// ============================================================================
// The computer player's policy for offline rounds — pure, like the engine it
// plays. It only reads the public rules (which zone is in play, what beats the
// pile), so a move it returns is legal by construction.
// ============================================================================
import {
  RANK_ORDER, activeZone, canPlay, getPhysicalTopRun, getTopRank, isQuartet, pileSize,
  type Card, type GameState, type Player, type Rank,
} from './index'

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
