import { describe, it, expect } from 'vitest'
import { canPlay, playClearsPile, isQuartet } from '../rules'
import { makeDeck, shuffleSeeded, RANK_ORDER } from '../deck'

describe('canPlay', () => {
  it('2 can be played on anything', () => {
    expect(canPlay({ id:'x', suit:'♠', rank:'2' }, 'A')).toBe(true)
    expect(canPlay({ id:'x', suit:'♠', rank:'2' }, '3')).toBe(true)
  })
  it('higher rank can be played on lower', () => {
    expect(canPlay({ id:'x', suit:'♠', rank:'7' }, '5')).toBe(true)
    expect(canPlay({ id:'x', suit:'♠', rank:'A' }, 'K')).toBe(true)
  })
  it('lower rank cannot be played on higher', () => {
    expect(canPlay({ id:'x', suit:'♠', rank:'5' }, '7')).toBe(false)
  })
  it('empty pile requires 3, 10, or joker to start', () => {
    expect(canPlay({ id:'x', suit:'♠', rank:'5' }, null)).toBe(false)
    expect(canPlay({ id:'x', suit:'♠', rank:'3' }, null)).toBe(true)
    expect(canPlay({ id:'x', suit:'♠', rank:'10' }, null)).toBe(true)
    expect(canPlay({ id:'x', suit:null, rank:'JOKER' }, null)).toBe(true)
  })
  it('joker can be played on anything', () => {
    expect(canPlay({ id:'x', suit:null, rank:'JOKER' }, 'A')).toBe(true)
  })
})

describe('playClearsPile', () => {
  it('10 clears', () => {
    expect(playClearsPile([{ id:'x', suit:'♠', rank:'10' }])).toBe(true)
  })
  it('quartet of 4 same rank clears', () => {
    const q = [
      { id:'a', suit:'♠' as const, rank:'7' as const },
      { id:'b', suit:'♥' as const, rank:'7' as const },
      { id:'c', suit:'♦' as const, rank:'7' as const },
      { id:'d', suit:'♣' as const, rank:'7' as const },
    ]
    expect(isQuartet(q)).toBe(true)
    expect(playClearsPile(q)).toBe(true)
  })
  it('3-of-a-kind does not clear', () => {
    const trio = [
      { id:'a', suit:'♠' as const, rank:'7' as const },
      { id:'b', suit:'♥' as const, rank:'7' as const },
      { id:'c', suit:'♦' as const, rank:'7' as const },
    ]
    expect(isQuartet(trio)).toBe(false)
    expect(playClearsPile(trio)).toBe(false)
  })
  it('quartet with joker does not count', () => {
    const bad = [
      { id:'a', suit:'♠' as const, rank:'7' as const },
      { id:'b', suit:'♥' as const, rank:'7' as const },
      { id:'c', suit:'♦' as const, rank:'7' as const },
      { id:'d', suit:null, rank:'JOKER' as const },
    ]
    expect(isQuartet(bad)).toBe(false)
  })
})

describe('deck', () => {
  it('makeDeck creates 54 cards (52 + 2 jokers)', () => {
    expect(makeDeck(true).length).toBe(54)
    expect(makeDeck(false).length).toBe(52)
  })
  it('shuffleSeeded is deterministic', () => {
    const rng = () => 0.5
    const a = shuffleSeeded([1,2,3,4,5,6,7,8,9,10], rng)
    const b = shuffleSeeded([1,2,3,4,5,6,7,8,9,10], rng)
    expect(a).toEqual(b)
  })
  it('rank order puts 3 lowest, A highest (excluding wilds)', () => {
    expect(RANK_ORDER['3']).toBeLessThan(RANK_ORDER['A'])
    expect(RANK_ORDER['10']).toBeLessThan(RANK_ORDER['A'])
  })
})
