// ============================================================================
// Shared test helpers for engine tests
// ============================================================================
import type { Card, GameState, Phase, Player, Rank, Suit } from '../index'

let n = 0
/** Readable, unique test card. Ids are opaque to the engine. */
export function c(rank: Rank, suit: Suit | null = '♠', id?: string): Card {
  return { id: id ?? `t-${rank}-${suit ?? 'X'}-${n++}`, suit, rank }
}

export interface MkPlayer {
  id: string
  name?: string
  isAI?: boolean
  aiDifficulty?: 'easy' | 'medium' | 'hard'
  hand?: Card[]
  faceUp?: Card[]
  faceDown?: Card[]
  isOut?: boolean
}

export interface MkState {
  players: MkPlayer[]
  pile?: Card[][]
  stock?: Card[]
  currentPlayerIdx?: number
  phase?: Phase
  loserId?: string | null
  log?: GameState['log']
}

/** Build a GameState directly (crafted scenarios, no dealing). */
export function mkState(over: MkState): GameState {
  const players: Player[] = over.players.map(p => ({
    id: p.id,
    name: p.name ?? p.id,
    isAI: p.isAI,
    aiDifficulty: p.aiDifficulty,
    hand: p.hand ?? [],
    faceUp: p.faceUp ?? [],
    faceDown: p.faceDown ?? [],
    isOut: p.isOut ?? false,
  }))
  return {
    phase: over.phase ?? 'play',
    players,
    stock: over.stock ?? [],
    pile: (over.pile ?? []).map(cards => ({ cards, cleared: false })),
    currentPlayerIdx: over.currentPlayerIdx ?? 0,
    playDirection: 1,
    turnCount: 0,
    loserId: over.loserId ?? null,
    log: over.log ?? [],
    seq: 0,
  }
}
