// ============================================================================
// HandFan (Z4) — the hand fan in the thumb zone (§2.5, §3.1).
// Hands fan at a 24px target floor and always use the same single-row layout.
// Pickups only make the row wider and horizontally scrollable; card size,
// vertical position, and spacing never change at a card-count threshold.
// Roving tabindex + ←/→ keyboard navigation (§6.5).
// ============================================================================
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HAND_DISPLAY_ORDER, type Card as CardT } from '../engine'
import { Card, type CardVisualState } from './Card'

/** Keep the viewer's display order while removing played cards and appending draws. */
export function reconcileHandOrder(order: string[], cards: CardT[]): string[] {
  const liveIds = new Set(cards.map(card => card.id))
  const next = order.filter(id => liveIds.has(id))
  const knownIds = new Set(next)
  for (const card of cards) {
    if (!knownIds.has(card.id)) {
      next.push(card.id)
      knownIds.add(card.id)
    }
  }
  return next
}

/** Stable local sort; opaque ids are never sent to the server as an ordering action. */
export function sortHandByDisplay(cards: CardT[]): string[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const rankDifference = HAND_DISPLAY_ORDER[left.card.rank] - HAND_DISPLAY_ORDER[right.card.rank]
      return rankDifference || left.index - right.index
    })
    .map(({ card }) => card.id)
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export interface HandFanProps {
  cards: CardT[]
  /** Visual state per card id (missing = 'rest'). */
  states: Map<string, CardVisualState>
  ariaHints?: Map<string, string>
  onSelect?: (id: string) => void
  labelledBy?: string
  /** Keeps independent local presentation orders when a hot-seat viewer changes. */
  orderKey?: string
}

export function HandFan({
  cards, states, ariaHints, onSelect, labelledBy, orderKey = 'default',
}: HandFanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const ordersByKey = useRef(new Map<string, string[]>())
  const activeOrderKey = useRef(orderKey)
  const [metrics, setMetrics] = useState({ avail: 0, cardW: 0 })
  const [order, setOrder] = useState(() => sortHandByDisplay(cards))

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

  useEffect(() => {
    setOrder(current => {
      if (activeOrderKey.current !== orderKey) {
        ordersByKey.current.set(activeOrderKey.current, current)
        activeOrderKey.current = orderKey
      }
      const stored = ordersByKey.current.get(orderKey)
      const reconciled = reconcileHandOrder(stored ?? [], cards)
      const pickedUp = stored === undefined || reconciled.some(id => !stored.includes(id))
      const canonical = sortHandByDisplay(cards)
      const next = pickedUp && !sameOrder(reconciled, canonical) ? canonical : reconciled
      ordersByKey.current.set(orderKey, next)
      return sameOrder(current, next) ? current : next
    })
  }, [cards, orderKey])

  const orderedCards = useMemo(() => {
    const reconciled = reconcileHandOrder(order, cards)
    const byId = new Map(cards.map(card => [card.id, card] as const))
    return reconciled.flatMap(id => {
      const card = byId.get(id)
      return card ? [card] : []
    })
  }, [cards, order])
  const n = orderedCards.length
  const { avail, cardW } = metrics
  // §2.5 fan step; 24px floor guarantees index visibility + WCAG 24px target.
  const step = n > 1 && cardW > 0 && avail > 0
    ? Math.max(24, Math.min(28, (avail - cardW) / (n - 1)))
    : 28
  const overlap = cardW > 0 ? Math.max(0, cardW - step) : 0

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(
      '.hand-fan__card > button, .hand-fan__card > [tabindex="0"]',
    ) ?? [])
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (idx === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowRight'
      ? buttons[(idx + 1) % buttons.length]
      : buttons[(idx - 1 + buttons.length) % buttons.length]
    next?.focus()
  }

  const renderCard = (c: CardT, i: number) => (
    <div
      key={c.id}
      style={{
        marginLeft: i === 0 ? 0 : -overlap,
        paddingBottom: 16,
        zIndex: Math.min(i + 1, 50),
      }}
      className="hand-fan__card shrink-0"
    >
      <Card
        card={c}
        state={states.get(c.id) ?? 'rest'}
        ariaHint={`${ariaHints?.get(c.id) ? `${ariaHints.get(c.id)}, ` : ''}${i + 1} of ${n}`}
        onActivate={onSelect ? () => onSelect(c.id) : undefined}
      />
    </div>
  )

  return (
    <div
      className="hand-fan-shell w-full"
      role="group"
      aria-label={`Your hand, ${n} ${n === 1 ? 'card' : 'cards'}; scroll horizontally`}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <div
        ref={containerRef}
        className="hand-fan w-full"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        <div
          className="hand-fan__row flex items-start justify-start px-s4"
          style={{ width: n > 0 && cardW > 0 ? cardW + step * (n - 1) + 32 : 'auto', margin: '0 auto', minWidth: 'fit-content' }}
        >
          {/* Hidden measuring card keeps W honest against the live CSS var. */}
          <div ref={measureRef} className="card invisible absolute pointer-events-none" aria-hidden="true" />
          {orderedCards.map(renderCard)}
        </div>
      </div>
    </div>
  )
}
