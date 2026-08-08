// ============================================================================
// WebSocket client — typed wrapper for the multiplayer protocol
// ============================================================================
import type { ClientMsg, ServerMsg } from '../engine/protocol'
import { isClientMsg } from '../engine/protocol'

export interface RoomClientOptions {
  url: string                  // ws://... or wss://...
  onMessage: (msg: ServerMsg) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (err: Event) => void
  reconnectDelayMs?: number
  maxReconnectAttempts?: number
}

export class RoomClient {
  private ws: WebSocket | null = null
  private opts: Required<RoomClientOptions>
  private reconnectAttempts = 0
  private closed = false
  private queue: ClientMsg[] = []

  constructor(opts: RoomClientOptions) {
    this.opts = {
      reconnectDelayMs: 1000,
      maxReconnectAttempts: 5,
      onOpen: () => {},
      onClose: () => {},
      onError: () => {},
      ...opts,
    }
    this.connect()
  }

  private connect() {
    if (this.closed) return
    try {
      this.ws = new WebSocket(this.opts.url)
    } catch (err) {
      this.opts.onError(err as Event)
      this.scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0
      // Flush queued messages
      for (const msg of this.queue) this.send(msg)
      this.queue = []
      this.opts.onOpen()
    })

    this.ws.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (typeof data === 'object' && data !== null && 'type' in data) {
          this.opts.onMessage(data as ServerMsg)
        }
      } catch (e) {
        // ignore parse errors
      }
    })

    this.ws.addEventListener('close', (ev) => {
      this.opts.onClose(ev)
      if (!this.closed) this.scheduleReconnect()
    })

    this.ws.addEventListener('error', (ev) => {
      this.opts.onError(ev)
    })
  }

  private scheduleReconnect() {
    if (this.closed) return
    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) return
    this.reconnectAttempts++
    const delay = this.opts.reconnectDelayMs * Math.min(this.reconnectAttempts, 5)
    setTimeout(() => this.connect(), delay)
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      // Queue for after reconnect
      this.queue.push(msg)
    }
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
