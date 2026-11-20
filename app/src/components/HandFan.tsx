// ============================================================================
// HandFan (Z4) — the hand fan in the thumb zone (§2.5, §3.1).
// Hands fan at a 24px target floor and always use the same single-row layout.
// Pickups only make the row wider and horizontally scrollable; card size,
// vertical position, and spacing never change at a card-count threshold.
// Roving tabindex + ←/→ keyboard navigation (§6.5).
// ============================================================================
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { HAND_DISPLAY_ORDER, type Card as CardT } from '../engine'
import { Card, type CardVisualState } from './Card'
import { flipHand, onAnyScroll, onViewportChange, recordCardRects, type HandEntrySource } from './cardFlight'

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

/**
 * The order to show `cards` in, given the order they were last shown in.
 * Played cards drop out and the rest stay put; as soon as a card arrives (a
 * draw or a pickup) the whole hand is sorted again.
 */
export function nextHandOrder(shown: string[] | undefined, cards: CardT[]): string[] {
  const reconciled = reconcileHandOrder(shown ?? [], cards)
  const arrived = shown === undefined || reconciled.some(id => !shown.includes(id))
  if (!arrived) return reconciled
  const sorted = sortHandByDisplay(cards)
  return sameOrder(reconciled, sorted) ? reconciled : sorted
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
  /** Where newly arrived cards fly in from: the stock (draw) or pile (pickup). */
  entryFrom?: HandEntrySource
}

export function HandFan({
  cards, states, ariaHints, onSelect, labelledBy, orderKey = 'default', entryFrom = null,
}: HandFanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const shownOrders = useRef(new Map<string, string[]>())
  const [metrics, setMetrics] = useState({ avail: 0, cardW: 0 })
  // Roving tabindex: exactly one card is the hand's tab stop.
  const [tabStop, setTabStop] = useState(0)
  // Which edges hide more cards; drives the fade that says "this scrolls".
  const [overflow, setOverflow] = useState({ start: false, end: false })
  const previousCount = useRef(cards.length)

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

  // The order is decided during render, from the order last committed for this
  // viewer. A drawn card therefore appears in its sorted slot straight away.
  // Sorting one render later laid the hand out twice: the fly-in was aimed at
  // the wrong slot, and the cards slid a second time once they had landed.
  const orderedCards = useMemo(() => {
    const byId = new Map(cards.map(card => [card.id, card] as const))
    return nextHandOrder(shownOrders.current.get(orderKey), cards).flatMap(id => {
      const card = byId.get(id)
      return card ? [card] : []
    })
  }, [cards, orderKey])
  useLayoutEffect(() => {
    shownOrders.current.set(orderKey, orderedCards.map(card => card.id))
  }, [orderedCards, orderKey])
  const n = orderedCards.length
  const { avail, cardW } = metrics
  // §2.5 fan step; 24px floor guarantees index visibility + WCAG 24px target.
  const step = n > 1 && cardW > 0 && avail > 0
    ? Math.max(24, Math.min(28, (avail - cardW) / (n - 1)))
    : 28
  const overlap = cardW > 0 ? Math.max(0, cardW - step) : 0

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => {
      const max = container.scrollWidth - container.clientWidth
      const next = { start: container.scrollLeft > 2, end: max - container.scrollLeft > 2 }
      setOverflow(current => (current.start === next.start && current.end === next.end ? current : next))
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => container.removeEventListener('scroll', update)
  }, [n, avail, cardW])

  // Remember where each card sits so a played card can fly to the pile from
  // its real slot (the slot has unmounted by the time the pile renders).
  const flipReady = useRef(false)
  const flipOrderKey = useRef(orderKey)
  useLayoutEffect(() => {
    const container = containerRef.current
    const reduceMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // No animation for the first deal or when a hot-seat viewer swaps hands.
    const animate = flipReady.current && flipOrderKey.current === orderKey && !reduceMotion
    flipReady.current = true
    flipOrderKey.current = orderKey
    if (animate) flipHand(container, entryFrom)
    recordCardRects(container)
  })
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => recordCardRects(container)
    container.addEventListener('scroll', onScroll, { passive: true })
    // The page itself can scroll too (small screens); keep rects in viewport space.
    const stopPageScroll = onAnyScroll(onScroll)
    const stopViewport = onViewportChange(onScroll)
    return () => {
      container.removeEventListener('scroll', onScroll)
      stopPageScroll()
      stopViewport()
    }
  }, [])

  // A pickup or draw re-sorts the hand and can push the cards that matter
  // off-screen. Bring the first selected (else first playable) card back into
  // view — only when the hand grew, so manual scrolling is never fought.
  const keepKeyCardInView = useEffectEvent(() => {
    const grew = n > previousCount.current
    previousCount.current = n
    const container = containerRef.current
    if (!grew || !container || typeof container.scrollTo !== 'function') return
    if (container.scrollWidth <= container.clientWidth) return
    const target = orderedCards.find(card => states.get(card.id) === 'selected')
      ?? orderedCards.find(card => states.get(card.id) === 'playable' || states.get(card.id) === 'joinable')
    if (!target) return
    const index = orderedCards.indexOf(target)
    const node = container.querySelectorAll<HTMLElement>('.hand-fan__card')[index]
    if (!node) return
    const left = node.offsetLeft
    const right = left + node.offsetWidth
    if (left >= container.scrollLeft && right <= container.scrollLeft + container.clientWidth) return
    const reduceMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({
      left: Math.max(0, left - (container.clientWidth - node.offsetWidth) / 2),
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  })
  useEffect(() => keepKeyCardInView(), [n])

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
      data-card-id={c.id}
      onFocus={() => setTabStop(i)}
    >
      <Card
        card={c}
        state={states.get(c.id) ?? 'rest'}
        ariaHint={`${ariaHints?.get(c.id) ? `${ariaHints.get(c.id)}, ` : ''}${i + 1} of ${n}`}
        onActivate={onSelect ? () => onSelect(c.id) : undefined}
        focusable={i === Math.min(tabStop, n - 1)}
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
        data-overflow-start={overflow.start ? 'true' : 'false'}
        data-overflow-end={overflow.end ? 'true' : 'false'}
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
