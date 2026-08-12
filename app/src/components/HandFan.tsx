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

const TOUCH_REORDER_DELAY_MS = 420
const POINTER_DRAG_SLOP_PX = 8

interface DragSession {
  cardId: string
  orderKey: string
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  currentX: number
  dragging: boolean
  longPressed: boolean
  lastTargetId: string
  initialOrder: string[]
  timer: ReturnType<typeof setTimeout> | null
}

/** Keep the viewer's manual order while removing played cards and appending draws. */
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

/** Move one opaque card id to another card's position without changing the game state. */
export function moveHandCard(order: string[], cardId: string, targetId: string): string[] {
  const from = order.indexOf(cardId)
  const to = order.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return order
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
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
  /** Long-press/touch or pointer-drag ordering; Alt+Arrow is the keyboard equivalent. */
  reorderable?: boolean
  /** Keeps independent local presentation orders when a hot-seat viewer changes. */
  orderKey?: string
}

export function HandFan({
  cards, states, ariaHints, onSelect, labelledBy, reorderable = false, orderKey = 'default',
}: HandFanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const dragSession = useRef<DragSession | null>(null)
  const visibleOrderRef = useRef<string[]>([])
  const focusAfterMove = useRef<string | null>(null)
  const suppressNextClickFor = useRef<string | null>(null)
  const suppressClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edgeScrollFrame = useRef<number | null>(null)
  const edgeScrollDirection = useRef<-1 | 0 | 1>(0)
  const ordersByKey = useRef(new Map<string, string[]>())
  const activeOrderKey = useRef(orderKey)
  const [metrics, setMetrics] = useState({ avail: 0, cardW: 0 })
  const [order, setOrder] = useState(() => sortHandByDisplay(cards))
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [reorderMessage, setReorderMessage] = useState('')

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

  useEffect(() => () => {
    if (dragSession.current?.timer) clearTimeout(dragSession.current.timer)
    if (suppressClickTimer.current) clearTimeout(suppressClickTimer.current)
    if (edgeScrollFrame.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(edgeScrollFrame.current)
    }
  }, [])

  useLayoutEffect(() => {
    const id = focusAfterMove.current
    if (!id) return
    focusAfterMove.current = null
    cardRefs.current.get(id)?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus()
  }, [order])

  const orderedCards = useMemo(() => {
    const reconciled = reconcileHandOrder(order, cards)
    const byId = new Map(cards.map(card => [card.id, card] as const))
    return reconciled.flatMap(id => {
      const card = byId.get(id)
      return card ? [card] : []
    })
  }, [cards, order])
  visibleOrderRef.current = orderedCards.map(card => card.id)

  const n = orderedCards.length
  const canReorder = reorderable && n > 1
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
    if (canReorder && e.altKey) {
      const targetIndex = e.key === 'ArrowRight' ? idx + 1 : idx - 1
      if (targetIndex < 0 || targetIndex >= orderedCards.length) return
      const card = orderedCards[idx]
      const target = orderedCards[targetIndex]
      focusAfterMove.current = card.id
      updateOrder(current => moveHandCard(current, card.id, target.id))
      setReorderMessage(`${card.rank === 'JOKER' ? 'Joker' : card.rank} moved to position ${targetIndex + 1}`)
      return
    }
    const next = e.key === 'ArrowRight'
      ? buttons[(idx + 1) % buttons.length]
      : buttons[(idx - 1 + buttons.length) % buttons.length]
    next?.focus()
  }

  const clearDragTimer = (session: DragSession | null) => {
    if (session?.timer) clearTimeout(session.timer)
    if (session) session.timer = null
  }

  const beginDrag = (session: DragSession) => {
    if (session.dragging) return
    clearDragTimer(session)
    session.dragging = true
    setDraggingId(session.cardId)
    setReorderMessage('Reordering hand. Drag left or right, then release.')
  }

  const suppressUpcomingCardClick = (cardId: string) => {
    suppressNextClickFor.current = cardId
    if (suppressClickTimer.current) clearTimeout(suppressClickTimer.current)
    // A click generated by pointerup is dispatched in the same task. The
    // fallback prevents a cancelled gesture from swallowing a later tap.
    suppressClickTimer.current = setTimeout(() => {
      suppressNextClickFor.current = null
      suppressClickTimer.current = null
    }, 250)
  }

  const updateOrder = (update: (current: string[]) => string[]) => {
    setOrder(current => {
      const next = update(reconcileHandOrder(current, cards))
      ordersByKey.current.set(orderKey, next)
      return next
    })
  }

  const moveDraggedCardToward = (session: DragSession, clientX: number) => {
    let targetId = session.cardId
    let closestDistance = Number.POSITIVE_INFINITY
    for (const id of visibleOrderRef.current) {
      const bounds = cardRefs.current.get(id)?.getBoundingClientRect()
      if (!bounds) continue
      const distanceToCenter = Math.abs(clientX - (bounds.left + bounds.right) / 2)
      if (distanceToCenter < closestDistance) {
        closestDistance = distanceToCenter
        targetId = id
      }
    }
    if (targetId === session.cardId) {
      // Reordering moves the dragged node beneath the stationary pointer. Mark
      // that crossing so the previous neighbour can become a valid target
      // again when the same gesture reverses direction.
      session.lastTargetId = session.cardId
      return
    }
    if (targetId === session.lastTargetId) return
    session.lastTargetId = targetId
    updateOrder(current => moveHandCard(current, session.cardId, targetId))
  }

  const stopEdgeScroll = () => {
    edgeScrollDirection.current = 0
    if (edgeScrollFrame.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(edgeScrollFrame.current)
    }
    edgeScrollFrame.current = null
  }

  const startEdgeScroll = (direction: -1 | 0 | 1) => {
    edgeScrollDirection.current = direction
    if (direction === 0) {
      stopEdgeScroll()
      return
    }
    if (edgeScrollFrame.current !== null) return
    if (typeof requestAnimationFrame !== 'function') {
      const session = dragSession.current
      const container = containerRef.current
      if (session?.dragging && container) {
        container.scrollLeft += direction * 18
        moveDraggedCardToward(session, session.currentX)
      }
      return
    }
    const tick = () => {
      edgeScrollFrame.current = null
      const session = dragSession.current
      const container = containerRef.current
      const activeDirection = edgeScrollDirection.current
      if (!session?.dragging || !container || activeDirection === 0) {
        stopEdgeScroll()
        return
      }
      const before = container.scrollLeft
      container.scrollLeft += activeDirection * 8
      moveDraggedCardToward(session, session.currentX)
      if (container.scrollLeft === before) {
        stopEdgeScroll()
        return
      }
      edgeScrollFrame.current = requestAnimationFrame(tick)
    }
    edgeScrollFrame.current = requestAnimationFrame(tick)
  }

  const finishDrag = (pointerId: number, cancelled = false, event?: { preventDefault(): void }) => {
    const session = dragSession.current
    if (!session || session.pointerId !== pointerId) return
    clearDragTimer(session)
    stopEdgeScroll()
    dragSession.current = null
    if (session.longPressed) {
      if (!cancelled) suppressUpcomingCardClick(session.cardId)
      setDraggingId(null)
      return
    }
    if (session.dragging) {
      event?.preventDefault()
      if (!cancelled) suppressUpcomingCardClick(session.cardId)
      if (cancelled) updateOrder(() => reconcileHandOrder(session.initialOrder, cards))
      setReorderMessage(cancelled ? 'Card move cancelled.' : 'Hand order updated.')
      const cardNode = cardRefs.current.get(session.cardId)
      if (cardNode?.hasPointerCapture?.(session.pointerId)) cardNode.releasePointerCapture(session.pointerId)
    }
    setDraggingId(null)
  }

  useEffect(() => {
    const finish = (event: PointerEvent) => finishDrag(event.pointerId, event.type === 'pointercancel', event)
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
    return () => {
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
    }
  })

  useEffect(() => {
    const session = dragSession.current
    if (!session) return
    if (session.orderKey !== orderKey) {
      clearDragTimer(session)
      stopEdgeScroll()
      ordersByKey.current.set(session.orderKey, session.initialOrder)
      dragSession.current = null
      setDraggingId(null)
      return
    }
    if (!reorderable || cards.length < 2 || !cards.some(card => card.id === session.cardId)) {
      finishDrag(session.pointerId, true)
    }
  }, [cards, orderKey, reorderable])

  const onCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, cardId: string) => {
    if (!canReorder || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (dragSession.current) {
      finishDrag(dragSession.current.pointerId, true)
    }
    const session: DragSession = {
      cardId,
      orderKey,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      dragging: false,
      longPressed: false,
      lastTargetId: cardId,
      initialOrder: [...visibleOrderRef.current],
      timer: null,
    }
    if (event.pointerType === 'touch') {
      session.timer = setTimeout(() => {
        if (dragSession.current !== session) return
        session.timer = null
        beginDrag(session)
      }, TOUCH_REORDER_DELAY_MS)
    } else {
      // Capture before the movement threshold so a release just outside an
      // overlapped wrapper cannot strand the pending gesture.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    dragSession.current = session
  }

  const onCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (session.longPressed) return
    session.currentX = event.clientX
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
    if (!session.dragging) {
      if (session.pointerType !== 'touch' && distance >= POINTER_DRAG_SLOP_PX) {
        beginDrag(session)
      } else if (session.pointerType === 'touch' && distance >= POINTER_DRAG_SLOP_PX) {
        // A touch swipe belongs to the horizontally scrolling hand rail.
        clearDragTimer(session)
        stopEdgeScroll()
        dragSession.current = null
        return
      } else {
        return
      }
    }

    event.preventDefault()
    const container = containerRef.current
    if (container) {
      const bounds = container.getBoundingClientRect()
      const direction = event.clientX < bounds.left + 36 ? -1
        : event.clientX > bounds.right - 36 ? 1
          : 0
      startEdgeScroll(direction)
    } else {
      stopEdgeScroll()
    }
    moveDraggedCardToward(session, event.clientX)
  }

  const renderCard = (c: CardT, i: number) => (
    <div
      key={c.id}
      ref={node => {
        if (node) cardRefs.current.set(c.id, node)
        else cardRefs.current.delete(c.id)
      }}
      style={{
        marginLeft: i === 0 ? 0 : -overlap,
        paddingBottom: 16,
        zIndex: draggingId === c.id ? n + 2 : Math.min(i + 1, 50),
      }}
      className="hand-fan__card shrink-0"
      data-dragging={draggingId === c.id ? 'true' : undefined}
      onPointerDown={event => onCardPointerDown(event, c.id)}
      onPointerMove={onCardPointerMove}
      onPointerUp={event => finishDrag(event.pointerId, false, event)}
      onPointerCancel={event => finishDrag(event.pointerId, true, event)}
      onLostPointerCapture={event => finishDrag(event.pointerId, true)}
      onContextMenu={event => {
        if (dragSession.current || suppressNextClickFor.current === c.id) event.preventDefault()
      }}
      onClickCapture={event => {
        if (suppressNextClickFor.current === c.id) {
          suppressNextClickFor.current = null
          if (suppressClickTimer.current) clearTimeout(suppressClickTimer.current)
          suppressClickTimer.current = null
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }}
    >
      <Card
        card={c}
        state={states.get(c.id) ?? 'rest'}
        ariaHint={`${ariaHints?.get(c.id) ? `${ariaHints.get(c.id)}, ` : ''}${i + 1} of ${n}`}
        onActivate={onSelect ? () => onSelect(c.id) : undefined}
        focusable={canReorder && !onSelect}
      />
    </div>
  )

  return (
    <div
      className="hand-fan-shell w-full"
      role="group"
      aria-label={`Your hand, ${n} ${n === 1 ? 'card' : 'cards'}; scroll horizontally${canReorder ? '; drag or hold then drag to reorder; Alt plus arrow keys also reorder' : ''}`}
      aria-labelledby={labelledBy}
      data-reorderable={canReorder ? 'true' : undefined}
      data-reordering={draggingId ? 'true' : undefined}
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
      <span className="sr-only" aria-live="polite">{reorderMessage}</span>
    </div>
  )
}
