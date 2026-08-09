// ============================================================================
// RearrangeScreen — tap a hand card (marks with the selected visual), tap a
// face-up card to swap (§6.2, preserved pattern). Shared by SP and MP.
// ============================================================================
import { useCallback, useRef, useState } from 'react'
import type { Player } from '../engine'
import { CardDefs, type CardVisualState } from './Card'
import { HandFan } from './HandFan'
import { TableauWell } from './TableauWell'
import { Announcer, useAnnouncer } from './Announcer'

export interface RearrangeScreenProps {
  player: Player
  onSwap: (handIdx: number, upIdx: number) => void
  onReady: () => void
  /** MP: already readied — waiting for the rest of the room. */
  waitingForOthers?: boolean
}

export function RearrangeScreen({ player, onSwap, onReady, waitingForOthers }: RearrangeScreenProps) {
  const [selectedHand, setSelectedHand] = useState<number | null>(null)
  const announcer = useAnnouncer()

  const onSwapRef = useRef(onSwap)
  onSwapRef.current = onSwap

  const handStates = new Map<string, CardVisualState>()
  const handHints = new Map<string, string>()
  player.hand.forEach((c, i) => {
    if (selectedHand === i) { handStates.set(c.id, 'selected'); handHints.set(c.id, 'marked to swap') }
    else if (!waitingForOthers) { handStates.set(c.id, 'playable'); handHints.set(c.id, 'tap to mark') }
  })
  const upStates = new Map<string, CardVisualState>()
  const upHints = new Map<string, string>()
  if (selectedHand !== null && !waitingForOthers) {
    player.faceUp.forEach(c => { upStates.set(c.id, 'joinable'); upHints.set(c.id, 'tap to swap') })
  }

  const onHandId = useCallback((id: string) => {
    const idx = player.hand.findIndex(c => c.id === id)
    if (idx === -1) return
    setSelectedHand(sel => {
      const next = sel === idx ? null : idx
      announcer.sayPolite(next === null ? 'Card unmarked' : `${player.hand[next].rank} marked — tap a face-up card to swap`)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.hand])

  const onFaceUpId = useCallback((id: string) => {
    const upIdx = player.faceUp.findIndex(c => c.id === id)
    if (upIdx === -1) return
    setSelectedHand(sel => {
      if (sel !== null) {
        onSwapRef.current(sel, upIdx)
        announcer.sayPolite('Cards swapped')
      }
      return null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.faceUp])

  return (
    <div
      className="app-viewport last-call-screen phase-screen phase-screen--rearrange rearrange-screen bg-felt text-cream flex flex-col table-select-none overflow-y-auto"
      data-waiting={waitingForOthers ? 'true' : 'false'}
      data-selection={selectedHand === null ? 'none' : 'hand'}
    >
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />

      <header className="phase-header rearrange-header px-s4 pt-s2 text-center">
        <div className="phase-header__kicker text-label font-bold tracking-label uppercase text-cream-dim">Final row · {player.name}</div>
        <h1 className="phase-header__title font-display text-title font-semibold mt-s1">Choose your final three</h1>
        <p className="phase-header__copy text-feed text-cream-dim mt-s1 min-h-[18px]" role="status">
          {waitingForOthers
            ? 'Waiting for the rest of the table…'
            : selectedHand !== null
              ? 'Tap a face-up card to swap'
              : 'Tap a hand card, then a face-up card, to swap them'}
        </p>
      </header>

      <main className="phase-main rearrange-main flex-1 flex flex-col justify-center min-h-0">
        <TableauWell
          faceUp={player.faceUp}
          faceDown={player.faceDown}
          fullSize
          faceUpStates={upStates}
          faceUpHints={upHints}
          onActivateFaceUp={!waitingForOthers && selectedHand !== null ? onFaceUpId : undefined}
        />
      </main>

      <footer className="app-bottom-zone phase-footer rearrange-footer">
        <div className="phase-footer__actions px-s4 min-h-[var(--actionbar-h)] flex items-center">
          <button
            type="button"
            onClick={onReady}
            disabled={waitingForOthers}
            className="phase-action phase-action--primary primary-action w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
          >
            {waitingForOthers ? 'Ready ✓' : 'Ready to play'}
          </button>
        </div>
        <HandFan
          cards={player.hand}
          states={handStates}
          ariaHints={handHints}
          onSelect={waitingForOthers ? undefined : onHandId}
        />
      </footer>
    </div>
  )
}
