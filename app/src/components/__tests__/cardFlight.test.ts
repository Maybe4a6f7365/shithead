// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  flightDuration, flightOffset, forgetCardRect, isTrivialFlight, peekCardRect, recordCardRects,
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
