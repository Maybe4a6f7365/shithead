import type { Card, GameState, Player } from '../engine'
import { initGame, pickUpPile, playCards, rearrange, startPlay } from '../engine'
import type { ClientMsg, RoomSummary, ServerMsg } from '../engine/protocol'
import { isClientMsg, PROTOCOL_VERSION, serializeGameState, toPlayerSummary } from '../engine/protocol'
import { BUILD_COMMIT } from './build-meta'

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
  version: 1
  code: string
  hostId: string
  maxPlayers: number
  players: Player[]
  state: GameState | null
  readyPlayerIds: string[]
  /** playerId -> SHA-256 hex hash of the current resume token (secret). */
  resumeTokens: Record<string, string>
  createdAt: number
  lastActivity: number
}

type StoredRoomData = Omit<RoomData, 'version' | 'readyPlayerIds' | 'lastActivity' | 'resumeTokens'> & {
  version?: 1
  readyPlayerIds?: string[]
  lastActivity?: number
  resumeTokens?: Record<string, string>
}

// ---------- Worker-local protocol extensions (engine is frozen) ----------
// WELCOME carries the per-player secret resumeToken (never broadcast);
// RESUME_FAILED is the typed refusal for a bad RESUME_ROOM.
type WelcomeMsg = {
  type: 'WELCOME'
  playerId: string
  room: RoomSummary
  version: number
  resumeToken: string
}
type ResumeFailedMsg = { type: 'RESUME_FAILED'; reason: string }
type OutMsg = ServerMsg | WelcomeMsg | ResumeFailedMsg

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGES_PER_SECOND = 20
const MAX_MESSAGE_CHARS = 16 * 1024 // per-socket WS message cap; oversize -> close 1009
const MAX_SOCKETS_PER_ROOM = 12 // 5 players + spectator/duplicate-tab allowance
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
  private data: RoomData | null = null
  private code = ''
  private operation: Promise<void> = Promise.resolve()
  private readonly initialized: Promise<void>

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<StoredRoomData>('room')
      if (!stored) return

      this.data = {
        ...stored,
        version: 1,
        readyPlayerIds: stored.readyPlayerIds ?? [],
        lastActivity: stored.lastActivity ?? stored.createdAt,
        resumeTokens: stored.resumeTokens ?? {},
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
    server.addEventListener('message', event => {
      const raw = String(event.data)
      if (raw.length > MAX_MESSAGE_CHARS) {
        logEvent('oversize_message', { code: this.code, size: raw.length })
        this.sessions.delete(sessionId)
        try { server.close(1009, 'Message too large') } catch {}
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
    server.addEventListener('close', () => this.closeSession(sessionId))
    server.addEventListener('error', () => this.closeSession(sessionId))

    return new Response(null, { status: 101, webSocket: client })
  }

  private async onMessage(sessionId: string, raw: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (!this.withinRateLimit(session)) {
      this.send(session, { type: 'ERROR', code: 'RATE_LIMITED', message: 'Too many messages' })
      return
    }

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

    switch (message.type) {
      case 'CREATE_ROOM':
        await this.createRoom(session, message.playerName, message.maxPlayers)
        break
      case 'JOIN_ROOM':
        await this.joinRoom(session, message.code, message.playerName)
        break
      case 'RESUME_ROOM': {
        // resumeToken rides along as an extra field (engine schema unchanged).
        const resumeToken = (parsed as { resumeToken?: unknown }).resumeToken
        await this.resumeRoom(sessionId, session, message.playerId, resumeToken)
        break
      }
      case 'LEAVE_ROOM':
        await this.leaveRoom(session)
        break
      case 'START_GAME':
        await this.startGame(session)
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
      case 'PICK_UP':
        await this.pickUp(session)
        break
      case 'CHAT':
        this.chat(session, message.text)
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

  private async createRoom(session: Session, rawName: string, requestedMaxPlayers = 5): Promise<void> {
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
    if (!claimOk) {
      this.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room code not allocated; request a new room first' })
      return
    }

    const player = makePlayer(name)
    const resumeToken = generateResumeToken()
    session.playerId = player.id
    this.data = {
      version: 1,
      code: this.code,
      hostId: player.id,
      maxPlayers: Math.max(2, Math.min(5, requestedMaxPlayers)),
      players: [player],
      state: null,
      readyPlayerIds: [],
      resumeTokens: { [player.id]: await hashResumeToken(resumeToken) },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }

    await this.save()
    logEvent('room_created', { code: this.code })
    this.welcomeAndState(session, resumeToken)
    this.broadcastRoom()
  }

  private async joinRoom(session: Session, code: string, rawName: string): Promise<void> {
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
    if (data.players.length >= data.maxPlayers) {
      this.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'Room is full' })
      return
    }
    if (data.state) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Game already started' })
      return
    }

    const player = makePlayer(name)
    const resumeToken = generateResumeToken()
    session.playerId = player.id
    data.players.push(player)
    data.resumeTokens[player.id] = await hashResumeToken(resumeToken)

    await this.save()
    this.welcomeAndState(session, resumeToken)
    this.broadcastRoom()
  }

  /**
   * Resume requires the per-player secret token issued in WELCOME (and
   * rotated on every successful resume). The broadcast playerId alone is
   * NOT a credential. Failures send RESUME_FAILED and never attach.
   */
  private async resumeRoom(sessionId: string, session: Session, playerId: string, resumeToken: unknown): Promise<void> {
    const fail = (reason: string) => {
      logEvent('resume_failed', { code: this.code, reason })
      this.send(session, { type: 'RESUME_FAILED', reason })
    }

    const data = this.data
    if (!data) {
      fail('room_not_found')
      return
    }
    if (!data.players.some(player => player.id === playerId)) {
      fail('not_a_member')
      return
    }
    const storedHash = data.resumeTokens[playerId]
    if (typeof resumeToken !== 'string' || !storedHash) {
      fail('invalid_token')
      return
    }
    const presentedHash = await hashResumeToken(resumeToken)
    if (!constantTimeEqual(presentedHash, storedHash)) {
      fail('invalid_token')
      return
    }

    // Rotate: the presented token is single-use; the new one goes only to
    // this socket in WELCOME.
    const nextToken = generateResumeToken()
    data.resumeTokens[playerId] = await hashResumeToken(nextToken)

    for (const [otherId, other] of this.sessions) {
      if (otherId === sessionId || other.playerId !== playerId) continue
      this.sessions.delete(otherId)
      try { other.webSocket.close(4001, 'Session resumed elsewhere') } catch {}
    }

    session.playerId = playerId
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
    if (data.state) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Game already started' })
      return
    }
    if (data.players.length < 2) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'At least two players are required' })
      return
    }

    data.state = initGame({
      players: data.players.map(player => ({ id: player.id, name: player.name, isAI: false })),
    })
    data.readyPlayerIds = []

    await this.save()
    this.broadcastGame()
  }

  private async markReady(session: Session): Promise<void> {
    const data = this.data
    if (!data?.state || !session.playerId || data.state.phase !== 'rearrange') return

    if (!data.readyPlayerIds.includes(session.playerId)) data.readyPlayerIds.push(session.playerId)
    const everyoneReady = data.players.every(player => data.readyPlayerIds.includes(player.id))
    if (everyoneReady) data.state = startPlay(data.state)

    await this.save()
    this.broadcastGame()
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
    const player = this.data?.state?.players.find(candidate => candidate.id === playerId)
    if (!player) return null

    const owned = new Map(
      [...player.hand, ...player.faceUp, ...player.faceDown].map(card => [card.id, card]),
    )
    const ids = requested.map(card => card.id)
    if (new Set(ids).size !== ids.length) return null

    const cards = ids.map(id => owned.get(id))
    return cards.every((card): card is Card => !!card) ? cards : null
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
    await this.save()
    this.broadcastGame()
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
    await this.save()
    this.broadcastGame()
  }

  private chat(session: Session, rawText: string): void {
    if (!session.playerId) return
    const text = rawText.slice(0, 200).replace(/[^\w\s!?.,-]/g, '')
    if (!text) return

    this.broadcast({ type: 'CHAT', playerId: session.playerId, text, ts: Date.now() })
  }

  private async leaveRoom(session: Session): Promise<void> {
    const data = this.data
    if (!data || !session.playerId) return

    // An explicit LEAVE always destroys the resume token (the credential is
    // surrendered). During a running game the seat itself is preserved for
    // game integrity, but without a token it can no longer be reclaimed.
    const leavingId = session.playerId
    delete data.resumeTokens[leavingId]

    if (data.state) {
      session.playerId = null
      await this.save()
      this.broadcastRoom()
      return
    }

    data.players = data.players.filter(player => player.id !== leavingId)
    data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== leavingId)
    session.playerId = null

    if (data.players.length === 0) {
      this.data = null
    } else if (data.hostId === leavingId) {
      data.hostId = data.players[0].id
    }

    await this.save()
    this.broadcast({ type: 'PLAYER_LEFT', playerId: leavingId })
    this.broadcastRoom()
  }

  private closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.broadcastRoom()
  }

  private isConnected(playerId: string): boolean {
    return [...this.sessions.values()].some(session => session.playerId === playerId)
  }

  private summary(): RoomSummary {
    const data = this.data!
    return {
      code: data.code,
      phase: data.state?.phase ?? 'waiting',
      hostId: data.hostId,
      maxPlayers: data.maxPlayers,
      players: data.players.map(lobbyPlayer => {
        const currentPlayer = data.state?.players.find(player => player.id === lobbyPlayer.id) ?? lobbyPlayer
        return toPlayerSummary(currentPlayer, this.isConnected(lobbyPlayer.id))
      }),
      createdAt: data.createdAt,
    }
  }

  private welcomeAndState(session: Session, resumeToken: string): void {
    // resumeToken is per-player secret: it goes ONLY to this socket, never
    // into ROOM_STATE/GAME_STATE broadcasts.
    this.send(session, {
      type: 'WELCOME',
      playerId: session.playerId!,
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
    // Per-recipient serialization: stock/opponent cards are masked for THIS
    // viewer; log is capped by the engine (MAX_LOG_ENTRIES ring buffer).
    this.send(session, {
      type: 'GAME_STATE',
      state: serializeGameState(data.state, session.playerId),
      version: PROTOCOL_VERSION,
    })
  }

  private broadcastGame(): void {
    for (const session of this.sessions.values()) this.sendGame(session)
  }

  private send(session: Session, message: OutMsg): void {
    try { session.webSocket.send(JSON.stringify(message)) } catch {}
  }

  private broadcast(message: OutMsg): void {
    for (const session of this.sessions.values()) this.send(session, message)
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
    if (path.startsWith('/api/') && origin && !originAllowed) {
      return withSecurityHeaders(new Response('Forbidden origin', { status: 403 }))
    }

    const headers = corsHeaders(origin, originAllowed)

    if (request.method === 'OPTIONS') return withSecurityHeaders(new Response(null, { headers }))

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

      if (request.method === 'GET' && !path.startsWith('/api/')) {
        const fallback = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)))
        return withSecurityHeaders(fallback)
      }
    }

    return withSecurityHeaders(new Response('Not found', { status: 404, headers }))
  },
}
