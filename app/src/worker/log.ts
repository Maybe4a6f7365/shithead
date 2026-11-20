/** Structured server-side log (observability enabled in wrangler.toml). */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ts: Date.now(), ...fields }))
}
