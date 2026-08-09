// @vitest-environment jsdom
// ============================================================================
// net/ contract tests: GAME_STATE seq guard (protocol: ignore seq <= last
// seen) and resume-token session persistence.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest'
import type { GameState } from '../engine'
import {
  shouldAcceptGameState, loadSession, saveSession, clearSession,
} from './useMultiplayerRoom'

function gs(seq: number, turnCount = seq, phase: GameState['phase'] = 'play'): GameState {
  return {
    phase, players: [], stock: [], pile: [],
    currentPlayerIdx: 0, playDirection: 1, turnCount,
    loserId: null, log: [], seq,
  }
}

describe('shouldAcceptGameState', () => {
  it('accepts the first state and forward movement', () => {
    expect(shouldAcceptGameState(gs(3), null)).toBe(true)
    expect(shouldAcceptGameState(gs(4), 3)).toBe(true)
  })

  it('ignores duplicates and out-of-order deliveries', () => {
    expect(shouldAcceptGameState(gs(3), 3)).toBe(false)
    expect(shouldAcceptGameState(gs(2), 3)).toBe(false)
  })

  it('accepts a rematch fresh deal (seq 0, turnCount 0, rearrange)', () => {
    expect(shouldAcceptGameState(gs(0, 0, 'rearrange'), 87)).toBe(true)
  })

  it('does not treat arbitrary low seqs as a new game', () => {
    expect(shouldAcceptGameState(gs(0, 0, 'play'), 87)).toBe(false)
    expect(shouldAcceptGameState(gs(1, 1, 'rearrange'), 87)).toBe(false)
  })

  it('accepts legacy states without seq', () => {
    const legacy = gs(0)
    delete legacy.seq
    expect(shouldAcceptGameState(legacy, 42)).toBe(true)
  })
})

describe('resume session storage', () => {
  beforeEach(() => clearSession())

  it('round-trips { roomCode, playerId, resumeToken, playerName }', () => {
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
    expect(loadSession()).toEqual({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
  })

  it('rotation: saving the new token replaces the old one', () => {
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-b', playerName: 'Greta' })
    expect(loadSession()?.resumeToken).toBe('tok-b')
  })

  it('works without a token (today’s worker) and clears on demand', () => {
    saveSession({ roomCode: 'ABCDEF', playerId: 'p9', playerName: 'Hans' })
    expect(loadSession()?.resumeToken).toBeUndefined()
    clearSession()
    expect(loadSession()).toBeNull()
  })

  it('returns null on corrupted storage', () => {
    localStorage.setItem('shithead:session', '{not json')
    expect(loadSession()).toBeNull()
    localStorage.setItem('shithead:session', '{"playerId":"x"}')
    expect(loadSession()).toBeNull()
  })
})
