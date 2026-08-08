// ============================================================================
// Multiplayer protocol — wire format between client and Durable Object
// Both client and worker import from this file (zero runtime deps).
// ============================================================================

import type { Card, GameState, Phase } from './index'

// ---------- Client → Server ----------

export type ClientMsg =
  | { type: 'CREATE_ROOM'; playerName: string; maxPlayers?: number }
  | { type: 'JOIN_ROOM'; code: string; playerName: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'START_GAME' }
  | { type: 'READY' }                       // confirm rearrange done
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
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'INVALID_MOVE'
  | 'RATE_LIMITED'
  | 'INTERNAL'

// ---------- Protocol validation ----------

export function isClientMsg(data: unknown): data is ClientMsg {
  if (typeof data !== 'object' || data === null) return false
  const m = data as { type?: unknown }
  if (typeof m.type !== 'string') return false
  return [
    'CREATE_ROOM', 'JOIN_ROOM', 'LEAVE_ROOM', 'START_GAME', 'READY',
    'REARRANGE', 'PLAY', 'PICK_UP', 'CHAT', 'PING'
  ].includes(m.type)
}

// ---------- Encoding helpers ----------

/**
 * Serialize a GameState for transmission.
 * Hides face-down cards from other players (security).
 */
export function serializeGameState(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p,
      // Hide other players' face-down cards (only ID + count, not actual cards)
      faceDown: p.id === viewerId || p.isOut
        ? p.faceDown
        : p.faceDown.map(c => ({ id: c.id, suit: null, rank: '3' as const })),  // mask with dummy
    })),
  }
}

/**
 * Build a player summary from a Player (for room lobby before game starts).
 */
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
