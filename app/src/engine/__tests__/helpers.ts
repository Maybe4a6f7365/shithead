// ============================================================================
// Shared test helpers for engine tests
// ============================================================================
import { DEFAULT_GAME_RULES } from '../index'
import type {
  Card,
  GameRules,
  GameState,
  PendingQuickFollowUp,
  PendingTribute,
  Phase,
  Player,
  Rank,
  Suit,
} from '../index'

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
  rules?: Partial<GameRules>
  winnerId?: string | null
  loserId?: string | null
  pendingTribute?: PendingTribute | null
  pendingQuickFollowUp?: PendingQuickFollowUp | null
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
    rules: { ...DEFAULT_GAME_RULES, ...(over.rules ?? {}) },
    players,
    stock: over.stock ?? [],
    pile: (over.pile ?? []).map(cards => ({ cards, cleared: false })),
    currentPlayerIdx: over.currentPlayerIdx ?? 0,
    playDirection: 1,
    turnCount: 0,
    winnerId: over.winnerId ?? null,
    loserId: over.loserId ?? null,
    pendingTribute: over.pendingTribute ?? null,
    pendingQuickFollowUp: over.pendingQuickFollowUp ?? null,
    log: over.log ?? [],
    seq: 0,
  }
}
