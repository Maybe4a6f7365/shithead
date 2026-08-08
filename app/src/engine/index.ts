// ============================================================================
// Shared Shithead game engine — pure functions, zero dependencies
// Used by both client (PWA) and worker (Durable Object) for multiplayer.
// 100% unit-tested. Source of truth for all game rules.
// ============================================================================

// ---------- Types ----------

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'JOKER'

export interface Card {
  id: string
  suit: Suit | null
  rank: Rank
}

export interface Player {
  id: string
  name: string
  isAI?: boolean
  aiDifficulty?: 'easy' | 'medium' | 'hard'
  hand: Card[]
  faceUp: Card[]
  faceDown: Card[]
  isOut: boolean
}

export interface PileEntry {
  cards: Card[]
  cleared: boolean
}

export type Phase = 'lobby' | 'rearrange' | 'play' | 'endgame' | 'roundEnd' | 'gameOver'

export interface GameState {
  phase: Phase
  players: Player[]
  stock: Card[]
  pile: PileEntry[]
  currentPlayerIdx: number
  playDirection: 1 | -1
  turnCount: number
  loserId: string | null  // player who is "shithead" (last with cards)
  log: GameEvent[]
}

export type GameEvent =
  | { type: 'PLAY_CARDS'; playerId: string; cards: Card[] }
  | { type: 'PICK_UP_PILE'; playerId: string }
  | { type: 'CLEAR_PILE'; reason: 'ten' | 'quartet' | 'joker' }
  | { type: 'PLAYER_OUT'; playerId: string }
  | { type: 'DRAW'; playerId: string; count: number }
  | { type: 'PHASE_CHANGE'; phase: Phase }
  | { type: 'REARRANGE'; playerId: string; fromIdx: number; toIdx: number }
  | { type: 'GAME_OVER'; loserId: string }

// ---------- Constants ----------

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// 2 is wild (-1), 3 is the lowest legal play, A is highest.
export const RANK_ORDER: Record<Rank, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6,
  '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11,
  '2': -1, 'JOKER': -2,
}

// ---------- Deck ----------

export function makeDeck(includeJokers = true): Card[] {
  const cards: Card[] = []
  let idx = 0
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${suit}-${rank}-${idx++}`, suit, rank })
    }
  }
  if (includeJokers) {
    cards.push({ id: `JOKER-A-${idx++}`, suit: null, rank: 'JOKER' })
    cards.push({ id: `JOKER-B-${idx++}`, suit: null, rank: 'JOKER' })
  }
  return cards
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- Rules (pure) ----------

export function canPlay(card: Card, topRank: Rank | null): boolean {
  if (card.rank === 'JOKER' || card.rank === '2') return true
  if (topRank === null) {
    // Start of pile: must be 3, 10, or joker
    const r = card.rank as string
    return r === '3' || r === '10' || r === 'JOKER'
  }
  return RANK_ORDER[card.rank as Rank] >= RANK_ORDER[topRank]
}

export function isClearCard(card: Card): boolean {
  return card.rank === '10' || card.rank === 'JOKER'
}

export function isQuartet(cards: Card[]): boolean {
  if (cards.length !== 4) return false
  if (cards.some(c => c.rank === 'JOKER' || c.rank === '2')) return false
  const first = cards[0].rank
  return cards.every(c => c.rank === first)
}

export function playClearsPile(cards: Card[]): boolean {
  if (cards.length === 0) return false
  if (cards.some(isClearCard)) return true
  if (isQuartet(cards)) return true
  return false
}

// ---------- Reducers ----------

export interface InitConfig {
  players: Array<{ id: string; name: string; isAI?: boolean; aiDifficulty?: 'easy'|'medium'|'hard' }>
  includeJokers?: boolean
  rng?: () => number
}

export function initGame(cfg: InitConfig): GameState {
  const deck = shuffle(makeDeck(cfg.includeJokers ?? true), cfg.rng)
  const players: Player[] = cfg.players.map(p => ({
    id: p.id,
    name: p.name,
    isAI: p.isAI,
    aiDifficulty: p.aiDifficulty,
    hand: [],
    faceUp: [],
    faceDown: [],
    isOut: false,
  }))

  let idx = 0
  for (let p = 0; p < players.length; p++) {
    const down: Card[] = []
    const up: Card[] = []
    const hand: Card[] = []
    for (let i = 0; i < 3; i++) down.push(deck[idx++])
    for (let i = 0; i < 3; i++) up.push(deck[idx++])
    for (let i = 0; i < 3; i++) hand.push(deck[idx++])
    players[p] = { ...players[p], faceDown: down, faceUp: up, hand }
  }
  const stock = deck.slice(idx)

  // Eldest hand = first player with a 3 face-up; else 3 in hand; else 4, 5...
  let startIdx = players.findIndex(p => p.faceUp.some(c => c.rank === '3'))
  if (startIdx === -1) {
    for (const rank of ['3','4','5','6','7','8','9','10','J','Q','K','A','2'] as Rank[]) {
      startIdx = players.findIndex(p =>
        p.hand.some(c => c.rank === rank) || p.faceUp.some(c => c.rank === rank)
      )
      if (startIdx !== -1) break
    }
  }
  if (startIdx === -1) startIdx = 0

  return {
    phase: 'rearrange',
    players,
    stock,
    pile: [],
    currentPlayerIdx: startIdx,
    playDirection: 1,
    turnCount: 0,
    loserId: null,
    log: [{ type: 'PHASE_CHANGE', phase: 'rearrange' }],
  }
}

export function rearrange(state: GameState, playerId: string, handIdx: number, upIdx: number): GameState {
  if (state.phase !== 'rearrange') return state
  const players = state.players.map(p => {
    if (p.id !== playerId) return p
    const hand = [...p.hand]
    const up = [...p.faceUp]
    if (handIdx < 0 || handIdx >= hand.length) return p
    if (upIdx < 0 || upIdx >= up.length) return p
    ;[hand[handIdx], up[upIdx]] = [up[upIdx], hand[handIdx]]
    return { ...p, hand, faceUp: up }
  })
  return {
    ...state,
    players,
    log: [...state.log, { type: 'REARRANGE', playerId, fromIdx: handIdx, toIdx: upIdx }],
  }
}

export function startPlay(state: GameState): GameState {
  if (state.phase !== 'rearrange') return state
  return {
    ...state,
    phase: 'play',
    log: [...state.log, { type: 'PHASE_CHANGE', phase: 'play' }],
  }
}

export interface PlayResult {
  state: GameState
  error?: string
}

export function playCards(state: GameState, playerId: string, cards: Card[]): PlayResult {
  if (state.phase !== 'play' && state.phase !== 'endgame') {
    return { state, error: 'Cannot play in current phase' }
  }
  const player = state.players[state.currentPlayerIdx]
  if (!player || player.id !== playerId) {
    return { state, error: 'Not your turn' }
  }
  if (player.isOut) {
    return { state, error: 'Player already out' }
  }

  // Validate all cards are in player's hand + face-up + face-down
  const playerCards = [...player.hand, ...player.faceUp, ...player.faceDown]
  for (const c of cards) {
    if (!playerCards.some(pc => pc.id === c.id)) {
      return { state, error: `Card ${c.id} not in player's possession` }
    }
  }

  // In normal play phase, only hand + face-up are allowed (face-down only in endgame)
  const allowedCards = state.phase === 'endgame' && player.hand.length === 0 && player.faceUp.length === 0
    ? player.faceDown
    : state.phase === 'endgame' && player.hand.length === 0
      ? player.faceUp
      : [...player.hand, ...player.faceUp]

  for (const c of cards) {
    if (!allowedCards.some(ac => ac.id === c.id)) {
      return { state, error: `Card ${c.id} cannot be played in current phase` }
    }
  }

  // Validate legal play
  const topEntry = state.pile[state.pile.length - 1]
  const topRank = topEntry?.cards[0].rank ?? null

  // Empty pile: must have at least one 3, 10, or joker (we don't enforce order for sets)
  if (topRank === null) {
    if (!cards.some(c => c.rank === '3' || c.rank === '10' || c.rank === 'JOKER')) {
      return { state, error: 'Empty pile: first card must be 3, 10, or Joker' }
    }
  } else {
    // Non-empty: each card must be ≥ top rank (wilds always ok)
    for (const c of cards) {
      if (!canPlay(c, topRank)) {
        return { state, error: `Card ${c.rank} cannot be played on ${topRank}` }
      }
    }
  }

  // Apply
  const playedIds = new Set(cards.map(c => c.id))
  let nextPlayers = state.players.map(p => {
    if (p.id !== playerId) return p
    return {
      ...p,
      hand: p.hand.filter(c => !playedIds.has(c.id)),
      faceUp: p.faceUp.filter(c => !playedIds.has(c.id)),
      faceDown: p.faceDown.filter(c => !playedIds.has(c.id)),
    }
  })

  let pile = [...state.pile]
  const cleared = playClearsPile(cards)
  const reason: 'ten' | 'quartet' | 'joker' = cards.some(c => c.rank === 'JOKER') ? 'joker' : cards.some(c => c.rank === '10') ? 'ten' : 'quartet'
  pile.push({ cards, cleared })

  // Draw from stock to refill hand to 3
  let stock = [...state.stock]
  const drawn: Card[] = []
  nextPlayers = nextPlayers.map(p => {
    if (p.id !== playerId) return p
    const hand = [...p.hand]
    while (hand.length < 3 && stock.length > 0) {
      const card = stock.shift()!
      hand.push(card)
      drawn.push(card)
    }
    return { ...p, hand }
  })

  // Check player out
  nextPlayers = nextPlayers.map(p => {
    if (p.id !== playerId) return p
    if (p.hand.length + p.faceUp.length + p.faceDown.length === 0) {
      return { ...p, isOut: true }
    }
    return p
  })

  // Determine phase transition
  let phase: Phase = state.phase
  if (stock.length === 0) {
    const someoneNeedsToPlayFromTable = nextPlayers.some(p =>
      !p.isOut && p.hand.length === 0 && (p.faceUp.length > 0 || p.faceDown.length > 0)
    )
    if (someoneNeedsToPlayFromTable) phase = 'endgame'
  }

  // Advance turn — same player goes again if pile cleared
  let nextIdx = state.currentPlayerIdx
  if (!cleared) {
    const activePlayers = nextPlayers.filter(p => !p.isOut)
    if (activePlayers.length > 0) {
      do {
        nextIdx = (nextIdx + state.playDirection + nextPlayers.length) % nextPlayers.length
      } while (nextPlayers[nextIdx].isOut)
    }
  }

  // Game over — only one player left = loser
  let loserId = state.loserId
  const activePlayers = nextPlayers.filter(p => !p.isOut)
  if (activePlayers.length === 1) {
    loserId = activePlayers[0].id
    phase = 'gameOver'
  }

  const log: GameEvent[] = [
    ...state.log,
    { type: 'PLAY_CARDS', playerId, cards },
    ...(cleared ? [{ type: 'CLEAR_PILE' as const, reason }] : []),
    ...(drawn.length > 0 ? [{ type: 'DRAW' as const, playerId, count: drawn.length }] : []),
    ...(nextPlayers.find(p => p.id === playerId)?.isOut ? [{ type: 'PLAYER_OUT' as const, playerId }] : []),
    ...(loserId && loserId !== state.loserId ? [{ type: 'GAME_OVER' as const, loserId }] : []),
  ]

  return {
    state: {
      ...state,
      players: nextPlayers,
      stock,
      pile,
      currentPlayerIdx: nextIdx,
      phase,
      turnCount: state.turnCount + 1,
      loserId,
      log,
    },
  }
}

export function pickUpPile(state: GameState, playerId: string): PlayResult {
  const player = state.players[state.currentPlayerIdx]
  if (!player || player.id !== playerId) {
    return { state, error: 'Not your turn' }
  }
  if (player.isOut) return { state, error: 'Player already out' }

  // Collect all non-cleared pile cards
  const collected: Card[] = []
  const newPile: PileEntry[] = []
  for (const entry of state.pile) {
    if (entry.cleared) newPile.push(entry)
    else collected.push(...entry.cards)
  }

  // Draw from stock to reach 3 (minimum hand size)
  let stock = [...state.stock]
  while (collected.length < 3 && stock.length > 0) {
    collected.push(stock.shift()!)
  }

  const players = state.players.map(p => p.id === playerId ? { ...p, hand: [...p.hand, ...collected] } : p)

  // Advance turn
  let nextIdx = state.currentPlayerIdx
  const activePlayers = players.filter(p => !p.isOut)
  if (activePlayers.length > 0) {
    do {
      nextIdx = (nextIdx + state.playDirection + players.length) % players.length
    } while (players[nextIdx].id === playerId || players[nextIdx].isOut)
  }

  // Phase transition
  let phase: Phase = state.phase
  if (stock.length === 0) {
    const someoneNeedsToPlayFromTable = players.some(p =>
      !p.isOut && p.hand.length === 0 && (p.faceUp.length > 0 || p.faceDown.length > 0)
    )
    if (someoneNeedsToPlayFromTable) phase = 'endgame'
  }

  return {
    state: {
      ...state,
      players,
      stock,
      pile: newPile,
      currentPlayerIdx: nextIdx,
      phase,
      turnCount: state.turnCount + 1,
      log: [...state.log, { type: 'PICK_UP_PILE', playerId }],
    },
  }
}

// ---------- AI (pure) ----------

export interface AIMove {
  type: 'play' | 'pickUp'
  cards?: Card[]
}

export function pickAIMove(state: GameState, player: Player, difficulty: 'easy'|'medium'|'hard' = 'medium'): AIMove {
  const topEntry = state.pile[state.pile.length - 1]
  const topRank = topEntry?.cards[0].rank ?? null

  const playable = player.hand.filter(c => canPlay(c, topRank))
  if (playable.length === 0) return { type: 'pickUp' }

  if (difficulty === 'easy') {
    const card = playable[Math.floor(Math.random() * playable.length)]
    return { type: 'play', cards: [card] }
  }

  if (difficulty === 'medium') {
    const sorted = [...playable].sort((a, b) => RANK_ORDER[a.rank as Rank] - RANK_ORDER[b.rank as Rank])
    const nonSpecial = sorted.filter(c => c.rank !== '2' && c.rank !== '10' && c.rank !== 'JOKER')
    if (nonSpecial.length > 0) return { type: 'play', cards: [nonSpecial[0]] }
    return { type: 'play', cards: [sorted[0]] }
  }

  // Hard: strategic
  const pileSize = state.pile.reduce((sum, e) => sum + (e.cleared ? 0 : e.cards.length), 0)
  // Try quartet
  const quartet = findQuartet(player.hand)
  if (quartet && pileSize >= 3) return { type: 'play', cards: quartet }
  // 10 on big pile
  const ten = playable.find(c => c.rank === '10')
  if (ten && pileSize >= 5) return { type: 'play', cards: [ten] }
  // 2 if desperate
  const two = playable.find(c => c.rank === '2')
  if (two && pileSize >= 4 && !playable.some(c => c.rank !== '2')) {
    return { type: 'play', cards: [two] }
  }
  // Default: lowest non-special
  const sorted = [...playable].sort((a, b) => RANK_ORDER[a.rank as Rank] - RANK_ORDER[b.rank as Rank])
  const nonSpecial = sorted.filter(c => c.rank !== '2' && c.rank !== '10' && c.rank !== 'JOKER')
  return { type: 'play', cards: [nonSpecial[0] ?? sorted[0]] }
}

function findQuartet(cards: Card[]): Card[] | null {
  const byRank = new Map<string, Card[]>()
  for (const c of cards) {
    if (c.rank === 'JOKER' || c.rank === '2') continue
    const arr = byRank.get(c.rank) ?? []
    arr.push(c)
    byRank.set(c.rank, arr)
    if (arr.length === 4) return arr
  }
  return null
}

// ---------- Helpers ----------

export function getCurrentPlayer(state: GameState): Player | null {
  return state.players[state.currentPlayerIdx] ?? null
}

export function getTopCard(state: GameState): Card | null {
  return state.pile[state.pile.length - 1]?.cards[0] ?? null
}

export function pileSize(state: GameState): number {
  return state.pile.reduce((sum, e) => sum + (e.cleared ? 0 : e.cards.length), 0)
}
