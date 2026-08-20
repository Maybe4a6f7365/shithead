// Tiny, non-interactive watcher status for the existing top status rail.
// It deliberately occupies no new topbar column.
export function SpectatorIndicator({ count }: { count: number }) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (safeCount === 0) return null

  const label = `${safeCount} spectator${safeCount === 1 ? '' : 's'} watching and waiting for the next round`
  return (
    <span
      className="table-spectator-indicator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2.8 12s3.3-5.2 9.2-5.2S21.2 12 21.2 12s-3.3 5.2-9.2 5.2S2.8 12 2.8 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
      <span aria-hidden="true">{safeCount}</span>
    </span>
  )
}
