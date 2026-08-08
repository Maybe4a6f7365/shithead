// ============================================================================
// Multiplayer hook — React wrapper around RoomClient
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import type { ClientMsg, ServerMsg, RoomSummary } from '../engine/protocol'
import type { GameState } from '../engine'
import { RoomClient, buildRoomWSUrl, getDefaultServerURL } from './RoomClient'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export function useMultiplayerRoom(roomId: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chat, setChat] = useState<Array<{ playerId: string; text: string; ts: number }>>([])
  const clientRef = useRef<RoomClient | null>(null)

  useEffect(() => {
    if (!roomId) return
    setStatus('connecting')
    const url = buildRoomWSUrl(getDefaultServerURL(), roomId)
    const client = new RoomClient({
      url,
      onOpen: () => setStatus('connected'),
      onClose: () => setStatus('disconnected'),
      onError: () => setStatus('error'),
      onMessage: (msg: ServerMsg) => {
        switch (msg.type) {
          case 'WELCOME': setRoom(msg.room); break
          case 'ROOM_STATE': setRoom(msg.room); break
          case 'GAME_STATE': setGameState(msg.state); break
          case 'ERROR': setError(msg.message); setTimeout(() => setError(null), 5000); break
          case 'CHAT': setChat(prev => [...prev, { playerId: msg.playerId, text: msg.text, ts: msg.ts }].slice(-50)); break
        }
      },
    })
    clientRef.current = client
    return () => { client.close(); clientRef.current = null }
  }, [roomId])

  const send = (msg: ClientMsg) => {
    if (!clientRef.current) return
    clientRef.current.send(msg)
  }

  return { status, room, gameState, error, chat, send }
}

// Helper: fetch a new room ID from the server
export async function createRoom(): Promise<string> {
  const resp = await fetch(`${getDefaultServerURL()}/api/room/new`, { method: 'POST' })
  if (!resp.ok) throw new Error('Failed to create room')
  const body = await resp.json() as { roomId: string }
  return body.roomId
}
