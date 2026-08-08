// ============================================================================
// Protocol tests — wire format + serialization (security-critical)
// ============================================================================
import { describe, it, expect } from 'vitest'
import { initGame } from '../index'
import { isClientMsg, serializeGameState, toPlayerSummary } from '../protocol'

describe('isClientMsg', () => {
  it('accepts valid message types', () => {
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'PING' })).toBe(true)
    expect(isClientMsg({ type: 'CHAT', text: 'hi' })).toBe(true)
  })
  it('rejects invalid types', () => {
    expect(isClientMsg({ type: 'NOPE' })).toBe(false)
    expect(isClientMsg({})).toBe(false)
    expect(isClientMsg(null)).toBe(false)
    expect(isClientMsg('string')).toBe(false)
    expect(isClientMsg(42)).toBe(false)
  })
})

describe('serializeGameState (security)', () => {
  it('hides other players face-down cards', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const serialized = serializeGameState(state, 'viewer')
    const opponent = serialized.players.find(p => p.id === 'opponent')!
    // Opponent's face-down cards are masked with dummy data (rank 3, no suit)
    expect(opponent.faceDown.length).toBe(3)
    expect(opponent.faceDown[0].rank).toBe('3')
    expect(opponent.faceDown[0].suit).toBe(null)
  })
  it('shows your own face-down cards', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const serialized = serializeGameState(state, 'viewer')
    const viewer = serialized.players.find(p => p.id === 'viewer')!
    // Viewer's face-down cards keep their real rank
    expect(viewer.faceDown.length).toBe(3)
    expect(['A','2','3','4','5','6','7','8','9','10','J','Q','K']).toContain(viewer.faceDown[0].rank)
  })
  it('shows all face-up and hand cards (public info)', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const serialized = serializeGameState(state, 'viewer')
    const opponent = serialized.players.find(p => p.id === 'opponent')!
    // Hand cards have real data
    expect(opponent.hand[0].rank).not.toBe('3') // hand wasn't masked
    // Face-up has real data
    expect(['A','2','3','4','5','6','7','8','9','10','J','Q','K']).toContain(opponent.faceUp[0].rank)
  })
})

describe('toPlayerSummary', () => {
  it('produces lobby-safe summary (no card details)', () => {
    const state = initGame({
      players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
      rng: () => 0,
    })
    const p = state.players[0]
    const summary = toPlayerSummary(p, true)
    expect(summary.id).toBe('a')
    expect(summary.name).toBe('Alice')
    expect(summary.connected).toBe(true)
    expect(summary.cardCount.hand).toBe(3)
    expect(summary.cardCount.faceUp).toBe(3)
    expect(summary.cardCount.faceDown).toBe(3)
    expect((summary as any).hand).toBeUndefined()
  })
})
