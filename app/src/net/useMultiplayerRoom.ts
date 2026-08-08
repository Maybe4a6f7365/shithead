import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMsg, RoomSummary, ServerMsg } from '../engine/protocol'
import type { GameState } from '../engine'
import { RoomClient, buildRoomWSUrl, getDefaultServerURL } from './RoomClient'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export function useMultiplayerRoom(roomId: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [room, setRoom] = useState<RoomSummary | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [chat, setChat] = useState<Array<{ playerId: string; text: string; ts: number }>>([])
  const clientRef = useRef<RoomClient | null>(null)

  useEffect(() => {
    if (!roomId) return

    setStatus('connecting')
    setError(null)
    const client = new RoomClient({
      url: buildRoomWSUrl(getDefaultServerURL(), roomId),
      onOpen: () => {
        setStatus('connected')
        setError(null)
      },
      onClose: event => {
        setStatus('disconnected')
        if (event.reason) setError(event.reason)
      },
      onError: () => {
        setStatus('error')
        setError('WebSocket connection failed')
      },
      onMessage: (message: ServerMsg) => {
        switch (message.type) {
          case 'WELCOME':
            setPlayerId(message.playerId)
            setRoom(message.room)
            sessionStorage.setItem(`shithead:player:${roomId}`, message.playerId)
            break
          case 'ROOM_STATE':
            setRoom(message.room)
            break
          case 'GAME_STATE':
            setGameState(message.state)
            break
          case 'ERROR':
            setError(message.message)
            if (message.code === 'SESSION_EXPIRED') {
              sessionStorage.removeItem(`shithead:player:${roomId}`)
              setPlayerId(null)
            }
            break
          case 'CHAT':
            setChat(previous => [
              ...previous,
              { playerId: message.playerId, text: message.text, ts: message.ts },
            ].slice(-50))
            break
        }
      },
    })

    clientRef.current = client
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [roomId])

  const send = useCallback((message: ClientMsg) => {
    clientRef.current?.send(message)
  }, [])

  return { status, room, gameState, error, chat, playerId, send }
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
