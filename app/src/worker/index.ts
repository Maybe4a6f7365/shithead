import type { Card, GameRules, GameState, Phase, Player, PreviousRoundResult } from '../engine'
import {
  DEFAULT_GAME_RULES,
  exchangeFaceUpCards,
  initGame,
  pickUpPile,
  playCards,
  rearrange,
  skipTribute,
  startPlay,
} from '../engine'
import type {
  ClientMsg,
  RoomSummary,
  ServerMsg,
  SpectatorIdentity,
  ViewerRole,
} from '../engine/protocol'
import {
  acceptedCustomMessageBurst,
  CUSTOM_MESSAGE_BURST_LIMIT,
  CUSTOM_MESSAGE_BURST_WINDOW_MS,
  isClientMsg,
  normalizeChatText,
  MAX_SPECTATORS_PER_ROOM,
  OFFLINE_KICK_DELAY_MS,
  PLAYER_LEFT_MESSAGE_IDS,
  PROTOCOL_VERSION,
  serializeGameState,
  serializeSpectatorGameState,
  SPECTATOR_RECONNECT_GRACE_MS,
  toPlayerSummary,
} from '../engine/protocol'
import { BUILD_COMMIT } from './build-meta'
import { applyPlayerForfeit } from './forfeit'
import { applyInterruptBurnRequest, applyQuickFollowUpRequest, canonicalCards } from './gameActions'
import {
  normalizeEasterEggEnabled,
  normalizeGameRules,
  normalizeOfflineSince,
  normalizePersistedGameState,
  normalizeRematchVotes,
  normalizeSpectators,
} from './migrateState'
import {
  acceptedReactionAt,
  normalizeStoredPendingOndraEvent,
  pendingOndraEventAfterLeave,
  type PendingOndraEvent,
  resolvePendingOndraEvent,
  scheduleOndraEventForPlayTransition,
} from './tableMessages'

interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher
  /** Optional comma-separated extra allowed Origins (exact matches). */
  ALLOWED_ORIGINS?: string
}

interface Session {
  webSocket: WebSocket
  playerId: string | null
  recentMessages: number[]
}

interface RoomData {
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

type StoredRoomData = Omit<RoomData, 'version' | 'rules' | 'easterEggEnabled' | 'readyPlayerIds' | 'rematchVotes' | 'offlineSince' | 'spectators' | 'lastActivity' | 'resumeTokens' | 'pendingTableEvent' | 'state'> & {
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

type OutMsg = ServerMsg

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGES_PER_SECOND = 20
const MAX_MESSAGE_CHARS = 16 * 1024 // per-socket WS message cap; oversize -> close 1009
const MAX_SOCKETS_PER_ROOM = 12 // 5 players + 5 spectators + two handshake/duplicate-tab slots
const AUTH_TIMEOUT_MS = 10_000
const REMATCH_VOTE_COOLDOWN_MS = 750
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/
const CLAIM_TTL_MS = 2 * 60 * 1000 // room-code reservation validity

// Room-creation abuse limits (per isolate, best effort — see module comment).
const ROOM_CREATE_MAX_PER_MINUTE = 10
const ROOM_CREATE_WINDOW_MS = 60_000
const ACTIVE_ROOMS_PER_IP_MAX = 30

const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8787']

function parseAllowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_DEV_ORIGINS)
}

function isAllowedOrigin(origin: string | null, requestUrl: string, extra: Set<string>): boolean {
  if (!origin) return false
  return origin === new URL(requestUrl).origin || extra.has(origin)
}

/** Structured server-side log (observability enabled in wrangler.toml). */
function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ts: Date.now(), ...fields }))
}

// ---------- Resume tokens ----------

function generateResumeToken(): string {
  const bytes = new Uint8Array(32) // 256 bits of entropy
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hashResumeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function makePlayer(name: string): Player {
  return {
    id: crypto.randomUUID(),
    name,
    isAI: false,
    hand: [],
    faceUp: [],
    faceDown: [],
    isOut: false,
  }
}

export class Room {
  private readonly sessions = new Map<string, Session>()
  /** Ephemeral per-player spam buckets survive socket reconnects within this room instance. */
  private readonly customMessageTimestamps = new Map<string, number[]>()
  /** Shared reaction cooldown follows the authenticated player across socket resumes. */
  private readonly lastReactionAtByPlayer = new Map<string, number>()
  /** Vote changes are cheap for the UI but durable writes, so throttle by identity across resumes. */
  private readonly lastRematchVoteAtByPlayer = new Map<string, number>()
  private data: RoomData | null = null
  private code = ''
  private operation: Promise<void> = Promise.resolve()
  private readonly initialized: Promise<void>

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredRoomData>('room')
      if (!stored) return

      const rules = normalizeGameRules(stored.state?.rules, stored.rules)
      const normalizedState = normalizePersistedGameState(stored.state, rules)
      const restoresTableEvent = normalizedState?.phase === 'play' || normalizedState?.phase === 'endgame'
      const easterEggEnabled = normalizeEasterEggEnabled(stored.easterEggEnabled)
      const restoredAt = Date.now()
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

      this.data = {
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
      await this.scheduleCleanup()
    })
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized
    const path = new URL(request.url).pathname

    if (path === '/internal/status') {
      return new Response(this.data ? 'occupied' : 'available', {
        status: this.data ? 200 : 404,
      })
    }

    // Atomically reserve this room code for one creator (fixes the
    // check-then-act race in /api/room/new and makes the per-IP creation
    // limit un-bypassable: CREATE_ROOM requires a fresh claim).
    if (path === '/internal/claim' && request.method === 'POST') {
      const claimed = await this.state.storage.transaction(async () => {
        if (this.data) return false
        const now = Date.now()
        const claim = await this.state.storage.get<{ at: number }>('claim')
        if (claim && now - claim.at < CLAIM_TTL_MS) return false
        await this.state.storage.put('claim', { at: now })
        return true
      })
      return new Response(claimed ? 'claimed' : 'unavailable', { status: claimed ? 200 : 409 })
    }

    const match = path.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/)
    if (!match) return new Response('Not found', { status: 404 })

    this.code = match[1]
    if (this.data && this.data.code !== this.code) {
      return new Response('Room identity mismatch', { status: 409 })
    }
    if (!isAllowedOrigin(request.headers.get('Origin'), request.url, parseAllowedOrigins(this.env))) {
      return new Response('Forbidden origin', { status: 403 })
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    if (this.sessions.size >= MAX_SOCKETS_PER_ROOM) {
      logEvent('socket_cap', { code: this.code, sockets: this.sessions.size })
      return new Response('Too many connections', { status: 429 })
    }

    return this.openWebSocket()
  }

  async alarm(): Promise<void> {
    await this.initialized
    if (!this.data) return

    const idleFor = Date.now() - this.data.lastActivity
    if (idleFor >= ROOM_TTL_MS && this.sessions.size === 0) {
      this.data = null
      this.customMessageTimestamps.clear()
      this.lastReactionAtByPlayer.clear()
      this.lastRematchVoteAtByPlayer.clear()
      await this.state.storage.deleteAll()
      return
    }

    await this.state.storage.setAlarm(Date.now() + Math.max(60_000, ROOM_TTL_MS - idleFor))
  }

  private openWebSocket(): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const sessionId = crypto.randomUUID()

    this.sessions.set(sessionId, {
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
          const pending = this.sessions.get(sessionId)
          if (!pending || pending.playerId) return
          this.sessions.delete(sessionId)
          try { pending.webSocket.close(4008, 'Authentication timeout') } catch {}
        })
        .catch(error => console.error('Room authentication timeout failed', error))
    }, AUTH_TIMEOUT_MS)
    server.addEventListener('message', event => {
      const raw = String(event.data)
      if (raw.length > MAX_MESSAGE_CHARS) {
        logEvent('oversize_message', { code: this.code, size: raw.length })
        // Route every terminal socket path through the same presence update so
        // an oversize-frame disconnect still starts the continuous offline timer.
        this.closeSession(sessionId)
        try { server.close(1009, 'Message too large') } catch {}
        return
      }
      // Measure bursts when frames arrive, before they enter the serialized
      // operation queue. Measuring later would let slow storage writes spread
      // a burst across several apparent one-second windows.
      const session = this.sessions.get(sessionId)
      if (!session) return
      if (!this.withinRateLimit(session)) {
        this.send(session, { type: 'ERROR', code: 'RATE_LIMITED', message: 'Too many messages' })
        return
      }
      this.operation = this.operation
        .then(() => this.onMessage(sessionId, raw))
        .catch(error => {
          console.error('Room message failed', error)
          const session = this.sessions.get(sessionId)
          if (session) this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Room operation failed' })
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
    const session = this.sessions.get(sessionId)
    if (!session) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid message' })
      return
    }

    // Protocol-version boundary check: a present-but-wrong `version` gets a
    // clean, specific error instead of a generic parse failure.
    const version = (parsed as { version?: unknown }).version
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      this.send(session, {
        type: 'ERROR',
        code: 'INTERNAL',
        message: `Unsupported protocol version; expected ${PROTOCOL_VERSION}`,
      })
      return
    }

    if (!isClientMsg(parsed)) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid message' })
      return
    }
    const message: ClientMsg = parsed

    // Authentication is one-shot per socket. In particular, a seated player
    // must not be able to submit a bad RESUME_ROOM and make the failure path
    // detach their live session without recording an offline timestamp.
    if (session.playerId && (message.type === 'CREATE_ROOM' || message.type === 'JOIN_ROOM' ||
      message.type === 'RESUME_ROOM')) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'This connection is already authenticated' })
      return
    }

    // A watcher is an authenticated read-only room member. Enforce that at
    // one dispatcher boundary so future player actions cannot accidentally
    // become available merely because a handler forgot its own roster check.
    if (this.roleOf(session.playerId) === 'spectator' &&
      message.type !== 'PING' && message.type !== 'LEAVE_ROOM') {
      this.send(session, {
        type: 'ERROR',
        code: 'INVALID_MOVE',
        message: 'Spectators can watch this round but cannot perform player actions',
      })
      return
    }

    switch (message.type) {
      case 'CREATE_ROOM':
        await this.createRoom(sessionId, session, message.playerName, message.maxPlayers)
        break
      case 'JOIN_ROOM':
        await this.joinRoom(sessionId, session, message.code, message.playerName)
        break
      case 'RESUME_ROOM': {
        await this.resumeRoom(sessionId, session, message.roomCode, message.playerId, message.resumeToken)
        break
      }
      case 'LEAVE_ROOM':
        await this.leaveRoom(session)
        break
      case 'START_GAME':
        await this.startGame(session)
        break
      case 'REMATCH_VOTE':
        await this.voteRematch(session, message.vote)
        break
      case 'KICK_OFFLINE_PLAYER':
        await this.kickOfflinePlayer(session, message.playerId)
        break
      case 'READY':
        await this.markReady(session)
        break
      case 'REARRANGE':
        await this.swapCards(session, message.handIdx, message.upIdx)
        break
      case 'PLAY':
        await this.play(session, message.cards)
        break
      case 'QUICK_FOLLOW_UP':
        await this.quickFollowUp(session, message.cardId, message.expectedSeq)
        break
      case 'BURN_IN':
        await this.burnIn(session, message.cards)
        break
      case 'PICK_UP':
        await this.pickUp(session)
        break
      case 'SET_RULES':
        await this.setRules(session, message.rules)
        break
      case 'SET_EASTER_EGG':
        await this.setEasterEgg(session, message.enabled)
        break
      case 'TRIBUTE_SWAP':
        await this.exchangeTribute(session, message.winnerCardId, message.loserCardId)
        break
      case 'TRIBUTE_SKIP':
        await this.declineTribute(session)
        break
      case 'CHAT':
        this.chat(session, message.text)
        break
      case 'EMOTE':
        this.emote(session, message.emote)
        break
      case 'BROADCAST':
        this.broadcastPreset(session, message.broadcast)
        break
      case 'PING':
        this.send(session, { type: 'PONG', ts: Date.now() })
        break
    }
  }

  private withinRateLimit(session: Session): boolean {
    const now = Date.now()
    session.recentMessages = session.recentMessages.filter(timestamp => now - timestamp < 1000)
    if (session.recentMessages.length >= MAX_MESSAGES_PER_SECOND) return false
    session.recentMessages.push(now)
    return true
  }

  private async save(): Promise<void> {
    if (!this.data) {
      await this.state.storage.delete('room')
      return
    }

    this.data.lastActivity = Date.now()
    await this.state.storage.put('room', this.data)
    await this.scheduleCleanup()
  }

  private async scheduleCleanup(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS)
  }

  private async createRoom(
    sessionId: string,
    session: Session,
    rawName: string,
    requestedMaxPlayers = 5,
  ): Promise<void> {
    if (session.playerId) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already connected to a room' })
      return
    }
    if (this.data) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Room already exists; resume the existing session' })
      return
    }

    const name = rawName.trim()
    if (!name || name.length > 32) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid player name' })
      return
    }

    // The code must have been reserved via POST /api/room/new (which is
    // per-IP rate limited). This closes the direct-WS room-creation bypass.
    const claimOk = await this.state.storage.transaction(async () => {
      const now = Date.now()
      const claim = await this.state.storage.get<{ at: number }>('claim')
      if (!claim || now - claim.at >= CLAIM_TTL_MS) return false
      await this.state.storage.delete('claim')
      return true
    })
    // The claim transaction yields to storage. Do not create an unreachable
    // one-player room if the unauthenticated socket closed in the meantime.
    if (this.sessions.get(sessionId) !== session) return
    if (!claimOk) {
      this.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room code not allocated; request a new room first' })
      return
    }

    const player = makePlayer(name)
    const resumeToken = generateResumeToken()
    session.playerId = player.id
    this.data = {
      version: 7,
      code: this.code,
      hostId: player.id,
      maxPlayers: Math.max(2, Math.min(5, requestedMaxPlayers)),
      easterEggEnabled: true,
      players: [player],
      spectators: [],
      state: null,
      rules: { ...DEFAULT_GAME_RULES },
      readyPlayerIds: [],
      rematchVotes: {},
      offlineSince: {},
      resumeTokens: { [player.id]: await hashResumeToken(resumeToken) },
      pendingTableEvent: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }

    await this.save()
    logEvent('room_created', { code: this.code })
    this.welcomeAndState(session, resumeToken)
    this.broadcastRoom()
  }

  private async joinRoom(sessionId: string, session: Session, code: string, rawName: string): Promise<void> {
    if (session.playerId) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already connected to a room' })
      return
    }

    const data = this.data
    const name = rawName.trim()
    if (!data || data.code !== code.toUpperCase()) {
      this.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room not found' })
      return
    }
    if (!name || name.length > 32) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid player name' })
      return
    }
    if (this.pruneExpiredSpectators()) {
      await this.save()
      // A close while pruning must not leave an identity with neither a live
      // socket nor an offline/expiry timestamp.
      if (this.sessions.get(sessionId) !== session) return
    }
    const activeRound = data.state !== null && data.state.phase !== 'gameOver'
    // Once a watcher queue exists, later game-over joins cannot jump ahead of
    // it merely because a seat opened. With no queue, a finished-round join
    // may claim an open next-round seat directly.
    const shouldSpectate = activeRound || data.spectators.length > 0 ||
      (data.state?.phase === 'gameOver' && data.players.length >= data.maxPlayers)
    if (!shouldSpectate && data.players.length >= data.maxPlayers) {
      this.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'Room is full' })
      return
    }
    if (shouldSpectate && data.spectators.length >= MAX_SPECTATORS_PER_ROOM) {
      this.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'The spectator queue is full' })
      return
    }

    const identity = makePlayer(name)
    const resumeToken = generateResumeToken()
    session.playerId = identity.id
    if (shouldSpectate) {
      data.spectators.push({ id: identity.id, name, joinedAt: Date.now() })
    } else {
      data.players.push(identity)
      delete data.offlineSince[identity.id]
    }
    data.resumeTokens[identity.id] = await hashResumeToken(resumeToken)

    await this.save()
    this.welcomeAndState(session, resumeToken)
    this.broadcastRoom()
  }

  /**
   * Resume requires the per-player secret token issued in WELCOME (and
   * rotated on every successful resume). The broadcast playerId alone is
   * NOT a credential. Failures send RESUME_FAILED and never attach.
   */
  private async resumeRoom(
    sessionId: string,
    session: Session,
    roomCode: string,
    playerId: string,
    resumeToken: string,
  ): Promise<void> {
    if (session.playerId) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'This connection is already authenticated' })
      return
    }
    const fail = (reason: string) => {
      logEvent('resume_failed', { code: this.code, reason })
      this.send(session, { type: 'RESUME_FAILED', reason, version: PROTOCOL_VERSION })
      // Authentication failures are terminal for this transport. Keeping an
      // anonymous failed-resume socket around would let stale clients consume
      // the room's connection allowance indefinitely.
      session.playerId = null
      session.recentMessages = []
      this.sessions.delete(sessionId)
      try { session.webSocket.close(4003, 'Resume failed') } catch {}
    }

    const data = this.data
    if (!data || roomCode !== data.code) {
      fail('room_not_found')
      return
    }
    if (this.pruneExpiredSpectators()) {
      await this.save()
      if (this.sessions.get(sessionId) !== session) return
    }
    if (!this.isMember(playerId)) {
      fail('not_a_member')
      return
    }
    const storedHash = data.resumeTokens[playerId]
    if (typeof resumeToken !== 'string' || !storedHash) {
      fail('invalid_token')
      return
    }
    const presentedHash = await hashResumeToken(resumeToken)
    if (this.sessions.get(sessionId) !== session) return
    if (!constantTimeEqual(presentedHash, storedHash)) {
      fail('invalid_token')
      return
    }

    // Rotate: the presented token is single-use; the new one goes only to
    // this socket in WELCOME. Hash before mutating the stored credential, and
    // abandon the resume with the old token intact if the socket disappeared
    // while either digest was pending.
    const nextToken = generateResumeToken()
    const nextHash = await hashResumeToken(nextToken)
    if (this.sessions.get(sessionId) !== session) return
    data.resumeTokens[playerId] = nextHash

    for (const [otherId, other] of this.sessions) {
      if (otherId === sessionId || other.playerId !== playerId) continue
      this.sessions.delete(otherId)
      try { other.webSocket.close(4001, 'Session resumed elsewhere') } catch {}
    }

    session.playerId = playerId
    if (this.roleOf(playerId) === 'player') delete data.offlineSince[playerId]
    const resumedSpectator = data.spectators.find(spectator => spectator.id === playerId)
    if (resumedSpectator) delete resumedSpectator.disconnectedAt
    await this.save()
    this.welcomeAndState(session, nextToken)
    this.broadcastRoom()
  }

  private async startGame(session: Session): Promise<void> {
    const data = this.data
    if (!data || session.playerId !== data.hostId) {
      this.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can start' })
      return
    }
    if (data.state && data.state.phase !== 'gameOver') {
      this.send(session, { type: 'ERROR', code: 'GAME_IN_PROGRESS', message: 'Game already in progress' })
      return
    }
    if (this.pruneExpiredSpectators()) await this.save()
    const prior = data.state
    let participants = [...data.players]
    const releasedIds = new Set<string>()
    const promotedSpectatorIds = new Set<string>()

    if (prior?.phase === 'gameOver') {
      const everyOnlinePlayerVoted = data.players.every(player =>
        !this.isConnected(player.id) || Object.prototype.hasOwnProperty.call(data.rematchVotes, player.id)
      )
      if (!everyOnlinePlayerVoted) {
        this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Waiting for every online player to vote' })
        return
      }
      if (data.rematchVotes[data.hostId] !== true) {
        this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'The host must vote yes or leave the room' })
        return
      }
      participants = data.players.filter(player => data.rematchVotes[player.id] === true)
      if (participants.some(player => !this.isConnected(player.id))) {
        this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Every yes voter must be online before starting' })
        return
      }

      // Joining an active/full finished table expresses intent to play the
      // next deal. Fill remaining seats from the connected FIFO queue; an
      // offline or excess watcher remains queued for a later round.
      const openSeats = Math.max(0, data.maxPlayers - participants.length)
      const promoted = data.spectators
        .filter(spectator => this.isConnected(spectator.id))
        .slice(0, openSeats)
      for (const spectator of promoted) {
        promotedSpectatorIds.add(spectator.id)
        participants.push({
          ...makePlayer(spectator.name),
          id: spectator.id,
        })
      }
      if (participants.length < 2) {
        this.send(session, {
          type: 'ERROR',
          code: 'INVALID_MOVE',
          message: 'At least two online players or waiting spectators are required',
        })
        return
      }
      for (const player of data.players) {
        // Explicit No voters and offline non-voters sit out. An offline Yes
        // remains a deliberate reservation and is rejected by the online gate.
        if (data.rematchVotes[player.id] !== true) releasedIds.add(player.id)
      }
    } else {
      if (participants.length < 2) {
        this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'At least two players are required' })
        return
      }
      if (participants.some(player => !this.isConnected(player.id))) {
        this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'All players must be online before starting' })
        return
      }
    }

    const rosterIds = new Set(participants.map(player => player.id))
    const previousRound: PreviousRoundResult | null =
      prior?.phase === 'gameOver' && prior.winnerId && prior.loserId &&
      prior.winnerId !== prior.loserId &&
      rosterIds.has(prior.winnerId) && rosterIds.has(prior.loserId)
        ? { winnerId: prior.winnerId, loserId: prior.loserId }
        : null

    for (const playerId of releasedIds) {
      delete data.resumeTokens[playerId]
      delete data.offlineSince[playerId]
      this.customMessageTimestamps.delete(playerId)
      this.lastReactionAtByPlayer.delete(playerId)
      this.lastRematchVoteAtByPlayer.delete(playerId)
    }
    data.players = participants
    data.spectators = data.spectators.filter(spectator => !promotedSpectatorIds.has(spectator.id))
    for (const player of participants) delete data.offlineSince[player.id]
    data.state = initGame({
      players: participants.map(player => ({ id: player.id, name: player.name, isAI: false })),
      rules: data.rules,
      previousRound,
    })
    data.readyPlayerIds = []
    data.rematchVotes = {}
    this.lastRematchVoteAtByPlayer.clear()
    data.pendingTableEvent = null

    await this.save()

    // A No vote is an explicit next-round seat release; offline non-voters are
    // also omitted so an abandoned tab cannot block the table indefinitely.
    // Notify any still-connected released clients, then remove and close their
    // sessions before a room/game broadcast can expose the fresh deal.
    for (const [sessionId, released] of [...this.sessions]) {
      if (!released.playerId || !releasedIds.has(released.playerId)) continue
      this.send(released, {
        type: 'ERROR',
        code: 'SESSION_EXPIRED',
        message: 'You chose not to join this rematch.',
      })
      released.playerId = null
      released.recentMessages = []
      this.sessions.delete(sessionId)
      try { released.webSocket.close(4003, 'Rematch seat released') } catch {}
    }
    this.broadcastRoom()
    this.broadcastGame()
  }

  private async voteRematch(session: Session, vote: boolean): Promise<void> {
    const data = this.data
    const playerId = session.playerId
    if (!data || !playerId || !data.players.some(player => player.id === playerId)) {
      this.send(session, { type: 'ERROR', code: 'SESSION_EXPIRED', message: 'Join the room before voting' })
      return
    }
    if (data.state?.phase !== 'gameOver') {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Rematch voting opens after the round' })
      return
    }
    if (Object.prototype.hasOwnProperty.call(data.rematchVotes, playerId) &&
      data.rematchVotes[playerId] === vote) return

    const now = Date.now()
    const previousVoteAt = this.lastRematchVoteAtByPlayer.get(playerId)
    if (previousVoteAt !== undefined && now - previousVoteAt < REMATCH_VOTE_COOLDOWN_MS) {
      this.send(session, {
        type: 'ERROR',
        code: 'RATE_LIMITED',
        message: 'Please wait a moment before changing your rematch vote',
      })
      return
    }

    this.lastRematchVoteAtByPlayer.set(playerId, now)
    data.rematchVotes = { ...data.rematchVotes, [playerId]: vote }
    await this.save()
    this.broadcastRoom()
  }

  /** Host-only removal after one continuous, server-measured offline spell. */
  private async kickOfflinePlayer(session: Session, targetId: string): Promise<void> {
    const data = this.data
    if (!data || session.playerId !== data.hostId) {
      this.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can kick an offline player' })
      return
    }
    if (targetId === data.hostId) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'The host cannot kick their own seat' })
      return
    }
    const target = data.players.find(player => player.id === targetId)
    if (!target) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'That player is no longer at the table' })
      return
    }
    if (this.isConnected(targetId)) {
      delete data.offlineSince[targetId]
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'That player is online' })
      return
    }

    const now = Date.now()
    const since = data.offlineSince[targetId]
    if (!Number.isSafeInteger(since) || Number(since) <= 0 || Number(since) > now) {
      // Conservative recovery for a legacy/corrupt presence snapshot: begin a
      // fresh server-side grace period rather than allowing an immediate kick.
      data.offlineSince[targetId] = now
      await this.save()
      this.broadcastRoom()
      this.send(session, {
        type: 'ERROR', code: 'INVALID_MOVE', message: 'That player must be offline for 20 seconds first',
      })
      return
    }
    const offlineFor = now - since
    if (offlineFor < OFFLINE_KICK_DELAY_MS) {
      const remainingSeconds = Math.max(1, Math.ceil((OFFLINE_KICK_DELAY_MS - offlineFor) / 1000))
      this.send(session, {
        type: 'ERROR',
        code: 'INVALID_MOVE',
        message: `That player can be kicked in ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`,
      })
      return
    }

    delete data.resumeTokens[targetId]
    delete data.rematchVotes[targetId]
    delete data.offlineSince[targetId]
    data.players = data.players.filter(player => player.id !== targetId)
    data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== targetId)
    this.customMessageTimestamps.delete(targetId)
    this.lastReactionAtByPlayer.delete(targetId)
    this.lastRematchVoteAtByPlayer.delete(targetId)

    if (data.state && data.state.phase !== 'gameOver') {
      data.state = applyPlayerForfeit(data.state, targetId)
    }
    data.pendingTableEvent = pendingOndraEventAfterLeave(
      data.pendingTableEvent,
      targetId,
      data.state?.phase ?? null,
    )

    await this.save()

    // Re-check and terminate any anomalous/racing attachment before a fresh
    // room or game view is broadcast. The serialized operation queue makes a
    // concurrent RESUME deterministic: it either won earlier (and blocked the
    // kick) or will fail later because the token/member record is gone.
    for (const [sessionId, kicked] of [...this.sessions]) {
      if (kicked.playerId !== targetId) continue
      this.send(kicked, {
        type: 'ERROR', code: 'SESSION_EXPIRED', message: 'The host removed your offline seat.',
      })
      kicked.playerId = null
      kicked.recentMessages = []
      this.sessions.delete(sessionId)
      try { kicked.webSocket.close(4003, 'Offline seat removed') } catch {}
    }

    this.broadcast({
      type: 'SYSTEM_EVENT',
      event: {
        kind: 'player-left',
        playerId: target.id,
        playerName: target.name,
        message: PLAYER_LEFT_MESSAGE_IDS[0],
        ts: Date.now(),
      },
    })
    this.broadcastRoom()
    this.broadcastGame()
  }

  private async setRules(session: Session, patch: Partial<GameRules>): Promise<void> {
    const data = this.data
    if (!data || session.playerId !== data.hostId) {
      this.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can change rules' })
      return
    }
    if (data.state && data.state.phase !== 'gameOver') {
      this.send(session, { type: 'ERROR', code: 'GAME_IN_PROGRESS', message: 'Rules are locked during a round' })
      return
    }

    // Merge against the current authoritative value so two rapid toggles do
    // not overwrite one another with stale whole-object snapshots.
    data.rules = normalizeGameRules(data.rules, patch)
    await this.save()
    this.broadcastRoom()
  }

  private async setEasterEgg(session: Session, enabled: boolean): Promise<void> {
    const data = this.data
    if (!data || session.playerId !== data.hostId) {
      this.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can change the easter egg' })
      return
    }

    data.easterEggEnabled = enabled
    if (!enabled) data.pendingTableEvent = null
    await this.save()
    this.broadcastRoom()
  }

  private async exchangeTribute(session: Session, winnerCardId: string, loserCardId: string): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return
    const previousPhase = data.state.phase
    const result = exchangeFaceUpCards(data.state, session.playerId, winnerCardId, loserCardId)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }
    data.state = result.state
    this.scheduleOndraModeForPlayTransition(previousPhase, data.state.phase)
    await this.save()
    this.broadcastRoom()
    this.broadcastGame()
  }

  private async declineTribute(session: Session): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return
    const previousPhase = data.state.phase
    const result = skipTribute(data.state, session.playerId)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }
    data.state = result.state
    this.scheduleOndraModeForPlayTransition(previousPhase, data.state.phase)
    await this.save()
    this.broadcastRoom()
    this.broadcastGame()
  }

  private async markReady(session: Session): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId || data.state.phase !== 'rearrange') return
    const previousPhase = data.state.phase

    if (!data.readyPlayerIds.includes(session.playerId)) data.readyPlayerIds.push(session.playerId)
    const everyoneReady = data.players.every(player => data.readyPlayerIds.includes(player.id))
    if (everyoneReady) data.state = startPlay(data.state)

    this.scheduleOndraModeForPlayTransition(previousPhase, data.state.phase)
    await this.save()
    this.broadcastGame()
  }

  /**
   * Roll once at the authoritative phase boundary and persist the private
   * result. The event is deliberately not broadcast until a later due action.
   */
  private scheduleOndraModeForPlayTransition(previousPhase: Phase, nextPhase: Phase): void {
    const data = this.data
    if (!data?.state) return
    if (!data.easterEggEnabled) {
      data.pendingTableEvent = null
      return
    }
    data.pendingTableEvent = scheduleOndraEventForPlayTransition(
      previousPhase,
      nextPhase,
      data.state.turnCount,
      data.players,
    )
  }

  private async swapCards(session: Session, handIdx: number, upIdx: number): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId || data.state.phase !== 'rearrange') return

    data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== session.playerId)
    data.state = rearrange(data.state, session.playerId, handIdx, upIdx)
    await this.save()
    this.broadcastGame()
  }

  private canonicalCards(playerId: string, requested: Card[]): Card[] | null {
    const state = this.data?.state
    return state ? canonicalCards(state, playerId, requested) : null
  }

  private async play(session: Session, requestedCards: Card[]): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return

    // Cards are re-derived from server state by id: forged suits/ranks are
    // discarded, and a replayed PLAY fails ownership because the cards have
    // already moved to the pile. Combined with the turn check in playCards,
    // retried/duplicated PLAYs cannot double-apply (replay defense via
    // server-side idempotency; state.seq lets clients dedupe broadcasts).
    const cards = this.canonicalCards(session.playerId, requestedCards)
    if (!cards) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Card is not owned by this player' })
      return
    }

    const result = playCards(data.state, session.playerId, cards)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }

    data.state = result.state
    const tableEvent = this.takePendingTableEvent()
    await this.save()
    this.broadcastGame()
    if (tableEvent) this.broadcast(tableEvent)
  }

  /**
   * Apply one exact same-rank quick match before a competing action closes
   * the window. Durable Object messages are serialized through `operation`;
   * expectedSeq therefore gives a deterministic winner and prevents stale
   * clicks/reconnect replays from mutating a later state.
   */
  private async quickFollowUp(session: Session, cardId: string, expectedSeq: number): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return

    const result = applyQuickFollowUpRequest(data.state, session.playerId, cardId, expectedSeq)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }

    data.state = result.state
    const tableEvent = this.takePendingTableEvent()
    await this.save()
    this.broadcastGame()
    if (tableEvent) this.broadcast(tableEvent)
  }

  /**
   * Apply an out-of-turn four-of-a-kind completion. Ownership and card
   * identities are derived from authoritative server state; the engine then
   * enforces the visible active zone, matching rank, complete matching set,
   * non-current actor, and cumulative top-run threshold.
   */
  private async burnIn(session: Session, requestedCards: Card[]): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return

    const result = applyInterruptBurnRequest(data.state, session.playerId, requestedCards)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }

    data.state = result.state
    const tableEvent = this.takePendingTableEvent()
    await this.save()
    this.broadcastGame()
    if (tableEvent) this.broadcast(tableEvent)
  }

  private async pickUp(session: Session): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId) return

    const result = pickUpPile(data.state, session.playerId)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }

    data.state = result.state
    const tableEvent = this.takePendingTableEvent()
    await this.save()
    this.broadcastGame()
    if (tableEvent) this.broadcast(tableEvent)
  }

  /**
   * Consume a due private event before persistence. Callers then broadcast the
   * authoritative GAME_STATE first and this returned frame second.
   */
  private takePendingTableEvent(): OutMsg | null {
    const data = this.data
    if (!data?.state) return null
    if (!data.easterEggEnabled) {
      data.pendingTableEvent = null
      return null
    }
    const resolution = resolvePendingOndraEvent(
      data.pendingTableEvent,
      data.state.phase,
      data.state.turnCount,
      data.players,
    )
    data.pendingTableEvent = resolution.pending
    return resolution.frame
  }

  /**
   * Relay one canonical, authenticated custom message as an ephemeral reaction.
   * Allowed in any pre-game or active phase (waiting, rearrange, tribute, play,
   * endgame) so the waiting room can host table talk. Cooldown and burst limit
   * apply uniformly.
   */
  private chat(session: Session, rawText: string): void {
    const playerId = session.playerId
    const data = this.data
    if (!playerId || !data?.players.some(player => player.id === playerId)) return
    const text = normalizeChatText(rawText)
    if (!text) return
    const ts = acceptedReactionAt(this.lastReactionAtByPlayer.get(playerId) ?? null, Date.now())
    if (ts === null) return
    if (!this.takeCustomMessageBurstSlot(playerId, ts)) {
      this.send(session, {
        type: 'ERROR',
        code: 'RATE_LIMITED',
        message: `Custom messages are limited to ${CUSTOM_MESSAGE_BURST_LIMIT} ` +
          `every ${CUSTOM_MESSAGE_BURST_WINDOW_MS / 1000} seconds`,
      })
      return
    }
    this.lastReactionAtByPlayer.set(playerId, ts)
    this.broadcast({ type: 'CHAT', playerId, text, ts })
  }

  /**
   * Relay a validated reaction to authenticated room members only. Emotes do
   * not touch RoomData, storage, the game log, or sequence counters: they are
   * intentionally short-lived UI feedback. The shared reaction cooldown and
   * socket-wide limiter both apply, so alternating reaction types cannot flood
   * the table or bypass normal rate limits.
   */
  private emote(session: Session, emote: Extract<ClientMsg, { type: 'EMOTE' }>['emote']): void {
    if (!session.playerId) return
    const ts = this.takeReactionSlot(session)
    if (ts === null) return
    this.broadcast({ type: 'EMOTE', playerId: session.playerId, emote, ts })
  }

  /**
   * Relay a server-validated preset id; free-form text never crosses this
   * boundary. Like emotes, broadcasts are authenticated, share one reaction
   * cooldown, remain socket-rate-limited, and are never persisted or applied
   * to state.
   */
  private broadcastPreset(
    session: Session,
    broadcast: Extract<ClientMsg, { type: 'BROADCAST' }>['broadcast'],
  ): void {
    if (!session.playerId) return
    const ts = this.takeReactionSlot(session)
    if (ts === null) return
    this.broadcast({ type: 'BROADCAST', playerId: session.playerId, broadcast, ts })
  }

  private takeReactionSlot(session: Session): number | null {
    const playerId = session.playerId
    if (!playerId || !this.data?.players.some(player => player.id === playerId)) return null
    const acceptedAt = acceptedReactionAt(this.lastReactionAtByPlayer.get(playerId) ?? null, Date.now())
    if (acceptedAt !== null) this.lastReactionAtByPlayer.set(playerId, acceptedAt)
    return acceptedAt
  }

  private takeCustomMessageBurstSlot(playerId: string, now: number): boolean {
    for (const [id, timestamps] of this.customMessageTimestamps) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] >= CUSTOM_MESSAGE_BURST_WINDOW_MS) {
        this.customMessageTimestamps.delete(id)
      }
    }
    const result = acceptedCustomMessageBurst(this.customMessageTimestamps.get(playerId) ?? [], now)
    this.customMessageTimestamps.set(playerId, result.timestamps)
    return result.accepted
  }

  private async leaveRoom(session: Session): Promise<void> {
    const data = this.data
    if (!data || !session.playerId) return

    const leavingId = session.playerId
    const leavingRole = this.roleOf(leavingId)
    this.customMessageTimestamps.delete(leavingId)
    this.lastReactionAtByPlayer.delete(leavingId)
    this.lastRematchVoteAtByPlayer.delete(leavingId)
    const leavingPlayer = data.players.find(player => player.id === leavingId)
    delete data.resumeTokens[leavingId]
    delete data.rematchVotes[leavingId]
    delete data.offlineSince[leavingId]
    data.spectators = data.spectators.filter(spectator => spectator.id !== leavingId)
    data.players = data.players.filter(player => player.id !== leavingId)
    data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== leavingId)
    session.playerId = null

    if (leavingRole === 'player' && data.state && data.state.phase !== 'gameOver') {
      data.state = applyPlayerForfeit(data.state, leavingId)
    }
    if (leavingRole === 'player') {
      data.pendingTableEvent = pendingOndraEventAfterLeave(
        data.pendingTableEvent,
        leavingId,
        data.state?.phase ?? null,
      )
    }

    if (data.players.length === 0) {
      // Spectators cannot inherit ownership of a room. Expire their sessions
      // before deleting the final authoritative snapshot.
      for (const [sessionId, watcher] of [...this.sessions]) {
        if (!watcher.playerId || !data.spectators.some(item => item.id === watcher.playerId)) continue
        this.send(watcher, {
          type: 'ERROR', code: 'SESSION_EXPIRED', message: 'The table has closed.',
        })
        watcher.playerId = null
        watcher.recentMessages = []
        this.sessions.delete(sessionId)
        try { watcher.webSocket.close(4003, 'Room closed') } catch {}
      }
      this.data = null
    } else if (data.hostId === leavingId) {
      data.hostId = data.players[0].id
    }

    await this.save()
    if (leavingPlayer) {
      this.broadcast({
        type: 'SYSTEM_EVENT',
        event: {
          kind: 'player-left',
          playerId: leavingPlayer.id,
          playerName: leavingPlayer.name,
          message: PLAYER_LEFT_MESSAGE_IDS[0],
          ts: Date.now(),
        },
      })
    }
    this.broadcastRoom()
    this.broadcastGame()
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const memberId = session.playerId
    this.sessions.delete(sessionId)
    this.operation = this.operation
      .then(async () => {
        const data = this.data
        if (data && memberId) {
          if (data.players.some(player => player.id === memberId)) {
            if (this.isConnected(memberId)) delete data.offlineSince[memberId]
            else if (data.offlineSince[memberId] === undefined) data.offlineSince[memberId] = Date.now()
            await this.save()
          } else {
            const spectator = data.spectators.find(item => item.id === memberId)
            if (spectator) {
              if (this.isConnected(memberId)) delete spectator.disconnectedAt
              else if (spectator.disconnectedAt === undefined) spectator.disconnectedAt = Date.now()
              await this.save()
            }
          }
        }
        this.broadcastRoom()
      })
      .catch(error => console.error('Room close failed', error))
  }

  private isConnected(playerId: string): boolean {
    return [...this.sessions.values()].some(session => session.playerId === playerId)
  }

  private roleOf(memberId: string | null): ViewerRole | null {
    if (!memberId || !this.data) return null
    if (this.data.players.some(player => player.id === memberId)) return 'player'
    if (this.data.spectators.some(spectator => spectator.id === memberId)) return 'spectator'
    return null
  }

  private isMember(memberId: string): boolean {
    return this.roleOf(memberId) !== null
  }

  /** Remove abandoned watcher identities without sacrificing brief reconnects. */
  private pruneExpiredSpectators(now = Date.now()): boolean {
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
      this.customMessageTimestamps.delete(id)
      this.lastReactionAtByPlayer.delete(id)
      this.lastRematchVoteAtByPlayer.delete(id)
    }
    return true
  }

  private summary(): RoomSummary {
    const data = this.data!
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

  private welcomeAndState(session: Session, resumeToken: string): void {
    // resumeToken is per-player secret: it goes ONLY to this socket, never
    // into ROOM_STATE/GAME_STATE broadcasts.
    this.send(session, {
      type: 'WELCOME',
      playerId: session.playerId!,
      role: this.roleOf(session.playerId)!,
      room: this.summary(),
      version: PROTOCOL_VERSION,
      resumeToken,
    })
    this.sendGame(session)
  }

  private broadcastRoom(): void {
    if (this.data) this.broadcast({ type: 'ROOM_STATE', room: this.summary() })
  }

  private sendGame(session: Session): void {
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

  private broadcastGame(): void {
    for (const session of this.sessions.values()) this.sendGame(session)
  }

  private send(session: Session, message: OutMsg): void {
    try { session.webSocket.send(JSON.stringify({ ...message, version: PROTOCOL_VERSION })) } catch {}
  }

  private broadcast(message: OutMsg): void {
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

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('')
}

// ---------- HTTP hygiene ----------

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; " +
    "worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Apply security headers to every HTTP response (assets included). */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  headers.delete('X-Powered-By')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Same-origin only: no ACAO is emitted for missing/disallowed origins. */
function corsHeaders(origin: string | null, originAllowed: boolean): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
  if (originAllowed && origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// ---------- Per-IP room-creation limits ----------
// In-memory, per-isolate sliding window + concurrent-room cap. Best effort:
// Cloudflare may run several isolates, so a distributed attacker gets
// N isolates x 10 rooms/min. Sufficient against scripted single-source
// abuse; for strict global limits add a Cloudflare Rate Limiting rule.
interface IpRoomUsage {
  window: number[]
  codes: Map<string, number>
}
const ipRoomUsage = new Map<string, IpRoomUsage>()

function roomCreationAllowed(ip: string): boolean {
  const now = Date.now()
  let usage = ipRoomUsage.get(ip)
  if (!usage) {
    usage = { window: [], codes: new Map() }
    ipRoomUsage.set(ip, usage)
    // Bound the map: drop fully-expired entries when it grows large.
    if (ipRoomUsage.size > 5000) {
      for (const [key, entry] of ipRoomUsage) {
        if (entry.window.length === 0 && entry.codes.size === 0) ipRoomUsage.delete(key)
      }
    }
  }
  usage.window = usage.window.filter(timestamp => now - timestamp < ROOM_CREATE_WINDOW_MS)
  for (const [code, at] of usage.codes) {
    if (now - at > ROOM_TTL_MS) usage.codes.delete(code)
  }
  return usage.window.length < ROOM_CREATE_MAX_PER_MINUTE && usage.codes.size < ACTIVE_ROOMS_PER_IP_MAX
}

function recordRoomCreation(ip: string, code: string): void {
  const usage = ipRoomUsage.get(ip)
  if (!usage) return
  usage.window.push(Date.now())
  usage.codes.set(code, Date.now())
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const origin = request.headers.get('Origin')
    const originAllowed = isAllowedOrigin(origin, request.url, parseAllowedOrigins(env))

    // Same-origin policy for the API: a present-but-disallowed Origin is
    // rejected outright (covers cross-origin WS upgrades too).
    const isApiPath = path === '/api' || path.startsWith('/api/')
    const isAssetPath = path === '/assets' || path.startsWith('/assets/')
    if (isApiPath && origin && !originAllowed) {
      return withSecurityHeaders(new Response('Forbidden origin', { status: 403 }))
    }

    const headers = corsHeaders(origin, originAllowed)

    if (request.method === 'OPTIONS') return withSecurityHeaders(new Response(null, { headers }))

    if (path === '/api' || path === '/assets') {
      return withSecurityHeaders(new Response('Not found', { status: 404, headers }))
    }

    if (path === '/api/health') {
      return withSecurityHeaders(new Response('OK', { headers }))
    }

    if (path === '/api/version') {
      return withSecurityHeaders(Response.json({
        service: 'shithead-multiplayer',
        commit: BUILD_COMMIT,
        protocol: PROTOCOL_VERSION,
      }, { headers }))
    }

    if (path === '/api/room/new' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
      if (!roomCreationAllowed(ip)) {
        logEvent('room_creation_rate_limited', { ip })
        return withSecurityHeaders(Response.json(
          { error: 'Room creation rate limit exceeded' },
          { status: 429, headers: { ...headers, 'Retry-After': '60' } },
        ))
      }
      // Atomic claim in the DO removes the probe-then-create TOCTOU.
      for (let attempt = 0; attempt < 10; attempt++) {
        const roomId = generateRoomCode()
        const stub = env.ROOM.get(env.ROOM.idFromName(roomId))
        const claim = await stub.fetch('https://room.internal/internal/claim', { method: 'POST' })
        if (claim.status === 200) {
          recordRoomCreation(ip, roomId)
          return withSecurityHeaders(Response.json({ roomId }, { headers }))
        }
      }
      return withSecurityHeaders(Response.json({ error: 'Could not allocate a room code' }, { status: 503, headers }))
    }

    const roomMatch = path.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/)
    if (roomMatch && ROOM_CODE_RE.test(roomMatch[1])) {
      const stub = env.ROOM.get(env.ROOM.idFromName(roomMatch[1]))
      const response = await stub.fetch(request)
      // 101 upgrades pass through untouched; rejections get headers.
      return response.status === 101 ? response : withSecurityHeaders(response)
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request)
      if (assetResponse.status !== 404) return withSecurityHeaders(assetResponse)

      if (request.method === 'GET' && !isApiPath && !isAssetPath) {
        const fallback = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)))
        return withSecurityHeaders(fallback)
      }
    }

    return withSecurityHeaders(new Response('Not found', { status: 404, headers }))
  },
}
