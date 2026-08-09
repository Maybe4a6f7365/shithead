// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { initialMode } from './App'
import { clearSession, saveSession } from './net/useMultiplayerRoom'

describe('App refresh and invite routing', () => {
  beforeEach(() => clearSession())

  it('restores a secure multiplayer session on refresh and on its own invite link', () => {
    saveSession({
      roomCode: 'ABC123', playerId: 'player-a', playerName: 'Ada', resumeToken: 'rotating-secret',
    })
    expect(initialMode('')).toEqual({
      name: 'mp-room', roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    })
    expect(initialMode('?room=abc123')).toEqual({
      name: 'mp-room', roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    })
  })

  it('does not swallow an explicit invite to a different room with a saved seat', () => {
    saveSession({
      roomCode: 'ABC123', playerId: 'player-a', playerName: 'Ada', resumeToken: 'rotating-secret',
    })
    expect(initialMode('?room=ZZZ999')).toEqual({ name: 'join-create' })
  })

  it('opens the join screen for a valid shared room link', () => {
    expect(initialMode('?room=abc123')).toEqual({ name: 'join-create' })
  })

  it('does not route malformed room links or tokenless records into multiplayer', () => {
    saveSession({ roomCode: 'ABC123', playerId: 'player-a', playerName: 'Ada' })
    expect(initialMode('?room=not-a-code')).toEqual({ name: 'landing' })
  })
})
