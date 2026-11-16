// ============================================================================
// How each of the viewer's cards looks and reads right now — pure.
//
// One card gets one state. The order of the rules below is the priority: an
// offered quick follow-up or burn-in outranks a selection, a selection outranks
// a remembered invalid tap, and only then does plain playability decide.
// ============================================================================
import type { Card as CardT, Player } from '../../engine'
import type { CardVisualState } from '../Card'
import type { Zone } from './selection'

export interface CardStatesInput {
  viewer: Pick<Player, 'hand' | 'faceUp' | 'faceDown'>
  zone: Zone | null
  zoneCards: CardT[]
  viewerActive: boolean
  selection: string[]
  /** Rank of the cards already selected, if any. */
  selectedRank: CardT['rank'] | null
  /** The card that was just tapped although it cannot be played. */
  invalidId: string | null
  /** Out-of-turn completion of the top run is on offer. */
  canBurnIn: boolean
  interruptIds: ReadonlySet<string>
  quickFollowUpIds: ReadonlySet<string>
  /** The quick follow-up is the action on offer (nothing else is selected). */
  quickActionVisible: boolean
  /** Off turn, the viewer may prepare their next play. */
  canPreselect: boolean
  playable: (card: CardT) => boolean
}

export interface CardStates {
  /** Hand and face-up cards. */
  states: Map<string, CardVisualState>
  hints: Map<string, string>
  /** Face-down cards, live only once they are the zone in play. */
  downStates: Map<string, CardVisualState>
  downHints: Map<string, string>
}

export function viewerCardStates({
  viewer, zone, zoneCards, viewerActive, selection, selectedRank, invalidId,
  canBurnIn, interruptIds, quickFollowUpIds, quickActionVisible, canPreselect, playable,
}: CardStatesInput): CardStates {
  const states = new Map<string, CardVisualState>()
  const hints = new Map<string, string>()
  const selected = new Set(selection)
  const inZone = new Set(zoneCards.map(card => card.id))
  const set = (card: CardT, state: CardVisualState, hint?: string) => {
    states.set(card.id, state)
    if (hint) hints.set(card.id, hint)
  }

  for (const card of [...viewer.hand, ...viewer.faceUp]) {
    if (quickActionVisible && quickFollowUpIds.has(card.id)) {
      set(card, 'joinable', 'matching card, quick follow-up available')
    } else if (canBurnIn && interruptIds.has(card.id)) {
      set(card, 'joinable', 'can burn in now')
    } else if (selected.has(card.id)) {
      set(card, 'selected', viewerActive ? 'selected' : 'selected for your next turn')
    } else if (quickFollowUpIds.has(card.id)) {
      set(card, 'joinable', 'matching card, quick follow-up available')
    } else if (invalidId === card.id) {
      set(card, 'invalid', 'not playable')
    } else if (!viewerActive) {
      if (interruptIds.has(card.id)) {
        set(card, 'joinable', 'can burn in now')
      } else if (canPreselect && inZone.has(card.id)) {
        set(card, 'rest', playable(card) ? 'available to select for your next turn' : 'not playable on the current pile')
      } else {
        set(card, 'rest')
      }
    } else if (zone === 'faceDown' || !inZone.has(card.id)) {
      set(card, 'rest')
    } else if (!playable(card)) {
      set(card, 'disabled', 'not playable')
    } else if (selectedRank && card.rank !== selectedRank) {
      set(card, 'playable', 'playable, replaces selection')
    } else if (selectedRank) {
      set(card, 'joinable', 'playable')
    } else {
      set(card, 'playable', 'playable')
    }
  }

  const downStates = new Map<string, CardVisualState>()
  const downHints = new Map<string, string>()
  if (viewerActive && zone === 'faceDown') {
    for (const card of viewer.faceDown) {
      downStates.set(card.id, selected.has(card.id) ? 'selected' : 'playable')
      downHints.set(card.id, selected.has(card.id) ? 'selected' : 'blind play')
    }
  }

  return { states, hints, downStates, downHints }
}
