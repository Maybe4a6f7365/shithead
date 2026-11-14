// ============================================================================
// Single-player / pass-and-play store. Seats keep stable ids across rounds so
// the previous winner/last-place exchange can be carried into a rematch.
// ============================================================================
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  DEFAULT_GAME_RULES,
  RANK_ORDER,
  type Card,
  type GameRules,
  type GameState,
  type Player,
  type PreviousRoundResult,
  exchangeFaceUpCards,
  getQuickFollowUpCards,
  interruptBurn,
  initGame,
  pickAIMove,
  pickUpPile,
  playCards,
  quickFollowUp as applyQuickFollowUp,
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
  quickFollowUp: (playerId: string, card: Card) => void
  interruptBurn: (playerId: string, cards: Card[]) => void
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
    pendingQuickFollowUp: null,
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
  if (card.rank === '3') return 70
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

// ---------- Persistence ----------
// A pass-and-play round lives only on this device. Keep it across a reload —
// an app update, a pull-to-refresh, the OS discarding the tab — the way a
// multiplayer seat is resumed from the server.

export const SP_STORAGE_KEY = 'shithead:local-round'
/** Bump when the engine's GameState shape changes incompatibly. */
export const SP_STORAGE_VERSION = 1

const memoryStorage = (): StateStorage => {
  const values = new Map<string, string>()
  return {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => { values.set(name, value) },
    removeItem: name => { values.delete(name) },
  }
}

function safeLocalStorage(): StateStorage {
  try {
    if (typeof localStorage === 'undefined') return memoryStorage()
    const fallback = memoryStorage()
    // Private modes and full quotas throw on access; a lost save must never
    // break the round in progress.
    return {
      getItem: name => { try { return localStorage.getItem(name) } catch { return fallback.getItem(name) } },
      setItem: (name, value) => { try { localStorage.setItem(name, value) } catch { fallback.setItem(name, value) } },
      removeItem: name => { try { localStorage.removeItem(name) } catch { fallback.removeItem(name) } },
    }
  } catch {
    return memoryStorage()
  }
}

type PersistedRound = Pick<SPState, 'state' | 'rules' | 'meId' | 'readyIds' | 'configs'>

const PHASES: ReadonlyArray<GameState['phase']> = ['lobby', 'rearrange', 'tribute', 'play', 'endgame', 'roundEnd', 'gameOver']
const isCardList = (value: unknown): boolean =>
  Array.isArray(value) && value.every(card =>
    typeof card === 'object' && card !== null && typeof (card as Card).id === 'string' &&
    typeof (card as Card).rank === 'string')

/** Accept only a snapshot the current table can render; anything else is dropped. */
export function isResumableRound(value: unknown): value is PersistedRound {
  if (typeof value !== 'object' || value === null) return false
  const round = value as Partial<PersistedRound>
  const state = round.state
  if (typeof state !== 'object' || state === null) return false
  if (!PHASES.includes(state.phase) || state.phase === 'lobby') return false
  if (!Array.isArray(state.players) || state.players.length < 2) return false
  if (!state.players.every(player =>
    typeof player === 'object' && player !== null && typeof player.id === 'string' &&
    typeof player.name === 'string' &&
    isCardList(player.hand) && isCardList(player.faceUp) && isCardList(player.faceDown))) return false
  if (!isCardList(state.stock) || !isCardList(state.pile) || !Array.isArray(state.log)) return false
  if (!Number.isInteger(state.currentPlayerIdx) ||
    state.currentPlayerIdx < 0 || state.currentPlayerIdx >= state.players.length) return false
  if (typeof state.rules !== 'object' || state.rules === null) return false
  if (typeof round.rules !== 'object' || round.rules === null) return false
  if (!Array.isArray(round.readyIds) || !Array.isArray(round.configs)) return false
  return round.meId === null || state.players.some(player => player.id === round.meId)
}

/** True when a reload should land back on the local table. */
export function hasResumableLocalRound(): boolean {
  return useSPGame.getState().state.phase !== 'lobby'
}

export const useSPGame = create<SPState>()(persist((set, get) => ({
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
      const keepsQuickWindow = result.state.pendingQuickFollowUp?.playerId === playerId
      return {
        state: result.state,
        lastError: null,
        revealedId: keepsQuickWindow ? (current.revealedId ?? playerId) : turnMoved ? null : current.revealedId,
      }
    })
  },

  quickFollowUp: (playerId, card) => {
    set(current => {
      const result = applyQuickFollowUp(current.state, playerId, [card])
      if (result.error) return { lastError: result.error }
      const keepsQuickWindow = result.state.pendingQuickFollowUp?.playerId === playerId
      return {
        state: result.state,
        lastError: null,
        revealedId: keepsQuickWindow ? (current.revealedId ?? playerId) : null,
      }
    })
  },

  interruptBurn: (playerId, cards) => {
    set(current => {
      const result = interruptBurn(current.state, playerId, cards)
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
      const pending = current.state.pendingQuickFollowUp
      if (pending) {
        const quickPlayer = current.state.players.find(player => player.id === pending.playerId)
        const quickCard = quickPlayer?.isAI
          ? getQuickFollowUpCards(current.state, quickPlayer.id)[0]
          : undefined
        if (quickPlayer?.isAI && quickCard) {
          const result = applyQuickFollowUp(current.state, quickPlayer.id, [quickCard])
          return result.error ? { lastError: result.error } : { state: result.state, lastError: null }
        }
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
}), {
  name: SP_STORAGE_KEY,
  version: SP_STORAGE_VERSION,
  storage: createJSONStorage(safeLocalStorage),
  // revealedId is deliberately left out: after a reload the pass gate must
  // come back before any hand other than the device owner's is shown.
  partialize: (current): PersistedRound => ({
    state: current.state,
    rules: current.rules,
    meId: current.meId,
    readyIds: current.readyIds,
    configs: current.configs,
  }),
  // A snapshot from another storage version is not migrated, only dropped.
  migrate: () => ({}) as PersistedRound,
  merge: (persisted, current) => (isResumableRound(persisted) ? { ...current, ...persisted } : current),
}))
