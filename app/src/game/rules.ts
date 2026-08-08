import type { Card, Rank } from './types'
import { RANK_ORDER } from './deck'

// Returns true if `card` can legally be played on `topRank` (or empty pile).
// Empty pile: only 3 (start card) or 10 or joker can be played.
export function canPlay(card: Card, topRank: Rank | null): boolean {
  if (card.rank === 'JOKER' || card.rank === '2') return true
  if (topRank === null) {
    // Start of pile: must be 3, or 10 (wild-clear), or joker
    const r = card.rank as string
    return r === '3' || r === '10' || r === 'JOKER'
  }
  return RANK_ORDER[card.rank as Rank] >= RANK_ORDER[topRank]
}

// Is this card a "clear" card (empties the pile)?
export function isClearCard(card: Card): boolean {
  return card.rank === '10' || card.rank === 'JOKER'
}

// Does this play form a quartet (4 same rank)?
export function isQuartet(cards: Card[]): boolean {
  if (cards.length !== 4) return false
  if (cards.some(c => c.rank === 'JOKER' || c.rank === '2')) return false
  const first = cards[0].rank
  return cards.every(c => c.rank === first)
}

// Returns true if the played cards clear the pile.
export function playClearsPile(cards: Card[]): boolean {
  if (cards.length === 0) return false
  // Any 10 or joker in the set → clears
  if (cards.some(isClearCard)) return true
  // Quartet clears
  if (isQuartet(cards)) return true
  return false
}
