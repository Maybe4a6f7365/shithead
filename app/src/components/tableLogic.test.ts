// ============================================================================
// Table presentation logic: stable seat ordering, feed lines, pile tilt.
// ============================================================================
import { describe, it, expect } from 'vitest'
import type { GameState, Player } from '../engine'
import { orderSeats } from './OpponentStrip'
import { feedLine } from './feedText'
import { pileTilt } from './Card'

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
    phase: 'play', players: [player('me'), player('greta')], stock: [], pile: [],
    currentPlayerIdx: 0, playDirection: 1, turnCount: 1, loserId: null, log, seq: 1,
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
})

describe('pileTilt', () => {
  it('is deterministic and within ±2.5°', () => {
    for (const id of ['abc', 'hidden:stock:3', 'c1x9z2']) {
      expect(pileTilt(id)).toBe(pileTilt(id))
      expect(Math.abs(pileTilt(id))).toBeLessThanOrEqual(2.5)
    }
  })
})
