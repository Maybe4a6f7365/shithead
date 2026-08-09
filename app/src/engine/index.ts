// ============================================================================
// Shared Shithead game engine — pure functions, zero dependencies
// Used by both client (PWA) and worker (Durable Object) for multiplayer.
// 100% unit-tested. Source of truth for all game rules.
//
// RULE DECISIONS (German variant per README; ambiguities resolved explicitly):
//  D1. Empty pile: ANY card may lead. README only requires ">= top of pile"
//      and defines the face-up-3 rule for choosing the *starting player*.
//      The old "empty pile must be opened with 3/10/Joker" restriction was an
//      invention and disagreed with itself (canPlay vs playCards). Removed.
//  D2. 2, 3, 10 and Joker are playable anytime. A 2 resets the active rank
//      constraint: the next player may play any card. A 3 copies the first
//      effective rank beneath any chain of 3s; above a reset 2 it therefore
//      also leaves play unrestricted.
//  D3. Burns (10 / quartet / Joker) REMOVE the pile from the game entirely:
//      burned cards leave play, the pile is empty, and the same player leads
//      on the empty pile. If that player just went out, the lead passes to
//      the next active player instead.
//  D4. Quartet = exactly 4 cards of one non-wild rank played in ONE action
//      (stricter reading of README "Quartet (4x same rank)"). Pile-top
//      accumulation across turns does not burn. Wilds never form quartets.
//  D5. Multi-card plays must be a single rank (README: "equal-rank set").
//      Wilds are not exempt: a set is exactly one rank (two 2s ok, 2+5 not).
//  D6. Card zones per player: play from hand while it has cards; face-up only
//      when the hand is empty; face-down (blind) only when hand AND face-up
//      are empty. (Hand is refilled to 3 from stock after every play, so an
//      empty hand implies the stock is empty in real games.)
//  D7. Blind face-down plays are SINGLE cards, freely chosen. If the revealed
//      card does not beat the pile top, the player takes the WHOLE pile plus
//      the revealed card into their hand and the turn passes (classic German
//      rule — no free retry). This is a legal action with a bad outcome, not
//      an error: playCards applies the penalty and returns no error.
//  D8. Picking up the pile never draws from the stock. Refill-to-3 happens
//      only after PLAYING cards (README: "draw from stock to refill").
//      Pickup is only legal in play/endgame phases and only on a non-empty
//      pile.
//  D9. Starting player: first with the lowest final FACE-UP card only. The
//      choice is recomputed after rearranging (and after an optional tribute)
//      so cards kept in hand can never decide who opens the round.
//  D10. playDirection is kept for state compatibility; no card reverses it.
//  D11. Stalemate cap (house rule): a game may run at most MAX_GAME_TURNS
//      actions. Shithead has genuine stalemates (e.g. both players hoarding
//      aces and trading pickups forever with all burn cards buried in
//      face-down cards); without a cap, AI-vs-AI games — and a Durable
//      Object room — can loop forever. When the cap is hit the game ends and
//      the player holding the MOST cards is the Shithead (ties: earliest in
//      turn order). ~88% of AI games finish naturally under half the cap.
//  D12. A 7 reverses the normal rank comparison for the next effective play:
//      ordinary cards must be 7 or lower. An 8 skips one active player per
//      card in the equal-rank set. Already-out players are never counted;
//      a quartet burn takes precedence over its skip effect.
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

export interface GameRules {
  includeJokers: boolean
  winnerSwapsFaceUp: boolean
}

/** Result carried into the following round for the optional winner tribute. */
export interface PreviousRoundResult {
  winnerId: string
  loserId: string
}

/** The one optional face-up-for-face-up exchange still awaiting a decision. */
export interface PendingTribute extends PreviousRoundResult {}

export type Phase = 'lobby' | 'rearrange' | 'tribute' | 'play' | 'endgame' | 'roundEnd' | 'gameOver'

export interface GameState {
  phase: Phase
  rules: GameRules
  players: Player[]
  stock: Card[]
  pile: PileEntry[]
  currentPlayerIdx: number
  playDirection: 1 | -1
  turnCount: number
  winnerId: string | null // first player to get rid of every card
  loserId: string | null  // player who is "shithead" (last with cards)
  pendingTribute: PendingTribute | null
  log: GameEvent[]
  /**
   * Monotonic action sequence number, assigned by the engine: 0 at init,
   * +1 for every state-mutating action (rearrange, startPlay, tribute,
   * playCards, pickUpPile). Per-room this lets clients detect duplicate/
   * replayed or out-of-order GAME_STATE broadcasts (ignore seq <= last seen).
   * Optional so existing consumers constructing lobby placeholders compile;
   * every engine-produced state always carries it.
   */
  seq?: number
}

export type GameEvent =
  | { type: 'PLAY_CARDS'; playerId: string; cards: Card[] }
  | { type: 'PICK_UP_PILE'; playerId: string }
  | { type: 'CLEAR_PILE'; reason: 'ten' | 'quartet' | 'joker' }
  | { type: 'PLAYER_OUT'; playerId: string }
  | { type: 'DRAW'; playerId: string; count: number }
  | { type: 'PHASE_CHANGE'; phase: Phase }
  | { type: 'REARRANGE'; playerId: string; fromIdx: number; toIdx: number }
  | { type: 'BLIND_REVEAL'; playerId: string; card: Card; success: boolean }
  | { type: 'GAME_OVER'; loserId: string }

// ---------- Constants ----------

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const DEFAULT_GAME_RULES: Readonly<GameRules> = Object.freeze({
  includeJokers: true,
  winnerSwapsFaceUp: false,
})

/** Maximum number of log entries retained in state (ring buffer). */
export const MAX_LOG_ENTRIES = 50

/** Maximum players the deck can support (54 cards / 9 per player). */
export const MAX_PLAYERS = 6

/** Hard cap on total actions per game; stalemate tiebreak (D11). */
export const MAX_GAME_TURNS = 1000

// 2 is a reset (-1), 3 is the lowest ordered rank, A is highest. Both 2 and
// 3 have special play/effective-top behavior handled below.
// 10 keeps its natural rank for pile-top comparisons (a pile topped by a 10
// burns immediately, so this only matters for canPlay display helpers).
export const RANK_ORDER: Record<Rank, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6,
  '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11,
  '2': -1, 'JOKER': -2,
}

// ---------- RNG ----------

/**
 * Deterministic seeded PRNG (mulberry32). Use for reproducible games/tests:
 *   const rng = seededRng(42); initGame({ players, rng })
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- Deck ----------

function makeCardId(rng: () => number, used: Set<string>): string {
  let id: string
  do {
    // 12 base36 chars ≈ 62 bits; contains no suit/rank information.
    id = `c${Math.floor(rng() * 0xffffffff).toString(36)}${Math.floor(rng() * 0xffffffff).toString(36)}`
  } while (used.has(id))
  used.add(id)
  return id
}

/**
 * Build a deck. Card IDs are opaque random tokens (never encode suit/rank),
 * so broadcasting a hidden card's ID cannot leak its identity.
 * Pass a seeded rng for deterministic decks.
 */
export function makeDeck(includeJokers = true, rng: () => number = Math.random): Card[] {
  const used = new Set<string>()
  const cards: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: makeCardId(rng, used), suit, rank })
    }
  }
  if (includeJokers) {
    cards.push({ id: makeCardId(rng, used), suit: null, rank: 'JOKER' })
    cards.push({ id: makeCardId(rng, used), suit: null, rank: 'JOKER' })
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

/**
 * Can `card` be played on a pile whose effective top rank is `topRank`
 * (null = empty pile or a reset 2)? See D1/D2/D12: any card leads without
 * an active constraint; 2, 3, 10 and Joker are play-anytime; a 7 requires
 * an ordinary response of 7 or lower.
 */
export function canPlay(card: Card, topRank: Rank | null): boolean {
  if (topRank === null) return true
  if (card.rank === '2' || card.rank === '3' || card.rank === '10' || card.rank === 'JOKER') return true
  if (topRank === '7') return RANK_ORDER[card.rank] <= RANK_ORDER['7']
  return RANK_ORDER[card.rank] >= RANK_ORDER[topRank]
}

export function isClearCard(card: Card): boolean {
  return card.rank === '10' || card.rank === 'JOKER'
}

/** Quartet: exactly 4 cards of one non-wild rank in a single action (D4). */
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

/**
 * Effective top rank of the pile, skipping legacy cleared entries and
 * copying 3s. A 2 is a reset boundary: cards beneath it no longer constrain
 * play, including when one or more copying 3s sit above that 2.
 */
export function getTopRank(state: GameState): Rank | null {
  for (let i = state.pile.length - 1; i >= 0; i--) {
    const entry = state.pile[i]
    if (entry.cleared || entry.cards.length === 0) continue
    const rank = entry.cards[0].rank
    if (rank === '3') continue
    if (rank === '2') return null
    return rank
  }
  return null
}

// ---------- Internal helpers ----------

/** Append events, keeping only the most recent MAX_LOG_ENTRIES (ring buffer). */
function appendLog(log: GameEvent[], ...events: GameEvent[]): GameEvent[] {
  const next = [...log, ...events]
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
}

/**
 * Index of the next active player after `fromIdx`. Bounded: never loops
 * forever even if every player is out (returns fromIdx in that case).
 */
function nextActiveIdx(players: Player[], fromIdx: number, dir: 1 | -1): number {
  const n = players.length
  let idx = fromIdx
  for (let i = 0; i < n; i++) {
    idx = (idx + dir + n) % n
    if (!players[idx].isOut) return idx
  }
  return fromIdx
}

/** Opening priority after every player has finalized their public row (D9). */
const START_RANKS: readonly Rank[] = [
  '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER',
]

function startingPlayerIdx(players: Player[]): number {
  for (const rank of START_RANKS) {
    const idx = players.findIndex(player =>
      !player.isOut && player.faceUp.some(card => card.rank === rank),
    )
    if (idx !== -1) return idx
  }
  const firstActive = players.findIndex(player => !player.isOut)
  return firstActive === -1 ? 0 : firstActive
}

function validPendingTribute(state: GameState): PendingTribute | null {
  const pending = state.pendingTribute
  const rules = state.rules ?? DEFAULT_GAME_RULES
  if (!rules.winnerSwapsFaceUp || !pending || pending.winnerId === pending.loserId) return null
  const winner = state.players.find(player => player.id === pending.winnerId)
  const loser = state.players.find(player => player.id === pending.loserId)
  return winner && loser ? pending : null
}

type CardZone = 'hand' | 'faceUp' | 'faceDown'

/** The zone a player must play from right now (D6). */
function activeZone(player: Player): CardZone {
  if (player.hand.length > 0) return 'hand'
  if (player.faceUp.length > 0) return 'faceUp'
  return 'faceDown'
}

/** Flip global phase to 'endgame' once stock is empty and someone is on table cards. */
function endgamePhase(current: Phase, players: Player[], stock: Card[]): Phase {
  if (stock.length > 0) return current
  const someoneOnTable = players.some(p =>
    !p.isOut && p.hand.length === 0 && (p.faceUp.length > 0 || p.faceDown.length > 0)
  )
  return someoneOnTable ? 'endgame' : current
}

/**
 * Stalemate cap (D11): once turnCount reaches MAX_GAME_TURNS the game ends
 * and the player holding the most cards is the Shithead.
 */
function applyStalemateCap(state: GameState): GameState {
  if (state.phase === 'gameOver' || state.turnCount < MAX_GAME_TURNS) return state
  let loserId: string | null = null
  let maxCards = -1
  for (const p of state.players) {
    const n = p.hand.length + p.faceUp.length + p.faceDown.length
    if (n > maxCards) { maxCards = n; loserId = p.id }
  }
  if (loserId === null) return state
  return {
    ...state,
    phase: 'gameOver',
    loserId,
    log: appendLog(state.log, { type: 'GAME_OVER', loserId }),
  }
}

// ---------- Reducers ----------

export interface InitConfig {
  players: Array<{ id: string; name: string; isAI?: boolean; aiDifficulty?: 'easy'|'medium'|'hard' }>
  rules?: GameRules
  previousRound?: PreviousRoundResult | null
  /** @deprecated Pass rules.includeJokers. Kept for legacy callers. */
  includeJokers?: boolean
  rng?: () => number
}

export function initGame(cfg: InitConfig): GameState {
  if (!Array.isArray(cfg.players) || cfg.players.length < 2 || cfg.players.length > MAX_PLAYERS) {
    throw new Error(`initGame requires 2-${MAX_PLAYERS} players`)
  }
  const rng = cfg.rng ?? Math.random
  const rules: GameRules = {
    ...DEFAULT_GAME_RULES,
    ...(cfg.rules ?? {}),
  }
  // The new rules object is authoritative when both APIs are supplied.
  if (cfg.rules === undefined && cfg.includeJokers !== undefined) {
    rules.includeJokers = cfg.includeJokers
  }
  const deck = shuffle(makeDeck(rules.includeJokers, rng), rng)
  if (deck.length < cfg.players.length * 9) {
    throw new Error('Deck too small for player count')
  }
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

  const startIdx = startingPlayerIdx(players)

  const previous = cfg.previousRound
  const ids = new Set(players.map(player => player.id))
  const pendingTribute: PendingTribute | null =
    rules.winnerSwapsFaceUp && previous && previous.winnerId !== previous.loserId &&
    ids.has(previous.winnerId) && ids.has(previous.loserId)
      ? { winnerId: previous.winnerId, loserId: previous.loserId }
      : null

  return {
    phase: 'rearrange',
    rules,
    players,
    stock,
    pile: [],
    currentPlayerIdx: startIdx,
    playDirection: 1,
    turnCount: 0,
    winnerId: null,
    loserId: null,
    pendingTribute,
    log: [{ type: 'PHASE_CHANGE', phase: 'rearrange' }],
    seq: 0,
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
    log: appendLog(state.log, { type: 'REARRANGE', playerId, fromIdx: handIdx, toIdx: upIdx }),
    seq: (state.seq ?? 0) + 1,
  }
}

export function startPlay(state: GameState): GameState {
  if (state.phase !== 'rearrange') return state
  const pendingTribute = validPendingTribute(state)
  const phase: Phase = pendingTribute ? 'tribute' : 'play'
  const tributeWinnerIdx = pendingTribute
    ? state.players.findIndex(player => player.id === pendingTribute.winnerId)
    : -1
  return {
    ...state,
    phase,
    pendingTribute,
    currentPlayerIdx: pendingTribute ? tributeWinnerIdx : startingPlayerIdx(state.players),
    log: appendLog(state.log, { type: 'PHASE_CHANGE', phase }),
    seq: (state.seq ?? 0) + 1,
  }
}

export interface PlayResult {
  state: GameState
  error?: string
}

function finishTribute(state: GameState, players: Player[]): GameState {
  return {
    ...state,
    players,
    phase: 'play',
    pendingTribute: null,
    currentPlayerIdx: startingPlayerIdx(players),
    log: appendLog(state.log, { type: 'PHASE_CHANGE', phase: 'play' }),
    seq: (state.seq ?? 0) + 1,
  }
}

/**
 * The previous winner may optionally exchange exactly one card from their
 * finalized public row with exactly one card from the previous loser's row.
 */
export function exchangeFaceUpCards(
  state: GameState,
  actorId: string,
  winnerCardId: string,
  loserCardId: string,
): PlayResult {
  if (state.phase !== 'tribute') return { state, error: 'Cannot exchange cards in current phase' }
  const pending = validPendingTribute(state)
  if (!pending) return { state, error: 'No valid tribute is pending' }
  if (actorId !== pending.winnerId) return { state, error: 'Only the previous winner may exchange cards' }

  const winnerIdx = state.players.findIndex(player => player.id === pending.winnerId)
  const loserIdx = state.players.findIndex(player => player.id === pending.loserId)
  const winnerCardIdx = state.players[winnerIdx].faceUp.findIndex(card => card.id === winnerCardId)
  const loserCardIdx = state.players[loserIdx].faceUp.findIndex(card => card.id === loserCardId)
  if (winnerCardIdx === -1 || loserCardIdx === -1) {
    return { state, error: 'Tribute may exchange face-up cards only' }
  }

  const players = state.players.map(player => ({ ...player, faceUp: [...player.faceUp] }))
  const winnerCard = players[winnerIdx].faceUp[winnerCardIdx]
  const loserCard = players[loserIdx].faceUp[loserCardIdx]
  players[winnerIdx].faceUp[winnerCardIdx] = loserCard
  players[loserIdx].faceUp[loserCardIdx] = winnerCard
  return { state: finishTribute(state, players) }
}

/** The previous winner may decline the optional exchange. */
export function skipTribute(state: GameState, actorId: string): PlayResult {
  if (state.phase !== 'tribute') return { state, error: 'Cannot skip tribute in current phase' }
  const pending = validPendingTribute(state)
  if (!pending) return { state, error: 'No valid tribute is pending' }
  if (actorId !== pending.winnerId) return { state, error: 'Only the previous winner may skip tribute' }
  return { state: finishTribute(state, state.players) }
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
  if (cards.length === 0) {
    return { state, error: 'No cards to play' }
  }
  if (cards.length > 4) {
    return { state, error: 'Cannot play more than 4 cards at once' }
  }

  // Duplicate-submission guard (card duplication exploit).
  const submittedIds = cards.map(c => c.id)
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { state, error: 'Duplicate card in play' }
  }

  // Canonicalize: re-derive the real cards from server state by id, so a
  // client cannot inject forged suit/rank fields.
  const owned = new Map(
    [...player.hand, ...player.faceUp, ...player.faceDown].map(c => [c.id, c] as const)
  )
  const realCards: Card[] = []
  for (const c of cards) {
    const real = owned.get(c.id)
    if (!real) return { state, error: `Card ${c.id} not in player's possession` }
    realCards.push(real)
  }

  // Zone gating (D6): hand first, then face-up, then face-down blind.
  const zone = activeZone(player)
  const zoneCards = player[zone]
  for (const c of realCards) {
    if (!zoneCards.some(zc => zc.id === c.id)) {
      return { state, error: `Card ${c.id} cannot be played from ${zone} right now` }
    }
  }

  // Blind face-down plays are single cards (D7).
  if (zone === 'faceDown' && realCards.length > 1) {
    return { state, error: 'Only one face-down card can be played blind' }
  }

  // Equal-rank sets only (D5).
  if (new Set(realCards.map(c => c.rank)).size !== 1) {
    return { state, error: 'Multi-card plays must all share one rank' }
  }

  const topRank = getTopRank(state)

  // Blind face-down play that does not beat the pile: penalty pickup of the
  // whole pile plus the revealed card; turn passes (D7). Not an error.
  if (zone === 'faceDown' && !canPlay(realCards[0], topRank)) {
    const revealed = realCards[0]
    const collected: Card[] = [revealed]
    for (const entry of state.pile) {
      if (!entry.cleared) collected.push(...entry.cards)
    }
    const nextPlayers = state.players.map(p =>
      p.id === playerId
        ? { ...p, faceDown: p.faceDown.filter(c => c.id !== revealed.id), hand: [...p.hand, ...collected] }
        : p
    )
    const nextIdx = nextActiveIdx(nextPlayers, state.currentPlayerIdx, state.playDirection)
    return {
      state: applyStalemateCap({
        ...state,
        players: nextPlayers,
        pile: state.pile.filter(e => e.cleared),
        currentPlayerIdx: nextIdx,
        turnCount: state.turnCount + 1,
        log: appendLog(
          state.log,
          { type: 'BLIND_REVEAL', playerId, card: revealed, success: false },
          { type: 'PICK_UP_PILE', playerId },
        ),
        seq: (state.seq ?? 0) + 1,
      }),
    }
  }

  // Legality vs pile top.
  if (!canPlay(realCards[0], topRank)) {
    return { state, error: `Card ${realCards[0].rank} cannot be played on ${topRank}` }
  }

  // Apply: remove played cards from the player's zones.
  const playedIds = new Set(realCards.map(c => c.id))
  let nextPlayers = state.players.map(p => {
    if (p.id !== playerId) return p
    return {
      ...p,
      hand: p.hand.filter(c => !playedIds.has(c.id)),
      faceUp: p.faceUp.filter(c => !playedIds.has(c.id)),
      faceDown: p.faceDown.filter(c => !playedIds.has(c.id)),
    }
  })

  // Burn (D3): burned cards leave the game; the pile becomes empty.
  const cleared = playClearsPile(realCards)
  const reason: 'ten' | 'quartet' | 'joker' =
    realCards.some(c => c.rank === 'JOKER') ? 'joker'
      : realCards.some(c => c.rank === '10') ? 'ten'
        : 'quartet'
  const pile = cleared ? [] : [...state.pile, { cards: realCards, cleared: false }]

  // Draw from stock to refill hand to 3 (README refill rule; never on pickup).
  const stock = [...state.stock]
  let drawCount = 0
  nextPlayers = nextPlayers.map(p => {
    if (p.id !== playerId) return p
    const hand = [...p.hand]
    while (hand.length < 3 && stock.length > 0) {
      hand.push(stock.shift()!)
      drawCount++
    }
    return { ...p, hand }
  })

  // Check player out. Preserve whether somebody was already out before this
  // action: legacy snapshots may have no winnerId even though their first
  // PLAYER_OUT event has fallen out of the capped log. A later player must
  // never steal that historically unknown winner slot.
  const hadPriorOut = state.players.some(p => p.isOut)
  nextPlayers = nextPlayers.map(p => {
    if (p.id !== playerId) return p
    if (p.hand.length + p.faceUp.length + p.faceDown.length === 0) {
      return { ...p, isOut: true }
    }
    return p
  })

  const wentOut = nextPlayers.find(p => p.id === playerId)?.isOut === true
  let winnerId = state.winnerId ?? null
  if (wentOut && winnerId === null && !hadPriorOut) winnerId = playerId

  // Phase transition
  let phase: Phase = endgamePhase(state.phase, nextPlayers, stock)

  // Turn: burn ⇒ same player leads on the empty pile — unless they just went
  // out, in which case the lead passes to the next active player (D3).
  // Otherwise each played 8 skips one additional active player (D12). Calling
  // nextActiveIdx repeatedly naturally ignores out players and handles small
  // tables: in a 2-player game one 8 returns the turn to its player, while a
  // pair skips both active seats and lands on the opponent.
  let nextIdx = state.currentPlayerIdx
  if (!cleared || wentOut) {
    nextIdx = nextActiveIdx(nextPlayers, state.currentPlayerIdx, state.playDirection)
    const skipCount = !cleared && realCards[0].rank === '8' ? realCards.length : 0
    for (let skipped = 0; skipped < skipCount; skipped++) {
      nextIdx = nextActiveIdx(nextPlayers, nextIdx, state.playDirection)
    }
  }

  // Game over — only one player left = loser
  let loserId = state.loserId
  const activePlayers = nextPlayers.filter(p => !p.isOut)
  if (activePlayers.length === 1) {
    loserId = activePlayers[0].id
    phase = 'gameOver'
  }

  const events: GameEvent[] = [
    ...(zone === 'faceDown'
      ? [{ type: 'BLIND_REVEAL' as const, playerId, card: realCards[0], success: true }]
      : []),
    { type: 'PLAY_CARDS', playerId, cards: realCards },
    ...(cleared ? [{ type: 'CLEAR_PILE' as const, reason }] : []),
    ...(drawCount > 0 ? [{ type: 'DRAW' as const, playerId, count: drawCount }] : []),
    ...(wentOut ? [{ type: 'PLAYER_OUT' as const, playerId }] : []),
    ...(loserId && loserId !== state.loserId ? [{ type: 'GAME_OVER' as const, loserId }] : []),
  ]

  return {
    state: applyStalemateCap({
      ...state,
      players: nextPlayers,
      stock,
      pile,
      currentPlayerIdx: nextIdx,
      phase,
      turnCount: state.turnCount + 1,
      winnerId,
      loserId,
      log: appendLog(state.log, ...events),
      seq: (state.seq ?? 0) + 1,
    }),
  }
}

export function pickUpPile(state: GameState, playerId: string): PlayResult {
  // Phase guard (D8): pickup is only a play-phase action. Without this it was
  // abusable during rearrange (free stock draws) and gameOver (infinite loop).
  if (state.phase !== 'play' && state.phase !== 'endgame') {
    return { state, error: 'Cannot pick up in current phase' }
  }
  const player = state.players[state.currentPlayerIdx]
  if (!player || player.id !== playerId) {
    return { state, error: 'Not your turn' }
  }
  if (player.isOut) return { state, error: 'Player already out' }

  const collectible = state.pile.filter(e => !e.cleared)
  if (collectible.length === 0) {
    return { state, error: 'Pile is empty — nothing to pick up' }
  }

  // Collect all pile cards. No stock draw (D8): refill-to-3 only happens
  // after playing cards, never as a pickup bonus.
  const collected: Card[] = []
  for (const entry of collectible) collected.push(...entry.cards)

  const players = state.players.map(p => p.id === playerId ? { ...p, hand: [...p.hand, ...collected] } : p)

  // Advance turn — bounded loop, terminates even with one active player.
  const nextIdx = nextActiveIdx(players, state.currentPlayerIdx, state.playDirection)

  const phase = endgamePhase(state.phase, players, state.stock)

  return {
    state: applyStalemateCap({
      ...state,
      players,
      pile: state.pile.filter(e => e.cleared),
      currentPlayerIdx: nextIdx,
      phase,
      turnCount: state.turnCount + 1,
      log: appendLog(state.log, { type: 'PICK_UP_PILE', playerId }),
      seq: (state.seq ?? 0) + 1,
    }),
  }
}

// ---------- AI (pure) ----------

export interface AIMove {
  type: 'play' | 'pickUp'
  cards?: Card[]
}

const SPECIALS: ReadonlySet<Rank> = new Set(['2', '3', '10', 'JOKER'])

/**
 * Choose a move for an AI player. Never stalls: the returned move is always
 * legal by construction (same canPlay/zone logic as playCards), and the AI
 * can always finish a game (hand → face-up → blind face-down).
 *
 * Tiers:
 *  - easy:   plays ONE random playable card; blind picks are random.
 *  - medium: plays the whole equal-rank set of its lowest non-special rank
 *            (sheds fast, hoards special cards); plays a single special only
 *            when nothing else is playable.
 *  - hard:   medium's shedding, plus: wins immediately when one action can
 *            empty all remaining cards; burns (10/Joker/quartet) only when
 *            the pile is meaningfully large (>= 4 cards — burning a big pile
 *            permanently removes those cards from the game and denies
 *            opponents a cheap pickup, while a small pile is not worth a
 *            premium card) or when it wins the game; prefers spending a 2
 *            before a burn card when only specials are playable (2s reset
 *            the constraint without removing cards from the game).
 *
 * Pass a seeded rng for deterministic behavior.
 */
export function pickAIMove(
  state: GameState,
  player: Player,
  difficulty: 'easy'|'medium'|'hard' = 'medium',
  rng: () => number = Math.random,
): AIMove {
  const topRank = getTopRank(state)
  const zone = activeZone(player)
  const zoneCards = player[zone]
  if (zoneCards.length === 0) return { type: 'pickUp' }

  // Blind face-down: the card is unknown to the player themselves, so every
  // tier picks one at random (single card per D7).
  if (zone === 'faceDown') {
    const pick = zoneCards[Math.floor(rng() * zoneCards.length)]
    return { type: 'play', cards: [pick] }
  }

  const playable = zoneCards.filter(c => canPlay(c, topRank))
  if (playable.length === 0) return { type: 'pickUp' }

  if (difficulty === 'easy') {
    return { type: 'play', cards: [playable[Math.floor(rng() * playable.length)]] }
  }

  // Group playable cards by rank (sets are single-rank per D5).
  const byRank = new Map<Rank, Card[]>()
  for (const c of playable) {
    const arr = byRank.get(c.rank) ?? []
    arr.push(c)
    byRank.set(c.rank, arr)
  }
  const groups = [...byRank.values()].sort((a, b) => RANK_ORDER[a[0].rank] - RANK_ORDER[b[0].rank])
  const nonSpecial = groups.filter(g => !SPECIALS.has(g[0].rank))

  const totalRemaining = player.hand.length + player.faceUp.length + player.faceDown.length

  if (difficulty === 'medium') {
    if (nonSpecial.length > 0) return { type: 'play', cards: nonSpecial[0] }
    return { type: 'play', cards: [groups[0][0]] }
  }

  // ---- hard ----
  const pileCards = pileSize(state)

  // Win now if a single action can shed every remaining card.
  const winner = groups.find(g => g.length === totalRemaining)
  if (winner) return { type: 'play', cards: winner }

  // Burn a meaningfully large pile (see rationale above).
  if (pileCards >= 4) {
    const quartet = nonSpecial.find(g => g.length === 4)
    if (quartet) return { type: 'play', cards: quartet }
    const burn = groups.find(g => g[0].rank === '10' || g[0].rank === 'JOKER')
    if (burn) return { type: 'play', cards: [burn[0]] }
  }

  // Default: shed the lowest non-special set.
  if (nonSpecial.length > 0) return { type: 'play', cards: nonSpecial[0] }

  // Only specials playable: spend a 2 before wasting a burn card.
  const twos = groups.find(g => g[0].rank === '2')
  if (twos) return { type: 'play', cards: [twos[0]] }
  return { type: 'play', cards: [groups[0][0]] }
}

// ---------- Helpers ----------

export function getCurrentPlayer(state: GameState): Player | null {
  return state.players[state.currentPlayerIdx] ?? null
}

/** Physical visible top card of the pile (skips legacy cleared entries). */
export function getTopCard(state: GameState): Card | null {
  for (let i = state.pile.length - 1; i >= 0; i--) {
    const entry = state.pile[i]
    if (!entry.cleared && entry.cards.length > 0) return entry.cards[0]
  }
  return null
}

export function pileSize(state: GameState): number {
  return state.pile.reduce((sum, e) => sum + (e.cleared ? 0 : e.cards.length), 0)
}
