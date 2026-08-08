import type { Card, GameState, Player } from './types'
import { canPlay, isQuartet, playClearsPile } from './rules'

export type Move = { type: 'play'; cards: Card[] } | { type: 'pickUp' }

// AI: pick a legal move. Easy = random, Medium = prefer keeping low cards, Hard = strategic.
export function pickAIMove(player: Player, state: GameState, difficulty: 'easy' | 'medium' | 'hard'): Move {
  const topCard = state.pile.length > 0 ? state.pile[state.pile.length - 1].cards[0] : null
  const topRank = topCard?.rank ?? null

  const hand = [...player.hand]
  const playable = hand.filter(c => canPlay(c, topRank))

  if (playable.length === 0) return { type: 'pickUp' }

  if (difficulty === 'easy') {
    // Random
    const card = playable[Math.floor(Math.random() * playable.length)]
    return { type: 'play', cards: [card] }
  }

  if (difficulty === 'medium') {
    // Play lowest legal card to save high cards
    const sorted = [...playable].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
    // But try to save 2s and 10s for emergencies
    const nonSpecial = sorted.filter(c => c.rank !== '2' && c.rank !== '10' && c.rank !== 'JOKER')
    if (nonSpecial.length > 0) return { type: 'play', cards: [nonSpecial[0]] }
    return { type: 'play', cards: [sorted[0]] }
  }

  // Hard: prefer to clear pile if pile is huge, save 10 for big piles, etc.
  const pileSize = state.pile.reduce((sum, e) => sum + (e.cleared ? 0 : e.cards.length), 0)
  // Look for quartets in hand
  const quartet = findQuartet(hand)
  if (quartet && pileSize >= 3) return { type: 'play', cards: quartet }

  // Play 10 if pile is large (≥5 cards)
  const ten = playable.find(c => c.rank === '10')
  if (ten && pileSize >= 5) return { type: 'play', cards: [ten] }

  // Play 2 only if top is high and 2 is the only option, or to reset after a streak
  const two = playable.find(c => c.rank === '2')
  if (two && pileSize >= 4 && !playable.some(c => c.rank !== '2')) {
    return { type: 'play', cards: [two] }
  }

  // Otherwise lowest non-special
  const sorted = [...playable].sort((a, b) => rankValue(a.rank) - rankValue(b.rank))
  const nonSpecial = sorted.filter(c => c.rank !== '2' && c.rank !== '10' && c.rank !== 'JOKER')
  return { type: 'play', cards: [nonSpecial[0] ?? sorted[0]] }
}

function rankValue(rank: Card['rank']): number {
  const order: Record<string, number> = { '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':99,'JOKER':100 }
  return order[rank] ?? 0
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
