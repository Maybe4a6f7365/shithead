// ============================================================================
// ConnectionBadge — top-left, 8px dot + micro label, ≥44x32 target (§4.6).
// Color is always paired with text. When the client has GIVEN UP, the whole
// badge becomes the retry button — never a dead "reconnecting…" forever.
// ============================================================================
import { useEffect, useState } from 'react'
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
  // "online" label fades out after 2s, dot stays (§4.6).
  const [labelGone, setLabelGone] = useState(false)
  useEffect(() => {
    if (status !== 'connected') { setLabelGone(false); return }
    const t = setTimeout(() => setLabelGone(true), 2000)
    return () => clearTimeout(t)
  }, [status])

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

  const showLabel = !(status === 'connected' && labelGone)
  const content = (
    <>
      <span className={clsx('inline-block w-2 h-2 rounded-full shrink-0', dot)} aria-hidden="true" />
      {showLabel && <span className="text-micro font-semibold tracking-micro text-cream-dim whitespace-nowrap">{label}</span>}
    </>
  )

  if (status === 'offline') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-s2 min-h-[32px] min-w-[44px] px-s2 -mx-s2"
        aria-label="Connection offline. Retry."
      >
        {content}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-s2 min-h-[32px] min-w-[44px]" role="status" aria-label={`Connection: ${label}`}>
      {content}
    </div>
  )
}
