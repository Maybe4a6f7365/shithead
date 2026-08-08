import type { Card, GameState, Player } from '../engine'
import { initGame, pickUpPile, playCards, rearrange, startPlay } from '../engine'
import type { ClientMsg, RoomSummary, ServerMsg } from '../engine/protocol'
import { isClientMsg, serializeGameState, toPlayerSummary } from '../engine/protocol'
import { BUILD_COMMIT } from './build-meta'

interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher
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
  createdAt: number
  lastActivity: number
}

type StoredRoomData = Omit<RoomData, 'version' | 'readyPlayerIds' | 'lastActivity'> & {
  version?: 1
  readyPlayerIds?: string[]
  lastActivity?: number
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGES_PER_SECOND = 20
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/
const EXTRA_ALLOWED_ORIGINS = new Set([
  'https://shithead.pages.dev',
  'https://shithead.maybe4a6f7365.workers.dev',
  'http://localhost:5173',
  'http://localhost:8787',
])

function isAllowedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false
  return origin === new URL(requestUrl).origin || EXTRA_ALLOWED_ORIGINS.has(origin)
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

    const match = path.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/)
    if (!match) return new Response('Not found', { status: 404 })

    this.code = match[1]
    if (this.data && this.data.code !== this.code) {
      return new Response('Room identity mismatch', { status: 409 })
    }
    if (!isAllowedOrigin(request.headers.get('Origin'), request.url)) {
      return new Response('Forbidden origin', { status: 403 })
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
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
      this.operation = this.operation
        .then(() => this.onMessage(sessionId, String(event.data)))
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

    let message: ClientMsg
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isClientMsg(parsed)) throw new Error('invalid payload')
      message = parsed
    } catch {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid message' })
      return
    }

    switch (message.type) {
      case 'CREATE_ROOM':
        await this.createRoom(session, message.playerName, message.maxPlayers)
        break
      case 'JOIN_ROOM':
        await this.joinRoom(session, message.code, message.playerName)
        break
      case 'RESUME_ROOM':
        this.resumeRoom(sessionId, session, message.playerId)
        break
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

    const player = makePlayer(name)
    session.playerId = player.id
    this.data = {
      version: 1,
      code: this.code,
      hostId: player.id,
      maxPlayers: Math.max(2, Math.min(5, requestedMaxPlayers)),
      players: [player],
      state: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }

    await this.save()
    this.welcomeAndState(session)
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
    session.playerId = player.id
    data.players.push(player)

    await this.save()
    this.welcomeAndState(session)
    this.broadcastRoom()
  }

  private resumeRoom(sessionId: string, session: Session, playerId: string): void {
    const data = this.data
    if (!data || !data.players.some(player => player.id === playerId)) {
      this.send(session, { type: 'ERROR', code: 'SESSION_EXPIRED', message: 'Saved room session no longer exists' })
      return
    }

    for (const [otherId, other] of this.sessions) {
      if (otherId === sessionId || other.playerId !== playerId) continue
      this.sessions.delete(otherId)
      try { other.webSocket.close(4001, 'Session resumed elsewhere') } catch {}
    }

    session.playerId = playerId
    this.welcomeAndState(session)
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

    // During a running game, preserve the seat so a temporary disconnect can resume.
    if (data.state) {
      session.playerId = null
      this.broadcastRoom()
      return
    }

    const leavingId = session.playerId
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

  private welcomeAndState(session: Session): void {
    this.send(session, { type: 'WELCOME', playerId: session.playerId!, room: this.summary() })
    this.sendGame(session)
  }

  private broadcastRoom(): void {
    if (this.data) this.broadcast({ type: 'ROOM_STATE', room: this.summary() })
  }

  private sendGame(session: Session): void {
    const data = this.data
    if (!data?.state || !session.playerId) return
    this.send(session, {
      type: 'GAME_STATE',
      state: serializeGameState(data.state, session.playerId),
    })
  }

  private broadcastGame(): void {
    for (const session of this.sessions.values()) this.sendGame(session)
  }

  private send(session: Session, message: ServerMsg): void {
    try { session.webSocket.send(JSON.stringify(message)) } catch {}
  }

  private broadcast(message: ServerMsg): void {
    for (const session of this.sessions.values()) this.send(session, message)
  }
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function corsHeaders(origin: string | null, requestUrl: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin, requestUrl) && origin ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const headers = corsHeaders(request.headers.get('Origin'), request.url)

    if (request.method === 'OPTIONS') return new Response(null, { headers })

    if (path === '/api/health') {
      return new Response('OK', { headers })
    }

    if (path === '/api/version') {
      return Response.json({
        service: 'shithead-multiplayer',
        commit: BUILD_COMMIT,
        protocol: 2,
      }, { headers })
    }

    if (path === '/api/room/new' && request.method === 'POST') {
      for (let attempt = 0; attempt < 10; attempt++) {
        const roomId = generateRoomCode()
        const stub = env.ROOM.get(env.ROOM.idFromName(roomId))
        const status = await stub.fetch('https://room.internal/internal/status')
        if (status.status === 404) return Response.json({ roomId }, { headers })
      }
      return Response.json({ error: 'Could not allocate a room code' }, { status: 503, headers })
    }

    const roomMatch = path.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/)
    if (roomMatch && ROOM_CODE_RE.test(roomMatch[1])) {
      const stub = env.ROOM.get(env.ROOM.idFromName(roomMatch[1]))
      return stub.fetch(request)
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request)
      if (assetResponse.status !== 404) return assetResponse

      if (request.method === 'GET' && !path.startsWith('/api/')) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)))
      }
    }

    return new Response('Not found', { status: 404, headers })
  },
}
