import { useRef } from 'react'

/**
 * A value computed when `key` changes and held, unchanged, until `key`
 * changes again. For a measurement taken as an animation starts, which must
 * not follow later re-renders. Unlike useMemo the held value is a guarantee,
 * and `compute` reads whatever is current at that moment.
 */
export function useHeld<T>(key: string | number | boolean | null | undefined, compute: () => T): T {
  const held = useRef<{ key: typeof key; value: T } | null>(null)
  if (held.current === null || held.current.key !== key) held.current = { key, value: compute() }
  return held.current.value
}
