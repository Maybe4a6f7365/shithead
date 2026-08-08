// ============================================================================
// Multiplayer protocol — wire format between client and Durable Object
// Both client and worker import from this file (zero runtime deps).
// ============================================================================

import type { Card, GameState, Phase } from './index'

// ---------- Client → Server ----------

export type ClientMsg =
  | { type: 'CREATE_ROOM'; playerName: string; maxPlayers?: number }
  | { type: 'JOIN_ROOM'; code: string; playerName: string }
  | { type: 'RESUME_ROOM'; playerId: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'START_GAME' }
  | { type: 'READY' }
  | { type: 'REARRANGE'; handIdx: number; upIdx: number }
  | { type: 'PLAY'; cards: Card[] }
  | { type: 'PICK_UP' }
  | { type: 'CHAT'; text: string }
  | { type: 'PING' }

// ---------- Server → Client ----------

export type ServerMsg =
  | { type: 'WELCOME'; playerId: string; room: RoomSummary }
  | { type: 'ROOM_STATE'; room: RoomSummary }
  | { type: 'GAME_STATE'; state: GameState }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PLAYER_JOINED'; player: PlayerSummary }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'CHAT'; playerId: string; text: string; ts: number }
  | { type: 'PONG'; ts: number }

// ---------- Types ----------

export interface PlayerSummary {
  id: string
  name: string
  isAI: boolean
  connected: boolean
  isOut: boolean
  cardCount: { hand: number; faceUp: number; faceDown: number }
}

export interface RoomSummary {
  code: string
  phase: Phase | 'waiting'
  hostId: string
  maxPlayers: number
  players: PlayerSummary[]
  createdAt: number
}

export type ErrorCode =
  | 'INVALID_CODE'
  | 'ROOM_FULL'
  | 'SESSION_EXPIRED'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'INVALID_MOVE'
  | 'RATE_LIMITED'
  | 'INTERNAL'

// ---------- Protocol validation ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isShortString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max

export function isClientMsg(data: unknown): data is ClientMsg {
  if (!isRecord(data) || typeof data.type !== 'string') return false

  switch (data.type) {
    case 'CREATE_ROOM':
      return isShortString(data.playerName, 32) &&
        (data.maxPlayers === undefined ||
          (Number.isInteger(data.maxPlayers) && Number(data.maxPlayers) >= 2 && Number(data.maxPlayers) <= 5))
    case 'JOIN_ROOM':
      return typeof data.code === 'string' && /^[A-Z0-9]{6}$/.test(data.code) && isShortString(data.playerName, 32)
    case 'RESUME_ROOM':
      return isShortString(data.playerId, 128)
    case 'REARRANGE':
      return Number.isInteger(data.handIdx) && Number.isInteger(data.upIdx)
    case 'PLAY':
      return Array.isArray(data.cards) && data.cards.length > 0 && data.cards.length <= 4 &&
        data.cards.every(card => isRecord(card) && isShortString(card.id, 128))
    case 'CHAT':
      return typeof data.text === 'string' && data.text.length > 0 && data.text.length <= 200
    case 'LEAVE_ROOM':
    case 'START_GAME':
    case 'READY':
    case 'PICK_UP':
    case 'PING':
      return true
    default:
      return false
  }
}

// ---------- Encoding helpers ----------

const hiddenCard = (card: Card): Card => ({ id: card.id, suit: null, rank: '3' })

/**
 * Serialize a GameState for one viewer.
 * Opponent hands and every face-down card retain only their stable IDs/counts.
 */
export function serializeGameState(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    players: state.players.map(player => ({
      ...player,
      hand: player.id === viewerId || player.isOut
        ? player.hand
        : player.hand.map(hiddenCard),
      faceDown: player.isOut
        ? player.faceDown
        : player.faceDown.map(hiddenCard),
    })),
  }
}

/** Build a lobby-safe player summary with no card details. */
export function toPlayerSummary(p: import('./index').Player, connected = true): PlayerSummary {
  return {
    id: p.id,
    name: p.name,
    isAI: !!p.isAI,
    connected,
    isOut: p.isOut,
    cardCount: { hand: p.hand.length, faceUp: p.faceUp.length, faceDown: p.faceDown.length },
  }
}
