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
    <div className="app-viewport bg-felt text-cream flex flex-col table-select-none">
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />

      <header className="px-s4 pt-s2 text-center">
        <div className="text-label font-bold tracking-label uppercase text-cream-dim">Rearrange phase</div>
        <div className="font-display text-title font-semibold mt-s1">{player.name}</div>
        <p className="text-feed text-cream-dim mt-s1 min-h-[18px]">
          {waitingForOthers
            ? 'Waiting for the rest of the table…'
            : selectedHand !== null
              ? 'Tap a face-up card to swap'
              : 'Tap a hand card, then a face-up card, to swap them'}
        </p>
      </header>

      <main className="flex-1 flex flex-col justify-center min-h-0">
        <TableauWell
          faceUp={player.faceUp}
          faceDown={player.faceDown}
          fullSize
          faceUpStates={upStates}
          faceUpHints={upHints}
          onActivateFaceUp={!waitingForOthers && selectedHand !== null ? onFaceUpId : undefined}
        />
      </main>

      <footer className="app-bottom-zone">
        <div className="px-s4 min-h-[var(--actionbar-h)] flex items-center">
          <button
            type="button"
            onClick={onReady}
            disabled={waitingForOthers}
            className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1 disabled:opacity-50"
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
