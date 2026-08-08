import type { Card, Rank, Suit } from './types'

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// Rank order for comparison (low → high). 2 is lowest because it's WILD (resets), not highest.
export const RANK_ORDER: Record<Rank, number> = {
  '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6,
  '10': 7, 'J': 8, 'Q': 9, 'K': 10, 'A': 11,
  '2': -1,  // wild — always playable
  'JOKER': -2  // also wild in this variant
}

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

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Fisher–Yates with optional seeded RNG for tests
export function shuffleSeeded<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
