// ============================================================================
// Table presentation logic: stable seat ordering, feed lines, pile tilt.
// ============================================================================
import { describe, it, expect } from 'vitest'
import type { GameState, Player } from '../engine'
import { orderSeats } from './OpponentStrip'
import { feedLine, latestActionEvents } from './feedText'
import { pileTilt } from './Card'
import { isMatchingSelfEmoteEcho, nextRankSelection } from './TableScreen'

function player(id: string): Player {
  const name = id.charAt(0).toUpperCase() + id.slice(1)
  return { id, name, hand: [], faceUp: [], faceDown: [], isOut: false }
}

describe('orderSeats', () => {
  it('orders by turn order relative to me, next player leftmost', () => {
    const ps = [player('a'), player('b'), player('c'), player('d')]
    expect(orderSeats(ps, 'a').map(p => p.id)).toEqual(['b', 'c', 'd'])
    expect(orderSeats(ps, 'c').map(p => p.id)).toEqual(['d', 'a', 'b'])
  })

  it('never reorders between calls for the same me (stable highlight fix)', () => {
    const ps = [player('a'), player('b'), player('c')]
    expect(orderSeats(ps, 'b')).toEqual(orderSeats(ps, 'b'))
  })
})

function gs(log: GameState['log']): GameState {
  return {
    phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [player('me'), player('greta')], stock: [], pile: [],
    currentPlayerIdx: 0, playDirection: 1, turnCount: 1,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log, seq: 1,
  }
}

describe('feedLine', () => {
  const ctx = { meId: 'me', players: [player('me'), player('greta')] }

  it('names the actor and the card for plays', () => {
    const line = feedLine(gs([{ type: 'PLAY_CARDS', playerId: 'greta', cards: [{ id: 'x', suit: '♥', rank: '9' }] }]), ctx)
    expect(line?.text).toBe('Greta played the 9 of hearts')
  })

  it('says "You" for the local player', () => {
    const line = feedLine(gs([{ type: 'PLAY_CARDS', playerId: 'me', cards: [{ id: 'x', suit: '♣', rank: 'K' }] }]), ctx)
    expect(line?.text).toBe('You played the King of clubs')
  })

  it('burn line borrows the actor from the preceding play', () => {
    const line = feedLine(gs([
      { type: 'PLAY_CARDS', playerId: 'greta', cards: [{ id: 'x', suit: '♣', rank: '10' }] },
      { type: 'CLEAR_PILE', reason: 'ten' },
    ]), ctx)
    expect(line?.text).toBe('Pile burned by Greta')
  })

  it('blind reveal success and failure read differently', () => {
    const ok = feedLine(gs([{ type: 'BLIND_REVEAL', playerId: 'me', card: { id: 'x', suit: '♠', rank: 'A' }, success: true }]), ctx)
    expect(ok?.text).toContain('blind')
    const bad = feedLine(gs([{ type: 'BLIND_REVEAL', playerId: 'me', card: { id: 'x', suit: '♠', rank: '4' }, success: false }]), ctx)
    expect(bad?.text).toContain('too low')
  })

  it('folds a trailing draw into the play and keys the feed by seq, not capped log length', () => {
    const state = {
      ...gs([
        { type: 'PLAY_CARDS' as const, playerId: 'greta', cards: [{ id: 'x', suit: '♥' as const, rank: '9' as const }] },
        { type: 'DRAW' as const, playerId: 'greta', count: 1 },
      ]),
      seq: 77,
    }
    const line = feedLine(state, ctx)
    expect(line?.text).toBe('Greta played the 9 of hearts')
    expect(line?.key).toBe(77)
  })

  it('treats a bare GAME_OVER as its own block instead of replaying the prior action', () => {
    const log: GameState['log'] = [
      { type: 'PLAY_CARDS', playerId: 'greta', cards: [{ id: 'x', suit: '♥', rank: '9' }] },
      { type: 'GAME_OVER', loserId: 'greta' },
    ]
    expect(latestActionEvents(log)).toEqual([{ type: 'GAME_OVER', loserId: 'greta' }])
    expect(feedLine({ ...gs(log), loserId: 'greta' }, ctx)?.text).toContain('Round over')
  })
})

describe('pileTilt', () => {
  it('is deterministic and within ±2.5°', () => {
    for (const id of ['abc', 'hidden:stock:3', 'c1x9z2']) {
      expect(pileTilt(id)).toBe(pileTilt(id))
      expect(Math.abs(pileTilt(id))).toBeLessThanOrEqual(2.5)
    }
  })
})

describe('rank selection', () => {
  const fiveA = { id: 'five-a', rank: '5', suit: '♣' } as const
  const fiveB = { id: 'five-b', rank: '5', suit: '♠' } as const
  const seven = { id: 'seven', rank: '7', suit: '♦' } as const
  const cards = [fiveA, fiveB, seven]

  it('adds and removes cards of the selected rank', () => {
    expect(nextRankSelection(['five-a'], fiveB, cards)).toEqual(['five-a', 'five-b'])
    expect(nextRankSelection(['five-a', 'five-b'], fiveA, cards)).toEqual(['five-b'])
  })

  it('atomically replaces the highlighted rank in one tap', () => {
    expect(nextRankSelection(['five-a', 'five-b'], seven, cards)).toEqual(['seven'])
  })

  it('allows every equal-rank card from multi-deck hands, beyond four', () => {
    const fives = Array.from({ length: 7 }, (_, index) => ({ id: `five-${index}`, rank: '5', suit: '♣' } as const))
    let selection: string[] = []
    for (const next of fives) selection = nextRankSelection(selection, next, fives)
    expect(selection).toEqual(fives.map(card => card.id))
  })
})

describe('emote echo dedupe', () => {
  it('suppresses only the matching short-lived server echo from this viewer', () => {
    const pending = { emote: 'fire' as const, sentAt: 1000 }
    expect(isMatchingSelfEmoteEcho(pending, { playerId: 'me', emote: 'fire', ts: 99_000 }, 'me', 1100)).toBe(true)
    expect(isMatchingSelfEmoteEcho(pending, { playerId: 'other', emote: 'fire', ts: 1100 }, 'me', 1100)).toBe(false)
    expect(isMatchingSelfEmoteEcho(pending, { playerId: 'me', emote: 'wow', ts: 1100 }, 'me', 1100)).toBe(false)
    expect(isMatchingSelfEmoteEcho(pending, { playerId: 'me', emote: 'fire', ts: 1100 }, 'me', 4000)).toBe(false)
  })
})
