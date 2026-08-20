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
  quickFollowUp?: { count: number; rank: string }
  onQuickFollowUp?: () => void
  onDismissQuickFollowUp?: () => void
  dismissQuickFollowUpLabel?: string
}

export function ActionBar({
  selectionCount, canPickUp, pickupArmed, onPlay, onPickUp,
  burnIn, onBurnIn, quickFollowUp, onQuickFollowUp,
  onDismissQuickFollowUp, dismissQuickFollowUpLabel = 'Normal turn',
}: ActionBarProps) {
  if (selectionCount === 0 && quickFollowUp && onQuickFollowUp) {
    return (
      <div
        className="action-bar action-bar--quick-follow-up quick-follow-up-bar flex items-center justify-center gap-s2 px-s4 min-h-[var(--actionbar-h)]"
        role="group"
        aria-label="Quick follow-up"
        data-mode="quick-follow-up"
      >
        <button
          type="button"
          onClick={onQuickFollowUp}
          className="action-button quick-follow-up-action min-h-[48px] px-s4"
          aria-label={`Play the matching ${quickFollowUp.rank} before the next card`}
          data-rank={quickFollowUp.rank}
          data-count={quickFollowUp.count}
        >
          <span className="action-button__content quick-follow-up-action__content">
            <strong className="action-button__label">Play matching {quickFollowUp.rank}</strong>
            <span className="action-button__meta">Quick match · play now</span>
          </span>
        </button>
        {onDismissQuickFollowUp && (
          <button
            type="button"
            onClick={onDismissQuickFollowUp}
            className="action-button quick-follow-up-dismiss min-h-[48px] px-s2"
            aria-label={dismissQuickFollowUpLabel === 'Normal turn'
              ? 'Continue the normal turn'
              : `${dismissQuickFollowUpLabel} quick match`}
          >
            <span className="action-button__label">{dismissQuickFollowUpLabel}</span>
          </button>
        )}
      </div>
    )
  }
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
          <span className="action-button__content burn-in-action__content">
            <span className="action-button__label">Burn in</span>
            <span className="action-button__meta" aria-hidden="true">{burnIn.count}× {burnIn.rank} · interrupt</span>
          </span>
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
            <span className="action-button__content">
              <span className="action-button__label">Pick up</span>
              {pickupArmed && <span className="action-button__meta">Tap again to confirm</span>}
            </span>
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
            <span className="action-button__label">Pick up</span>
          </button>
          <button
            type="button"
            onClick={onPlay}
            className="action-button action-button--primary primary-action min-w-[96px] px-s5 text-button font-bold tracking-button uppercase"
            aria-label={`Play ${selectionCount} selected card${selectionCount === 1 ? '' : 's'}`}
          >
            <span className="action-button__label">Play</span>
            {selectionCount > 1 && (
              <span className="action-button__count" aria-hidden="true">{selectionCount}</span>
            )}
          </button>
        </>
      )}
    </div>
  )
}
