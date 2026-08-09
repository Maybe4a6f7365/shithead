// ============================================================================
// ActionBar (Z4) — 48px, directly above the hand fan / home indicator (§3.1).
// PICK UP = ghost (button style, cream 80%, no fill); PLAY = burgundy primary,
// label carries the count, ABSENT (not disabled) with no selection.
// ============================================================================
import clsx from 'clsx'

export interface ActionBarProps {
  selectionCount: number
  canPickUp: boolean
  pickupArmed: boolean
  onPlay: () => void
  onPickUp: () => void
}

export function ActionBar({ selectionCount, canPickUp, pickupArmed, onPlay, onPickUp }: ActionBarProps) {
  return (
    <div className="flex items-center justify-between gap-s3 px-s4 min-h-[var(--actionbar-h)]">
      {selectionCount === 0 ? (
        canPickUp && (
          <button
            type="button"
            onClick={onPickUp}
            className={clsx(
              'mx-auto min-h-[48px] min-w-[88px] px-s4 text-button font-bold tracking-button uppercase',
              pickupArmed ? 'text-gold-bright' : 'text-cream/80',
            )}
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
            className="min-h-[48px] min-w-[88px] px-s4 text-button font-bold tracking-button uppercase text-cream/80 disabled:opacity-40"
          >
            Pick up
          </button>
          <button
            type="button"
            onClick={onPlay}
            className="min-h-[48px] min-w-[88px] px-s5 rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
          >
            Play{selectionCount > 1 ? ` ${selectionCount}×` : ''}
          </button>
        </>
      )}
    </div>
  )
}
