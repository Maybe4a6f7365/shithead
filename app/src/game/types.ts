export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'JOKER'

export interface Card {
  id: string         // unique: e.g. "♠-7-3" (suit-rank-idx)
  suit: Suit | null  // null for joker
  rank: Rank
  faceDown?: boolean // for down-cards phase
}

export interface Player {
  id: string
  name: string
  isAI: boolean
  aiDifficulty?: 'easy' | 'medium' | 'hard'
  hand: Card[]      // cards in hand, max 3 always
  faceUp: Card[]    // 3 face-up cards on table
  faceDown: Card[]  // 3 face-down cards on table
  isOut: boolean    // true when no cards left
}

export interface PileEntry {
  cards: Card[]
  cleared: boolean  // pile was cleared by 10 or quartet
}

export type GamePhase =
  | 'lobby'
  | 'deal'
  | 'rearrange'   // players swap hand ↔ face-up
  | 'play'        // normal play loop
  | 'endgame'     // stock empty, playing from face-up/face-down
  | 'roundEnd'

export interface GameState {
  phase: GamePhase
  players: Player[]
  stock: Card[]           // remaining deck
  pile: PileEntry[]
  currentPlayerIdx: number
  playDirection: 1 | -1   // for joker reverse variant
  turnCount: number
  winner: string | null   // player who lost = "Shithead"
  log: GameEvent[]
}

export type GameEvent =
  | { type: 'PLAY_CARDS'; playerId: string; cards: Card[] }
  | { type: 'PICK_UP_PILE'; playerId: string }
  | { type: 'CLEAR_PILE'; reason: 'ten' | 'quartet' }
  | { type: 'PLAYER_OUT'; playerId: string }
  | { type: 'DRAW_TO_HAND'; playerId: string; count: number }
  | { type: 'PHASE_CHANGE'; phase: GamePhase }
  | { type: 'GAME_OVER'; loserId: string }
