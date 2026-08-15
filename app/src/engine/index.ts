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
//  D2. 2, 3 and Joker are playable anytime. A 10 is normally unrestricted,
//      but it does NOT override the low-card constraint of an effective 7.
//      A 2 resets the active rank constraint: the next player may play any
//      card. A 3 copies the first effective rank beneath any chain of 3s;
//      above a reset 2 it therefore also leaves play unrestricted.
//  D3. Burns (10 / quartet / Joker) REMOVE the pile from the game entirely:
//      burned cards leave play, the pile is empty, and the same player leads
//      on the empty pile. If that player just went out, the lead passes to
//      the next active player instead.
//  D4. Four-or-more burn = whenever the uninterrupted PHYSICAL top run of
//      one rank reaches at least four cards, the pile burns. The run may be
//      completed across actions (including an out-of-turn interrupt), and
//      may exceed four when multiple decks are in use. Physical 2s and 3s
//      count as their printed ranks even though their play effects reset or
//      mirror the effective rank. 10 and Joker still burn immediately.
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
//  D13. After a normal visible play refills from stock, only replacement
//      cards actually drawn by that action which match the played printed
//      rank may be played immediately as a quick follow-up. The entitlement
//      is exact-card-id based, may chain through matching replacement draws,
//      and expires on the next accepted competing gameplay action.
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
  deckCount: 1 | 2 | 3
}

/** Result carried into the following round for the optional winner tribute. */
export interface PreviousRoundResult {
  winnerId: string
  loserId: string
}

/** The one optional face-up-for-face-up exchange still awaiting a decision. */
export interface PendingTribute extends PreviousRoundResult {}

/**
 * Server-authoritative entitlement for the just-played actor to add matching
 * replacement cards before another gameplay action wins the race.
 */
export interface PendingQuickFollowUp {
  playerId: string
  rank: Rank
  eligibleCardIds: string[]
  /** State sequence produced by the action that opened/refreshed the window. */
  sourceSeq: number
}

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
  pendingQuickFollowUp: PendingQuickFollowUp | null
  log: GameEvent[]
  /**
   * Monotonic action sequence number, assigned by the engine: 0 at init,
   * +1 for every state-mutating action (rearrange, startPlay, tribute,
   * playCards, quickFollowUp, interruptBurn, pickUpPile). Per-room this lets clients detect duplicate/
   * replayed or out-of-order GAME_STATE broadcasts (ignore seq <= last seen).
   * Optional so existing consumers constructing lobby placeholders compile;
   * every engine-produced state always carries it.
   */
  seq?: number
}

export type GameEvent =
  | { type: 'PLAY_CARDS'; playerId: string; cards: Card[] }
  | { type: 'QUICK_FOLLOW_UP'; playerId: string; cards: Card[] }
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
  deckCount: 1,
})

/** Maximum number of log entries retained in state (ring buffer). */
export const MAX_LOG_ENTRIES = 50

/** Maximum supported seats (a single 54-card deck supplies 9 cards each). */
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

/** Display-only ordering for the hand fan. Lowest → highest.
 *  Distinct from RANK_ORDER (which is for pile-top comparisons). */
export const HAND_DISPLAY_ORDER: Record<Rank, number> = {
  '4': 0, '5': 1, '6': 2, '7': 3, '8': 4, '9': 5,
  'J': 6, 'Q': 7, 'K': 8, 'A': 9, '2': 10, '3': 11, '10': 12,
  'JOKER': 13,
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
function makeStandardDeck(includeJokers: boolean, rng: () => number, used: Set<string>): Card[] {
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

export function makeDeck(includeJokers = true, rng: () => number = Math.random): Card[] {
  return makeStandardDeck(includeJokers, rng, new Set<string>())
}

/** Build 1-3 complete decks while keeping opaque card IDs unique globally. */
export function makeDecks(
  includeJokers = true,
  deckCount: 1 | 2 | 3 = 1,
  rng: () => number = Math.random,
): Card[] {
  if (deckCount !== 1 && deckCount !== 2 && deckCount !== 3) {
    throw new Error('deckCount must be 1, 2, or 3')
  }
  const used = new Set<string>()
  const cards: Card[] = []
  for (let deck = 0; deck < deckCount; deck++) {
    cards.push(...makeStandardDeck(includeJokers, rng, used))
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
 * an active constraint; 2, 3 and Joker are play-anytime. A 10 is normally
 * unrestricted, except that an effective 7 still requires it to be 7/lower.
 */
export function canPlay(card: Card, topRank: Rank | null): boolean {
  if (topRank === null) return true
  if (card.rank === '2' || card.rank === '3' || card.rank === 'JOKER') return true
  if (topRank === '7') return RANK_ORDER[card.rank] <= RANK_ORDER['7']
  if (card.rank === '10') return true
  return RANK_ORDER[card.rank] >= RANK_ORDER[topRank]
}

export function isClearCard(card: Card): boolean {
  return card.rank === '10' || card.rank === 'JOKER'
}

/** Four-or-more equal physical ranks in one action (part of D4). */
export function isQuartet(cards: Card[]): boolean {
  if (cards.length < 4) return false
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

export interface PhysicalTopRun {
  rank: Rank
  count: number
}

/**
 * The uninterrupted run of the printed rank at the physical top of the pile.
 * Unlike getTopRank, this deliberately does not apply the 2 reset or 3 mirror
 * effects. Legacy cleared/empty entries are ignored consistently with the
 * other pile readers.
 */
export function getPhysicalTopRun(state: GameState): PhysicalTopRun | null {
  let rank: Rank | null = null
  let count = 0
  for (let i = state.pile.length - 1; i >= 0; i--) {
    const entry = state.pile[i]
    if (entry.cleared || entry.cards.length === 0) continue
    const entryRank = entry.cards[0].rank
    if (rank === null) rank = entryRank
    if (entryRank !== rank || entry.cards.some(card => card.rank !== rank)) break
    count += entry.cards.length
  }
  return rank === null || count === 0 ? null : { rank, count }
}

function completesPhysicalBurn(state: GameState, cards: Card[]): boolean {
  if (cards.length === 0) return false
  if (isQuartet(cards)) return true
  const run = getPhysicalTopRun(state)
  return run !== null && run.rank === cards[0].rank && run.count + cards.length >= 4
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
    pendingQuickFollowUp: null,
    log: appendLog(state.log, { type: 'GAME_OVER', loserId }),
  }
}

// ---------- Reducers ----------

export interface InitConfig {
  players: Array<{ id: string; name: string; isAI?: boolean; aiDifficulty?: 'easy'|'medium'|'hard' }>
  rules?: Partial<GameRules>
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
  if (rules.deckCount !== 1 && rules.deckCount !== 2 && rules.deckCount !== 3) {
    throw new Error('deckCount must be 1, 2, or 3')
  }
  const deck = shuffle(makeDecks(rules.includeJokers, rules.deckCount, rng), rng)
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
    pendingQuickFollowUp: null,
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
    pendingQuickFollowUp: null,
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
    pendingQuickFollowUp: null,
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

function clearReason(cards: Card[]): 'ten' | 'quartet' | 'joker' {
  return cards.some(card => card.rank === 'JOKER') ? 'joker'
    : cards.some(card => card.rank === '10') ? 'ten'
      : 'quartet'
}

type AcceptedPlayKind = 'normal' | 'interrupt' | 'quickFollowUp'

/** Apply a fully validated play, including draw, out/game-over, logs and turn. */
function applyAcceptedPlay(
  state: GameState,
  actorIdx: number,
  realCards: Card[],
  zone: CardZone,
  cleared: boolean,
  kind: AcceptedPlayKind,
): GameState {
  const playerId = state.players[actorIdx].id
  const playedIds = new Set(realCards.map(card => card.id))
  let nextPlayers = state.players.map(player => {
    if (player.id !== playerId) return player
    return {
      ...player,
      hand: player.hand.filter(card => !playedIds.has(card.id)),
      faceUp: player.faceUp.filter(card => !playedIds.has(card.id)),
      faceDown: player.faceDown.filter(card => !playedIds.has(card.id)),
    }
  })

  // Burned cards leave the game entirely; otherwise append one physical run
  // entry for this action.
  const pile = cleared ? [] : [...state.pile, { cards: realCards, cleared: false }]

  // Playing (including an interrupt) refills the hand to three while stock
  // remains. A pickup intentionally never does this.
  const stock = [...state.stock]
  let drawCount = 0
  const drawnCards: Card[] = []
  nextPlayers = nextPlayers.map(player => {
    if (player.id !== playerId) return player
    const hand = [...player.hand]
    while (hand.length < 3 && stock.length > 0) {
      const drawn = stock.shift()!
      hand.push(drawn)
      drawnCards.push(drawn)
      drawCount++
    }
    return { ...player, hand }
  })

  // Preserve a historical unknown first winner in migrated snapshots.
  const hadPriorOut = state.players.some(player => player.isOut)
  nextPlayers = nextPlayers.map(player => {
    if (player.id !== playerId) return player
    return player.hand.length + player.faceUp.length + player.faceDown.length === 0
      ? { ...player, isOut: true }
      : player
  })

  const wentOut = nextPlayers[actorIdx]?.isOut === true
  let winnerId = state.winnerId ?? null
  if (wentOut && winnerId === null && !hadPriorOut) winnerId = playerId

  let phase: Phase = endgamePhase(state.phase, nextPlayers, stock)

  // A burn hands the empty-pile lead to its actor (including an interrupt or
  // quick follow-up). A normal non-burning play calculates the next seat from
  // the actor. A quick follow-up must instead preserve the already-calculated
  // next player; each extra 8 advances it one further active seat so stacked
  // skip effects remain cumulative rather than being recalculated from actor.
  let nextIdx: number
  if (cleared) {
    nextIdx = wentOut
      ? nextActiveIdx(nextPlayers, actorIdx, state.playDirection)
      : actorIdx
  } else if (kind === 'quickFollowUp') {
    nextIdx = state.currentPlayerIdx
    const extraSkipCount = realCards[0].rank === '8' ? realCards.length : 0
    for (let skipped = 0; skipped < extraSkipCount; skipped++) {
      nextIdx = nextActiveIdx(nextPlayers, nextIdx, state.playDirection)
    }
  } else {
    nextIdx = nextActiveIdx(nextPlayers, actorIdx, state.playDirection)
    const skipCount = realCards[0].rank === '8' ? realCards.length : 0
    for (let skipped = 0; skipped < skipCount; skipped++) {
      nextIdx = nextActiveIdx(nextPlayers, nextIdx, state.playDirection)
    }
  }

  let loserId = state.loserId
  const activePlayers = nextPlayers.filter(player => !player.isOut)
  if (activePlayers.length === 1) {
    loserId = activePlayers[0].id
    phase = 'gameOver'
  }

  const nextSeq = (state.seq ?? 0) + 1
  let eligibleCardIds: string[] = []
  if (!cleared && !wentOut && phase !== 'gameOver') {
    if (kind === 'normal' && zone !== 'faceDown') {
      eligibleCardIds = drawnCards
        .filter(card => card.rank === realCards[0].rank)
        .map(card => card.id)
    } else if (kind === 'quickFollowUp') {
      const previous = state.pendingQuickFollowUp
      const remaining = previous?.playerId === playerId && previous.rank === realCards[0].rank
        ? previous.eligibleCardIds.filter(id => !playedIds.has(id))
        : []
      const newlyEligible = drawnCards
        .filter(card => card.rank === realCards[0].rank)
        .map(card => card.id)
      const stillInHand = new Set(nextPlayers[actorIdx]?.hand.map(card => card.id) ?? [])
      eligibleCardIds = [...new Set([...remaining, ...newlyEligible])]
        .filter(id => stillInHand.has(id))
    }
  }
  const pendingQuickFollowUp: PendingQuickFollowUp | null = eligibleCardIds.length > 0
    ? { playerId, rank: realCards[0].rank, eligibleCardIds, sourceSeq: nextSeq }
    : null

  const events: GameEvent[] = [
    ...(zone === 'faceDown'
      ? [{ type: 'BLIND_REVEAL' as const, playerId, card: realCards[0], success: true }]
      : []),
    { type: 'PLAY_CARDS', playerId, cards: realCards },
    ...(kind === 'quickFollowUp'
      ? [{ type: 'QUICK_FOLLOW_UP' as const, playerId, cards: realCards }]
      : []),
    ...(cleared ? [{ type: 'CLEAR_PILE' as const, reason: clearReason(realCards) }] : []),
    ...(drawCount > 0 ? [{ type: 'DRAW' as const, playerId, count: drawCount }] : []),
    ...(wentOut ? [{ type: 'PLAYER_OUT' as const, playerId }] : []),
    ...(loserId && loserId !== state.loserId ? [{ type: 'GAME_OVER' as const, loserId }] : []),
  ]

  return applyStalemateCap({
    ...state,
    players: nextPlayers,
    stock,
    pile,
    currentPlayerIdx: nextIdx,
    phase,
    turnCount: state.turnCount + 1,
    winnerId,
    loserId,
    pendingQuickFollowUp,
    log: appendLog(state.log, ...events),
    seq: nextSeq,
  })
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
        pendingQuickFollowUp: null,
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

  const cleared = playClearsPile(realCards) || completesPhysicalBurn(state, realCards)
  return { state: applyAcceptedPlay(state, state.currentPlayerIdx, realCards, zone, cleared, 'normal') }
}

/**
 * Canonical cards the named player may use for the currently open quick
 * follow-up. This never grants eligibility by rank alone: the exact card id
 * must have been recorded when that card was drawn from stock.
 */
export function getQuickFollowUpCards(state: GameState, playerId: string): Card[] {
  if (state.phase !== 'play' && state.phase !== 'endgame') return []
  const pending = state.pendingQuickFollowUp
  if (!pending || pending.playerId !== playerId || pending.sourceSeq !== (state.seq ?? 0)) return []
  const actor = state.players.find(player => player.id === playerId)
  if (!actor || actor.isOut) return []
  const run = getPhysicalTopRun(state)
  if (!run || run.rank !== pending.rank) return []

  const eligible = new Set(pending.eligibleCardIds)
  return actor.hand.filter(card => eligible.has(card.id) && card.rank === pending.rank)
}

/**
 * Add one or more entitled replacement cards before a competing action is
 * accepted. Multiplayer currently submits one card at a time; the engine
 * supports a batch so offline/future callers preserve equal-rank semantics.
 */
export function quickFollowUp(state: GameState, playerId: string, cards: Card[]): PlayResult {
  if (state.phase !== 'play' && state.phase !== 'endgame') {
    return { state, error: 'Cannot quick-follow-up in current phase' }
  }
  const actorIdx = state.players.findIndex(player => player.id === playerId)
  if (actorIdx === -1) return { state, error: 'Player not found' }
  if (state.players[actorIdx].isOut) return { state, error: 'Player already out' }
  if (cards.length === 0) return { state, error: 'No cards to quick-follow-up with' }

  const pending = state.pendingQuickFollowUp
  if (!pending || pending.playerId !== playerId) {
    return { state, error: 'No quick follow-up is available for this player' }
  }
  if (pending.sourceSeq !== (state.seq ?? 0)) {
    return { state, error: 'Quick follow-up window has expired' }
  }

  const submittedIds = cards.map(card => card.id)
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { state, error: 'Duplicate card in quick follow-up' }
  }
  const eligible = new Map(
    getQuickFollowUpCards(state, playerId).map(card => [card.id, card] as const),
  )
  const realCards: Card[] = []
  for (const card of cards) {
    const real = eligible.get(card.id)
    if (!real) {
      return { state, error: `Card ${card.id} was not drawn for this quick follow-up` }
    }
    realCards.push(real)
  }

  const cleared = playClearsPile(realCards) || completesPhysicalBurn(state, realCards)
  return {
    state: applyAcceptedPlay(state, actorIdx, realCards, 'hand', cleared, 'quickFollowUp'),
  }
}

/**
 * Return the complete set an out-of-turn player may use to finish a physical
 * four-or-more run right now. An empty result means no legal interrupt. This
 * is intentionally pure so clients can render eligibility from shared rules.
 */
export function getInterruptBurnCards(state: GameState, playerId: string): Card[] {
  if (state.phase !== 'play' && state.phase !== 'endgame') return []
  const actorIdx = state.players.findIndex(player => player.id === playerId)
  if (actorIdx === -1 || actorIdx === state.currentPlayerIdx) return []
  const player = state.players[actorIdx]
  if (player.isOut) return []

  const run = getPhysicalTopRun(state)
  if (!run || run.count >= 4) return []
  const zone = activeZone(player)
  if (zone === 'faceDown') return []
  const matching = player[zone].filter(card => card.rank === run.rank)
  return matching.length > 0 && run.count + matching.length >= 4 ? matching : []
}

/**
 * Burn-in / cut-in: an out-of-turn player may interrupt only by playing ALL
 * matching cards from their currently active visible zone when that play
 * completes the physical top run to at least four. The interrupter then owns
 * the empty-pile lead exactly as after a 10, unless the play makes them go out.
 */
export function interruptBurn(state: GameState, playerId: string, cards: Card[]): PlayResult {
  if (state.phase !== 'play' && state.phase !== 'endgame') {
    return { state, error: 'Cannot interrupt in current phase' }
  }
  const actorIdx = state.players.findIndex(player => player.id === playerId)
  if (actorIdx === -1) return { state, error: 'Player not found' }
  if (actorIdx === state.currentPlayerIdx) {
    return { state, error: 'Use the normal play action on your turn' }
  }
  const player = state.players[actorIdx]
  if (player.isOut) return { state, error: 'Player already out' }
  if (cards.length === 0) return { state, error: 'No cards to interrupt with' }

  const run = getPhysicalTopRun(state)
  if (!run) return { state, error: 'Pile is empty — nothing to interrupt' }
  if (run.count >= 4) return { state, error: 'Top run should already be burned' }

  const zone = activeZone(player)
  if (zone === 'faceDown') {
    return { state, error: 'Face-down cards cannot be used to interrupt' }
  }

  const submittedIds = cards.map(card => card.id)
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { state, error: 'Duplicate card in interrupt' }
  }

  const owned = new Map(
    [...player.hand, ...player.faceUp, ...player.faceDown].map(card => [card.id, card] as const),
  )
  const realCards: Card[] = []
  for (const card of cards) {
    const real = owned.get(card.id)
    if (!real) return { state, error: `Card ${card.id} not in player's possession` }
    if (!player[zone].some(zoneCard => zoneCard.id === real.id)) {
      return { state, error: `Card ${card.id} cannot be played from ${zone} right now` }
    }
    realCards.push(real)
  }

  if (realCards.some(card => card.rank !== run.rank)) {
    return { state, error: `Interrupt cards must all match the physical top rank ${run.rank}` }
  }

  const allMatching = player[zone].filter(card => card.rank === run.rank)
  const playedIds = new Set(realCards.map(card => card.id))
  if (allMatching.length !== realCards.length || allMatching.some(card => !playedIds.has(card.id))) {
    return { state, error: 'Interrupt must play all matching cards from the active zone' }
  }
  if (run.count + realCards.length < 4) {
    return { state, error: 'Interrupt must complete at least four matching cards' }
  }

  return { state: applyAcceptedPlay(state, actorIdx, realCards, zone, true, 'interrupt') }
}

/** True when this player can submit the existing, authoritative pile pickup. */
export function canPickUpPile(state: GameState, playerId: string): boolean {
  if (state.phase !== 'play' && state.phase !== 'endgame') return false
  const player = state.players[state.currentPlayerIdx]
  return Boolean(
    player && player.id === playerId && !player.isOut &&
    state.pile.some(entry => !entry.cleared),
  )
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
      pendingQuickFollowUp: null,
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
 *            empty all remaining cards; recognizes cumulative physical runs
 *            and completes a forced four-or-more burn when possible. It uses
 *            a standalone 10/Joker/four-plus set to burn a meaningfully large
 *            pile (>= 4 cards) or when it wins the game; otherwise it prefers
 *            spending a 2 before a premium burn card.
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

  // Finish an existing physical top run. This is based on the printed rank,
  // so cumulative 2s/3s are recognized despite their effective-rank effects.
  const topRun = getPhysicalTopRun(state)
  const runCompleter = topRun && topRun.count < 4
    ? groups.find(group => group[0].rank === topRun.rank && topRun.count + group.length >= 4)
    : undefined
  if (runCompleter) return { type: 'play', cards: runCompleter }

  // Burn a meaningfully large pile (see rationale above).
  if (pileCards >= 4) {
    const quartet = groups.find(g => isQuartet(g))
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
