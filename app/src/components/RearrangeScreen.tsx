// ============================================================================
// RearrangeScreen — tap a hand card (marks with the selected visual), tap a
// face-up card to swap (§6.2, preserved pattern). Shared by SP and MP.
// ============================================================================
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Player } from '../engine'
import { CardDefs, type CardVisualState } from './Card'
import { HandFan } from './HandFan'
import { TableauWell } from './TableauWell'
import { Announcer, useAnnouncer } from './Announcer'
import { claimDeal, dealIn, holdFlips } from './cardFlight'

export interface RearrangeScreenProps {
  player: Player
  onSwap: (handIdx: number, upIdx: number) => void
  onReady: () => void
  /** MP: already readied — waiting for the rest of the room. */
  waitingForOthers?: boolean
}

export function RearrangeScreen({ player, onSwap, onReady, waitingForOthers }: RearrangeScreenProps) {
  const [selectedHand, setSelectedHand] = useState<number | null>(null)
  const { polite, assertive, sayPolite } = useAnnouncer()

  // Opening deal: cards fly in from the dealer, once per set of dealt cards.
  // Pass 1 decides and pauses the hand FLIP; pass 2 (after the hand has
  // measured itself) reads real positions and deals.
  const screenRef = useRef<HTMLDivElement>(null)
  const dealing = useRef(false)
  const [dealReady, setDealReady] = useState(false)
  // The cards this screen opened with: later swaps are not a new deal.
  const [dealKey] = useState(() => {
    const cards = [...player.hand, ...player.faceUp, ...player.faceDown].map(card => card.id).sort().join('|')
    return `${player.id}:${cards}`
  })
  useLayoutEffect(() => {
    const reduceMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Sticky: StrictMode re-runs this effect, and the second claim would fail.
    dealing.current = dealing.current || (!reduceMotion && claimDeal(dealKey))
    if (dealing.current) holdFlips(900)
    setDealReady(true)
  }, [dealKey])
  useLayoutEffect(() => {
    const screen = screenRef.current
    if (!dealReady || !screen || !dealing.current) return
    const origin = { left: window.innerWidth / 2 - 30, top: -110, width: 60, height: 84 }
    const deal = dealIn(screen, origin)
    if (!deal) return
    const skip = () => deal.skip()
    screen.addEventListener('pointerdown', skip, { once: true })
    const timer = window.setTimeout(() => screen.removeEventListener('pointerdown', skip), deal.total + 50)
    return () => {
      window.clearTimeout(timer)
      screen.removeEventListener('pointerdown', skip)
      deal.cancel()
    }
  }, [dealReady])

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

  // Selection lives in a ref as well, so the handlers can read it without
  // doing side effects (swap, announce) inside a state updater, which React
  // StrictMode runs twice in development.
  const selectedRef = useRef<number | null>(null)
  selectedRef.current = selectedHand

  const onHandId = useCallback((id: string) => {
    const idx = player.hand.findIndex(c => c.id === id)
    if (idx === -1) return
    const next = selectedRef.current === idx ? null : idx
    sayPolite(next === null ? 'Card unmarked' : `${player.hand[next].rank} marked — tap a face-up card to swap`)
    selectedRef.current = next
    setSelectedHand(next)
  }, [player.hand, sayPolite])

  const onFaceUpId = useCallback((id: string) => {
    const upIdx = player.faceUp.findIndex(c => c.id === id)
    if (upIdx === -1) return
    const selected = selectedRef.current
    if (selected !== null) {
      onSwapRef.current(selected, upIdx)
      sayPolite('Cards swapped')
    }
    selectedRef.current = null
    setSelectedHand(null)
  }, [player.faceUp, sayPolite])

  return (
    <div
      ref={screenRef}
      className="app-viewport last-call-screen phase-screen phase-screen--rearrange rearrange-screen bg-felt text-cream flex flex-col table-select-none overflow-y-auto"
      data-waiting={waitingForOthers ? 'true' : 'false'}
      data-selection={selectedHand === null ? 'none' : 'hand'}
    >
      <CardDefs />
      <Announcer polite={polite} assertive={assertive} />

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
