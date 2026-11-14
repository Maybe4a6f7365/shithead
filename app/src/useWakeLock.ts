// ============================================================================
// Keep the screen awake while a match is running. A card game is mostly
// waiting for other players; a phone that dims and locks mid-round drops the
// connection and makes the player miss their turn. Best effort: unsupported
// or refused requests are silent.
// ============================================================================
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return
      try {
        const next = await wakeLock.request('screen')
        if (cancelled) {
          void next.release().catch(() => undefined)
          return
        }
        sentinel = next
        // The browser releases the lock whenever the page is hidden.
        next.addEventListener('release', () => { if (sentinel === next) sentinel = null })
      } catch {
        // Battery saver, permissions policy, or an inactive document.
      }
    }
    const onVisibility = () => { void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const held = sentinel
      sentinel = null
      if (held && !held.released) void held.release().catch(() => undefined)
    }
  }, [active])
}
