// ============================================================================
// ConnectionBadge — top-left, 8px dot + persistent micro label, ≥44px action target.
// Color is always paired with text. When the client has GIVEN UP, the whole
// badge becomes the retry button — never a dead "reconnecting…" forever.
// ============================================================================
import clsx from 'clsx'

export type BadgeStatus =
  | 'connecting' | 'connected' | 'reconnecting' | 'restored' | 'offline'

export interface ConnectionBadgeProps {
  status: BadgeStatus
  attempt?: number
  maxAttempts?: number
  onRetry?: () => void
}

export function ConnectionBadge({ status, attempt = 0, maxAttempts = 5, onRetry }: ConnectionBadgeProps) {
  // "back" holds 1.5s then the parent flips us to connected.
  const dot = {
    connecting: 'bg-gold-bright badge-pulse',
    connected: 'bg-online',
    reconnecting: 'bg-gold-bright badge-pulse',
    restored: 'bg-online',
    offline: 'bg-danger-bright',
  }[status]

  const label = {
    connecting: 'connecting',
    connected: 'online',
    reconnecting: `reconnecting · ${attempt}/${maxAttempts}`,
    restored: 'back',
    offline: 'offline — retry',
  }[status]

  const content = (
    <span className="connection-badge__content">
      <span className={clsx('connection-badge__dot inline-block w-2 h-2 rounded-full shrink-0', dot)} aria-hidden="true" />
      <span className="connection-badge__label text-micro font-semibold tracking-micro text-cream-dim whitespace-nowrap">
        {label}
      </span>
    </span>
  )

  if (status === 'offline') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="connection-badge connection-badge--action flex items-center gap-s2 min-h-[44px] min-w-[44px] px-s2 -mx-s2"
        data-status={status}
        aria-label="Connection offline. Retry."
      >
        {content}
      </button>
    )
  }
  return (
    <div
      className="connection-badge flex items-center gap-s2 min-h-[44px] min-w-[44px]"
      data-status={status}
      role="status"
      aria-label={`Connection: ${label}`}
    >
      {content}
    </div>
  )
}
