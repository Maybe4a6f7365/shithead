// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Card, Player } from '../../engine'
import { RearrangeScreen } from '../RearrangeScreen'
import { claimDeal, dealDelay, dealIn, dealTilt, DEAL_CARD_MS } from '../cardFlight'

describe('deal timing', () => {
  it('spaces cards evenly and keeps the whole deal near 600-700ms', () => {
    expect(dealDelay(0, 9)).toBe(0)
    expect(dealDelay(1, 9)).toBe(45)
    expect(dealDelay(8, 9)).toBe(360)
    expect(dealDelay(8, 9) + DEAL_CARD_MS).toBeLessThanOrEqual(700)
    // A big hand is squeezed rather than stretching the deal.
    expect(dealDelay(29, 30) + DEAL_CARD_MS).toBeLessThanOrEqual(700)
    expect(dealDelay(0, 1)).toBe(0)
  })

  it('tilts deterministically within ±5°', () => {
    for (let i = 0; i < 20; i++) expect(Math.abs(dealTilt(i))).toBeLessThanOrEqual(5)
    expect(dealTilt(3)).toBe(dealTilt(3))
  })

  it('claims a deal once per key', () => {
    expect(claimDeal('k-unique-1')).toBe(true)
    expect(claimDeal('k-unique-1')).toBe(false)
    expect(claimDeal('k-unique-2')).toBe(true)
  })
})

const card = (id: string, rank: Card['rank'] = '5', suit: Card['suit'] = '♠'): Card => ({ id, rank, suit })
const player: Player = {
  id: 'p1', name: 'Me',
  hand: [card('h1'), card('h2', '6'), card('h3', '7')],
  faceUp: [card('u1', '8'), card('u2', '9'), card('u3', 'J')],
  faceDown: [card('d1'), card('d2'), card('d3')], isOut: false,
}

describe('opening deal on the rearrange screen', () => {
  const calls: Array<{ id: string | undefined; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = []

  beforeEach(() => {
    calls.length = 0
    class ResizeObserverMock { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 100, top: 400, width: 80, height: 128, right: 180, bottom: 528, x: 100, y: 400, toJSON() {} } as DOMRect,
    )
    ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const cancel = vi.fn()
      calls.push({ id: this.dataset.cardId, keyframes, options, cancel })
      return { cancel }
    }
  })
  afterEach(() => {
    cleanup()
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
    vi.restoreAllMocks()
  })

  const screen = (id = 'p1', who = player) =>
    <RearrangeScreen player={{ ...who, id }} onSwap={vi.fn()} onReady={vi.fn()} />

  it('deals down, then up, then hand, each later than the last', () => {
    render(screen('deal-a'))
    expect(calls.map(c => c.id)).toEqual(['d1', 'd2', 'd3', 'u1', 'u2', 'u3', 'h1', 'h2', 'h3'])
    const delays = calls.map(c => Number(c.options.delay))
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(new Set(delays).size).toBe(9)
    // Individual transform properties (so a card's own CSS transform survives).
    expect(calls[0].keyframes[0]).toMatchObject({ opacity: 0 })
    expect(Object.keys(calls[0].keyframes[0])).toEqual(expect.arrayContaining(['translate', 'scale', 'rotate']))
    expect(Object.keys(calls[0].keyframes[0])).not.toContain('transform')
  })

  it('cancels every card on a tap anywhere (skip)', () => {
    const view = render(screen('deal-b'))
    fireEvent.pointerDown(view.container.querySelector('.rearrange-screen')!)
    expect(calls.every(c => c.cancel.mock.calls.length === 1)).toBe(true)
  })

  it('does not replay for the same cards after a remount', () => {
    const first = render(screen('deal-c'))
    expect(calls).toHaveLength(9)
    first.unmount()
    calls.length = 0
    render(screen('deal-c'))
    expect(calls).toHaveLength(0)
  })

  it('does nothing under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    render(screen('deal-d'))
    expect(calls).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('dealIn returns null with nothing to deal', () => {
    expect(dealIn(document.createElement('div'), { left: 0, top: 0, width: 60, height: 84 })).toBeNull()
    expect(dealIn(null, { left: 0, top: 0, width: 60, height: 84 })).toBeNull()
  })
})
