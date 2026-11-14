// ============================================================================
// Standings reveal — the round-over leaderboard counts down from last place to
// first: each row lands in turn, the Shithead tag is stamped onto the loser's
// row, the winner's row triggers a suit burst, and the round highlights fade in
// last. Web Animations API (opacity / translate / scale / rotate only), with
// fill: backwards so rows are hidden until their turn. Tap anywhere to skip.
// ============================================================================

export const REVEAL_START_MS = 450
export const REVEAL_ROW_MS = 260
export const REVEAL_MAX_STEP_MS = 170
export const REVEAL_BUDGET_MS = 850

/** Gap between rows; squeezed for big tables so the whole count-down stays ~<=1.3s. */
export function standingsStep(count: number): number {
  if (count <= 1) return 0
  return Math.min(REVEAL_MAX_STEP_MS, Math.round(REVEAL_BUDGET_MS / (count - 1)))
}

/** Row `index` (0 = first place) of `count`: the LAST row is revealed first. */
export function standingsDelay(index: number, count: number): number {
  return REVEAL_START_MS + (count - 1 - index) * standingsStep(count)
}

export interface StandingsReveal {
  /** Length of the whole reveal in ms. */
  total: number
  /** Jump to the finished state (tap to skip). */
  skip: () => void
}

type Animatable = HTMLElement & { animate: HTMLElement['animate'] }
const canAnimate = (el: Element): el is Animatable => typeof (el as Partial<Animatable>).animate === 'function'

export function revealStandings(
  root: ParentNode | null,
  options: { onWinner?: (row: HTMLElement) => void } = {},
): StandingsReveal | null {
  if (!root) return null
  const rows = Array.from(root.querySelectorAll<HTMLElement>('.game-over-table tbody tr'))
  if (rows.length === 0) return null
  const animations: Animation[] = []
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const count = rows.length

  rows.forEach((row, index) => {
    const delay = standingsDelay(index, count)
    if (canAnimate(row)) {
      animations.push(row.animate(
        [
          { opacity: 0, translate: '0px 14px' },
          { opacity: 1, translate: '0px 0px' },
        ],
        { duration: REVEAL_ROW_MS, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
      ))
    }
    const tag = row.querySelector<HTMLElement>('.game-over-loser-tag')
    if (tag && canAnimate(tag)) {
      // Stamped on a beat after its row lands, and left at a slight tilt.
      animations.push(tag.animate(
        [
          { opacity: 0, scale: '2.4', rotate: '-14deg' },
          { opacity: 1, scale: '0.9', rotate: '-3deg', offset: 0.6 },
          { opacity: 1, scale: '1', rotate: '-3deg' },
        ],
        { duration: 320, delay: delay + 200, easing: 'cubic-bezier(0.34, 1.3, 0.4, 1)', fill: 'both' },
      ))
    }
    if (row.dataset.place === '1' && options.onWinner) {
      timers.push(setTimeout(() => options.onWinner?.(row), delay + 140))
    }
  })

  const rowsEnd = standingsDelay(0, count) + REVEAL_ROW_MS
  const highlights = Array.from(root.querySelectorAll<HTMLElement>('.game-over-highlights li'))
  highlights.forEach((item, index) => {
    if (!canAnimate(item)) return
    animations.push(item.animate(
      [{ opacity: 0, translate: '0px 8px' }, { opacity: 1, translate: '0px 0px' }],
      { duration: 240, delay: rowsEnd - 120 + index * 80, easing: 'ease-out', fill: 'backwards' },
    ))
  })

  const total = rowsEnd + (highlights.length > 0 ? highlights.length * 80 + 120 : 0)
  return {
    total,
    skip: () => {
      timers.forEach(clearTimeout)
      animations.forEach(animation => animation.cancel?.())
    },
  }
}
