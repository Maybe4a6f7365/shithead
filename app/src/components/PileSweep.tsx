// ============================================================================
// PileSweep — picking up the pile is the most painful moment in the game, so
// it gets a physical beat: the stack leaves the pile slot and is swept to
// whoever took it (your hand, or the opponent's seat, which recoils on
// arrival). Rendered inside the pile card slot; transform/opacity only; not
// rendered under reduced motion.
// ============================================================================
import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Card as CardT } from '../engine'
import { Card } from './Card'
import { flightOffset, groupTilt, type FlightRect } from './cardFlight'
import { EASE_LEAVE_CSS, EASE_SETTLE_CSS } from './motion'

export interface PileSweepData {
  key: string
  card: CardT
  /** Cards in the pile before the pickup (drives how thick the sweep looks). */
  count: number
  takerId: string
  toward: FlightRect | null
}

/** One layer per couple of cards, so a fat pile reads as fat but stays cheap. */
export function sweepLayers(count: number): number {
  if (count <= 1) return 1
  return Math.min(3, 1 + Math.ceil((count - 1) / 3))
}

const SWEEP_SECONDS = 0.42

export function PileSweep({ data, onDone }: { data: PileSweepData; onDone: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState<{ x: number; y: number; scale: number } | null>(null)

  // One sweep per pickup: the route is measured once and must not follow a
  // later re-render.
  const measureRoute = useEffectEvent(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      onDone(data.key)
      return
    }
    const to = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    const target = data.toward ? flightOffset(data.toward, to) : { x: 0, y: 160, scale: 0.5 }
    setOffset({ x: target.x, y: target.y, scale: Math.min(target.scale, 0.6) })
  })
  useLayoutEffect(() => measureRoute(), [data.key])

  const layers = useMemo(() => sweepLayers(data.count), [data.count])
  const layerRefs = useRef<Array<HTMLDivElement | null>>([])

  const sweepTo = useEffectEvent((offset: { x: number; y: number; scale: number }) => {
    // Web Animations API: fill 'forwards' holds the faded end state, so there
    // is no flash on the frame the animation completes.
    layerRefs.current.forEach((el, index) => {
      if (!el || typeof el.animate !== 'function') return
      const trail = layers - 1 - index // lower layers trail behind the top one
      const tilt = index === layers - 1 ? 0 : groupTilt(index)
      el.animate(
        [
          { transform: `translate(0px, 0px) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0 },
          { opacity: 1, offset: 0.6 },
          { transform: `translate(${offset.x}px, ${offset.y}px) scale(${offset.scale}) rotate(${tilt * 2}deg)`, opacity: 0, offset: 1 },
        ],
        { duration: SWEEP_SECONDS * 1000, delay: trail * 40, easing: EASE_LEAVE_CSS, fill: 'both' },
      )
    })
    // The taker's seat recoils as the stack lands on it.
    const recoil = window.setTimeout(() => {
      const seat = Array.from(document.querySelectorAll<HTMLElement>('[data-seat-id]'))
        .find(el => el.dataset.seatId === data.takerId)
      if (seat && typeof seat.animate === 'function') {
        seat.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(0.98)' }, { transform: 'scale(1)' }],
          { duration: 260, easing: EASE_SETTLE_CSS },
        )
      }
    }, SWEEP_SECONDS * 1000 * 0.75)
    const done = window.setTimeout(() => onDone(data.key), SWEEP_SECONDS * 1000 + 120)
    return () => { window.clearTimeout(recoil); window.clearTimeout(done) }
  })
  useLayoutEffect(() => {
    if (offset) return sweepTo(offset)
  }, [offset])

  return (
    <div ref={ref} className="pile-sweep absolute inset-0 pointer-events-none" style={{ zIndex: 5 }} aria-hidden="true">
      {offset && Array.from({ length: layers }).map((_, index) => (
        <div key={index} ref={el => { layerRefs.current[index] = el }} className="absolute inset-0">
          <Card card={data.card} state="in-pile" />
        </div>
      ))}
    </div>
  )
}
