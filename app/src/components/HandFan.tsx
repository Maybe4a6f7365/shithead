// ============================================================================
// HandFan (Z4) — the hand fan in the thumb zone (§2.5, §3.1).
// Normal hands fan at a 24px target floor. Pickups can make a hand very
// large, so 13+ cards switch to a fixed-height, horizontally scrolling
// overlapping rail. Keeping one row makes every card reachable without the
// second row falling behind mobile browser chrome or the safe-area edge.
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
  const large = n > 12
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

  const renderCard = (c: CardT, i: number, compactRail = false) => (
    <div
      key={c.id}
      style={compactRail
        ? { marginLeft: i === 0 ? 0 : -overlap }
        : { marginLeft: i === 0 ? 0 : -overlap, paddingBottom: 16 }}
      className={compactRail ? 'shrink-0 pb-s2' : 'shrink-0'}
    >
      <Card
        card={c}
        state={states.get(c.id) ?? 'rest'}
        ariaHint={`${ariaHints?.get(c.id) ? `${ariaHints.get(c.id)}, ` : ''}${i + 1} of ${n}`}
        onActivate={onSelect ? () => onSelect(c.id) : undefined}
      />
    </div>
  )

  if (large) {
    return (
      <section className="large-hand" aria-label={`Your hand, ${n} cards`} aria-labelledby={labelledBy}>
        <div className="large-hand__meta px-s4 text-micro font-semibold tracking-micro uppercase text-cream-dim">
          <span>{n} cards</span>
          <span aria-hidden="true">Swipe →</span>
        </div>
        <div
          ref={containerRef}
          className="large-hand__scroller w-full overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch' }}
          role="group"
          aria-label={`${n} cards; scroll horizontally`}
          onKeyDown={onKeyDown}
        >
          <div ref={measureRef} className="card invisible absolute pointer-events-none" aria-hidden="true" />
          <div
            className="large-hand__row px-s4 pt-s2"
            style={{
              width: n > 0 && cardW > 0 ? cardW + step * (n - 1) + 32 : 'auto',
              minWidth: 'fit-content',
            }}
          >
            {cards.map((card, index) => renderCard(card, index, true))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <div
      ref={containerRef}
      className="hand-fan w-full overflow-x-auto overflow-y-visible"
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      role="group"
      aria-label="Your hand"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div
        className="hand-fan__row flex items-end justify-start px-s4 pt-s5"
        style={{ width: n > 0 && cardW > 0 ? cardW + step * (n - 1) + 32 : 'auto', margin: '0 auto', minWidth: 'fit-content' }}
      >
        {/* Hidden measuring card keeps W honest against the live CSS var. */}
        <div ref={measureRef} className="card invisible absolute pointer-events-none" aria-hidden="true" />
        {cards.map((c, i) => renderCard(c, i))}
      </div>
    </div>
  )
}
