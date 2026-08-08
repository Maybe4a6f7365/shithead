// ============================================================================
// Protocol tests — wire format + serialization (security-critical)
// ============================================================================
import { describe, it, expect } from 'vitest'
import { initGame } from '../index'
import { isClientMsg, serializeGameState, toPlayerSummary } from '../protocol'

describe('isClientMsg', () => {
  it('accepts valid message types and resume payloads', () => {
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'RESUME_ROOM', playerId: 'player-id' })).toBe(true)
    expect(isClientMsg({ type: 'PING' })).toBe(true)
    expect(isClientMsg({ type: 'CHAT', text: 'hi' })).toBe(true)
  })

  it('rejects malformed or oversized payloads', () => {
    expect(isClientMsg({ type: 'CREATE_ROOM' })).toBe(false)
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: 'X', maxPlayers: 99 })).toBe(false)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'bad', playerName: 'X' })).toBe(false)
    expect(isClientMsg({ type: 'RESUME_ROOM', playerId: '' })).toBe(false)
    expect(isClientMsg({ type: 'PLAY', cards: [] })).toBe(false)
    expect(isClientMsg({ type: 'CHAT', text: 'x'.repeat(201) })).toBe(false)
    expect(isClientMsg({ type: 'NOPE' })).toBe(false)
    expect(isClientMsg({})).toBe(false)
    expect(isClientMsg(null)).toBe(false)
    expect(isClientMsg('string')).toBe(false)
    expect(isClientMsg(42)).toBe(false)
  })
})

describe('serializeGameState (security)', () => {
  it('hides opponent hands while preserving card IDs and counts', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const original = state.players.find(p => p.id === 'opponent')!
    const serialized = serializeGameState(state, 'viewer')
    const opponent = serialized.players.find(p => p.id === 'opponent')!

    expect(opponent.hand).toHaveLength(original.hand.length)
    expect(opponent.hand[0].id).toBe(original.hand[0].id)
    expect(opponent.hand[0].rank).toBe('3')
    expect(opponent.hand[0].suit).toBe(null)
  })

  it('hides every face-down card, including the viewers own blind cards', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const serialized = serializeGameState(state, 'viewer')

    for (const player of serialized.players) {
      expect(player.faceDown).toHaveLength(3)
      expect(player.faceDown.every(card => card.rank === '3' && card.suit === null)).toBe(true)
    }
  })

  it('shows the viewers hand and every public face-up card', () => {
    const state = initGame({
      players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
      rng: () => 0,
    })
    const serialized = serializeGameState(state, 'viewer')
    const viewer = serialized.players.find(p => p.id === 'viewer')!
    const opponent = serialized.players.find(p => p.id === 'opponent')!

    expect(viewer.hand).toEqual(state.players.find(p => p.id === 'viewer')!.hand)
    expect(opponent.faceUp).toEqual(state.players.find(p => p.id === 'opponent')!.faceUp)
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
