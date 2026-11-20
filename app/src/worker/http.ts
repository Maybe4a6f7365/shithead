// ============================================================================
// The Worker's front door: every HTTP request. API routes, allocation of new
// room codes (rate limited per IP), routing of room sockets to their Durable
// Object, the static app, and the security headers on all of it.
// ============================================================================
import { PROTOCOL_VERSION } from '../engine/protocol'
import { BUILD_COMMIT } from './build-meta'
import { generateRoomCode } from './credentials'
import { isAllowedOrigin, parseAllowedOrigins, type Env } from './env'
import { logEvent } from './log'
import { ROOM_TTL_MS } from './room/roomData'

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/

// Room-creation abuse limits (per isolate, best effort — see below).
const ROOM_CREATE_MAX_PER_MINUTE = 10
const ROOM_CREATE_WINDOW_MS = 60_000
const ACTIVE_ROOMS_PER_IP_MAX = 30

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
