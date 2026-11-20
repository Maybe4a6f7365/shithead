// ============================================================================
// The Worker's bindings, and the origin policy they configure. Browsers may
// reach the API and open room sockets only from the app's own origin (plus the
// local dev servers, or an explicit ALLOWED_ORIGINS list).
// ============================================================================

export interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher
  /** Optional comma-separated extra allowed Origins (exact matches). */
  ALLOWED_ORIGINS?: string
}

const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8787']

export function parseAllowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_DEV_ORIGINS)
}

export function isAllowedOrigin(origin: string | null, requestUrl: string, extra: Set<string>): boolean {
  if (!origin) return false
  return origin === new URL(requestUrl).origin || extra.has(origin)
}
