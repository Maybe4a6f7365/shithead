// ============================================================================
// Room Durable Object — one instance per game room
// - Stores game state + player connections
// - Validates + applies moves
// - Broadcasts state to all connected players
// - Auto-cleans empty rooms after 1h
// ============================================================================

import type {
  GameState, Player, Card,
} from '../engine'
import {
  initGame, rearrange, startPlay, playCards, pickUpPile,
  getCurrentPlayer, pileSize, getTopCard, makeDeck,
} from '../engine'
import type {
  ClientMsg, ServerMsg, RoomSummary, PlayerSummary, ErrorCode,
} from '../engine/protocol'
import {
  isClientMsg, serializeGameState, toPlayerSummary,
} from '../engine/protocol'

interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher  // static asset binding (for serving PWA)
}

interface Session {
  webSocket: WebSocket
  playerId: string | null
  playerName: string | null
  ip: string
}

interface RoomData {
  code: string
  hostId: string
  maxPlayers: number
  players: Player[]
  state: GameState | null
  createdAt: number
  lastActivity: number
}

// Allowed origins for WebSocket upgrade — strict in prod
const ALLOWED_ORIGINS_LIST = [
  'https://shithead.pages.dev',
  'https://shithead.maybe4a6f7365.workers.dev',
  'http://localhost:5173',
  'http://localhost:8787',
]

function ALLOWED_ORIGINS(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGINS_LIST.some(allowed => origin.startsWith(allowed))
}

// In-memory storage (Durable Object instance state)
const rooms = new Map<string, RoomData>()

export class Room {
  private state: DurableObjectState
  private env: Env
  private sessions: Map<string, Session> = new Map()
  private code: string = ''
  private hostId: string = ''

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // WebSocket upgrade
    if (path === '/ws') {
      const origin = request.headers.get('Origin')
      if (!ALLOWED_ORIGINS(origin)) {
        return new Response('Forbidden origin', { status: 403 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }
      return this.handleWebSocket(request)
    }

    // HTTP REST for room metadata (used by lobby for room list)
    if (path === '/meta') {
      const data = rooms.get(this.code)
      if (!data) return new Response('Not found', { status: 404 })
      return Response.json(this.toSummary(data))
    }

    if (path === '/health') return new Response('OK')

    return new Response('Not found', { status: 404 })
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'

    const sessionId = crypto.randomUUID()
    const session: Session = {
      webSocket: server,
      playerId: null,
      playerName: null,
      ip,
    }
    this.sessions.set(sessionId, session)

    server.accept()
    server.addEventListener('message', (ev) => this.onMessage(sessionId, ev.data as string))
    server.addEventListener('close', () => this.onClose(sessionId))
    server.addEventListener('error', () => this.onClose(sessionId))

    // Send WELCOME with playerId after handshake completes (on first CREATE_ROOM or JOIN_ROOM)
    return new Response(null, { status: 101, webSocket: client })
  }

  private onMessage(sessionId: string, raw: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return

    let msg: ClientMsg
    try {
      const parsed = JSON.parse(raw)
      if (!isClientMsg(parsed)) throw new Error('Invalid message type')
      msg = parsed
    } catch (e) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Bad message format' })
      return
    }

    // Rate limit (cheap): 10 msgs/sec per session
    if (!this.checkRateLimit(sessionId)) {
      this.send(session, { type: 'ERROR', code: 'RATE_LIMITED', message: 'Slow down' })
      return
    }

    switch (msg.type) {
      case 'CREATE_ROOM': this.handleCreate(session, msg.playerName, msg.maxPlayers); break
      case 'JOIN_ROOM': this.handleJoin(session, msg.code, msg.playerName); break
      case 'LEAVE_ROOM': this.handleLeave(session); break
      case 'START_GAME': this.handleStart(session); break
      case 'READY': this.handleReady(session); break
      case 'REARRANGE': this.handleRearrange(session, msg.handIdx, msg.upIdx); break
      case 'PLAY': this.handlePlay(session, msg.cards); break
      case 'PICK_UP': this.handlePickUp(session); break
      case 'CHAT': this.handleChat(session, msg.text); break
      case 'PING': this.send(session, { type: 'PONG', ts: Date.now() }); break
    }
  }

  private onClose(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    // Mark player as disconnected, don't kick — they can reconnect with same playerId
    // (future: store playerId in cookie/sessionStorage on client)
    this.broadcastRoom()
  }

  // ----- Rate limit -----
  private rateLimits = new Map<string, number[]>()
  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now()
    const arr = (this.rateLimits.get(sessionId) ?? []).filter(t => now - t < 1000)
    if (arr.length >= 10) return false
    arr.push(now)
    this.rateLimits.set(sessionId, arr)
    return true
  }

  // ----- Handlers -----

  private handleCreate(session: Session, playerName: string, maxPlayers = 5) {
    if (session.playerId) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already in room' })
      return
    }
    if (!playerName || playerName.length > 32) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid name' })
      return
    }

    const playerId = crypto.randomUUID()
    const code = generateRoomCode()
    const player: Player = {
      id: playerId,
      name: playerName,
      isAI: false,
      hand: [], faceUp: [], faceDown: [], isOut: false,
    }

    session.playerId = playerId
    session.playerName = playerName
    this.hostId = playerId
    this.code = code

    rooms.set(code, {
      code,
      hostId: playerId,
      maxPlayers,
      players: [player],
      state: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    })

    this.send(session, { type: 'WELCOME', playerId, room: this.toSummary(rooms.get(code)!) })
    this.broadcastRoom()
  }

  private handleJoin(session: Session, code: string, playerName: string) {
    if (session.playerId) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already in room' })
      return
    }
    const data = rooms.get(code.toUpperCase())
    if (!data) {
      this.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room not found' })
      return
    }
    if (data.players.length >= data.maxPlayers) {
      this.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'Room is full' })
      return
    }
    if (data.state && data.state.phase !== 'lobby' && data.state.phase !== 'rearrange') {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Game already started' })
      return
    }

    const playerId = crypto.randomUUID()
    const player: Player = {
      id: playerId,
      name: playerName,
      isAI: false,
      hand: [], faceUp: [], faceDown: [], isOut: false,
    }
    session.playerId = playerId
    session.playerName = playerName

    // If game already in rearrange phase, give them their dealt hand
    if (data.state) {
      // Re-deal not supported — instead kick back to lobby
      data.state = null
    }
    data.players.push(player)
    data.lastActivity = Date.now()

    this.send(session, { type: 'WELCOME', playerId, room: this.toSummary(data) })
    this.broadcastRoom()
  }

  private handleLeave(session: Session) {
    if (!session.playerId) return
    this.removePlayer(session.playerId)
    session.playerId = null
    session.playerName = null
  }

  private handleStart(session: Session) {
    if (session.playerId !== this.hostId) {
      this.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only host can start' })
      return
    }
    const data = rooms.get(this.code)
    if (!data) return
    if (data.players.length < 2) {
      this.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Need at least 2 players' })
      return
    }

    // Optionally fill with AIs
    const playerConfigs = data.players.map(p => ({
      id: p.id, name: p.name, isAI: p.isAI, aiDifficulty: p.aiDifficulty as any,
    }))
    while (playerConfigs.length < 2) {
      playerConfigs.push({
        id: crypto.randomUUID(),
        name: `Bot ${playerConfigs.length}`,
        isAI: true,
        aiDifficulty: 'medium' as const,
      })
    }
    data.state = initGame({ players: playerConfigs })
    data.lastActivity = Date.now()
    this.broadcastGameState()
  }

  private handleReady(session: Session) {
    if (!session.playerId) return
    const data = rooms.get(this.code)
    if (!data || !data.state) return
    if (data.state.phase !== 'rearrange') return
    data.state = startPlay(data.state)
    data.lastActivity = Date.now()
    this.broadcastGameState()
  }

  private handleRearrange(session: Session, handIdx: number, upIdx: number) {
    if (!session.playerId) return
    const data = rooms.get(this.code)
    if (!data || !data.state) return
    if (data.state.phase !== 'rearrange') return
    const player = data.state.players.find(p => p.id === session.playerId)
    if (!player) return
    data.state = rearrange(data.state, player.id, handIdx, upIdx)
    data.lastActivity = Date.now()
    this.broadcastGameState()
  }

  private handlePlay(session: Session, cards: Card[]) {
    if (!session.playerId) return
    const data = rooms.get(this.code)
    if (!data || !data.state) return
    const result = playCards(data.state, session.playerId, cards)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }
    data.state = result.state
    data.lastActivity = Date.now()
    this.broadcastGameState()
  }

  private handlePickUp(session: Session) {
    if (!session.playerId) return
    const data = rooms.get(this.code)
    if (!data || !data.state) return
    const result = pickUpPile(data.state, session.playerId)
    if (result.error) {
      this.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
      return
    }
    data.state = result.state
    data.lastActivity = Date.now()
    this.broadcastGameState()
  }

  private handleChat(session: Session, text: string) {
    if (!session.playerId) return
    const clean = text.slice(0, 200).replace(/[^\w\s!?.,-]/g, '')
    if (!clean) return
    this.broadcast({
      type: 'CHAT',
      playerId: session.playerId,
      text: clean,
      ts: Date.now(),
    })
  }

  // ----- Broadcast helpers -----

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg)
    for (const session of this.sessions.values()) {
      try {
        session.webSocket.send(data)
      } catch {
        // ignore
      }
    }
  }

  private broadcastRoom() {
    const data = rooms.get(this.code)
    if (!data) return
    this.broadcast({ type: 'ROOM_STATE', room: this.toSummary(data) })
  }

  private broadcastGameState() {
    const data = rooms.get(this.code)
    if (!data || !data.state) return
    for (const [sessionId, session] of this.sessions) {
      if (!session.playerId) continue
      const sanitized = serializeGameState(data.state, session.playerId)
      try {
        session.webSocket.send(JSON.stringify({ type: 'GAME_STATE', state: sanitized } as ServerMsg))
      } catch {}
    }
  }

  private send(session: Session, msg: ServerMsg) {
    try {
      session.webSocket.send(JSON.stringify(msg))
    } catch {}
  }

  private toSummary(data: RoomData): RoomSummary {
    return {
      code: data.code,
      phase: data.state?.phase ?? 'waiting',
      hostId: data.hostId,
      maxPlayers: data.maxPlayers,
      players: data.players.map(p => toPlayerSummary(p, this.sessionsConnected(p.id))),
      createdAt: data.createdAt,
    }
  }

  private sessionsConnected(playerId: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.playerId === playerId) return true
    }
    return false
  }

  private removePlayer(playerId: string) {
    const data = rooms.get(this.code)
    if (!data) return
    data.players = data.players.filter(p => p.id !== playerId)
    if (data.players.length === 0) {
      rooms.delete(this.code)
    } else if (data.hostId === playerId) {
      data.hostId = data.players[0].id
      this.hostId = data.hostId
    }
    this.broadcast({ type: 'PLAYER_LEFT', playerId })
    this.broadcastRoom()
  }
}

// ============================================================================
// Worker entry point — HTTP routing + static asset serving
// ============================================================================

function generateRoomCode(): string {
  // 6-char alphanumeric, avoiding confusable chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export { generateRoomCode }

// ---------- Entry ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request.headers.get('Origin')),
      })
    }

    // API routes
    if (path === '/api/health') {
      return new Response('OK', { headers: corsHeaders(request.headers.get('Origin')) })
    }

    if (path === '/api/room/new') {
      // Create a new room and return its code
      const id = env.ROOM.newUniqueId()
      const room = env.ROOM.get(id)
      // Initialize room state by calling fetch with a special init path
      await room.fetch(new Request('https://internal/init', { method: 'POST' }))
      return Response.json({ roomId: id.toString() }, { headers: corsHeaders(request.headers.get('Origin')) })
    }

    // WebSocket upgrade for room
    if (path.startsWith('/api/room/') && path.endsWith('/ws')) {
      const roomId = path.split('/')[3]
      const id = env.ROOM.idFromString(roomId)
      const room = env.ROOM.get(id)
      return room.fetch(request)
    }

    // Static assets (built PWA)
    if (env.ASSETS) {
      const assetResp = await env.ASSETS.fetch(request)
      if (assetResp.status !== 404) return assetResp
    }

    // SPA fallback — serve index.html for any non-API path
    if (request.method === 'GET' && !path.startsWith('/api/')) {
      const indexReq = new Request(new URL('/index.html', request.url))
      return env.ASSETS.fetch(indexReq)
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(request.headers.get('Origin')) })
  },
}

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}
