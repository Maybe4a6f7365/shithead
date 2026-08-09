// ============================================================================
// Single-player store — zustand-backed thin wrapper around the pure engine.
// Used for hot-seat play against AI bots.
//
// PRIVACY MODEL (Appendix A.1): the bottom panel (Z3/Z4) is pinned to ME —
// the device owner (first human seat). Opponents, human or AI, only ever
// render as backs + counts. Pass-and-play: when another HUMAN's turn comes,
// a privacy gate ("Pass to <name>") must be deliberately revealed before the
// viewer switches — identity never hot-swaps per turn on its own.
// ============================================================================
import { create } from 'zustand'
import {
  type Card, type GameState, type Player,
  initGame, rearrange, startPlay, playCards, pickUpPile, pickAIMove,
} from '../engine'

export interface InitPlayer { name: string; isAI: boolean; difficulty?: 'easy'|'medium'|'hard' }

interface SPState {
  state: GameState
  /** The local device owner — Z3/Z4 always return to this player. */
  meId: string | null
  /** Non-me human whose cards are currently revealed via the pass gate. */
  revealedId: string | null
  /** Players done with the rearrange phase (AI are auto-ready). */
  readyIds: string[]
  /** Last engine rejection — surfaced in the feed, never swallowed. */
  lastError: string | null
  /** Configs from the last initGame, for REMATCH. */
  configs: InitPlayer[]
  initGame: (players: InitPlayer[]) => void
  endRearrange: (playerId: string) => void
  rearrange: (playerId: string, handIdx: number, upIdx: number) => void
  playCards: (playerId: string, cards: Card[]) => void
  pickUpPile: (playerId: string) => void
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
    players: [],
    stock: [],
    pile: [],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 0,
    loserId: null,
    log: [],
  }
}

/**
 * Whose cards the bottom panel may render. Pure + exported for tests.
 * Pinned to meId; switches ONLY to a non-me human who passed the privacy
 * gate AND currently holds the turn.
 */
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

/** True when the current turn needs the pass-and-play privacy gate. */
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

export const useSPGame = create<SPState>((set, get) => ({
  state: emptyState(),
  meId: null,
  revealedId: null,
  readyIds: [],
  lastError: null,
  configs: [],

  initGame: (configs) => {
    const playerConfigs = configs.map(c => ({
      id: crypto.randomUUID(),
      name: c.name,
      isAI: c.isAI,
      aiDifficulty: c.difficulty,
    }))
    const newState = initGame({ players: playerConfigs })
    const meId = playerConfigs.find(p => !p.isAI)?.id ?? playerConfigs[0].id
    set({
      state: newState,
      meId,
      revealedId: null,
      // AI players never rearrange — they are ready from the start.
      readyIds: playerConfigs.filter(p => p.isAI).map(p => p.id),
      lastError: null,
      configs,
    })
  },

  endRearrange: (playerId) => {
    set(s => {
      if (s.state.phase !== 'rearrange') return s
      const readyIds = s.readyIds.includes(playerId) ? s.readyIds : [...s.readyIds, playerId]
      const allReady = s.state.players.every(p => readyIds.includes(p.id))
      return {
        readyIds,
        revealedId: null,
        state: allReady ? startPlay(s.state) : s.state,
      }
    })
  },

  rearrange: (playerId, handIdx, upIdx) => {
    set(s => ({ state: rearrange(s.state, playerId, handIdx, upIdx) }))
  },

  playCards: (playerId, cards) => {
    set(s => {
      const result = playCards(s.state, playerId, cards)
      if (result.error) return { lastError: result.error }
      // The turn moved: any hot-seat reveal ends (cards private again).
      const turnMoved = result.state.currentPlayerIdx !== s.state.currentPlayerIdx
      return { state: result.state, lastError: null, revealedId: turnMoved ? null : s.revealedId }
    })
  },

  pickUpPile: (playerId) => {
    set(s => {
      const result = pickUpPile(s.state, playerId)
      if (result.error) return { lastError: result.error }
      const turnMoved = result.state.currentPlayerIdx !== s.state.currentPlayerIdx
      return { state: result.state, lastError: null, revealedId: turnMoved ? null : s.revealedId }
    })
  },

  tickAI: () => {
    set(s => {
      const cur = s.state.players[s.state.currentPlayerIdx]
      if (!cur || !cur.isAI || cur.isOut) return s
      const move = pickAIMove(s.state, cur, cur.aiDifficulty ?? 'medium')
      const result = move.type === 'play' && move.cards
        ? playCards(s.state, cur.id, move.cards)
        : pickUpPile(s.state, cur.id)
      if (result.error) return { lastError: result.error }
      return { state: result.state, lastError: null }
    })
  },

  revealFor: (playerId) => set({ revealedId: playerId }),
  hideViewer: () => set({ revealedId: null }),
  clearError: () => set({ lastError: null }),

  rematch: () => {
    const { configs } = get()
    if (configs.length > 0) get().initGame(configs)
  },

  reset: () => set({
    state: emptyState(), meId: null, revealedId: null,
    readyIds: [], lastError: null, configs: [],
  }),
}))
