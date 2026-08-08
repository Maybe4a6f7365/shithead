// ============================================================================
// Single-player store — zustand-backed wrapper around the pure engine
// Used for hot-seat play against AI bots.
// ============================================================================
import { create } from 'zustand'
import {
  type Card, type GameState, type Player,
  initGame, rearrange, startPlay, playCards, pickUpPile, pickAIMove,
} from '../engine'

interface InitPlayer { name: string; isAI: boolean; difficulty?: 'easy'|'medium'|'hard' }

interface SPState {
  state: GameState
  initGame: (players: InitPlayer[]) => void
  endRearrange: (playerId: string) => void
  rearrange: (playerId: string, handIdx: number, upIdx: number) => void
  playCards: (playerId: string, cards: Card[]) => void
  pickUpPile: (playerId: string) => void
  tickAI: () => void
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

export const useSPGame = create<SPState>((set, get) => ({
  state: emptyState(),

  initGame: (configs) => {
    const playerConfigs = configs.map(c => ({
      id: crypto.randomUUID(),
      name: c.name,
      isAI: c.isAI,
      aiDifficulty: c.difficulty,
    }))
    const newState = initGame({ players: playerConfigs })
    set({ state: newState })
  },

  endRearrange: (playerId) => {
    set(s => ({ state: startPlay(s.state) }))
  },

  rearrange: (playerId, handIdx, upIdx) => {
    set(s => ({ state: rearrange(s.state, playerId, handIdx, upIdx) }))
  },

  playCards: (playerId, cards) => {
    set(s => {
      const result = playCards(s.state, playerId, cards)
      if (result.error) return s
      return { state: result.state }
    })
  },

  pickUpPile: (playerId) => {
    set(s => {
      const result = pickUpPile(s.state, playerId)
      if (result.error) return s
      return { state: result.state }
    })
  },

  tickAI: () => {
    set(s => {
      const cur = s.state.players[s.state.currentPlayerIdx]
      if (!cur || !cur.isAI || cur.isOut) return s
      const move = pickAIMove(s.state, cur, cur.aiDifficulty ?? 'medium')
      if (move.type === 'play' && move.cards) {
        const result = playCards(s.state, cur.id, move.cards)
        if (result.error) return s
        return { state: result.state }
      } else {
        const result = pickUpPile(s.state, cur.id)
        if (result.error) return s
        return { state: result.state }
      }
    })
  },

  reset: () => set({ state: emptyState() }),
}))
