// ============================================================================
// The viewer's play draft: the cards they have selected but not yet played,
// and the armed pick-up guard. A draft survives harmless table updates and is
// dropped as a whole the moment it stops being a complete legal play.
// ============================================================================
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Card as CardT, GameState, Rank } from '../../engine'
import { reconcilePlayableSelection, sameSelection, type Zone } from './selection'

const NO_SELECTION: string[] = []

export interface PlayDraftArgs {
  phase: GameState['phase']
  /** Advances with every accepted action. */
  actionSeq: number
  viewerId: string
  viewerActive: boolean
  zone: Zone | null
  zoneCards: CardT[]
  topRank: Rank | null
  /** Explain in the feed and to assistive tech why a draft was dropped. */
  onDraftDropped: (text: string) => void
}

export function usePlayDraft({
  phase, actionSeq, viewerId, viewerActive, zone, zoneCards, topRank, onDraftDropped,
}: PlayDraftArgs) {
  const [stored, setSelection] = useState<string[]>(NO_SELECTION)
  const [pickupArmed, setPickupArmed] = useState(false)
  // Pass-and-play reuses one mounted table for several viewers: a draft never
  // crosses from one viewer to the next.
  const owner = useRef(viewerId)
  const owned = owner.current === viewerId ? stored : NO_SELECTION
  const inPlay = phase === 'play' || phase === 'endgame'

  // What the draft is worth against the table as it stands now. The stored
  // draft catches up in the effect below; rendering never shows a stale one.
  const selection = useMemo(() => {
    if (!inPlay) return NO_SELECTION
    if (zone === 'faceDown') {
      // Blind plays are single cards (D7) and exist only on the viewer's turn.
      return viewerActive && owned.length <= 1 &&
        owned.every(id => zoneCards.some(card => card.id === id))
        ? owned
        : NO_SELECTION
    }
    return reconcilePlayableSelection(owned, zoneCards, topRank)
  }, [owned, inPlay, topRank, viewerActive, zone, zoneCards])
  const selectedCards = useMemo(
    () => zoneCards.filter(card => selection.includes(card.id)),
    [selection, zoneCards],
  )

  // Keep an off-turn draft across harmless actions. Reconcile it against each
  // authoritative hand/pile update and clear it only when it is no longer a
  // complete legal play (or the private hot-seat viewer changes).
  useEffect(() => {
    if (owner.current !== viewerId) {
      owner.current = viewerId
      setSelection(NO_SELECTION)
      setPickupArmed(false)
      return
    }
    setSelection(current => {
      let next: string[]
      if (phase !== 'play' && phase !== 'endgame') next = NO_SELECTION
      else if (zone === 'faceDown') {
        next = viewerActive && current.length <= 1 &&
          current.every(id => zoneCards.some(card => card.id === id))
          ? current
          : NO_SELECTION
      } else {
        next = reconcilePlayableSelection(current, zoneCards, topRank)
      }
      return sameSelection(current, next) ? current : next
    })
    setPickupArmed(false)
  }, [phase, topRank, viewerActive, viewerId, zone, zoneCards])

  // The effect above clears a dropped draft in the same commit; this one only
  // explains why its highlight disappeared, once per draft and action.
  const dropped = owned.length > 0 && selection.length === 0 && zone !== 'faceDown' && inPlay
  const droppedNoticeKey = useRef('')
  // Runs when a draft is dropped, not when the draft or the callback changes.
  const noticeDroppedDraft = useEffectEvent(() => {
    const key = `${viewerId}:${actionSeq}:${owned.join(',')}`
    if (droppedNoticeKey.current === key) return
    droppedNoticeKey.current = key
    onDraftDropped('Prepared cards no longer fit the pile — choose again')
  })
  useEffect(() => {
    if (dropped) noticeDroppedDraft()
    else droppedNoticeKey.current = ''
  }, [dropped, actionSeq, viewerId])

  return { selection, selectedCards, setSelection, pickupArmed, setPickupArmed }
}
