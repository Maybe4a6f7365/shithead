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
const seatRects = new Map<string, FlightRect>()

function snapshot(el: Element): FlightRect | null {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Snapshot every element under `root` tagged `data-card-id`. */
export function recordCardRects(root: ParentNode | null): void {
  if (!root) return
  root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el => {
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
