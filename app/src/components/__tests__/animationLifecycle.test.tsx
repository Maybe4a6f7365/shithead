// @vitest-environment jsdom
// Lifecycle and consistency guarantees of the table animations: nothing
// outlives its screen, anchors are measured where they are now, the deal is
// not replayed by a reload, one burst per round-over card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Card, Player } from '../../engine'
import { GameOverOverlay, type GameOverLeaderboardRow } from '../GameOverOverlay'
import { RearrangeScreen } from '../RearrangeScreen'
import { dealIn, flipsHeld, onViewportChange, peekSeatRect, registerSeat } from '../cardFlight'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('framer-motion', async importOriginal => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduced,
}))

const rect = (left: number, top: number, width = 80, height = 128): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect

const cancels: Array<ReturnType<typeof vi.fn>> = []
beforeEach(() => {
  cancels.length = 0
  motion.reduced = false
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function () {
    const cancel = vi.fn()
    cancels.push(cancel)
    return { cancel }
  }
})
afterEach(() => {
  cleanup()
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const card = (id: string, rank: Card['rank'] = '5'): Card => ({ id, rank, suit: '♠' })
const dealt = (id: string): Player => ({
  id, name: 'Me', isOut: false,
  hand: [card(`${id}-h1`), card(`${id}-h2`), card(`${id}-h3`)],
  faceUp: [card(`${id}-u1`), card(`${id}-u2`), card(`${id}-u3`)],
  faceDown: [card(`${id}-d1`), card(`${id}-d2`), card(`${id}-d3`)],
}) as Player

describe('opening deal lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(100, 300))
  })

  it('leaves no timer, running animation or FLIP hold behind when the screen unmounts mid-deal', () => {
    vi.useFakeTimers()
    const view = render(<RearrangeScreen player={dealt('life-a')} onSwap={vi.fn()} onReady={vi.fn()} />)
    expect(cancels.length).toBe(9)
    expect(flipsHeld()).toBe(true)
    view.unmount()
    expect(cancels.every(cancel => cancel.mock.calls.length === 1)).toBe(true)
    expect(flipsHeld()).toBe(false)
    // The deal's settle timer is gone: nothing measures the dead screen later.
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    const measured = measure.mock.calls.length
    vi.runAllTimers()
    expect(measure.mock.calls.length).toBe(measured)
    expect(flipsHeld()).toBe(false)
  })

  it('cancel() stops a deal without recording positions from a dead screen', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    root.innerHTML = '<div class="hand-fan__card" data-card-id="lone"></div>'
    document.body.append(root)
    const deal = dealIn(root, { left: 0, top: -100, width: 60, height: 84 })!
    deal.cancel()
    expect(vi.getTimerCount()).toBe(0)
    expect(flipsHeld()).toBe(false)
    root.remove()
  })

  it('does not replay the deal after a page reload in the same tab', async () => {
    const first = render(<RearrangeScreen player={dealt('life-b')} onSwap={vi.fn()} onReady={vi.fn()} />)
    expect(cancels.length).toBe(9)
    first.unmount()
    cancels.length = 0
    // A reload throws away module memory; only sessionStorage survives.
    vi.resetModules()
    const reloaded = await import('../RearrangeScreen')
    render(<reloaded.RearrangeScreen player={dealt('life-b')} onSwap={vi.fn()} onReady={vi.fn()} />)
    expect(cancels.length).toBe(0)
  })

  it('still deals when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<RearrangeScreen player={dealt('life-c')} onSwap={vi.fn()} onReady={vi.fn()} />)
    expect(cancels.length).toBe(9)
  })
})

describe('flight anchors', () => {
  it('measures a seat where it is now, not where it was when last rendered', () => {
    const seat = document.createElement('div')
    document.body.append(seat)
    const measure = vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue(rect(40, 20))
    registerSeat('anchor-seat', seat)
    expect(peekSeatRect('anchor-seat')).toMatchObject({ left: 40, top: 20 })
    // The phone rotates: the seat moves, nothing re-renders.
    measure.mockReturnValue(rect(310, 12))
    expect(peekSeatRect('anchor-seat')).toMatchObject({ left: 310, top: 12 })
    // Once the seat has left the page, its last known position still answers.
    seat.remove()
    expect(peekSeatRect('anchor-seat')).toMatchObject({ left: 310, top: 12 })
    registerSeat('anchor-seat', null)
    expect(peekSeatRect('anchor-seat')).toBeNull()
  })

  it('re-records card positions on resize and rotation, and stops when unsubscribed', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const nextFrame = () => frames.splice(0).forEach(callback => callback(0))
    const record = vi.fn()
    const stop = onViewportChange(record)
    // A burst of resize events in one frame is one re-measure.
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    nextFrame()
    expect(record).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('orientationchange'))
    nextFrame()
    expect(record).toHaveBeenCalledTimes(2)
    stop()
    window.dispatchEvent(new Event('resize'))
    nextFrame()
    expect(record).toHaveBeenCalledTimes(2)
  })
})

const row = (playerId: string, name: string, place: number, isLoser = false): GameOverLeaderboardRow => ({
  playerId, name, place, isLoser, cardsPlayed: 10, tensPlayed: 1, burns: 1, pickups: 1, largestPickup: 4,
})
const board = [row('a', 'Alex', 1), row('b', 'Bea', 2), row('c', 'Cy', 3, true)]
const titleBurst = (root: HTMLElement) => root.querySelector('.game-over-card__burst:not(.game-over-row-burst)')

describe('round-over card', () => {
  it('cancels the reveal and its winner timer when it unmounts mid count-down', () => {
    vi.useFakeTimers()
    const view = render(<GameOverOverlay result="win" shitheadName="Cy" canRematch={false} onLeave={vi.fn()} leaderboard={board} />)
    expect(cancels.length).toBeGreaterThan(0)
    const before = vi.getTimerCount()
    view.unmount()
    expect(cancels.every(cancel => cancel.mock.calls.length === 1)).toBe(true)
    expect(vi.getTimerCount()).toBeLessThan(before)
    // Nothing left that could fire the burst on a card that is gone.
    expect(() => vi.runAllTimers()).not.toThrow()
  })

  it('shows one burst, not two: the count-down ends on the winner row burst', () => {
    vi.useFakeTimers()
    const view = render(<GameOverOverlay result="win" shitheadName="Cy" canRematch={false} onLeave={vi.fn()} leaderboard={board} />)
    expect(titleBurst(view.container)).toBeNull()
  })

  it('keeps the title burst when there is no count-down to end on', () => {
    const noBoard = render(<GameOverOverlay result="win" shitheadName="Cy" canRematch={false} onLeave={vi.fn()} />)
    expect(titleBurst(noBoard.container)).not.toBeNull()
    cleanup()
    motion.reduced = true
    const still = render(<GameOverOverlay result="win" shitheadName="Cy" canRematch={false} onLeave={vi.fn()} leaderboard={board} />)
    expect(titleBurst(still.container)).not.toBeNull()
    expect(still.container.querySelector('.game-over-row-burst')).toBeNull()
  })
})
