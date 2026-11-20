// ============================================================================
// Room — the Durable Object behind one room code. It restores the stored
// snapshot, accepts the room's sockets, and runs every message and every
// disconnect through one serialized operation queue, so no two handlers ever
// interleave across an await. What each message does lives in ./membership,
// ./lobby, ./gameplay and ./reactions; the state they share, in ./context.
// ============================================================================
import type { ClientMsg } from '../../engine/protocol'
import { isClientMsg, PROTOCOL_VERSION } from '../../engine/protocol'
import { isAllowedOrigin, parseAllowedOrigins, type Env } from '../env'
import { logEvent } from '../log'
import { RoomContext, type Session } from './context'
import { burnIn, declineTribute, exchangeTribute, markReady, pickUp, play, quickFollowUp, swapCards } from './gameplay'
import { kickOfflinePlayer, setEasterEgg, setRules, startGame, voteRematch } from './lobby'
import { claimRoomCode, createRoom, joinRoom, leaveRoom, recordDeparture, resumeRoom } from './membership'
import { broadcastPreset, chat, emote } from './reactions'
import { restoreRoomData, ROOM_TTL_MS, type StoredRoomData } from './roomData'

const MAX_MESSAGES_PER_SECOND = 20
const MAX_MESSAGE_CHARS = 16 * 1024 // per-socket WS message cap; oversize -> close 1009
const MAX_SOCKETS_PER_ROOM = 12 // 5 players + 5 spectators + two handshake/duplicate-tab slots
const AUTH_TIMEOUT_MS = 10_000

/**
 * The complete set a queued watcher may send. A watcher is read-only with
 * respect to the *game*, not silent at the table: they can talk while they wait
 * for a seat, on the same relay and the same limits as a seated player. Keeping
 * it one explicit allowlist means a new gameplay message can never become
 * reachable for them by default.
 */
const SPECTATOR_ALLOWED_TYPES = new Set<ClientMsg['type']>([
  'PING', 'LEAVE_ROOM', 'CHAT', 'EMOTE', 'BROADCAST',
])

export class Room {
  private readonly room: RoomContext
  private operation: Promise<void> = Promise.resolve()
  private readonly initialized: Promise<void>

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.room = new RoomContext(state.storage)
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredRoomData>('room')
      if (!stored) return
      this.room.data = restoreRoomData(stored, Date.now())
      await this.room.scheduleCleanup()
    })
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized
    const room = this.room
    const path = new URL(request.url).pathname

    if (path === '/internal/status') {
      return new Response(room.data ? 'occupied' : 'available', {
        status: room.data ? 200 : 404,
      })
    }

    if (path === '/internal/claim' && request.method === 'POST') {
      const claimed = await claimRoomCode(room)
      return new Response(claimed ? 'claimed' : 'unavailable', { status: claimed ? 200 : 409 })
    }

    const match = path.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/)
    if (!match) return new Response('Not found', { status: 404 })

    room.code = match[1]
    if (room.data && room.data.code !== room.code) {
      return new Response('Room identity mismatch', { status: 409 })
    }
    if (!isAllowedOrigin(request.headers.get('Origin'), request.url, parseAllowedOrigins(this.env))) {
      return new Response('Forbidden origin', { status: 403 })
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    if (room.sessions.size >= MAX_SOCKETS_PER_ROOM) {
      logEvent('socket_cap', { code: room.code, sockets: room.sessions.size })
      return new Response('Too many connections', { status: 429 })
    }

    return this.openWebSocket()
  }

  async alarm(): Promise<void> {
    await this.initialized
    const room = this.room
    if (!room.data) return

    const idleFor = Date.now() - room.data.lastActivity
    if (idleFor >= ROOM_TTL_MS && room.sessions.size === 0) {
      room.data = null
      room.forgetAllMembers()
      await this.state.storage.deleteAll()
      return
    }

    await this.state.storage.setAlarm(Date.now() + Math.max(60_000, ROOM_TTL_MS - idleFor))
  }

  private openWebSocket(): Response {
    const room = this.room
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const sessionId = crypto.randomUUID()

    room.sessions.set(sessionId, {
      webSocket: server,
      playerId: null,
      recentMessages: [],
    })

    server.accept()
    // Anonymous sockets receive no room data and get a short window to send
    // CREATE/JOIN/RESUME. This prevents idle handshakes from holding the two
    // connection-buffer slots indefinitely and blocking legitimate resumes.
    const authTimeout = setTimeout(() => {
      this.operation = this.operation
        .then(() => {
          const pending = room.sessions.get(sessionId)
          if (!pending || pending.playerId) return
          room.endSession(sessionId, pending, null, 4008, 'Authentication timeout')
        })
        .catch(error => console.error('Room authentication timeout failed', error))
    }, AUTH_TIMEOUT_MS)
    server.addEventListener('message', event => {
      const raw = String(event.data)
      if (raw.length > MAX_MESSAGE_CHARS) {
        logEvent('oversize_message', { code: room.code, size: raw.length })
        // Route every terminal socket path through the same presence update so
        // an oversize-frame disconnect still starts the continuous offline timer.
        this.closeSession(sessionId)
        try { server.close(1009, 'Message too large') } catch {}
        return
      }
      // Measure bursts when frames arrive, before they enter the serialized
      // operation queue. Measuring later would let slow storage writes spread
      // a burst across several apparent one-second windows.
      const session = room.sessions.get(sessionId)
      if (!session) return
      if (!withinRateLimit(session)) {
        room.send(session, { type: 'ERROR', code: 'RATE_LIMITED', message: 'Too many messages' })
        return
      }
      this.operation = this.operation
        .then(() => this.onMessage(sessionId, raw))
        .catch(error => {
          console.error('Room message failed', error)
          const session = room.sessions.get(sessionId)
          if (session) room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Room operation failed' })
        })
    })
    server.addEventListener('close', () => {
      clearTimeout(authTimeout)
      this.closeSession(sessionId)
    })
    server.addEventListener('error', () => {
      clearTimeout(authTimeout)
      this.closeSession(sessionId)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private async onMessage(sessionId: string, raw: string): Promise<void> {
    const room = this.room
    const session = room.sessions.get(sessionId)
    if (!session) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid message' })
      return
    }

    // Protocol-version boundary check: a present-but-wrong `version` gets a
    // clean, specific error instead of a generic parse failure.
    const version = (parsed as { version?: unknown }).version
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      room.send(session, {
        type: 'ERROR',
        code: 'INTERNAL',
        message: `Unsupported protocol version; expected ${PROTOCOL_VERSION}`,
      })
      return
    }

    if (!isClientMsg(parsed)) {
      room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid message' })
      return
    }
    const message: ClientMsg = parsed

    // Authentication is one-shot per socket. In particular, a seated player
    // must not be able to submit a bad RESUME_ROOM and make the failure path
    // detach their live session without recording an offline timestamp.
    if (session.playerId && (message.type === 'CREATE_ROOM' || message.type === 'JOIN_ROOM' ||
      message.type === 'RESUME_ROOM')) {
      room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'This connection is already authenticated' })
      return
    }

    // A watcher is an authenticated room member who may watch and talk but not
    // play. Enforce that at one dispatcher boundary so future player actions
    // cannot accidentally become available merely because a handler forgot its
    // own roster check.
    if (room.roleOf(session.playerId) === 'spectator' &&
      !SPECTATOR_ALLOWED_TYPES.has(message.type)) {
      room.send(session, {
        type: 'ERROR',
        code: 'INVALID_MOVE',
        message: 'Spectators can watch and chat but cannot perform player actions',
      })
      return
    }

    switch (message.type) {
      case 'CREATE_ROOM':
        await createRoom(room, sessionId, session, message.playerName, message.maxPlayers)
        break
      case 'JOIN_ROOM':
        await joinRoom(room, sessionId, session, message.code, message.playerName)
        break
      case 'RESUME_ROOM':
        await resumeRoom(room, sessionId, session, message.roomCode, message.playerId, message.resumeToken)
        break
      case 'LEAVE_ROOM':
        await leaveRoom(room, session)
        break
      case 'START_GAME':
        await startGame(room, session)
        break
      case 'REMATCH_VOTE':
        await voteRematch(room, session, message.vote)
        break
      case 'KICK_OFFLINE_PLAYER':
        await kickOfflinePlayer(room, session, message.playerId)
        break
      case 'READY':
        await markReady(room, session)
        break
      case 'REARRANGE':
        await swapCards(room, session, message.handIdx, message.upIdx)
        break
      case 'PLAY':
        await play(room, session, message.cards)
        break
      case 'QUICK_FOLLOW_UP':
        await quickFollowUp(room, session, message.cardId, message.expectedSeq)
        break
      case 'BURN_IN':
        await burnIn(room, session, message.cards)
        break
      case 'PICK_UP':
        await pickUp(room, session)
        break
      case 'SET_RULES':
        await setRules(room, session, message.rules)
        break
      case 'SET_EASTER_EGG':
        await setEasterEgg(room, session, message.enabled)
        break
      case 'TRIBUTE_SWAP':
        await exchangeTribute(room, session, message.winnerCardId, message.loserCardId)
        break
      case 'TRIBUTE_SKIP':
        await declineTribute(room, session)
        break
      case 'CHAT':
        chat(room, session, message.text)
        break
      case 'EMOTE':
        emote(room, session, message.emote)
        break
      case 'BROADCAST':
        broadcastPreset(room, session, message.broadcast)
        break
      case 'PING':
        room.send(session, { type: 'PONG', ts: Date.now() })
        break
    }
  }

  private closeSession(sessionId: string): void {
    const session = this.room.sessions.get(sessionId)
    if (!session) return
    const memberId = session.playerId
    this.room.sessions.delete(sessionId)
    this.operation = this.operation
      .then(() => recordDeparture(this.room, memberId))
      .catch(error => console.error('Room close failed', error))
  }
}

function withinRateLimit(session: Session): boolean {
  const now = Date.now()
  session.recentMessages = session.recentMessages.filter(timestamp => now - timestamp < 1000)
  if (session.recentMessages.length >= MAX_MESSAGES_PER_SECOND) return false
  session.recentMessages.push(now)
  return true
}
