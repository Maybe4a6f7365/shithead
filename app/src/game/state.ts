import { create } from 'zustand'
import type { Card, GameState, GameEvent, Player, GamePhase } from './types'
import { makeDeck, shuffle } from './deck'
import { canPlay, playClearsPile } from './rules'

interface StoreState {
  state: GameState
  initGame: (playerNames: { name: string; isAI: boolean; difficulty?: 'easy'|'medium'|'hard' }[]) => void
  playCards: (playerId: string, cards: Card[]) => void
  pickUpPile: (playerId: string) => void
  rearrange: (playerId: string, handIdx: number, upIdx: number) => void
  endRearrange: (playerId: string) => void
  reset: () => void
}

function makePlayer(name: string, isAI: boolean, difficulty?: 'easy'|'medium'|'hard', id: string = crypto.randomUUID()): Player {
  return { id, name, isAI, aiDifficulty: difficulty, hand: [], faceUp: [], faceDown: [], isOut: false }
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
    winner: null,
    log: []
  }
}

export const useGame = create<StoreState>((set, get) => ({
  state: emptyState(),

  initGame: (configs) => {
    const deck = shuffle(makeDeck(true))
    const players: Player[] = configs.map((c, i) => makePlayer(c.name, c.isAI, c.difficulty))
    // Deal 9 cards each: 3 face-down, 3 face-up, 3 in hand
    let idx = 0
    for (let p = 0; p < players.length; p++) {
      const down: Card[] = []
      const up: Card[] = []
      const hand: Card[] = []
      for (let i = 0; i < 3; i++) down.push({ ...deck[idx++], faceDown: true })
      for (let i = 0; i < 3; i++) up.push(deck[idx++])
      for (let i = 0; i < 3; i++) hand.push(deck[idx++])
      players[p] = { ...players[p], faceDown: down, faceUp: up, hand }
    }
    const stock = deck.slice(idx)

    // Find eldest hand: player with a 3 face-up
    let startIdx = players.findIndex(p => p.faceUp.some(c => c.rank === '3'))
    if (startIdx === -1) {
      // Search hand for 3, then 4, etc.
      for (let r = 0; r < 10; r++) {
        const rank = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'][r]
        startIdx = players.findIndex(p => p.hand.some(c => c.rank === rank) || p.faceUp.some(c => c.rank === rank))
        if (startIdx !== -1) break
      }
    }
    if (startIdx === -1) startIdx = 0

    set({
      state: {
        phase: 'rearrange',
        players,
        stock,
        pile: [],
        currentPlayerIdx: startIdx,
        playDirection: 1,
        turnCount: 0,
        winner: null,
        log: [{ type: 'PHASE_CHANGE', phase: 'rearrange' }]
      }
    })
  },

  rearrange: (playerId, handIdx, upIdx) => {
    set(s => {
      const players = s.state.players.map(p => {
        if (p.id !== playerId) return p
        const hand = [...p.hand]
        const up = [...p.faceUp]
        ;[hand[handIdx], up[upIdx]] = [up[upIdx], hand[handIdx]]
        return { ...p, hand, faceUp: up }
      })
      return { state: { ...s.state, players } }
    })
  },

  endRearrange: (playerId) => {
    const state = get().state
    // Mark this player as done rearranging by moving on; for simplicity,
    // we end rearrange after the first player (human or AI) confirms.
    // This keeps the flow tight — players can still rearrange in real time.
    set(s => ({
      state: { ...s.state, phase: 'play', log: [...s.state.log, { type: 'PHASE_CHANGE', phase: 'play' }] }
    }))
  },

  playCards: (playerId, cards) => {
    set(s => {
      const players = s.state.players.map(p => {
        if (p.id !== playerId) return p
        const hand = p.hand.filter(c => !cards.find(x => x.id === c.id))
        return { ...p, hand }
      })

      const pile = [...s.state.pile]
      if (playClearsPile(cards)) {
        pile.push({ cards, cleared: true })
      } else {
        pile.push({ cards, cleared: false })
      }

      // Check player out (no cards in hand + faceUp + faceDown)
      let updatedPlayers = players.map(p => {
        if (p.id !== playerId) return p
        const remaining = p.hand.length + p.faceUp.length + p.faceDown.length
        if (remaining === 0) return { ...p, isOut: true }
        return p
      })

      // Draw from stock to refill hand to 3
      let stock = [...s.state.stock]
      updatedPlayers = updatedPlayers.map(p => {
        if (p.id !== playerId) return p
        if (p.isOut) return p
        const hand = [...p.hand]
        while (hand.length < 3 && stock.length > 0) {
          hand.push(stock.shift()!)
        }
        return { ...p, hand }
      })

      // If stock is empty and player still has only faceUp/faceDown → endgame
      const phase: GamePhase = stock.length === 0 && updatedPlayers.some(p => p.hand.length === 0 && (p.faceUp.length > 0 || p.faceDown.length > 0))
        ? 'endgame' : s.state.phase === 'endgame' ? 'endgame' : 'play'

      // Advance to next player
      let nextIdx = s.state.currentPlayerIdx
      const activePlayers = updatedPlayers.filter(p => !p.isOut)
      if (activePlayers.length > 0) {
        do {
          nextIdx = (nextIdx + s.state.playDirection + updatedPlayers.length) % updatedPlayers.length
        } while (updatedPlayers[nextIdx].isOut)
      }

      // Check winner (only one player left = loser = Shithead)
      let winner: string | null = s.state.winner
      if (activePlayers.length === 1) {
        winner = activePlayers[0].id
      }

      const log: GameEvent[] = [
        ...s.state.log,
        { type: 'PLAY_CARDS', playerId, cards },
        ...(playClearsPile(cards) ? [{ type: 'CLEAR_PILE' as const, reason: cards.some(c=>c.rank==='10') ? 'ten' as const : 'quartet' as const }] : [])
      ]

      return {
        state: {
          ...s.state,
          players: updatedPlayers,
          stock,
          pile,
          currentPlayerIdx: nextIdx,
          phase,
          turnCount: s.state.turnCount + 1,
          winner,
          log
        }
      }
    })
  },

  pickUpPile: (playerId) => {
    set(s => {
      // Gather all non-cleared pile cards into player's hand
      const collected: Card[] = []
      const newPile: typeof s.state.pile = []
      for (const entry of s.state.pile) {
        if (entry.cleared) newPile.push(entry)
        else collected.push(...entry.cards)
      }
      // Player must have at least 3 cards after pickup, so draw from stock
      let stock = [...s.state.stock]
      while (collected.length < 3 && stock.length > 0) {
        collected.push(stock.shift()!)
      }
      const players = s.state.players.map(p => p.id === playerId ? { ...p, hand: [...p.hand, ...collected] } : p)

      // Advance to next player (skip the picker — they just picked up)
      let nextIdx = s.state.currentPlayerIdx
      const updatedPlayers = players
      const activePlayers = updatedPlayers.filter(p => !p.isOut)
      if (activePlayers.length > 0) {
        do {
          nextIdx = (nextIdx + s.state.playDirection + updatedPlayers.length) % updatedPlayers.length
        } while (updatedPlayers[nextIdx].id === playerId || updatedPlayers[nextIdx].isOut)
      }

      return {
        state: {
          ...s.state,
          players,
          stock,
          pile: newPile,
          currentPlayerIdx: nextIdx,
          turnCount: s.state.turnCount + 1,
          log: [...s.state.log, { type: 'PICK_UP_PILE', playerId }]
        }
      }
    })
  },

  reset: () => set({ state: emptyState() })
}))
