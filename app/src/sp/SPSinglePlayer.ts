// ============================================================================
// Single-player / pass-and-play store. Seats keep stable ids across rounds so
// the previous winner/last-place exchange can be carried into a rematch.
// ============================================================================
import { create } from 'zustand'
import {
  DEFAULT_GAME_RULES,
  RANK_ORDER,
  type Card,
  type GameRules,
  type GameState,
  type Player,
  type PreviousRoundResult,
  exchangeFaceUpCards,
  initGame,
  pickAIMove,
  pickUpPile,
  playCards,
  rearrange,
  skipTribute,
  startPlay,
} from '../engine'

export interface InitPlayer {
  id?: string
  name: string
  isAI: boolean
  difficulty?: 'easy' | 'medium' | 'hard'
}

interface SPState {
  state: GameState
  /** Rules selected for the next deal (may differ from a finished round). */
  rules: GameRules
  meId: string | null
  revealedId: string | null
  readyIds: string[]
  lastError: string | null
  /** Configs from the first deal, including stable seat ids. */
  configs: InitPlayer[]
  initGame: (players: InitPlayer[], rules?: GameRules) => void
  setRules: (patch: Partial<GameRules>) => void
  endRearrange: (playerId: string) => void
  rearrange: (playerId: string, handIdx: number, upIdx: number) => void
  playCards: (playerId: string, cards: Card[]) => void
  pickUpPile: (playerId: string) => void
  exchangeTribute: (playerId: string, winnerCardId: string, loserCardId: string) => void
  skipTribute: (playerId: string) => void
  tickAI: () => void
  revealFor: (playerId: string) => void
  hideViewer: () => void
  clearError: () => void
  rematch: () => void
  reset: () => void
}

function emptyState(): GameState {
  return {
    phase: 'lobby',
    rules: { ...DEFAULT_GAME_RULES },
    players: [],
    stock: [],
    pile: [],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 0,
    winnerId: null,
    loserId: null,
    pendingTribute: null,
    log: [],
    seq: 0,
  }
}

/** Whose cards the bottom panel may render. Pinned unless deliberately passed. */
export function resolveViewerId(
  players: Player[],
  currentPlayerIdx: number,
  meId: string | null,
  revealedId: string | null,
): string | null {
  const current = players[currentPlayerIdx]
  if (revealedId && current && current.id === revealedId && !current.isAI) return revealedId
  return meId ?? players[0]?.id ?? null
}

export function needsPassGate(
  players: Player[],
  currentPlayerIdx: number,
  meId: string | null,
  revealedId: string | null,
): boolean {
  const current = players[currentPlayerIdx]
  if (!current || current.isAI || current.isOut) return false
  if (current.id === meId) return false
  return revealedId !== current.id
}

/** Special cards are the strongest public endgame cards for the simple AI. */
export function finalCardScore(card: Card): number {
  if (card.rank === 'JOKER') return 100
  if (card.rank === '10') return 90
  if (card.rank === '2') return 80
  return RANK_ORDER[card.rank]
}

/** Give every AI the best three of its six visible cards before humans act. */
export function arrangeAIPlayers(initial: GameState): GameState {
  let state = initial
  for (const original of initial.players) {
    if (!original.isAI) continue
    const current = state.players.find(player => player.id === original.id)
    if (!current) continue
    const desired = new Set(
      [...current.faceUp, ...current.hand]
        .sort((a, b) => finalCardScore(b) - finalCardScore(a))
        .slice(0, 3)
        .map(card => card.id),
    )
    for (let upIndex = 0; upIndex < 3; upIndex++) {
      const player = state.players.find(candidate => candidate.id === original.id)
      if (!player || desired.has(player.faceUp[upIndex]?.id)) continue
      const handIndex = player.hand.findIndex(card => desired.has(card.id))
      if (handIndex !== -1) state = rearrange(state, player.id, handIndex, upIndex)
    }
  }
  return state
}

/** AI accepts the optional exchange only when the loser's card is stronger. */
export function resolveAITribute(initial: GameState): GameState {
  const pending = initial.pendingTribute
  if (initial.phase !== 'tribute' || !pending) return initial
  const winner = initial.players.find(player => player.id === pending.winnerId)
  const loser = initial.players.find(player => player.id === pending.loserId)
  if (!winner?.isAI || !loser) return initial
  const give = [...winner.faceUp].sort((a, b) => finalCardScore(a) - finalCardScore(b))[0]
  const take = [...loser.faceUp].sort((a, b) => finalCardScore(b) - finalCardScore(a))[0]
  const result = give && take && finalCardScore(take) > finalCardScore(give)
    ? exchangeFaceUpCards(initial, winner.id, give.id, take.id)
    : skipTribute(initial, winner.id)
  return result.error ? initial : result.state
}

function makeRound(
  requested: InitPlayer[],
  rules: GameRules,
  previousRound: PreviousRoundResult | null = null,
) {
  const configs = requested.map(config => ({
    ...config,
    id: config.id ?? crypto.randomUUID(),
  }))
  const players = configs.map(config => ({
    id: config.id!,
    name: config.name,
    isAI: config.isAI,
    aiDifficulty: config.difficulty,
  }))
  let state = arrangeAIPlayers(initGame({ players, rules, previousRound }))
  const readyIds = players.filter(player => player.isAI).map(player => player.id)
  if (players.every(player => player.isAI)) {
    state = resolveAITribute(startPlay(state))
  }
  return {
    state,
    configs,
    readyIds,
    meId: players.find(player => !player.isAI)?.id ?? players[0]?.id ?? null,
  }
}

export const useSPGame = create<SPState>((set, get) => ({
  state: emptyState(),
  rules: { ...DEFAULT_GAME_RULES },
  meId: null,
  revealedId: null,
  readyIds: [],
  lastError: null,
  configs: [],

  initGame: (requested, selectedRules = { ...DEFAULT_GAME_RULES }) => {
    const round = makeRound(requested, selectedRules)
    set({ ...round, rules: { ...selectedRules }, revealedId: null, lastError: null })
  },

  setRules: patch => set(current => ({ rules: { ...current.rules, ...patch } })),

  endRearrange: playerId => {
    set(current => {
      if (current.state.phase !== 'rearrange') return current
      const readyIds = current.readyIds.includes(playerId)
        ? current.readyIds
        : [...current.readyIds, playerId]
      const allReady = current.state.players.every(player => readyIds.includes(player.id))
      const state = allReady
        ? resolveAITribute(startPlay(current.state))
        : current.state
      return { readyIds, revealedId: null, state }
    })
  },

  rearrange: (playerId, handIdx, upIdx) => {
    set(current => ({ state: rearrange(current.state, playerId, handIdx, upIdx) }))
  },

  playCards: (playerId, cards) => {
    set(current => {
      const result = playCards(current.state, playerId, cards)
      if (result.error) return { lastError: result.error }
      const turnMoved = result.state.currentPlayerIdx !== current.state.currentPlayerIdx
      return { state: result.state, lastError: null, revealedId: turnMoved ? null : current.revealedId }
    })
  },

  pickUpPile: playerId => {
    set(current => {
      const result = pickUpPile(current.state, playerId)
      if (result.error) return { lastError: result.error }
      const turnMoved = result.state.currentPlayerIdx !== current.state.currentPlayerIdx
      return { state: result.state, lastError: null, revealedId: turnMoved ? null : current.revealedId }
    })
  },

  exchangeTribute: (playerId, winnerCardId, loserCardId) => {
    set(current => {
      const result = exchangeFaceUpCards(current.state, playerId, winnerCardId, loserCardId)
      return result.error ? { lastError: result.error } : { state: result.state, lastError: null }
    })
  },

  skipTribute: playerId => {
    set(current => {
      const result = skipTribute(current.state, playerId)
      return result.error ? { lastError: result.error } : { state: result.state, lastError: null }
    })
  },

  tickAI: () => {
    set(current => {
      if (current.state.phase === 'tribute') {
        const state = resolveAITribute(current.state)
        return state === current.state ? current : { state, lastError: null }
      }
      const player = current.state.players[current.state.currentPlayerIdx]
      if (!player || !player.isAI || player.isOut) return current
      const move = pickAIMove(current.state, player, player.aiDifficulty ?? 'medium')
      const result = move.type === 'play' && move.cards
        ? playCards(current.state, player.id, move.cards)
        : pickUpPile(current.state, player.id)
      return result.error ? { lastError: result.error } : { state: result.state, lastError: null }
    })
  },

  revealFor: playerId => set({ revealedId: playerId }),
  hideViewer: () => set({ revealedId: null }),
  clearError: () => set({ lastError: null }),

  rematch: () => {
    const current = get()
    if (current.configs.length === 0) return
    const previousRound = current.state.winnerId && current.state.loserId
      ? { winnerId: current.state.winnerId, loserId: current.state.loserId }
      : null
    const round = makeRound(current.configs, current.rules, previousRound)
    set({ ...round, revealedId: null, lastError: null })
  },

  reset: () => set({
    state: emptyState(),
    rules: { ...DEFAULT_GAME_RULES },
    meId: null,
    revealedId: null,
    readyIds: [],
    lastError: null,
    configs: [],
  }),
}))
