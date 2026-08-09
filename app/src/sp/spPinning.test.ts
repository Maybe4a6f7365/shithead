// ============================================================================
// Hand-pinning selectors (Appendix A.1): the bottom panel is pinned to ME;
// opponents never render in it; identity switches only via the deliberate
// pass-and-play gate, and only while the revealed player holds the turn.
// ============================================================================
import { describe, it, expect } from 'vitest'
import type { Player } from '../engine'
import { resolveViewerId, needsPassGate } from './SPSinglePlayer'

function player(id: string, isAI = false): Player {
  return { id, name: id, isAI, hand: [], faceUp: [], faceDown: [], isOut: false }
}

const players = [player('me'), player('ai', true), player('other')]

describe('resolveViewerId', () => {
  it('is pinned to me while AI or I hold the turn', () => {
    expect(resolveViewerId(players, 0, 'me', null)).toBe('me')   // my turn
    expect(resolveViewerId(players, 1, 'me', null)).toBe('me')   // AI turn
    expect(resolveViewerId(players, 2, 'me', null)).toBe('me')   // other human, not revealed
  })

  it('switches to a revealed non-me human ONLY while they hold the turn', () => {
    expect(resolveViewerId(players, 2, 'me', 'other')).toBe('other')
    // Turn moved on: viewer snaps back to me even if reveal flag lingers.
    expect(resolveViewerId(players, 1, 'me', 'other')).toBe('me')
    expect(resolveViewerId(players, 0, 'me', 'other')).toBe('me')
  })

  it('never reveals AI players', () => {
    expect(resolveViewerId(players, 1, 'me', 'ai')).toBe('me')
  })
})

describe('needsPassGate', () => {
  it('is true only for a non-me, non-AI, active player who has not revealed', () => {
    expect(needsPassGate(players, 2, 'me', null)).toBe(true)
    expect(needsPassGate(players, 2, 'me', 'other')).toBe(false)
    expect(needsPassGate(players, 1, 'me', null)).toBe(false) // AI never gates
    expect(needsPassGate(players, 0, 'me', null)).toBe(false) // my own turn
  })

  it('never gates on a player who is out', () => {
    const out = [player('me'), player('ai', true), { ...player('other'), isOut: true }]
    expect(needsPassGate(out, 2, 'me', null)).toBe(false)
  })
})
