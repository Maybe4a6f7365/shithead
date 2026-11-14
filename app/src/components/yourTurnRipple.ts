// ============================================================================
// Your-turn ripple — when the turn reaches you, the cards you can play hop in
// a quick left-to-right wave instead of all lighting up at once, so your eye
// is led across the hand to your options. Web Animations API on the card's
// individual `translate` property: it composes with the card's CSS transform
// (the resting playable lift) and its transitions without fighting either.
// ============================================================================
import { useLayoutEffect, useRef, type RefObject } from 'react'

export const RIPPLE_STEP_MS = 30
export const RIPPLE_MAX_DELAY_MS = 300
export const RIPPLE_HOP_PX = 9
export const RIPPLE_MS = 340

/** Delay (ms) for the nth playable card; capped so a huge hand never drags. */
export function rippleDelay(index: number): number {
  return Math.min(Math.max(0, index) * RIPPLE_STEP_MS, RIPPLE_MAX_DELAY_MS)
}

/** Cards within this many px of vertical distance belong to the same row. */
export const RIPPLE_ROW_TOLERANCE_PX = 40

/**
 * Cards the ripple should visit: playable/joinable ones, one wave per row
 * (tableau row first, then the hand), each wave left to right. Rows are
 * clustered by a wide tolerance, because a card lifted by its playable state
 * or mid-transition sits a few px off its neighbours and must not be split
 * into a different "row".
 */
export function rippleTargets(root: ParentNode | null): HTMLElement[] {
  if (!root) return []
  const entries = Array.from(
    root.querySelectorAll<HTMLElement>('.card[data-state="playable"], .card[data-state="joinable"]'),
  )
    .filter(el => !el.classList.contains('invisible'))
    .map(el => ({ el, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top)
  const rows: typeof entries[] = []
  for (const entry of entries) {
    const row = rows[rows.length - 1]
    if (row && entry.rect.top - row[0].rect.top <= RIPPLE_ROW_TOLERANCE_PX) row.push(entry)
    else rows.push([entry])
  }
  return rows.flatMap(row => row.sort((a, b) => a.rect.left - b.rect.left)).map(entry => entry.el)
}

/** Run the wave. Returns how many cards it animated. */
export function rippleCards(root: ParentNode | null): number {
  const targets = rippleTargets(root)
  targets.forEach((el, index) => {
    if (typeof el.animate !== 'function') return
    el.animate(
      [
        { translate: '0px 0px' },
        { translate: `0px -${RIPPLE_HOP_PX}px`, offset: 0.4 },
        { translate: '0px 0px' },
      ],
      { duration: RIPPLE_MS, delay: rippleDelay(index), easing: 'ease-out' },
    )
  })
  return targets.length
}

/**
 * Ripple whenever `key` changes to a new non-null value (a new turn that is
 * yours). Not on mount (a reconnect mid-turn is not an arrival) and not under
 * reduced motion. The key and the cards' data-state come from the same render,
 * so the layout effect sees the playable states already in the DOM.
 */
export function useYourTurnRipple(
  root: RefObject<HTMLElement>,
  key: string | null,
  reduceMotion: boolean | null,
): void {
  const last = useRef<string | null>(key)
  useLayoutEffect(() => {
    if (key === last.current) return
    last.current = key
    if (!key || reduceMotion) return
    rippleCards(root.current)
  }, [key, reduceMotion, root])
}
