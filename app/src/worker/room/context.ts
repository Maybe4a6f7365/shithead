// ============================================================================
// RoomContext — one room's live state and what every handler needs to act on
// it: the snapshot and its persistence, the sockets and who they belong to,
// and how views of the room reach them. The handlers in ./membership, ./lobby,
// ./gameplay and ./reactions work through this object only; the Durable Object
// in ./Room owns the sockets' lifecycle and serializes every operation.
// ============================================================================
import type { RoomSummary, ServerMsg, ViewerRole } from '../../engine/protocol'
import {
  PROTOCOL_VERSION,
  serializeGameState,
  serializeSpectatorGameState,
  SPECTATOR_RECONNECT_GRACE_MS,
  toPlayerSummary,
} from '../../engine/protocol'
import { ROOM_TTL_MS, type RoomData } from './roomData'

export interface Session {
  webSocket: WebSocket
  /** Null until CREATE_ROOM, JOIN_ROOM or RESUME_ROOM succeeds on this socket. */
  playerId: string | null
  recentMessages: number[]
}

export type OutMsg = ServerMsg

export class RoomContext {
  readonly sessions = new Map<string, Session>()
  /** Ephemeral per-player spam buckets survive socket reconnects within this room instance. */
  readonly customMessageTimestamps = new Map<string, number[]>()
  /** Shared reaction cooldown follows the authenticated player across socket resumes. */
  readonly lastReactionAtByPlayer = new Map<string, number>()
  /** Vote changes are cheap for the UI but durable writes, so throttle by identity across resumes. */
  readonly lastRematchVoteAtByPlayer = new Map<string, number>()
  data: RoomData | null = null
  /** The code this object serves, from the socket URL; equals data.code once the room exists. */
  code = ''

  constructor(readonly storage: DurableObjectStorage) {}

  async save(): Promise<void> {
    if (!this.data) {
      await this.storage.delete('room')
      return
    }

    this.data.lastActivity = Date.now()
    await this.storage.put('room', this.data)
    await this.scheduleCleanup()
  }

  async scheduleCleanup(): Promise<void> {
    await this.storage.setAlarm(Date.now() + ROOM_TTL_MS)
  }

  /** Drop the in-memory rate-limit state of a member who has left the room. */
  forgetMember(memberId: string): void {
    this.customMessageTimestamps.delete(memberId)
    this.lastReactionAtByPlayer.delete(memberId)
    this.lastRematchVoteAtByPlayer.delete(memberId)
  }

  forgetAllMembers(): void {
    this.customMessageTimestamps.clear()
    this.lastReactionAtByPlayer.clear()
    this.lastRematchVoteAtByPlayer.clear()
  }

  /**
   * Detach a socket from the room for good: send it `notice` (if any), forget
   * whom it belonged to, and close it. Its own close event then finds nothing
   * left to update.
   */
  endSession(sessionId: string, session: Session, notice: OutMsg | null, closeCode: number, closeReason: string): void {
    if (notice) this.send(session, notice)
    session.playerId = null
    session.recentMessages = []
    this.sessions.delete(sessionId)
    try { session.webSocket.close(closeCode, closeReason) } catch {}
  }

  isConnected(playerId: string): boolean {
    return [...this.sessions.values()].some(session => session.playerId === playerId)
  }

  roleOf(memberId: string | null): ViewerRole | null {
    if (!memberId || !this.data) return null
    if (this.data.players.some(player => player.id === memberId)) return 'player'
    if (this.data.spectators.some(spectator => spectator.id === memberId)) return 'spectator'
    return null
  }

  isMember(memberId: string): boolean {
    return this.roleOf(memberId) !== null
  }

  /**
   * Resolve the attribution stamped onto an ephemeral table message. Room
   * summaries carry spectator counts but never spectator identities, so a
   * watcher's name reaches the table only here — on a message that watcher
   * chose to send. Silent watchers stay anonymous.
   */
  speakerOf(memberId: string): { playerName: string; role: ViewerRole } | null {
    const data = this.data
    if (!data) return null
    const player = data.players.find(entry => entry.id === memberId)
    if (player) return { playerName: player.name, role: 'player' }
    const spectator = data.spectators.find(entry => entry.id === memberId)
    if (spectator) return { playerName: spectator.name, role: 'spectator' }
    return null
  }

  /** Remove abandoned watcher identities without sacrificing brief reconnects. */
  pruneExpiredSpectators(now = Date.now()): boolean {
    const data = this.data
    if (!data) return false
    const expired = data.spectators.filter(spectator =>
      !this.isConnected(spectator.id) && spectator.disconnectedAt !== undefined &&
      now - spectator.disconnectedAt >= SPECTATOR_RECONNECT_GRACE_MS)
    if (expired.length === 0) return false

    const expiredIds = new Set(expired.map(spectator => spectator.id))
    data.spectators = data.spectators.filter(spectator => !expiredIds.has(spectator.id))
    for (const id of expiredIds) {
      delete data.resumeTokens[id]
      this.forgetMember(id)
    }
    return true
  }

  summary(): RoomSummary {
    const { data } = this
    if (!data) throw new Error('No room to summarise')
    return {
      code: data.code,
      phase: data.state?.phase ?? 'waiting',
      hostId: data.hostId,
      maxPlayers: data.maxPlayers,
      easterEggEnabled: data.easterEggEnabled,
      players: data.players.map(lobbyPlayer => {
        const currentPlayer = data.state?.players.find(player => player.id === lobbyPlayer.id) ?? lobbyPlayer
        const connected = this.isConnected(lobbyPlayer.id)
        return toPlayerSummary(currentPlayer, connected, connected ? undefined : data.offlineSince[lobbyPlayer.id])
      }),
      spectatorCount: data.spectators.filter(spectator => this.isConnected(spectator.id)).length,
      spectatorQueueSize: data.spectators.length,
      createdAt: data.createdAt,
      rules: data.rules,
      rematchVotes: data.players.map(player => ({
        playerId: player.id,
        vote: !Object.prototype.hasOwnProperty.call(data.rematchVotes, player.id)
          ? 'pending'
          : data.rematchVotes[player.id] ? 'yes' : 'no',
      })),
    }
  }

  welcomeAndState(session: Session, resumeToken: string): void {
    // resumeToken is per-player secret: it goes ONLY to this socket, never
    // into ROOM_STATE/GAME_STATE broadcasts.
    const { playerId } = session
    const role = this.roleOf(playerId)
    if (!playerId || !role) throw new Error('WELCOME for a socket that has no identity in this room')
    this.send(session, {
      type: 'WELCOME',
      playerId,
      role,
      room: this.summary(),
      version: PROTOCOL_VERSION,
      resumeToken,
    })
    this.sendGame(session)
  }

  broadcastRoom(): void {
    if (this.data) this.broadcast({ type: 'ROOM_STATE', room: this.summary() })
  }

  sendGame(session: Session): void {
    const data = this.data
    if (!data?.state || !session.playerId) return
    const role = this.roleOf(session.playerId)
    if (!role) return
    // Per-recipient serialization: a seated participant gets their normal
    // view. A player admitted only after gameOver has no cards in that
    // finished round and receives the strict spectator mask until the deal in
    // which they actually participate.
    const participatedInCurrentRound = data.state.players.some(player => player.id === session.playerId)
    this.send(session, {
      type: 'GAME_STATE',
      state: role === 'player' && participatedInCurrentRound
        ? serializeGameState(data.state, session.playerId)
        : serializeSpectatorGameState(data.state),
      version: PROTOCOL_VERSION,
    })
  }

  broadcastGame(): void {
    for (const session of this.sessions.values()) this.sendGame(session)
  }

  send(session: Session, message: OutMsg): void {
    try { session.webSocket.send(JSON.stringify({ ...message, version: PROTOCOL_VERSION })) } catch {}
  }

  broadcast(message: OutMsg): void {
    // A WebSocket is not a room member until CREATE/JOIN/RESUME succeeds.
    // Rejected late joins and idle unauthenticated sockets must not observe
    // roster, chat, or emote traffic (and sendGame independently applies this guard).
    for (const session of this.sessions.values()) {
      if (session.playerId && this.isMember(session.playerId)) {
        this.send(session, message)
      }
    }
  }
}
