// ============================================================================
// HandFan (Z4) — the hand fan in the thumb zone (§2.5, §3.1).
// Fan step = max(24px, min(28px, (availableWidth − W) / (n−1))); horizontal
// momentum scroll at the 24px floor; never wraps to two rows.
// Roving tabindex + ←/→ keyboard navigation (§6.5).
// ============================================================================
import { useLayoutEffect, useRef, useState } from 'react'
import type { Card as CardT } from '../engine'
import { Card, type CardVisualState } from './Card'

export interface HandFanProps {
  cards: CardT[]
  /** Visual state per card id (missing = 'rest'). */
  states: Map<string, CardVisualState>
  ariaHints?: Map<string, string>
  onSelect?: (id: string) => void
  labelledBy?: string
}

export function HandFan({ cards, states, ariaHints, onSelect, labelledBy }: HandFanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({ avail: 0, cardW: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const avail = containerRef.current?.clientWidth ?? 0
      const cardW = measureRef.current?.offsetWidth ?? 0
      setMetrics({ avail, cardW })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const n = cards.length
  const { avail, cardW } = metrics
  // §2.5 fan step; 24px floor guarantees index visibility + WCAG 24px target.
  const step = n > 1 && cardW > 0 && avail > 0
    ? Math.max(24, Math.min(28, (avail - cardW) / (n - 1)))
    : 28
  const overlap = cardW > 0 ? Math.max(0, cardW - step) : 0

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (idx === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowRight'
      ? buttons[(idx + 1) % buttons.length]
      : buttons[(idx - 1 + buttons.length) % buttons.length]
    next?.focus()
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-auto overflow-y-visible"
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      role="group"
      aria-label="Your hand"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div
        className="flex items-end justify-start px-s4 pt-s5"
        style={{ width: n > 0 && cardW > 0 ? cardW + step * (n - 1) + 32 : 'auto', margin: '0 auto', minWidth: 'fit-content' }}
      >
        {/* Hidden measuring card keeps W honest against the live CSS var. */}
        <div ref={measureRef} className="card invisible absolute pointer-events-none" aria-hidden="true" />
        {cards.map((c, i) => (
          <div
            key={c.id}
            style={{ marginLeft: i === 0 ? 0 : -overlap, paddingBottom: 16 }}
            className="shrink-0"
          >
            <Card
              card={c}
              state={states.get(c.id) ?? 'rest'}
              ariaHint={ariaHints?.get(c.id)}
              onActivate={onSelect ? () => onSelect(c.id) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
