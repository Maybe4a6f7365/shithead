// ============================================================================
// useMultiplayerRoom — room socket lifecycle, session resume, seq guard,
// truthful connection states (§4.6, Appendix A.10).
//
// RESUME CONTRACT (shared with the worker agent; additive + backwards
// compatible with today's worker, where token fields are simply absent):
//  - WELCOME may carry `resumeToken` (per-player secret). We persist
//    { roomCode, playerId, resumeToken, playerName } in localStorage.
//  - RESUME_ROOM is sent as { type, roomCode, playerId, resumeToken } —
//    today's worker validates only playerId and ignores the extra fields.
//  - New server message RESUME_FAILED { reason } clears credentials and
//    routes to the lobby with an explicit "session expired" state.
//  - On successful resume the server ROTATES the token; the WELCOME that
//    answers RESUME_ROOM carries the new one and is stored.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMsg, RoomSummary, ServerMsg } from '../engine/protocol'
import type { GameState } from '../engine'
import { RoomClient, buildRoomWSUrl, getDefaultServerURL } from './RoomClient'

export type RoomStatus =
  | 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'restored' | 'offline'

export type RoomErrorKind =
  | 'invalid-room' | 'room-full' | 'server-error' | 'session-expired' | 'host-unavailable'

export interface RoomError { kind: RoomErrorKind; message: string }

// ---------- Session persistence ----------

export interface StoredSession {
  roomCode: string
  playerId: string
  resumeToken?: string
  playerName: string
}

const SESSION_KEY = 'shithead:session'

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.roomCode === 'string' && typeof parsed?.playerId === 'string') {
      return parsed as StoredSession
    }
  } catch { /* corrupted storage */ }
  return null
}

export function saveSession(s: StoredSession): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* storage full/denied */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

// ---------- seq guard (pure, exported for tests) ----------

/**
 * Accept a GAME_STATE iff it moves the sequence forward (protocol: clients
 * MUST ignore state.seq <= last seen). Exception: a rematch restarts the
 * engine — seq 0, turnCount 0, phase rearrange — which is a fresh game, not
 * a replay. Messages without seq (legacy) are always accepted.
 */
export function shouldAcceptGameState(incoming: GameState, lastSeq: number | null): boolean {
  const seq = incoming.seq
  if (seq === undefined || seq === null) return true
  if (lastSeq === null) return true
  if (seq > lastSeq) return true
  return seq === 0 && incoming.turnCount === 0 && incoming.phase === 'rearrange'
}

// ---------- Extended (additive) server messages ----------

interface WelcomeExt { playerId: string; room: RoomSummary; resumeToken?: string }
interface ResumeFailedMsg { type: 'RESUME_FAILED'; reason?: string }

// ---------- The hook ----------

export interface UseMultiplayerRoomArgs {
  roomId: string | null
  playerName: string
  intent: 'create' | 'join'
}

export function useMultiplayerRoom({ roomId, playerName, intent }: UseMultiplayerRoomArgs) {
  const [status, setStatus] = useState<RoomStatus>('idle')
  const [attempt, setAttempt] = useState(0)
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [error, setError] = useState<RoomError | null>(null)
  const [notice, setNotice] = useState<string | null>(null) // in-game rejections → feed
  const clientRef = useRef<RoomClient | null>(null)
  const lastSeqRef = useRef<number | null>(null)
  const sessionRef = useRef<StoredSession | null>(null)
  const reconnectingRef = useRef(false)
  const restoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!roomId) return

    setStatus('connecting')
    setError(null)
    setNotice(null)
    setRoom(null)
    setGameState(null)
    setPlayerId(null)
    lastSeqRef.current = null
    reconnectingRef.current = false

    // Prefer stored credentials for this room (refresh / auto-reconnect).
    const stored = loadSession()
    sessionRef.current = stored && stored.roomCode === roomId ? stored : null

    const sendJoinIntent = () => {
      if (sessionRef.current) {
        const s = sessionRef.current
        // Additive: roomCode + resumeToken are ignored by today's worker.
        clientRef.current?.send({
          type: 'RESUME_ROOM',
          playerId: s.playerId,
          roomCode: s.roomCode,
          resumeToken: s.resumeToken,
        } as ClientMsg)
      } else if (intent === 'join') {
        clientRef.current?.send({ type: 'JOIN_ROOM', code: roomId, playerName })
      } else {
        clientRef.current?.send({ type: 'CREATE_ROOM', playerName })
      }
    }

    const client = new RoomClient({
      url: buildRoomWSUrl(getDefaultServerURL(), roomId),
      onOpen: () => {
        setError(null)
        sendJoinIntent()
      },
      onClose: () => {
        reconnectingRef.current = true
        setStatus(prev => (prev === 'offline' ? prev : 'reconnecting'))
      },
      onError: () => {
        setStatus(prev => (prev === 'connected' || prev === 'restored' || prev === 'reconnecting') ? prev : 'connecting')
      },
      onReconnecting: (n) => {
        reconnectingRef.current = true
        setAttempt(n)
        setStatus('reconnecting')
      },
      onGiveUp: () => {
        setStatus('offline')
      },
      onMessage: (message: ServerMsg | ResumeFailedMsg) => {
        switch (message.type) {
          case 'WELCOME': {
            const w = message as ServerMsg & WelcomeExt & { type: 'WELCOME' }
            setPlayerId(w.playerId)
            setRoom(w.room)
            setError(null)
            // Persist (and rotate) credentials.
            const session: StoredSession = {
              roomCode: w.room.code,
              playerId: w.playerId,
              resumeToken: w.resumeToken ?? sessionRef.current?.resumeToken,
              playerName: playerName || sessionRef.current?.playerName || 'Player',
            }
            sessionRef.current = session
            saveSession(session)
            if (reconnectingRef.current) {
              reconnectingRef.current = false
              setAttempt(0)
              setStatus('restored')
              if (restoredTimer.current) clearTimeout(restoredTimer.current)
              restoredTimer.current = setTimeout(() => setStatus('connected'), 1500)
            } else {
              setStatus('connected')
            }
            break
          }
          case 'ROOM_STATE':
            setRoom(message.room)
            break
          case 'GAME_STATE':
            if (shouldAcceptGameState(message.state, lastSeqRef.current)) {
              lastSeqRef.current = message.state.seq ?? lastSeqRef.current
              setGameState(message.state)
            }
            break
          case 'ERROR': {
            switch (message.code) {
              case 'INVALID_CODE':
                setError({ kind: 'invalid-room', message: message.message })
                break
              case 'ROOM_FULL':
                setError({ kind: 'room-full', message: message.message })
                break
              case 'SESSION_EXPIRED':
                sessionRef.current = null
                clearSession()
                setError({ kind: 'session-expired', message: message.message })
                break
              case 'INTERNAL':
                setError({ kind: 'server-error', message: message.message })
                break
              default:
                // NOT_HOST / NOT_YOUR_TURN / INVALID_MOVE / RATE_LIMITED:
                // in-game rejections surface in the feed, never full-screen.
                setNotice(message.message)
            }
            break
          }
          case 'RESUME_FAILED': {
            // New worker: resume token rejected — clear and route to lobby
            // with an explicit session-expired state (never silently dump).
            sessionRef.current = null
            clearSession()
            setError({ kind: 'session-expired', message: message.reason || 'Your session has expired.' })
            break
          }
        }
      },
    })

    clientRef.current = client
    return () => {
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
      client.close()
      clientRef.current = null
    }
  }, [roomId, playerName, intent])

  const send = useCallback((message: ClientMsg) => {
    clientRef.current?.send(message)
  }, [])

  /** Badge-as-button retry after the client gave up (§4.6). */
  const retry = useCallback(() => {
    reconnectingRef.current = false
    setAttempt(0)
    setStatus('connecting')
    clientRef.current?.retry()
  }, [])

  /** "TRY AGAIN" on invalid-room: re-send the join intent. */
  const tryAgain = useCallback(() => {
    setError(null)
    if (sessionRef.current) {
      const s = sessionRef.current
      clientRef.current?.send({
        type: 'RESUME_ROOM', playerId: s.playerId, roomCode: s.roomCode, resumeToken: s.resumeToken,
      } as ClientMsg)
    } else if (roomId) {
      send(intent === 'join'
        ? { type: 'JOIN_ROOM', code: roomId, playerName }
        : { type: 'CREATE_ROOM', playerName })
    }
  }, [intent, playerName, roomId, send])

  /** Explicit leave: LEAVE_ROOM + clear stored credentials. */
  const leave = useCallback(() => {
    clientRef.current?.send({ type: 'LEAVE_ROOM' })
    sessionRef.current = null
    clearSession()
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  return {
    status, attempt, maxAttempts: 5,
    room, gameState, playerId,
    error, notice, clearNotice,
    send, retry, tryAgain, leave,
  }
}

export async function createRoom(): Promise<string> {
  const url = `${getDefaultServerURL()}/api/room/new`
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('Room service is unreachable. Please retry.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Failed to create room (${response.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`)
  }

  const body = await response.json() as { roomId?: string }
  if (!body.roomId || !/^[A-Z0-9]{6}$/.test(body.roomId)) {
    throw new Error('Room service returned an invalid room code')
  }

  return body.roomId
}
