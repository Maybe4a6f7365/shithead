// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialMode } from './App'
import { clearSession, saveSession } from './net/useMultiplayerRoom'
import { isResumableRound, SP_STORAGE_KEY, SP_STORAGE_VERSION, useSPGame } from './sp/SPSinglePlayer'

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

describe('pass-and-play round survives a reload', () => {
  beforeEach(() => clearSession())
  afterEach(() => {
    useSPGame.getState().reset()
    localStorage.removeItem(SP_STORAGE_KEY)
  })

  const startRound = () => useSPGame.getState().initGame([
    { name: 'Ada', isAI: false },
    { name: 'Bo', isAI: false },
  ])

  it('writes the round to storage without the privacy reveal', () => {
    startRound()
    useSPGame.getState().revealFor(useSPGame.getState().state.players[1].id)
    const stored = JSON.parse(localStorage.getItem(SP_STORAGE_KEY)!)
    expect(stored.version).toBe(SP_STORAGE_VERSION)
    expect(stored.state.state.phase).toBe('rearrange')
    expect(stored.state).not.toHaveProperty('revealedId')
    expect(isResumableRound(stored.state)).toBe(true)
  })

  it('restores the stored round and routes back to the local table', async () => {
    startRound()
    const saved = localStorage.getItem(SP_STORAGE_KEY)!
    const players = useSPGame.getState().state.players.map(player => player.id)
    useSPGame.getState().reset()
    expect(initialMode('')).toEqual({ name: 'landing' })

    localStorage.setItem(SP_STORAGE_KEY, saved)
    await useSPGame.persist.rehydrate()
    expect(useSPGame.getState().state.players.map(player => player.id)).toEqual(players)
    expect(useSPGame.getState().revealedId).toBeNull()
    expect(initialMode('')).toEqual({ name: 'hotseat' })
    // An explicit invite still wins over a saved local round.
    expect(initialMode('?room=abc123')).toEqual({ name: 'join-create' })
  })

  it('restores a round that is under way, with cards on the pile', async () => {
    startRound()
    const store = useSPGame.getState()
    for (const player of store.state.players) store.endRearrange(player.id)
    // Play until a card stays on the pile (a 10 or a quartet would burn it).
    for (let turn = 0; turn < 20 && useSPGame.getState().state.pile.every(entry => entry.cleared); turn++) {
      const { state, playCards, pickUpPile } = useSPGame.getState()
      const current = state.players[state.currentPlayerIdx]
      const before = state.turnCount
      for (const card of current.hand) {
        playCards(current.id, [card])
        if (useSPGame.getState().state.turnCount !== before) break
      }
      if (useSPGame.getState().state.turnCount === before) pickUpPile(current.id)
    }
    const playing = useSPGame.getState().state
    expect(playing.pile.some(entry => !entry.cleared)).toBe(true)

    const saved = localStorage.getItem(SP_STORAGE_KEY)!
    expect(isResumableRound(JSON.parse(saved).state)).toBe(true)
    useSPGame.getState().reset()
    localStorage.setItem(SP_STORAGE_KEY, saved)
    await useSPGame.persist.rehydrate()
    expect(useSPGame.getState().state.pile).toEqual(playing.pile)
    expect(useSPGame.getState().state.turnCount).toBe(playing.turnCount)
    expect(initialMode('')).toEqual({ name: 'hotseat' })
  })

  it('drops a snapshot whose pile is not a pile', async () => {
    startRound()
    const saved = JSON.parse(localStorage.getItem(SP_STORAGE_KEY)!)
    const withPile = (pile: unknown) => ({ ...saved.state, state: { ...saved.state.state, pile } })
    expect(isResumableRound(withPile([{ cards: [{ id: 'c1', rank: '9', suit: '♠' }], cleared: false }]))).toBe(true)
    expect(isResumableRound(withPile([{ id: 'c1', rank: '9', suit: '♠' }]))).toBe(false)
    expect(isResumableRound(withPile([{ cards: 'nope', cleared: false }]))).toBe(false)
    expect(isResumableRound(withPile([{ cards: [], cleared: 'no' }]))).toBe(false)
  })

  it('drops a malformed or outdated snapshot instead of resuming it', async () => {
    startRound()
    const saved = JSON.parse(localStorage.getItem(SP_STORAGE_KEY)!)
    useSPGame.getState().reset()

    localStorage.setItem(SP_STORAGE_KEY, JSON.stringify({ ...saved, version: SP_STORAGE_VERSION + 1 }))
    await useSPGame.persist.rehydrate()
    expect(initialMode('')).toEqual({ name: 'landing' })

    const broken = { ...saved, state: { ...saved.state, state: { ...saved.state.state, players: 'nope' } } }
    localStorage.setItem(SP_STORAGE_KEY, JSON.stringify(broken))
    await useSPGame.persist.rehydrate()
    expect(initialMode('')).toEqual({ name: 'landing' })
    expect(isResumableRound(broken.state)).toBe(false)
  })
})
