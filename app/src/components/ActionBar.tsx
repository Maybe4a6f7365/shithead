// ============================================================================
// ActionBar (Z4) — 48px, directly above the hand fan / home indicator (§3.1).
// PICK UP = quiet secondary action; PLAY = coral primary,
// label carries the count, ABSENT (not disabled) with no selection.
// ============================================================================
import clsx from 'clsx'

export interface ActionBarProps {
  selectionCount: number
  canPickUp: boolean
  pickupArmed: boolean
  onPlay: () => void
  onPickUp: () => void
  burnIn?: { count: number; rank: string }
  onBurnIn?: () => void
}

export function ActionBar({ selectionCount, canPickUp, pickupArmed, onPlay, onPickUp, burnIn, onBurnIn }: ActionBarProps) {
  if (burnIn && onBurnIn) {
    return (
      <div
        className="action-bar action-bar--burn-in burn-in-bar flex items-center justify-center gap-s3 px-s4 min-h-[var(--actionbar-h)]"
        role="group"
        aria-label="Interrupt action"
        data-mode="burn-in"
      >
        <button
          type="button"
          onClick={onBurnIn}
          className="action-button action-button--burn burn-in-action min-h-[48px] px-s5 text-button font-bold tracking-button uppercase"
          aria-label={`Burn in with ${burnIn.count} cards of rank ${burnIn.rank}`}
          data-rank={burnIn.rank}
          data-count={burnIn.count}
        >
          Burn in <span aria-hidden="true">· {burnIn.count}× {burnIn.rank}</span>
        </button>
      </div>
    )
  }
  if (selectionCount === 0 && !canPickUp) return null
  return (
    <div
      className={clsx('action-bar flex items-center justify-between gap-s3 px-s4 min-h-[var(--actionbar-h)]', {
        'action-bar--pickup': selectionCount === 0,
        'action-bar--play': selectionCount > 0,
      })}
      role="group"
      aria-label="Turn actions"
      data-mode={selectionCount === 0 ? 'pickup' : 'play'}
      data-selection-count={selectionCount}
    >
      {selectionCount === 0 ? (
        canPickUp && (
          <button
            type="button"
            onClick={onPickUp}
            className={clsx(
              'action-button action-button--pickup mx-auto min-h-[48px] min-w-[88px] px-s4 text-button font-bold tracking-button uppercase',
              pickupArmed ? 'text-gold-bright bg-[var(--color-teal-soft)] rounded-button' : 'text-cream/80',
            )}
            data-armed={pickupArmed ? 'true' : 'false'}
          >
            {pickupArmed ? 'Tap again to confirm' : 'Pick up'}
          </button>
        )
      ) : (
        <>
          <button
            type="button"
            onClick={onPickUp}
            disabled={!canPickUp}
            className="action-button action-button--secondary secondary-action min-w-[96px] px-s4 text-button font-bold tracking-button uppercase text-cream/80 disabled:opacity-40"
          >
            Pick up
          </button>
          <button
            type="button"
            onClick={onPlay}
            className="action-button action-button--primary primary-action min-w-[96px] px-s5 text-button font-bold tracking-button uppercase"
            aria-label={`Play ${selectionCount} selected card${selectionCount === 1 ? '' : 's'}`}
          >
            Play{selectionCount > 1 ? ` ${selectionCount}×` : ''}
          </button>
        </>
      )}
    </div>
  )
}
