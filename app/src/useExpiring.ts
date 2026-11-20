import { useEffect, useMemo, useRef, useState } from 'react'

export interface ExpiringSlot<T> {
  /** Show `value` for `ms`. It replaces what is showing and restarts the clock. */
  show: (value: T, ms: number) => void
  clear: () => void
}

/**
 * A value that is shown for a while and then clears itself: a table notice, a
 * reaction bubble. A newer value replaces the current one and restarts the
 * clock, so an older value's timer can never clear a newer one. The slot keeps
 * its identity, so effects can name it as a dependency.
 */
export function useExpiring<T>(): [T | null, ExpiringSlot<T>] {
  const [value, setValue] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slot = useMemo<ExpiringSlot<T>>(() => {
    const stop = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
    return {
      show: (next, ms) => {
        stop()
        setValue(next)
        timer.current = setTimeout(() => {
          timer.current = null
          setValue(null)
        }, ms)
      },
      clear: () => {
        stop()
        setValue(null)
      },
    }
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return [value, slot]
}
