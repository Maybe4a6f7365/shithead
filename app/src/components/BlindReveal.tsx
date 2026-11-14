// ============================================================================
// BlindReveal — the suspense beat for a face-down play. The card travels from
// its tableau slot (or the opponent's seat) to the pile as a card back, lifts
// and holds, then flips in 3D. A good flip settles onto the pile; a bad one
// shakes and is swept toward the player who has to take the pile.
// Rendered inside the pile card slot, so it inherits the pile card's size.
// Transform and opacity only. Not rendered at all under reduced motion.
// ============================================================================
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Card as CardT } from '../engine'
import { Card } from './Card'
import { flightOffset, type FlightRect } from './cardFlight'

export interface BlindRevealData {
  key: string
  card: CardT
  success: boolean
  from: FlightRect | null
  toward: FlightRect | null
}

interface Stop {
  t: number
  x?: number
  y?: number
  scale?: number
  opacity?: number
}

export interface BlindTimeline {
  total: number
  times: number[]
  x: number[]
  y: number[]
  scale: number[]
  opacity: number[]
  flip: number[]
}

/** Pure timeline builder (ms) so the choreography is testable. */
export function blindTimeline(
  success: boolean,
  start: { x: number; y: number; scale: number },
  sweep: { x: number; y: number } | null,
): BlindTimeline {
  const stops: Stop[] = [
    { t: 0, x: start.x, y: start.y, scale: start.scale, opacity: 1 },
    { t: 280, x: 0, y: 0, scale: 1.08 }, // arrive, lifted
    { t: 430, x: 0, y: 0, scale: 1.08 }, // hold — the suspense
    { t: 700, x: 0, y: 0, scale: 1.08 }, // flip happens here
  ]
  if (success) {
    stops.push({ t: 900, x: 0, y: 0, scale: 1 })
  } else {
    stops.push(
      { t: 750, x: 7 }, { t: 800, x: -7 }, { t: 850, x: 4 }, { t: 880, x: 0 },
      { t: 1280, x: sweep?.x ?? 0, y: sweep?.y ?? 80, scale: 0.55, opacity: 0 },
    )
  }
  const total = stops[stops.length - 1].t
  // Fill unspecified channels with the previous stop's value.
  let x = 0, y = 0, scale = 1, opacity = 1
  const resolved = stops.map(stop => {
    x = stop.x ?? x
    y = stop.y ?? y
    scale = stop.scale ?? scale
    opacity = stop.opacity ?? opacity
    return { t: stop.t, x, y, scale, opacity }
  })
  const times = resolved.map(stop => stop.t / total)
  return {
    total,
    times,
    x: resolved.map(stop => stop.x),
    y: resolved.map(stop => stop.y),
    scale: resolved.map(stop => stop.scale),
    opacity: resolved.map(stop => stop.opacity),
    // Back until 430ms, flipping to the face by 700ms, face for the rest.
    flip: resolved.map(stop => (stop.t <= 430 ? 0 : 180)),
  }
}

interface Geo {
  start: { x: number; y: number; scale: number }
  sweep: { x: number; y: number } | null
}

export function BlindReveal({ data, onDone }: { data: BlindRevealData; onDone: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geo | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const rect = el?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      onDone(data.key)
      return
    }
    const to = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    const start = data.from ? flightOffset(data.from, to) : { x: 0, y: 70, scale: 0.8 }
    const sweep = data.toward ? flightOffset(data.toward, to) : null
    setGeo({ start, sweep: sweep ? { x: sweep.x, y: sweep.y } : null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.key])

  const timeline = useMemo(
    () => (geo ? blindTimeline(data.success, geo.start, geo.sweep) : null),
    [geo, data.success],
  )

  useLayoutEffect(() => {
    if (!timeline) return
    const timer = window.setTimeout(() => onDone(data.key), timeline.total + 40)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline])

  const seconds = timeline ? timeline.total / 1000 : 0
  return (
    <div
      ref={ref}
      className="blind-reveal absolute inset-0 pointer-events-none"
      style={{ zIndex: 6, perspective: 700 }}
      data-blind-result={data.success ? 'success' : 'fail'}
      aria-hidden="true"
    >
      {timeline && (
        <motion.div
          className="absolute inset-0"
          initial={{ x: timeline.x[0], y: timeline.y[0], scale: timeline.scale[0], opacity: 1 }}
          animate={{ x: timeline.x, y: timeline.y, scale: timeline.scale, opacity: timeline.opacity }}
          transition={{ duration: seconds, times: timeline.times, ease: 'easeInOut' }}
        >
          <motion.div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d' }}
            initial={{ rotateY: 0 }}
            animate={{ rotateY: timeline.flip }}
            transition={{ duration: seconds, times: timeline.times, ease: 'easeInOut' }}
          >
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
              <Card faceDown />
            </div>
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <Card card={data.card} state="in-pile" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
