// ============================================================================
// WebSocket client — typed wrapper for the multiplayer protocol.
// Reconnect truthfulness (§4.6, Appendix A.10): the client reports every
// attempt with a real counter, and when it gives up it says so — the UI can
// then turn the badge into a retry button instead of lying "reconnecting…".
// ============================================================================
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../engine/protocol'

export interface RoomClientOptions {
  url: string                  // ws://... or wss://...
  onMessage: (msg: ServerMsg) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (err: Event) => void
  /** Fired before each scheduled retry with the real attempt counter. */
  onReconnecting?: (attempt: number, maxAttempts: number) => void
  /** Fired once when all attempts are exhausted. Never reconnects after. */
  onGiveUp?: () => void
  reconnectDelayMs?: number
  maxReconnectAttempts?: number
}

export class RoomClient {
  private ws: WebSocket | null = null
  private opts: Required<RoomClientOptions>
  private reconnectAttempts = 0
  private closed = false
  private gaveUp = false
  private authenticated = false
  private queue: ClientMsg[] = []

  constructor(opts: RoomClientOptions) {
    this.opts = {
      reconnectDelayMs: 1000,
      maxReconnectAttempts: 5,
      onOpen: () => {},
      onClose: () => {},
      onError: () => {},
      onReconnecting: () => {},
      onGiveUp: () => {},
      ...opts,
    }
    this.connect()
  }

  private connect() {
    if (this.closed || this.gaveUp) return
    try {
      this.ws = new WebSocket(this.opts.url)
    } catch (err) {
      this.opts.onError(err as Event)
      this.scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0
      this.authenticated = false
      // The hook sends CREATE/JOIN/RESUME here. It must be the first frame on
      // every connection; gameplay queued while offline is flushed only once
      // WELCOME proves that the socket has reclaimed its seat.
      this.opts.onOpen()
      this.flushPreAuthLeave()
    })

    this.ws.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (typeof data === 'object' && data !== null && 'type' in data) {
          this.opts.onMessage(data as ServerMsg)
        }
      } catch {
        // ignore parse errors
      }
    })

    this.ws.addEventListener('close', (ev) => {
      this.authenticated = false
      this.opts.onClose(ev)
      if (!this.closed) this.scheduleReconnect()
    })

    this.ws.addEventListener('error', (ev) => {
      this.opts.onError(ev)
    })
  }

  private scheduleReconnect() {
    if (this.closed || this.gaveUp) return
    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      this.gaveUp = true
      this.opts.onGiveUp()
      return
    }
    this.reconnectAttempts++
    this.opts.onReconnecting(this.reconnectAttempts, this.opts.maxReconnectAttempts)
    const delay = this.opts.reconnectDelayMs * Math.min(this.reconnectAttempts, 5)
    setTimeout(() => this.connect(), delay)
  }

  /** Manual retry after give-up (the badge-as-button path, §4.6). */
  retry() {
    if (this.closed) return
    this.gaveUp = false
    this.reconnectAttempts = 0
    this.connect()
  }

  hasGivenUp(): boolean {
    return this.gaveUp
  }

  send(msg: ClientMsg): boolean {
    const stamped = { ...msg, version: PROTOCOL_VERSION } as ClientMsg
    // Chat/reactions/broadcasts are presence, and QUICK_FOLLOW_UP is bound to one
    // exact authoritative sequence. Never replay any after reconnect/auth the
    // way durable game actions are: the next player's move may have already
    // closed the follow-up window (and a rematch may restart seq at zero).
    if ((stamped.type === 'CHAT' || stamped.type === 'EMOTE' || stamped.type === 'BROADCAST' ||
      stamped.type === 'QUICK_FOLLOW_UP') &&
      (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated)) return false
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.isAuthentication(stamped) || stamped.type === 'LEAVE_ROOM' || this.authenticated) {
        this.ws.send(JSON.stringify(stamped))
        return true
      } else {
        this.queue.push(stamped)
        return true
      }
    } else {
      // The lifecycle owner re-sends fresh authentication from onOpen. Never
      // retain an offline auth frame: a queued RESUME would carry the token
      // that WELCOME just rotated and could invalidate the recovered session.
      if (!this.isAuthentication(stamped)) {
        this.queue.push(stamped)
        return true
      }
    }
    return false
  }

  /** Called after WELCOME: queued gameplay is now safe to send. */
  markAuthenticated() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.authenticated = true
    const queued = this.queue
    this.queue = []
    for (const msg of queued) {
      // Defensive filtering also protects sessions created by older code or
      // tests that directly seeded the queue before authentication.
      if (msg.type === 'CHAT' || msg.type === 'EMOTE' || msg.type === 'BROADCAST' ||
        msg.type === 'QUICK_FOLLOW_UP') continue
      this.ws.send(JSON.stringify({ ...msg, version: PROTOCOL_VERSION }))
    }
  }

  private isAuthentication(msg: ClientMsg): boolean {
    return msg.type === 'CREATE_ROOM' || msg.type === 'JOIN_ROOM' || msg.type === 'RESUME_ROOM'
  }

  /**
   * Cancel may happen after the socket opened but before WELCOME. Send only
   * the terminal LEAVE at that point: TCP ordering keeps JOIN -> LEAVE, while
   * PLAY and other queued actions still wait for authentication.
   */
  private flushPreAuthLeave() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const remaining: ClientMsg[] = []
    for (const msg of this.queue) {
      if (msg.type === 'LEAVE_ROOM') this.ws.send(JSON.stringify({ ...msg, version: PROTOCOL_VERSION }))
      else remaining.push(msg)
    }
    this.queue = remaining
  }

  close() {
    this.closed = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// ---------- URL helpers ----------

export function buildRoomWSUrl(base: string, roomId: string): string {
  // Convert http:// → ws://, https:// → wss://
  const wsBase = base.replace(/^http/, 'ws')
  return `${wsBase}/api/room/${roomId}/ws`
}

export function getDefaultServerURL(): string {
  if (typeof window !== 'undefined') {
    // Production: same origin
    if (window.location.hostname.endsWith('.workers.dev') || window.location.hostname.endsWith('.pages.dev')) {
      return window.location.origin
    }
    // Dev: separate worker port
    if (window.location.port === '5173') {
      return 'http://localhost:8787'
    }
    return window.location.origin
  }
  return ''
}
