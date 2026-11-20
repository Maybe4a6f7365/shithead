// ============================================================================
// WinMoment — the small celebration for getting rid of every card.
//  - SuitBurst: a one-shot fan of suit glyphs. Transform/opacity only, never
//    looping, hidden entirely under reduced motion.
//  - OutMoment: the mid-round "You're out" banner with the finishing place,
//    shown when the viewer goes out while the round carries on.
// Both are decorative and pointer-transparent; screen readers get the news
// through the table announcer instead.
// ============================================================================
import { useEffect, useState } from 'react'

const BURST_GLYPHS = ['♠', '♥', '♦', '♣'] as const
const BURST_PARTICLES = 14

/** Deterministic spread so the burst looks the same on every render pass. */
export function burstParticles(count = BURST_PARTICLES) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (360 / count) * index + (index % 2 === 0 ? 0 : 9)
    return {
      glyph: BURST_GLYPHS[index % BURST_GLYPHS.length],
      angle,
      distance: 92 + (index % 3) * 26,
      delay: (index % 4) * 28,
      spin: index % 2 === 0 ? 150 : -150,
      warm: index % 4 === 1 || index % 4 === 2,
    }
  })
}

export function SuitBurst({ burstKey }: { burstKey: string | number }) {
  return (
    <span className="suit-burst" aria-hidden="true" key={burstKey}>
      {burstParticles().map((particle, index) => (
        <span
          key={index}
          className="suit-burst__particle"
          data-warm={particle.warm ? 'true' : 'false'}
          style={{
            '--burst-angle': `${particle.angle}deg`,
            '--burst-distance': `${particle.distance}px`,
            '--burst-spin': `${particle.spin}deg`,
            '--burst-delay': `${particle.delay}ms`,
          } as React.CSSProperties}
        >
          {particle.glyph}
        </span>
      ))}
    </span>
  )
}

export interface OutMomentEvent {
  key: string
  /** 1-based finishing position among the players already out. */
  place: number
}

export function placeLabel(place: number): string {
  const tens = place % 100
  if (tens >= 11 && tens <= 13) return `${place}th`
  const suffix = place % 10 === 1 ? 'st' : place % 10 === 2 ? 'nd' : place % 10 === 3 ? 'rd' : 'th'
  return `${place}${suffix}`
}

export function outMomentCopy(place: number): { title: string; detail: string } {
  return place === 1
    ? { title: 'First out', detail: 'You win this round' }
    : { title: "You're out", detail: `${placeLabel(place)} place · safe` }
}

export const OUT_MOMENT_MS = 2400

export function OutMoment({ event }: { event: OutMomentEvent | null }) {
  const [visibleKey, setVisibleKey] = useState<string | null>(null)

  const eventKey = event?.key ?? null
  useEffect(() => {
    if (eventKey === null) return
    setVisibleKey(eventKey)
    const timeout = window.setTimeout(() => setVisibleKey(null), OUT_MOMENT_MS)
    return () => window.clearTimeout(timeout)
  }, [eventKey])

  if (!event || visibleKey !== event.key) return null
  const copy = outMomentCopy(event.place)
  return (
    <div className="out-moment" data-place={event.place} data-testid="out-moment" aria-hidden="true">
      <SuitBurst burstKey={event.key} />
      <div className="out-moment__banner">
        <strong className="out-moment__title">{copy.title}</strong>
        <span className="out-moment__detail">{copy.detail}</span>
      </div>
    </div>
  )
}
