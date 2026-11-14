// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  flightDuration, flightOffset, flipHand, forgetCardRect, isTrivialFlight, peekCardRect, recordCardRects, registerSeat,
} from '../cardFlight'

const rect = (left: number, top: number, width = 60, height = 84) => ({ left, top, width, height })

describe('cardFlight', () => {
  it('offsets from the destination centre back to the origin centre', () => {
    const offset = flightOffset(rect(10, 500), rect(150, 200))
    expect(offset.x).toBe(10 - 150)
    expect(offset.y).toBe(500 - 200)
    expect(offset.scale).toBe(1)
  })

  it('scales a small origin (opponent seat) up to the pile card, clamped', () => {
    expect(flightOffset(rect(0, 0, 30, 40), rect(0, 0, 60, 84)).scale).toBe(0.5)
    expect(flightOffset(rect(0, 0, 1, 1), rect(0, 0, 60, 84)).scale).toBe(0.3)
    expect(flightOffset(rect(0, 0, 600, 1), rect(0, 0, 60, 84)).scale).toBe(1.4)
  })

  it('keeps durations in the 200–340ms band and ignores tiny hops', () => {
    expect(flightDuration({ x: 0, y: 0, scale: 1 })).toBe(0.2)
    expect(flightDuration({ x: 3000, y: 3000, scale: 1 })).toBe(0.34)
    expect(isTrivialFlight({ x: 5, y: 5, scale: 1 })).toBe(true)
    expect(isTrivialFlight({ x: 80, y: 0, scale: 1 })).toBe(false)
  })

  it('records tagged elements with real size and forgets them on demand', () => {
    const root = document.createElement('div')
    const visible = document.createElement('div')
    visible.dataset.cardId = 'c1'
    visible.getBoundingClientRect = () => ({ left: 4, top: 8, width: 50, height: 70 } as DOMRect)
    const flat = document.createElement('div') // jsdom default: 0×0, must be skipped
    flat.dataset.cardId = 'c2'
    root.append(visible, flat)
    recordCardRects(root)
    expect(peekCardRect('c1')).toEqual({ left: 4, top: 8, width: 50, height: 70 })
    expect(peekCardRect('c2')).toBeNull()
    forgetCardRect('c1')
    expect(peekCardRect('c1')).toBeNull()
  })
})

describe('flipHand', () => {
  const box = (id: string, left: number, top = 600) => {
    const el = document.createElement('div')
    el.dataset.cardId = id
    el.getBoundingClientRect = () => ({ left, top, width: 80, height: 128 } as DOMRect)
    const calls: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = []
    ;(el as unknown as { animate: unknown }).animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      calls.push({ keyframes, options })
      return {}
    }
    return { el, calls }
  }
  const rootOf = (...els: HTMLElement[]) => {
    const root = document.createElement('div')
    root.append(...els)
    return root
  }

  it('slides neighbours that moved, leaves still cards alone', () => {
    const before = rootOf(box('a', 0).el, box('b', 28).el, box('c', 56).el)
    recordCardRects(before)
    const a = box('a', 0), c = box('c', 28) // b played; c closes the gap
    flipHand(rootOf(a.el, c.el), null)
    expect(a.calls).toHaveLength(0)
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0].keyframes[0]).toEqual({ transform: 'translate(28px, 0px)' })
  })

  it('flies new cards in from the stock anchor, staggered', () => {
    registerSeat('stock', (() => {
      const el = document.createElement('div')
      el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 80, height: 128 } as DOMRect)
      return el
    })())
    const n1 = box('n1', 0), n2 = box('n2', 28)
    flipHand(rootOf(n1.el, n2.el), 'stock')
    expect(n1.calls[0].options.delay).toBe(0)
    expect(n2.calls[0].options.delay).toBe(40)
    expect(String(n1.calls[0].keyframes[0].transform)).toContain('translate(100px, -400px)')
  })

  it('fades new cards in when no origin is known', () => {
    const n = box('n3', 0)
    flipHand(rootOf(n.el), 'pile')
    expect(n.calls[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })
})
