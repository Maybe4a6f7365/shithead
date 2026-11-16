// ============================================================================
// Selection rules for the viewer's cards — pure, shared by the play draft and
// the tap handler.
// ============================================================================
import type { Card as CardT, Rank } from '../../engine'
import { canPlay } from '../../engine'

/** The one row of the viewer's cards that is in play right now (D6). */
export type Zone = 'hand' | 'faceUp' | 'faceDown'

export function activeZoneOf(p: { hand: CardT[]; faceUp: CardT[]; faceDown: CardT[] }): Zone {
  if (p.hand.length > 0) return 'hand'
  if (p.faceUp.length > 0) return 'faceUp'
  return 'faceDown'
}

/**
 * Same-rank cards form a multi-play. Choosing another playable rank replaces
 * the whole set in one tap, so the interface never traps the user behind a
 * separate "unselect" step.
 */
export function nextRankSelection(selection: string[], tapped: CardT, cards: CardT[]): string[] {
  if (selection.includes(tapped.id)) return selection.filter(id => id !== tapped.id)
  const selected = cards.find(card => selection.includes(card.id))
  if (selected && selected.rank !== tapped.rank) return [tapped.id]
  return [...selection, tapped.id]
}

/**
 * Revalidate a local hand/face-up draft against the latest authoritative pile.
 * A multi-card choice is atomic: ownership, rank, or legality changes clear the
 * complete draft rather than silently playing only the surviving subset.
 */
export function reconcilePlayableSelection(
  selection: string[],
  cards: CardT[],
  topRank: Rank | null,
): string[] {
  if (selection.length === 0) return selection
  if (new Set(selection).size !== selection.length) return []
  const byId = new Map(cards.map(card => [card.id, card] as const))
  const selected = selection.flatMap(id => {
    const card = byId.get(id)
    return card ? [card] : []
  })
  if (selected.length !== selection.length) return []
  if (selected.some(card => card.rank !== selected[0].rank)) return []
  if (selected.some(card => !canPlay(card, topRank))) return []
  return selection
}

export function sameSelection(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}
