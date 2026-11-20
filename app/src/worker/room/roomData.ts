// ============================================================================
// The durable room snapshot (one per Durable Object, under the key 'room'),
// and how a snapshot written by any earlier version is brought up to date when
// the object is recreated.
// ============================================================================
import type { GameRules, GameState, Player } from '../../engine'
import type { SpectatorIdentity } from '../../engine/protocol'
import {
  normalizeEasterEggEnabled,
  normalizeGameRules,
  normalizeOfflineSince,
  normalizePersistedGameState,
  normalizeRematchVotes,
  normalizeSpectators,
} from '../migrateState'
import { normalizeStoredPendingOndraEvent, type PendingOndraEvent } from '../tableMessages'

/** A room nobody has connected to or written for this long is deleted. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000

export interface RoomData {
  version: 7
  code: string
  hostId: string
  maxPlayers: number
  easterEggEnabled: boolean
  players: Player[]
  /** FIFO identities watching the current round and waiting for an open seat. */
  spectators: SpectatorIdentity[]
  state: GameState | null
  rules: GameRules
  readyPlayerIds: string[]
  /** Authenticated playerId -> explicit yes/no vote for the finished round. */
  rematchVotes: Record<string, boolean>
  /** Player id -> start of the current continuous offline spell. */
  offlineSince: Record<string, number>
  /** playerId -> SHA-256 hex hash of the current resume token (secret). */
  resumeTokens: Record<string, string>
  /** Private delayed system event; never serialized into room/game views. */
  pendingTableEvent: PendingOndraEvent | null
  createdAt: number
  lastActivity: number
}

export type StoredRoomData = Omit<RoomData, 'version' | 'rules' | 'easterEggEnabled' | 'readyPlayerIds' | 'rematchVotes' | 'offlineSince' | 'spectators' | 'lastActivity' | 'resumeTokens' | 'pendingTableEvent' | 'state'> & {
  version?: 1 | 2 | 3 | 4 | 5 | 6 | 7
  state: GameState | null
  rules?: Partial<GameRules>
  easterEggEnabled?: unknown
  readyPlayerIds?: string[]
  rematchVotes?: unknown
  offlineSince?: unknown
  spectators?: unknown
  lastActivity?: number
  resumeTokens?: Record<string, string>
  pendingTableEvent?: PendingOndraEvent | null
}

/**
 * Bring a stored snapshot of any version to the current shape. Runs once, when
 * the Durable Object is recreated: at that moment no socket is connected, so
 * every seat and watcher starts out offline.
 */
export function restoreRoomData(stored: StoredRoomData, restoredAt: number): RoomData {
  const rules = normalizeGameRules(stored.state?.rules, stored.rules)
  const normalizedState = normalizePersistedGameState(stored.state, rules)
  const restoresTableEvent = normalizedState?.phase === 'play' || normalizedState?.phase === 'endgame'
  const easterEggEnabled = normalizeEasterEggEnabled(stored.easterEggEnabled)
  const resumeTokens = stored.resumeTokens ?? {}
  const restoredSpectators = normalizeSpectators(stored.spectators, stored.players, restoredAt, resumeTokens)
  // Native socket presence does not survive a Durable Object recreation.
  // Preserve a known offline spell; otherwise grant one fresh bounded
  // resume window to a watcher whose live socket disappeared with it.
  const spectators = restoredSpectators.map(spectator => ({
    ...spectator,
    disconnectedAt: spectator.disconnectedAt ?? restoredAt,
  }))
  const offlineSince = normalizeOfflineSince(stored.offlineSince, stored.players, restoredAt)
  // Socket presence is intentionally not persisted. After an object
  // recreation, any seat without a valid stored timestamp receives a
  // fresh grace window and a reconnect clears it before it can be kicked.
  for (const player of stored.players) {
    if (offlineSince[player.id] === undefined) offlineSince[player.id] = restoredAt
  }

  return {
    ...stored,
    version: 7,
    rules,
    easterEggEnabled,
    spectators,
    offlineSince,
    state: normalizedState,
    readyPlayerIds: stored.readyPlayerIds ?? [],
    rematchVotes: normalizeRematchVotes(
      stored.rematchVotes,
      stored.players,
      normalizedState?.phase ?? null,
    ),
    lastActivity: stored.lastActivity ?? stored.createdAt,
    resumeTokens,
    pendingTableEvent: easterEggEnabled && restoresTableEvent
      ? normalizeStoredPendingOndraEvent(
          stored.pendingTableEvent,
          stored.players,
          normalizedState.turnCount,
        )
      : null,
  }
}
