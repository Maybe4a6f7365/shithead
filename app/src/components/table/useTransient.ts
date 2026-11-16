// ============================================================================
// Short-lived table feedback: one-shot timers that die with the table, and
// the feed line that briefly replaces the latest table event.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'

export function useTransient() {
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
  }, [])

  /** Run `fn` after `ms`, unless the table has gone by then. */
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  const [flash, setFlash] = useState<string | null>(null)
  /** Show `text` in the feed for `ms`. A newer flash is never cleared early. */
  const showFlash = useCallback((text: string, ms: number) => {
    setFlash(text)
    later(ms, () => setFlash(current => (current === text ? null : current)))
  }, [later])

  return { flash, showFlash, later }
}
