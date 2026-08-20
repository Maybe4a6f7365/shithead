// ============================================================================
// useMultiplayerRoom — room socket lifecycle, session resume, seq guard,
// truthful connection states (§4.6, Appendix A.10).
//
// RESUME CONTRACT (protocol v8):
//  - WELCOME carries `resumeToken` (per-player secret). We persist
//    { roomCode, playerId, resumeToken, playerName } in localStorage.
//  - RESUME_ROOM is sent as { type, roomCode, playerId, resumeToken }.
//  - New server message RESUME_FAILED { reason } clears credentials, closes
//    the invalid transport, and routes to an explicit "session expired" state.
//  - On successful resume the server ROTATES the token; the WELCOME that
//    answers RESUME_ROOM carries the new one and is stored.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BroadcastEvent, BroadcastId, ChatEvent, ClientMsg, EmoteEvent, EmoteId, RoomSummary, ServerMsg, SystemEvent,
  ViewerRole,
} from '../engine/protocol'
import type { GameState } from '../engine'
import { addRecentCustomMessage } from '../customMessageHistory'
import { RoomClient, buildRoomWSUrl, getDefaultServerURL } from './RoomClient'

export type RoomStatus =
  | 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'restored' | 'offline'

export type RoomErrorKind =
  | 'invalid-room' | 'room-full' | 'server-error' | 'session-expired' | 'host-unavailable' | 'game-in-progress'

export interface RoomError { kind: RoomErrorKind; message: string }

// ---------- Session persistence ----------

export interface StoredSession {
  roomCode: string
  playerId: string
  resumeToken?: string
  playerName: string
  /** Optional for backwards compatibility with sessions stored before v8. */
  role?: ViewerRole
}

const SESSION_KEY = 'shithead:session'

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const validToken = parsed?.resumeToken === undefined || (
      typeof parsed.resumeToken === 'string' && parsed.resumeToken.length > 0 && parsed.resumeToken.length <= 256
    )
    const validRole = parsed?.role === undefined || parsed.role === 'player' || parsed.role === 'spectator'
    if (
      typeof parsed?.roomCode === 'string' && /^[A-Z0-9]{6}$/.test(parsed.roomCode) &&
      typeof parsed?.playerId === 'string' && parsed.playerId.length > 0 && parsed.playerId.length <= 128 &&
      typeof parsed?.playerName === 'string' && parsed.playerName.trim().length > 0 && parsed.playerName.length <= 32 &&
      validToken && validRole
    ) {
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

/**
 * Convert a resumable credential into the initial App route after a hard
 * refresh. `intent` is deliberately `join`: the hook will authenticate with
 * RESUME_ROOM first, while the fallback can never accidentally re-create an
 * already allocated room code.
 */
export function loadRestoredRoomIntent(): UseMultiplayerRoomArgs | null {
  const session = loadSession()
  if (!session?.resumeToken) return null
  return {
    roomId: session.roomCode,
    playerName: session.playerName,
    intent: 'join',
  }
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
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null)
  const [error, setError] = useState<RoomError | null>(null)
  const [notice, setNotice] = useState<string | null>(null) // in-game rejections → feed
  const [latestEmote, setLatestEmote] = useState<EmoteEvent | null>(null)
  const [latestBroadcast, setLatestBroadcast] = useState<BroadcastEvent | null>(null)
  const [latestChat, setLatestChat] = useState<ChatEvent | null>(null)
  const [recentCustomMessages, setRecentCustomMessages] = useState<string[]>([])
  const [latestSystemEvent, setLatestSystemEvent] = useState<SystemEvent | null>(null)
  const clientRef = useRef<RoomClient | null>(null)
  const lastSeqRef = useRef<number | null>(null)
  const sessionRef = useRef<StoredSession | null>(null)
  const authoritativeStateRef = useRef<GameState | null>(null)
  const reconnectingRef = useRef(false)
  const restoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const broadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const systemEventTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!roomId) return

    setStatus('connecting')
    setError(null)
    setNotice(null)
    setRecentCustomMessages([])
    if (emoteTimer.current) clearTimeout(emoteTimer.current)
    emoteTimer.current = null
    setLatestEmote(null)
    if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
    broadcastTimer.current = null
    setLatestBroadcast(null)
    if (chatTimer.current) clearTimeout(chatTimer.current)
    chatTimer.current = null
    setLatestChat(null)
    if (systemEventTimer.current) clearTimeout(systemEventTimer.current)
    systemEventTimer.current = null
    setLatestSystemEvent(null)
    setRoom(null)
    setGameState(null)
    setPlayerId(null)
    setViewerRole(null)
    authoritativeStateRef.current = null
    lastSeqRef.current = null
    reconnectingRef.current = false

    // Prefer stored credentials for this room (refresh / auto-reconnect).
    const stored = loadSession()
    sessionRef.current = stored && stored.roomCode === roomId && stored.resumeToken ? stored : null
    if (stored && stored.roomCode === roomId && !stored.resumeToken) clearSession()

    const clearAuthoritativeNotice = () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      noticeTimer.current = null
      setNotice(null)
    }

    const showNotice = (message: string) => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      setNotice(message)
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null
        setNotice(null)
      }, 3000)
    }

    const clearRestoredTimer = () => {
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
      restoredTimer.current = null
    }

    const sendJoinIntent = () => {
      if (sessionRef.current) {
        const s = sessionRef.current
        clientRef.current?.send({
          type: 'RESUME_ROOM',
          playerId: s.playerId,
          roomCode: s.roomCode,
          resumeToken: s.resumeToken!,
        })
      } else if (intent === 'join') {
        clientRef.current?.send({ type: 'JOIN_ROOM', code: roomId, playerName })
      } else {
        clientRef.current?.send({ type: 'CREATE_ROOM', playerName })
      }
    }

    const client = new RoomClient({
      url: buildRoomWSUrl(getDefaultServerURL(), roomId),
      onOpen: () => {
        clearRestoredTimer()
        setError(null)
        sendJoinIntent()
      },
      onClose: () => {
        clearRestoredTimer()
        reconnectingRef.current = true
        setStatus(prev => (prev === 'offline' ? prev : 'reconnecting'))
      },
      onError: () => {
        setStatus(prev => (prev === 'connected' || prev === 'restored' || prev === 'reconnecting') ? prev : 'connecting')
      },
      onReconnecting: (n) => {
        clearRestoredTimer()
        reconnectingRef.current = true
        setAttempt(n)
        setStatus('reconnecting')
      },
      onGiveUp: () => {
        clearRestoredTimer()
        setStatus('offline')
      },
      onMessage: (message: ServerMsg) => {
        switch (message.type) {
          case 'WELCOME': {
            clientRef.current?.markAuthenticated()
            clearAuthoritativeNotice()
            if (sessionRef.current?.playerId && sessionRef.current.playerId !== message.playerId) {
              setRecentCustomMessages([])
            }
            setPlayerId(message.playerId)
            setViewerRole(message.role)
            setRoom(message.room)
            setError(null)
            // Persist (and rotate) credentials.
            const session: StoredSession = {
              roomCode: message.room.code,
              playerId: message.playerId,
              resumeToken: message.resumeToken,
              playerName: playerName || sessionRef.current?.playerName || 'Player',
              role: message.role,
            }
            sessionRef.current = session
            saveSession(session)
            if (reconnectingRef.current) {
              reconnectingRef.current = false
              setAttempt(0)
              setStatus('restored')
              clearRestoredTimer()
              restoredTimer.current = setTimeout(() => setStatus('connected'), 1500)
            } else {
              setStatus('connected')
            }
            break
          }
          case 'ROOM_STATE': {
            clearAuthoritativeNotice()
            const state = authoritativeStateRef.current
            setRoom(state ? { ...message.room, phase: state.phase } : message.room)
            const currentSession = sessionRef.current
            if (currentSession && message.room.players.some(player => player.id === currentSession.playerId)) {
              // Promotion is authoritative in ROOM_STATE. Preserve the same
              // identity/token and simply move the local viewer into a seat.
              setViewerRole('player')
              if (currentSession.role !== 'player') {
                const promoted = { ...currentSession, role: 'player' as const }
                sessionRef.current = promoted
                saveSession(promoted)
              }
            }
            break
          }
          case 'GAME_STATE':
            if (shouldAcceptGameState(message.state, lastSeqRef.current)) {
              lastSeqRef.current = message.state.seq ?? lastSeqRef.current
              authoritativeStateRef.current = message.state
              setGameState(message.state)
              setRoom(previous => previous ? { ...previous, phase: message.state.phase, rules: message.state.rules } : previous)
              clearAuthoritativeNotice()
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
                setRecentCustomMessages([])
                setViewerRole(null)
                setError({ kind: 'session-expired', message: message.message })
                // This is a terminal server decision (including a rematch seat
                // release), not a transient disconnect. Stop the transport so
                // it cannot reconnect with an invalidated token or retain an
                // idle socket against the room cap.
                clientRef.current?.close()
                break
              case 'GAME_IN_PROGRESS':
                if (authoritativeStateRef.current) showNotice(message.message)
                else setError({ kind: 'game-in-progress', message: message.message })
                break
              case 'INTERNAL':
                setError({ kind: 'server-error', message: message.message })
                break
              default:
                // NOT_HOST / NOT_YOUR_TURN / INVALID_MOVE / RATE_LIMITED:
                // in-game rejections surface in the feed, never full-screen.
                showNotice(message.message)
            }
            break
          }
          case 'RESUME_FAILED': {
            // New worker: resume token rejected — clear and route to lobby
            // with an explicit session-expired state (never silently dump).
            // This is terminal: do not retain or reconnect an invalid socket.
            sessionRef.current = null
            clearSession()
            setViewerRole(null)
            setError({ kind: 'session-expired', message: message.reason || 'Your session has expired.' })
            clientRef.current?.close()
            break
          }
          case 'EMOTE': {
            const received = { playerId: message.playerId, emote: message.emote, ts: message.ts }
            if (emoteTimer.current) clearTimeout(emoteTimer.current)
            setLatestEmote(received)
            emoteTimer.current = setTimeout(() => {
              emoteTimer.current = null
              setLatestEmote(current => (
                current?.playerId === received.playerId &&
                current.emote === received.emote &&
                current.ts === received.ts
                  ? null
                  : current
              ))
            }, 2500)
            break
          }
          case 'BROADCAST': {
            const received: BroadcastEvent = {
              playerId: message.playerId,
              broadcast: message.broadcast,
              ts: message.ts,
            }
            if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
            setLatestBroadcast(received)
            broadcastTimer.current = setTimeout(() => {
              broadcastTimer.current = null
              setLatestBroadcast(current => (
                current?.playerId === received.playerId &&
                current.broadcast === received.broadcast &&
                current.ts === received.ts
                  ? null
                  : current
              ))
            }, 3500)
            break
          }
          case 'CHAT': {
            const received: ChatEvent = {
              playerId: message.playerId,
              text: message.text,
              ts: message.ts,
            }
            // History is private to this client and contains only messages the
            // server authoritatively accepted for this player. Peer messages,
            // failed sends, and rate-limited attempts are never retained.
            if (message.playerId === sessionRef.current?.playerId) {
              setRecentCustomMessages(current => addRecentCustomMessage(current, message.text))
            }
            if (chatTimer.current) clearTimeout(chatTimer.current)
            setLatestChat(received)
            chatTimer.current = setTimeout(() => {
              chatTimer.current = null
              setLatestChat(current => (
                current?.playerId === received.playerId &&
                current.text === received.text &&
                current.ts === received.ts
                  ? null
                  : current
              ))
            }, 3500)
            break
          }
          case 'SYSTEM_EVENT': {
            const received = message.event
            if (systemEventTimer.current) clearTimeout(systemEventTimer.current)
            setLatestSystemEvent(received)
            systemEventTimer.current = setTimeout(() => {
              systemEventTimer.current = null
              setLatestSystemEvent(current => (
                current?.kind === received.kind &&
                current.playerId === received.playerId &&
                current.message === received.message &&
                current.ts === received.ts
                  ? null
                  : current
              ))
            }, 4500)
            break
          }
        }
      },
    })

    clientRef.current = client
    return () => {
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      if (emoteTimer.current) clearTimeout(emoteTimer.current)
      if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
      if (chatTimer.current) clearTimeout(chatTimer.current)
      if (systemEventTimer.current) clearTimeout(systemEventTimer.current)
      client.close()
      clientRef.current = null
    }
  }, [roomId, playerName, intent])

  const send = useCallback((message: ClientMsg) => {
    return clientRef.current?.send(message) ?? false
  }, [])

  const sendEmote = useCallback((emote: EmoteId) => {
    return send({ type: 'EMOTE', emote })
  }, [send])

  const sendBroadcast = useCallback((broadcast: BroadcastId) => {
    return send({ type: 'BROADCAST', broadcast })
  }, [send])

  const sendChat = useCallback((text: string) => {
    return send({ type: 'CHAT', text })
  }, [send])

  /**
   * Play one replacement card that the engine marked as an immediate
   * same-rank follow-up. The client binds the intent to the latest accepted
   * authoritative sequence; the worker rejects it if another action won the
   * race. RoomClient deliberately never queues this time-sensitive action.
   */
  const quickFollowUp = useCallback((cardId: string) => {
    const expectedSeq = authoritativeStateRef.current?.seq
    if (!cardId || !Number.isSafeInteger(expectedSeq) || Number(expectedSeq) < 0) return false
    return send({ type: 'QUICK_FOLLOW_UP', cardId, expectedSeq: Number(expectedSeq) })
  }, [send])

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
        type: 'RESUME_ROOM', playerId: s.playerId, roomCode: s.roomCode, resumeToken: s.resumeToken!,
      })
    } else if (roomId) {
      send(intent === 'join'
        ? { type: 'JOIN_ROOM', code: roomId, playerName }
        : { type: 'CREATE_ROOM', playerName })
    }
  }, [intent, playerName, roomId, send])

  /**
   * Explicit leave is only committed locally when it can be sent. While
   * offline the server still owns the seat, so preserving the credential is
   * the truthful/recoverable outcome instead of pretending the leave won.
   */
  const leave = useCallback(() => {
    const client = clientRef.current
    if (!client?.isConnected()) return false
    client.send({ type: 'LEAVE_ROOM' })
    sessionRef.current = null
    clearSession()
    setRecentCustomMessages([])
    setViewerRole(null)
    return true
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  return {
    status, attempt, maxAttempts: 5,
    room, gameState, playerId, viewerRole,
    error, notice, clearNotice, latestEmote, latestBroadcast, latestChat, recentCustomMessages, latestSystemEvent,
    send, sendEmote, sendBroadcast, sendChat, quickFollowUp, retry, tryAgain, leave,
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
