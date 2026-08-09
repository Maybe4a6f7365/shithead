// ============================================================================
// AI tests — legal moves always, distinct tiers, full-game completion
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  initGame, startPlay, playCards, pickUpPile, pickAIMove, seededRng, MAX_GAME_TURNS,
} from '../index'
import type { Card, GameState } from '../index'
import { c, mkState } from './helpers'

describe('pickAIMove move generation', () => {
  it('picks up when nothing in hand beats the pile', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('4')], faceUp: [c('5')] }],
      pile: [[c('A')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'medium', seededRng(1))
    expect(move.type).toBe('pickUp')
    expect(pickUpPile(state, 'b').error).toBeUndefined()
  })

  it('plays from face-up when the hand is empty (never stalls endgame)', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [], faceUp: [c('K')], faceDown: [c('3')] }],
      pile: [[c('5')]],
      currentPlayerIdx: 1,
      phase: 'endgame',
    })
    const move = pickAIMove(state, state.players[1], 'medium', seededRng(1))
    expect(move.type).toBe('play')
    expect(move.cards![0].rank).toBe('K')
    expect(playCards(state, 'b', move.cards!).error).toBeUndefined()
  })

  it('plays exactly one blind face-down card when nothing else remains', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', faceDown: [c('K'), c('3')] }],
      pile: [[c('5')]],
      currentPlayerIdx: 1,
      phase: 'endgame',
    })
    const move = pickAIMove(state, state.players[1], 'hard', seededRng(1))
    expect(move.type).toBe('play')
    expect(move.cards!.length).toBe(1)
    expect(playCards(state, 'b', move.cards!).error).toBeUndefined()
  })

  it('medium plays the whole equal-rank set of its lowest non-special rank', () => {
    const hand = [c('5','♠'), c('5','♥'), c('9')]
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand }],
      pile: [[c('4')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'medium', seededRng(1))
    expect(move.type).toBe('play')
    expect(move.cards!.length).toBe(2)
    expect(move.cards!.every(cd => cd.rank === '5')).toBe(true)
  })

  it('easy plays a single card', () => {
    const hand = [c('5','♠'), c('5','♥')]
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand }],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'easy', seededRng(2))
    expect(move.type).toBe('play')
    expect(move.cards!.length).toBe(1)
  })

  it('hard wins immediately when one action sheds all remaining cards', () => {
    const hand = [c('7','♠'), c('7','♥')]
    const state = mkState({
      players: [{ id: 'a', hand: [c('3')] }, { id: 'b', hand }],
      pile: [[c('4')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'hard', seededRng(1))
    expect(move.cards!.length).toBe(2)
    const r = playCards(state, 'b', move.cards!)
    expect(r.state.players[1].isOut).toBe(true)
    expect(r.state.phase).toBe('gameOver')
  })

  it('hard burns a large pile with a 10 but hoards it against a small pile', () => {
    const mk = (pileRanks: Array<Array<Card['rank']>>) => mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('10'), c('8')], faceUp: [c('Q')], faceDown: [c('K')] }],
      pile: pileRanks.map(rs => rs.map(r => c(r))),
      currentPlayerIdx: 1,
    })
    const big = mk([['4'],['5'],['6'],['7']]) // pileSize 4
    const moveBig = pickAIMove(big, big.players[1], 'hard', seededRng(1))
    expect(moveBig.cards![0].rank).toBe('10')
    const small = mk([['4']])
    const moveSmall = pickAIMove(small, small.players[1], 'hard', seededRng(1))
    expect(moveSmall.cards!.every(cd => cd.rank === '8')).toBe(true)
  })

  it('hard recognizes a cumulative physical run and a four-plus multi-deck set', () => {
    const completing = [c('3'), c('3', '♥'), c('3', '♦')]
    const cumulative = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [...completing, c('9')] }],
      pile: [[c('K')], [c('3', '♣')]],
      currentPlayerIdx: 1,
    })
    const completion = pickAIMove(cumulative, cumulative.players[1], 'hard', seededRng(1))
    expect(completion.cards).toEqual(completing)
    expect(playCards(cumulative, 'b', completion.cards!).state.pile).toEqual([])

    const many = Array.from({ length: 6 }, (_, index) => c('6', '♠', `ai-six-${index}`))
    const multiDeck = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [...many, c('9')] }],
      pile: [[c('3')], [c('4')], [c('5')], [c('6')]],
      currentPlayerIdx: 1,
    })
    const largeSet = pickAIMove(multiDeck, multiDeck.players[1], 'hard', seededRng(1))
    expect(largeSet.cards).toEqual(many)
  })

  it('hard prefers spending a 2 over a burn card when only specials are playable', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('2'), c('10')], faceUp: [c('Q')], faceDown: [c('K')] }],
      pile: [[c('A')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'hard', seededRng(1))
    expect(move.cards![0].rank).toBe('2')
  })

  it('obeys the reversed 7 constraint and selects a legal low card', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('6'), c('8'), c('Q')] }],
      pile: [[c('7')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'medium', seededRng(1))
    expect(move.type).toBe('play')
    expect(move.cards![0].rank).toBe('6')
    expect(playCards(state, 'b', move.cards!).error).toBeUndefined()
  })

  it('can use a copying 3 on an otherwise unbeatable pile', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('3'), c('6')] }],
      pile: [[c('A')]],
      currentPlayerIdx: 1,
    })
    const move = pickAIMove(state, state.players[1], 'medium', seededRng(1))
    expect(move.type).toBe('play')
    expect(move.cards![0].rank).toBe('3')
    expect(playCards(state, 'b', move.cards!).error).toBeUndefined()
  })

  it('is deterministic with a seeded rng', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b', hand: [c('5'), c('9'), c('K')] }],
      currentPlayerIdx: 1,
    })
    const m1 = pickAIMove(state, state.players[1], 'easy', seededRng(8))
    const m2 = pickAIMove(state, state.players[1], 'easy', seededRng(8))
    expect(m1).toEqual(m2)
  })
})

// ---------- Full-game simulation ----------

// The stalemate cap (D11) guarantees termination at MAX_GAME_TURNS.
const MAX_TURNS = MAX_GAME_TURNS + 50

function simulate(seed: number, difficulties: Array<'easy'|'medium'|'hard'>): { state: GameState; turns: number } {
  const rng = seededRng(seed)
  let state = startPlay(initGame({
    players: difficulties.map((d, i) => ({ id: `p${i}`, name: `P${i}`, isAI: true, aiDifficulty: d })),
    rng,
  }))
  let turns = 0
  while (state.phase !== 'gameOver' && turns < MAX_TURNS) {
    const cur = state.players[state.currentPlayerIdx]
    if (!cur || cur.isOut) throw new Error(`turn stranded on out/missing player at turn ${turns}`)
    const move = pickAIMove(state, cur, cur.aiDifficulty ?? 'medium', rng)
    const res = move.type === 'play'
      ? playCards(state, cur.id, move.cards!)
      : pickUpPile(state, cur.id)
    if (res.error) throw new Error(`AI move rejected at turn ${turns}: ${res.error}`)
    state = res.state
    turns++
  }
  return { state, turns }
}

describe('AI full-game simulation (B9/B10 regression)', () => {
  it.each([
    ['easy vs easy', ['easy', 'easy'] as const, 101],
    ['medium vs medium', ['medium', 'medium'] as const, 102],
    ['hard vs hard', ['hard', 'hard'] as const, 103],
    ['easy vs hard', ['easy', 'hard'] as const, 104],
    ['3-player mixed', ['easy', 'medium', 'hard'] as const, 105],
    ['4-player hard', ['hard', 'hard', 'hard', 'hard'] as const, 106],
    ['5-player mixed', ['medium', 'hard', 'easy', 'medium', 'hard'] as const, 107],
  ])('%s completes to a winner within %d turns', (_label, difficulties, seed) => {
    const { state, turns } = simulate(seed, [...difficulties])
    expect(turns).toBeLessThan(MAX_TURNS)
    expect(state.phase).toBe('gameOver')
    expect(state.loserId).not.toBeNull()
    expect(state.players.filter(p => p.isOut).length).toBe(difficulties.length - 1)
  })

  it('two simulations with the same seed are identical (determinism)', () => {
    const a = simulate(202, ['medium', 'hard', 'easy'])
    const b = simulate(202, ['medium', 'hard', 'easy'])
    expect(a.turns).toBe(b.turns)
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })
})
