// ============================================================================
// cardFlight — remembers where cards (and opponent seats) were on screen so a
// card entering the pile can fly from where it really came from (FLIP-style).
// Rects are snapshotted after each hand render; by the time the played card
// reaches the pile its hand slot has already unmounted.
// ============================================================================

export interface FlightRect {
  left: number
  top: number
  width: number
  height: number
}

export interface FlightOffset {
  x: number
  y: number
  scale: number
}

const cardRects = new Map<string, FlightRect>()
// While a deal is in flight, card rects include its transforms and the hand is
// still settling; recording them (or FLIPping against them) would fight the deal.
let holdUntil = 0
export function holdFlips(ms: number): void {
  holdUntil = Math.max(holdUntil, Date.now() + ms)
}
export function releaseFlips(): void {
  holdUntil = 0
}
export function flipsHeld(): boolean {
  return Date.now() < holdUntil
}
const seatRects = new Map<string, FlightRect>()

function snapshot(el: Element): FlightRect | null {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * True while an animation is moving `el` itself. Its bounding box then
 * includes the animation's transform, so it is not a resting position: a
 * rect recorded now would make the next FLIP replay a move that already
 * happened.
 */
function isAnimating(el: Element): boolean {
  const getAnimations = (el as Partial<Pick<Element, 'getAnimations'>>).getAnimations
  return typeof getAnimations === 'function' && getAnimations.call(el).length > 0
}

/**
 * Snapshot every element under `root` tagged `data-card-id`. Elements that
 * are mid-animation keep the resting rect the FLIP pass stored for them.
 */
export function recordCardRects(root: ParentNode | null): void {
  if (!root || flipsHeld()) return
  root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el => {
    if (isAnimating(el)) return
    const id = el.dataset.cardId
    const rect = id ? snapshot(el) : null
    if (id && rect) cardRects.set(id, rect)
  })
  // Hands are small; the cap only guards against unbounded growth over a long
  // session of unique ids.
  if (cardRects.size > 200) {
    for (const key of cardRects.keys()) {
      cardRects.delete(key)
      if (cardRects.size <= 120) break
    }
  }
}

export function peekCardRect(id: string | null | undefined): FlightRect | null {
  return id ? cardRects.get(id) ?? null : null
}

export function forgetCardRect(id: string | null | undefined): void {
  if (id) cardRects.delete(id)
}

export function registerSeat(id: string, el: Element | null): void {
  if (!el) {
    seatRects.delete(id)
    return
  }
  const rect = snapshot(el)
  if (rect) seatRects.set(id, rect)
}

export function peekSeatRect(id: string | null | undefined): FlightRect | null {
  return id ? seatRects.get(id) ?? null : null
}

/** Pure: translate/scale that makes a box at `to` look like it sits at `from`. */
export function flightOffset(from: FlightRect, to: FlightRect): FlightOffset {
  const fromX = from.left + from.width / 2
  const fromY = from.top + from.height / 2
  const toX = to.left + to.width / 2
  const toY = to.top + to.height / 2
  return {
    x: fromX - toX,
    y: fromY - toY,
    scale: to.width > 0 ? Math.min(1.4, Math.max(0.3, from.width / to.width)) : 1,
  }
}

/** Short hops stay snappy; long ones get a touch more time. 200–340ms. */
export function flightDuration(offset: FlightOffset): number {
  const distance = Math.hypot(offset.x, offset.y)
  return Math.min(0.34, Math.max(0.2, 0.16 + distance / 2600))
}

/** True when the card barely moved, so a flight would read as jitter. */
export function isTrivialFlight(offset: FlightOffset): boolean {
  return Math.hypot(offset.x, offset.y) < 12
}

export type HandEntrySource = 'stock' | 'pile' | null

type Animatable = Pick<HTMLElement, 'animate'>

function canAnimate(el: Element): el is Element & Animatable {
  return typeof (el as Partial<Animatable>).animate === 'function'
}

/**
 * FLIP the hand: cards that moved slide from their previous slot (so the row
 * closes gaps and re-sorts smoothly) and cards that are new fly in from the
 * stock or pile. Runs in a layout effect, before paint; call it BEFORE
 * recordCardRects so the registry still holds the previous positions.
 * Compositor-only: transform and opacity, via the Web Animations API.
 */
export function flipHand(root: ParentNode | null, entryFrom: HandEntrySource): void {
  if (!root || flipsHeld()) return
  const origin = entryFrom ? peekSeatRect(entryFrom) : null
  let fresh = 0
  root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el => {
    // Still travelling from an earlier FLIP: let it finish where it is going.
    if (!canAnimate(el) || isAnimating(el)) return
    const id = el.dataset.cardId
    const now = id ? snapshot(el) : null
    if (!id || !now) return
    const before = peekCardRect(id)
    // Store the resting rect now, before the animation transforms the box.
    cardRects.set(id, now)
    if (before) {
      const dx = before.left - now.left
      const dy = before.top - now.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
      return
    }
    const delay = Math.min(fresh++ * 40, 240)
    if (origin) {
      const offset = flightOffset(origin, now)
      el.animate(
        [
          { transform: `translate(${offset.x}px, ${offset.y}px) scale(${offset.scale})`, opacity: 0.2 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ],
        { duration: Math.round(flightDuration(offset) * 1000), delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
      )
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: 'backwards' })
    }
  })
}

/** Seconds between consecutive cards of a multi-card play; capped for big sets. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * 0.055, 0.22)
}

/** Deterministic resting tilt for the cards tucked under the top card. */
export function groupTilt(index: number): number {
  return (index % 2 === 0 ? -1 : 1) * (2 + (index % 3))
}

export interface GroupGhostTiming {
  total: number
  times: number[]
  opacity: number[]
}

/**
 * A ghost card flies in, rests, and fades once the top card has landed.
 * `flight` is its own travel time; `topLandsAt` when the top card settles (s,
 * measured from the play); `delay` its own start. All in seconds.
 */
export function groupGhostTiming(flight: number, topLandsAt: number, delay: number): GroupGhostTiming {
  const fade = 0.1
  const hold = Math.max(flight, topLandsAt - delay)
  const total = hold + fade
  return {
    total,
    times: [0, flight / total, hold / total, 1],
    opacity: [1, 1, 1, 0],
  }
}

/** Delay (ms) before card `index` of `count` is dealt; whole deal stays ~<=700ms. */
export function dealDelay(index: number, count: number): number {
  if (count <= 1) return 0
  return Math.round(Math.min(45, 360 / (count - 1)) * index)
}

/** Small deterministic spin so a dealt hand doesn't look machine-stamped. */
export function dealTilt(index: number): number {
  return ((index * 7) % 11) - 5 // -5..5 degrees
}

export const DEAL_CARD_MS = 280

export interface DealHandle {
  /** Total length of the deal in ms. */
  total: number
  /** Finish immediately (tap to skip). */
  skip: () => void
}

let lastDealKey: string | null = null

/** True once per distinct set of dealt cards — a reconnect/remount won't replay. */
export function claimDeal(key: string): boolean {
  if (lastDealKey === key) return false
  lastDealKey = key
  return true
}

/**
 * Deal the round in: three face-down, three face-up, then the hand, each card
 * flying from `origin` (the dealer, off the top of the screen) in turn. Uses
 * the individual translate/scale/rotate properties so it composes with the
 * transforms the cards already carry (e.g. the face-down offset).
 */
export function dealIn(root: ParentNode | null, origin: FlightRect): DealHandle | null {
  if (!root) return null
  const ordered = [
    ...root.querySelectorAll<HTMLElement>('.tableau-stack__down[data-card-id]'),
    ...root.querySelectorAll<HTMLElement>('.tableau-stack__up[data-card-id]'),
    ...root.querySelectorAll<HTMLElement>('.hand-fan__card[data-card-id]'),
  ].filter(el => canAnimate(el))
  if (ordered.length === 0) return null
  const animations: Animation[] = []
  ordered.forEach((el, index) => {
    const rect = snapshot(el)
    if (!rect) return
    const offset = flightOffset(origin, rect)
    animations.push(el.animate(
      [
        { translate: `${offset.x}px ${offset.y}px`, scale: String(offset.scale), rotate: `${dealTilt(index) * 2}deg`, opacity: 0 },
        { translate: '0px 0px', scale: '1', rotate: '0deg', opacity: 1 },
      ],
      { duration: DEAL_CARD_MS, delay: dealDelay(index, ordered.length), easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
    ))
  })
  const total = dealDelay(ordered.length - 1, ordered.length) + DEAL_CARD_MS
  holdFlips(total + 60)
  const settle = () => {
    releaseFlips()
    recordCardRects(root) // fresh, transform-free positions for the next FLIP
  }
  const timer = setTimeout(settle, total + 80)
  return {
    total,
    skip: () => {
      clearTimeout(timer)
      animations.forEach(animation => animation.cancel?.())
      settle()
    },
  }
}

export const TABLEAU_FLIP_MS = 260

/** True when a card's box barely changed (position AND size), so a FLIP would be jitter. */
export function isTrivialTableauMove(offset: FlightOffset): boolean {
  return Math.hypot(offset.x, offset.y) < 1 && Math.abs(offset.scale - 1) < 0.02
}

/**
 * FLIP the tableau: any card whose box changed since it was last recorded
 * slides/scales from there to its new slot. That covers a hand<->face-up swap
 * (the card's old rect was recorded in the hand), closing gaps when a face-up
 * card is played, and minis growing to full size in place. Cards with no
 * recorded rect (brand new) are left alone. Uses the individual translate and
 * scale properties so the face-down stack's own CSS transform survives. Call
 * BEFORE recordCardRects.
 */
export function flipTableau(root: ParentNode | null): void {
  if (!root || flipsHeld()) return
  root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el => {
    if (!canAnimate(el) || isAnimating(el)) return
    const id = el.dataset.cardId
    const now = id ? snapshot(el) : null
    const before = id ? peekCardRect(id) : null
    // Store the resting rect now, before the animation transforms the box.
    if (id && now) cardRects.set(id, now)
    if (!now || !before) return
    const offset = flightOffset(before, now)
    if (isTrivialTableauMove(offset)) return
    el.animate(
      [
        { translate: `${offset.x}px ${offset.y}px`, scale: String(offset.scale) },
        { translate: '0px 0px', scale: '1' },
      ],
      { duration: TABLEAU_FLIP_MS, easing: 'cubic-bezier(0.34, 1.3, 0.4, 1)' },
    )
  })
}

/**
 * Run `callback` (rAF-throttled) whenever anything scrolls, so cached card
 * rects stay in viewport coordinates and a later FLIP doesn't mistake a scroll
 * for a move. Returns the unsubscribe.
 */
export function onAnyScroll(callback: () => void): () => void {
  let frame = 0
  const handler = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      callback()
    })
  }
  window.addEventListener('scroll', handler, { capture: true, passive: true })
  return () => {
    window.removeEventListener('scroll', handler, { capture: true } as EventListenerOptions)
    if (frame) cancelAnimationFrame(frame)
  }
}
