// What a room looks like after its Durable Object is recreated from storage.
// The live Worker suites never see this: a room is not evicted mid-test.
import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES, initGame, seededRng, startPlay, type GameState, type Player } from '../../engine'
import { restoreRoomData, type StoredRoomData } from '../room/roomData'
import type { PendingOndraEvent } from '../tableMessages'

const seat = (id: string, name: string): Player =>
  ({ id, name, isAI: false, hand: [], faceUp: [], faceDown: [], isOut: false })
const PLAYERS = [seat('a', 'Ondra'), seat('b', 'Bea')]
const tokenHash = (digit: string) => digit.repeat(64)

function deal(players: Player[] = PLAYERS): GameState {
  return initGame({ players: players.map(player => ({ id: player.id, name: player.name })), rng: seededRng(4) })
}

/** A snapshot as the first version wrote it: none of the later fields. */
function snapshot(overrides: Partial<StoredRoomData> = {}): StoredRoomData {
  return {
    version: 1,
    code: 'ABC234',
    hostId: 'a',
    maxPlayers: 4,
    players: PLAYERS,
    state: null,
    createdAt: 1_000,
    ...overrides,
  }
}

describe('restoring a stored room', () => {
  it('brings a first-version waiting room up to date', () => {
    expect(restoreRoomData(snapshot(), 5_000)).toEqual({
      version: 7,
      code: 'ABC234',
      hostId: 'a',
      maxPlayers: 4,
      players: PLAYERS,
      state: null,
      createdAt: 1_000,
      lastActivity: 1_000,
      rules: DEFAULT_GAME_RULES,
      easterEggEnabled: true,
      spectators: [],
      // Nobody is connected at the moment of restore.
      offlineSince: { a: 5_000, b: 5_000 },
      readyPlayerIds: [],
      rematchVotes: {},
      resumeTokens: {},
      pendingTableEvent: null,
    })
  })

  it('keeps the settings and activity time a later snapshot stored', () => {
    const restored = restoreRoomData(snapshot({
      version: 7,
      rules: { deckCount: 2, includeJokers: false },
      easterEggEnabled: false,
      readyPlayerIds: ['a'],
      lastActivity: 4_000,
      resumeTokens: { a: tokenHash('a') },
    }), 5_000)
    expect(restored.rules).toEqual({ ...DEFAULT_GAME_RULES, deckCount: 2, includeJokers: false })
    expect(restored.easterEggEnabled).toBe(false)
    expect(restored.readyPlayerIds).toEqual(['a'])
    expect(restored.lastActivity).toBe(4_000)
    expect(restored.resumeTokens).toEqual({ a: tokenHash('a') })
  })

  it('keeps an offline clock that was already running and starts every other one now', () => {
    const restored = restoreRoomData(snapshot({
      offlineSince: { a: 2_000, ghost: 2_500, b: 9_999 },
      resumeTokens: { w1: tokenHash('1'), w2: tokenHash('2') },
      spectators: [
        { id: 'w1', name: 'Wren', joinedAt: 1_500 },
        { id: 'w2', name: 'Wade', joinedAt: 1_600, disconnectedAt: 3_000 },
        { id: 'w3', name: 'No token', joinedAt: 1_700 },
      ],
    }), 5_000)
    // Unknown ids and clocks from the future are dropped.
    expect(restored.offlineSince).toEqual({ a: 2_000, b: 5_000 })
    // A watcher without a stored token can never resume, so it is not restored.
    expect(restored.spectators).toEqual([
      { id: 'w1', name: 'Wren', joinedAt: 1_500, disconnectedAt: 5_000 },
      { id: 'w2', name: 'Wade', joinedAt: 1_600, disconnectedAt: 3_000 },
    ])
  })

  it('keeps rematch votes only for a finished round, and only for seated players', () => {
    const votes = { a: true, b: 'yes', stranger: false }
    const finished = restoreRoomData(snapshot({ state: { ...deal(), phase: 'gameOver' }, rematchVotes: votes }), 5_000)
    expect(finished.rematchVotes).toEqual({ a: true })
    const live = restoreRoomData(snapshot({ state: deal(), rematchVotes: votes }), 5_000)
    expect(live.rematchVotes).toEqual({})
  })

  it('restores the private table event only for a round in play with the easter egg on', () => {
    const playing = startPlay(deal())
    expect(playing.phase).toBe('play')
    const pending: PendingOndraEvent = {
      playerId: 'a', playerName: 'Ondra', message: 'ondra-faster', triggerTurnCount: playing.turnCount + 3,
    }
    expect(restoreRoomData(snapshot({ state: playing, pendingTableEvent: pending }), 5_000).pendingTableEvent)
      .toEqual(pending)
    expect(restoreRoomData(snapshot({ state: playing, pendingTableEvent: pending, easterEggEnabled: false }), 5_000)
      .pendingTableEvent).toBeNull()
    expect(restoreRoomData(snapshot({ state: deal(), pendingTableEvent: pending }), 5_000).pendingTableEvent)
      .toBeNull()
  })
})
