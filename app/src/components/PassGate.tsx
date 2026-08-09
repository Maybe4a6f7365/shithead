// ============================================================================
// PassGate — hot-seat hand privacy (§3.1 "Your identity never moves" +
// pass-and-play). When another human's turn comes on a shared device, their
// cards stay hidden behind this deliberate gate; identity never hot-swaps
// on its own.
// ============================================================================
import { useEffect, useRef } from 'react'
import type { Player } from '../engine'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function PassGate({ player, onReveal }: { player: Player; onReveal: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))

    focusables()[0]?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      ref={dialogRef}
      className="pass-gate fixed inset-0 z-overlay bg-felt flex flex-col items-center justify-center p-s4 text-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Pass the device to ${player.name}`}
      tabIndex={-1}
    >
      <div className="pass-gate__card">
        <div className="pass-gate__deck" aria-hidden="true">
          <span className="pass-gate__card-back pass-gate__card-back--left" />
          <span className="pass-gate__card-back pass-gate__card-back--middle" />
          <span className="pass-gate__card-back pass-gate__card-back--right"><i>S</i></span>
        </div>
        <p className="pass-gate__kicker text-label font-bold tracking-label uppercase text-cream-dim">Hand off</p>
        <h1 className="pass-gate__title font-display text-display font-semibold text-cream">Pass to {player.name}</h1>
        <p className="pass-gate__copy text-body text-cream-dim max-w-[280px]">
          Keep their hand covered until the phone changes hands.
        </p>
        <button
          type="button"
          onClick={onReveal}
          className="primary-action pass-gate__reveal min-w-[120px] px-s6 text-button font-bold tracking-button uppercase"
        >
          Reveal {player.name}'s hand
        </button>
      </div>
    </div>
  )
}
