// ============================================================================
// MirrorGhost — a 3 copies whatever sits beneath it. When one lands, the card
// it is copying ghosts up through it for a moment, so the "= K" label is
// something the player saw happen rather than something they have to read.
// Rendered inside the pile card slot above the 3; Web Animations API,
// transform/opacity only; not rendered under reduced motion.
// ============================================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card as CardT } from '../engine'
import { Card } from './Card'

/** Timeline (ms): wait for the 3 to land, ghost in, hold, fade. */
const MIRROR_DELAY_MS = 240
const MIRROR_DURATION_MS = 950

export function MirrorGhost({ source }: { source: CardT }) {
  const ref = useRef<HTMLDivElement>(null)
  const [gone, setGone] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    el.animate(
      [
        { opacity: 0, translate: '-14px 0px', scale: '0.96' },
        { opacity: 0.62, translate: '0px 0px', scale: '1', offset: 0.28 },
        { opacity: 0.62, translate: '0px 0px', scale: '1', offset: 0.68 },
        { opacity: 0, translate: '6px 0px', scale: '1.02' },
      ],
      { duration: MIRROR_DURATION_MS, delay: MIRROR_DELAY_MS, easing: 'ease-out', fill: 'both' },
    )
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setGone(true), MIRROR_DELAY_MS + MIRROR_DURATION_MS + 80)
    return () => window.clearTimeout(timer)
  }, [])

  if (gone) return null
  return (
    <div
      ref={ref}
      className="mirror-ghost absolute inset-0 pointer-events-none"
      style={{ zIndex: 3, opacity: 0 }}
      aria-hidden="true"
      data-mirror-of={source.id}
    >
      <Card card={source} state="in-pile" />
    </div>
  )
}
