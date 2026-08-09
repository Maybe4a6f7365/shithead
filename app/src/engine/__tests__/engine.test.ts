// ============================================================================
// Engine tests — core primitives: deck, RNG, rules predicates, init, helpers
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  makeDeck, shuffle, seededRng, canPlay, isQuartet, playClearsPile,
  initGame, rearrange, startPlay, playCards, pickUpPile,
  RANK_ORDER, getCurrentPlayer, getTopCard, pileSize, MAX_LOG_ENTRIES,
} from '../index'
import type { Card } from '../index'
import { c, mkState } from './helpers'

describe('makeDeck', () => {
  it('creates 52 cards without jokers', () => {
    expect(makeDeck(false).length).toBe(52)
  })
  it('creates 54 cards with jokers', () => {
    expect(makeDeck(true).length).toBe(54)
  })
  it('has 13 cards per suit', () => {
    const deck = makeDeck(false)
    for (const suit of ['♠','♥','♦','♣'] as const) {
      expect(deck.filter(cd => cd.suit === suit).length).toBe(13)
    }
  })
  it('generates unique, opaque ids that never encode suit or rank', () => {
    const deck = makeDeck(true, seededRng(7))
    const ids = deck.map(cd => cd.id)
    expect(new Set(ids).size).toBe(deck.length)
    for (const cd of deck) {
      if (cd.suit) expect(cd.id).not.toContain(cd.suit)
      expect(cd.id).not.toMatch(/[♠♥♦♣]|JOKER/)
      expect(cd.id).toMatch(/^c[0-9a-z]+$/)
      // id never starts with the card's rank token (old format was `${suit}-${rank}-${idx}`)
      expect(cd.id.startsWith(`${cd.rank}-`)).toBe(false)
    }
  })
  it('is deterministic with a seeded rng', () => {
    expect(makeDeck(true, seededRng(42))).toEqual(makeDeck(true, seededRng(42)))
  })
})

describe('seededRng', () => {
  it('produces deterministic sequences in [0,1)', () => {
    const a = seededRng(1)
    const b = seededRng(1)
    for (let i = 0; i < 20; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('preserves length and elements', () => {
    const arr = [1,2,3,4,5]
    const s = shuffle(arr)
    expect(s.length).toBe(5)
    expect([...s].sort()).toEqual([1,2,3,4,5])
  })
  it('is deterministic with seeded RNG', () => {
    expect(shuffle([1,2,3,4,5], seededRng(9))).toEqual(shuffle([1,2,3,4,5], seededRng(9)))
  })
})

describe('canPlay', () => {
  it('2, 10 and Joker can be played on anything (README: play anytime)', () => {
    for (const top of ['A','K','3','10'] as const) {
      expect(canPlay(c('2'), top)).toBe(true)
      expect(canPlay(c('10'), top)).toBe(true)
      expect(canPlay(c('JOKER', null), top)).toBe(true)
    }
  })
  it('ANY card may lead on an empty pile (rule decision D1)', () => {
    for (const r of ['2','3','5','7','10','K','A','JOKER'] as const) {
      expect(canPlay(c(r, r === 'JOKER' ? null : '♠'), null)).toBe(true)
    }
  })
  it('higher or equal rank can be played on lower', () => {
    expect(canPlay(c('7'), '5')).toBe(true)
    expect(canPlay(c('7'), '7')).toBe(true)
    expect(canPlay(c('A'), 'K')).toBe(true)
  })
  it('lower rank cannot be played on higher', () => {
    expect(canPlay(c('5'), '7')).toBe(false)
    expect(canPlay(c('3'), 'A')).toBe(false)
  })
  it('anything non-wild follows a 2 (wild top)', () => {
    expect(canPlay(c('3'), '2')).toBe(true)
    expect(canPlay(c('A'), '2')).toBe(true)
  })
})

describe('isQuartet + playClearsPile', () => {
  it('quartet of 4 same non-wild rank clears', () => {
    const q = [c('7','♠'), c('7','♥'), c('7','♦'), c('7','♣')]
    expect(isQuartet(q)).toBe(true)
    expect(playClearsPile(q)).toBe(true)
  })
  it('3-of-a-kind does not clear', () => {
    expect(isQuartet([c('7','♠'), c('7','♥'), c('7','♦')])).toBe(false)
  })
  it('quartet containing a wild does not count', () => {
    expect(isQuartet([c('7','♠'), c('7','♥'), c('7','♦'), c('JOKER', null)])).toBe(false)
    expect(isQuartet([c('2','♠'), c('2','♥'), c('2','♦'), c('2','♣')])).toBe(false)
  })
  it('10 and Joker clear; 2 does not', () => {
    expect(playClearsPile([c('10')])).toBe(true)
    expect(playClearsPile([c('JOKER', null)])).toBe(true)
    expect(playClearsPile([c('2')])).toBe(false)
  })
})

describe('RANK_ORDER', () => {
  it('3 is lowest, A is highest (non-wild)', () => {
    expect(RANK_ORDER['3']).toBeLessThan(RANK_ORDER['A'])
    expect(RANK_ORDER['10']).toBeLessThan(RANK_ORDER['A'])
  })
  it('2 and JOKER are wild (negative)', () => {
    expect(RANK_ORDER['2']).toBeLessThan(0)
    expect(RANK_ORDER['JOKER']).toBeLessThan(0)
  })
})

describe('initGame', () => {
  it('deals 9 cards per player (3 face-down + 3 face-up + 3 hand)', () => {
    const state = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(3),
    })
    for (const p of state.players) {
      expect(p.faceDown.length).toBe(3)
      expect(p.faceUp.length).toBe(3)
      expect(p.hand.length).toBe(3)
      expect(p.isOut).toBe(false)
    }
  })
  it('rest of deck goes to stock; seq starts at 0; phase is rearrange', () => {
    const state = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(3),
    })
    expect(state.stock.length).toBe(54 - 18)
    expect(state.phase).toBe('rearrange')
    expect(state.seq).toBe(0)
  })
  it('is fully deterministic with a seeded rng', () => {
    const cfg = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }
    expect(initGame({ ...cfg, rng: seededRng(11) })).toEqual(initGame({ ...cfg, rng: seededRng(11) }))
  })
  it('rejects invalid player counts (engine-side deck guard)', () => {
    expect(() => initGame({ players: [{ id: 'a', name: 'A' }] })).toThrow()
    expect(() => initGame({
      players: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    })).toThrow()
  })
})

describe('rearrange + startPlay', () => {
  it('swaps a hand card with a face-up card and bumps seq', () => {
    let state = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(5),
    })
    const handCard = state.players[0].hand[0]
    const upCard = state.players[0].faceUp[0]
    state = rearrange(state, 'a', 0, 0)
    expect(state.players[0].hand[0]).toEqual(upCard)
    expect(state.players[0].faceUp[0]).toEqual(handCard)
    expect(state.seq).toBe(1)
  })
  it('no-op outside rearrange phase', () => {
    let state = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(5),
    })
    state = startPlay(state)
    const before = state.players[0]
    state = rearrange(state, 'a', 0, 0)
    expect(state.players[0]).toEqual(before)
  })
  it('startPlay moves to play phase', () => {
    let state = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(5),
    })
    state = startPlay(state)
    expect(state.phase).toBe('play')
  })
})

describe('playCards basics', () => {
  it('rejects if not your turn', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      currentPlayerIdx: 0,
    })
    const r = playCards(state, 'b', [c('6')])
    expect(r.error).toBe('Not your turn')
  })
  it('rejects playing outside play/endgame phases', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      phase: 'rearrange',
    })
    expect(playCards(state, 'a', [state.players[0].hand[0]]).error).toMatch(/phase/)
  })
  it('removes played cards and refills hand to 3 from stock', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5'), c('6'), c('7')] }, { id: 'b', hand: [c('8')] }],
      stock: [c('9'), c('J')],
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.error).toBeUndefined()
    const a = r.state.players[0]
    expect(a.hand.length).toBe(3)
    expect(a.hand.some(cd => cd.rank === '5')).toBe(false)
    expect(r.state.stock.length).toBe(1)
  })
  it('increments seq and turnCount on every accepted action', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5'), c('8')] }, { id: 'b', hand: [c('6')] }],
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.state.seq).toBe(1)
    expect(r.state.turnCount).toBe(1)
    const r2 = playCards(r.state, 'b', [r.state.players[1].hand[0]])
    expect(r2.state.seq).toBe(2)
  })
})

describe('pickUpPile basics', () => {
  it('rejects if not your turn', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('7')]],
    })
    expect(pickUpPile(state, 'b').error).toBe('Not your turn')
  })
  it('collects the whole pile, advances turn, never draws stock', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('7')], [c('8'), c('8', '♥')]],
      stock: [c('9'), c('J'), c('Q')],
    })
    const r = pickUpPile(state, 'a')
    expect(r.error).toBeUndefined()
    expect(r.state.players[0].hand.length).toBe(1 + 3)
    expect(r.state.pile.length).toBe(0)
    expect(r.state.stock.length).toBe(3) // unchanged: no free pickup draws
    expect(r.state.currentPlayerIdx).toBe(1)
  })
})

describe('helpers', () => {
  it('getCurrentPlayer returns the current player', () => {
    const state = mkState({ players: [{ id: 'a' }, { id: 'b' }], currentPlayerIdx: 1 })
    expect(getCurrentPlayer(state)!.id).toBe('b')
  })
  it('getTopCard skips cleared entries and pileSize counts live cards', () => {
    const state = mkState({ players: [{ id: 'a' }, { id: 'b' }], pile: [[c('5')], [c('9')]] })
    state.pile[1].cleared = true // legacy shape tolerance
    expect(getTopCard(state)!.rank).toBe('5')
    expect(pileSize(state)).toBe(1)
  })
  it('log is capped at MAX_LOG_ENTRIES', () => {
    const log = Array.from({ length: MAX_LOG_ENTRIES }, () => ({ type: 'PICK_UP_PILE' as const, playerId: 'a' }))
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      log,
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.state.log.length).toBe(MAX_LOG_ENTRIES)
  })
})

// Re-export for backwards compatibility of imports in old call sites.
export type { Card }
