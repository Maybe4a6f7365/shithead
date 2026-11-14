// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Card, Player } from '../../engine'
import { RearrangeScreen } from '../RearrangeScreen'
import { TableauWell } from '../TableauWell'
import { flightOffset, flipTableau, isTrivialTableauMove, recordCardRects, releaseFlips, TABLEAU_FLIP_MS } from '../cardFlight'

describe('isTrivialTableauMove', () => {
  it('ignores sub-pixel, same-size moves but not size changes', () => {
    expect(isTrivialTableauMove({ x: 0.4, y: 0.2, scale: 1 })).toBe(true)
    expect(isTrivialTableauMove({ x: 0, y: 0, scale: 1.01 })).toBe(true)
    expect(isTrivialTableauMove({ x: 0, y: 0, scale: 0.5 })).toBe(false)
    expect(isTrivialTableauMove({ x: 40, y: 0, scale: 1 })).toBe(false)
  })
})

const calls: Array<{ id: string | undefined; keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = []

beforeEach(() => {
  calls.length = 0
  releaseFlips() // an earlier test's opening deal holds the FLIP; a tap would release it
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ id: this.dataset.cardId, keyframes, options })
    return { cancel() {} }
  }
})
afterEach(() => {
  cleanup()
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  vi.restoreAllMocks()
})

/** Hand wrappers live low on the screen, tableau wrappers higher; mini tableau is half size. */
function mockRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const inHand = this.classList.contains('hand-fan__card')
    const inTableau = this.classList.contains('tableau-stack__up') || this.classList.contains('tableau-stack__down')
    if (!inHand && !inTableau) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
    const mini = this.closest('.tableau-well')?.getAttribute('data-size') === 'mini'
    const w = mini ? 40 : 80
    const left = inHand ? 50 : 200
    const top = inHand ? 600 : 250
    return { left, top, width: w, height: w * 1.6, right: left + w, bottom: top + w * 1.6, x: left, y: top, toJSON() {} } as DOMRect
  })
}

const card = (id: string, rank: Card['rank'] = '5', suit: Card['suit'] = '♠'): Card => ({ id, rank, suit })
const player = (swapped: boolean): Player => ({
  id: 'me', name: 'Me',
  hand: [swapped ? card('u1', '8') : card('h1'), card('h2', '6'), card('h3', '7')],
  faceUp: [swapped ? card('h1') : card('u1', '8'), card('u2', '9'), card('u3', 'J')],
  faceDown: [card('d1'), card('d2'), card('d3')], isOut: false,
})

describe('swap on the rearrange screen', () => {
  it('glides the swapped cards between the hand and the face-up row', () => {
    mockRects()
    const onSwap = vi.fn()
    const view = render(<RearrangeScreen player={player(false)} onSwap={onSwap} onReady={vi.fn()} />)
    // Mount is the deal's business, not a handoff; the player's first tap ends it.
    calls.length = 0
    releaseFlips()

    fireEvent.click(screen.getByRole('button', { name: /^5 of spades.*tap to mark/i }))
    fireEvent.click(screen.getByRole('button', { name: /8 of spades.*tap to swap/i }))
    expect(onSwap).toHaveBeenCalledWith(0, 0)

    view.rerender(<RearrangeScreen player={player(true)} onSwap={onSwap} onReady={vi.fn()} />)
    const intoTableau = calls.find(c => c.id === 'h1' && 'translate' in c.keyframes[0])
    const intoHand = calls.find(c => c.id === 'u1')
    expect(intoTableau).toBeTruthy()
    expect(intoHand).toBeTruthy()
    // h1 left the hand (low on screen) for the tableau: it starts below its slot.
    expect(String(intoTableau!.keyframes[0].translate)).toMatch(/^-150px 350px$/)
    expect(intoTableau!.options.duration).toBe(TABLEAU_FLIP_MS)
    // Untouched cards stay put.
    expect(calls.find(c => c.id === 'h2')).toBeUndefined()
    expect(calls.find(c => c.id === 'u2')).toBeUndefined()
  })
})

describe('minis growing to full size', () => {
  const up = [card('u1', '8'), card('u2', '9'), card('u3', 'J')]
  const down = [card('d1'), card('d2'), card('d3')]

  it('scales each card up from its mini box instead of popping', () => {
    mockRects()
    const view = render(<TableauWell faceUp={up} faceDown={down} />)
    calls.length = 0
    view.rerender(<TableauWell faceUp={up} faceDown={down} fullSize />)
    const grown = calls.filter(c => c.id === 'u1')
    expect(grown).toHaveLength(1)
    expect(String(grown[0].keyframes[0].scale)).toBe('0.5')
    expect(grown[0].keyframes[1]).toMatchObject({ translate: '0px 0px', scale: '1' })
    // Face-down cards grow too, and nothing animates `transform` (they carry a CSS one).
    expect(calls.some(c => c.id === 'd1')).toBe(true)
    expect(calls.every(c => !('transform' in c.keyframes[0]))).toBe(true)
  })

  it('does not animate on first mount or when nothing changed', () => {
    mockRects()
    const view = render(<TableauWell faceUp={up} faceDown={down} fullSize />)
    expect(calls).toHaveLength(0)
    view.rerender(<TableauWell faceUp={up} faceDown={down} fullSize />)
    expect(calls).toHaveLength(0)
  })
})

describe('flipTableau', () => {
  it('leaves cards with no recorded rect alone', () => {
    const root = document.createElement('div')
    const el = document.createElement('div')
    el.dataset.cardId = 'never-seen'
    el.getBoundingClientRect = () => ({ left: 5, top: 5, width: 80, height: 128 } as DOMRect)
    ;(el as unknown as { animate: unknown }).animate = () => { throw new Error('should not animate') }
    root.append(el)
    expect(() => flipTableau(root)).not.toThrow()
  })

  it('uses flightOffset geometry (centre to centre)', () => {
    const root = document.createElement('div')
    const el = document.createElement('div')
    el.dataset.cardId = 'geo'
    const rect = (left: number, top: number, width: number) => ({ left, top, width, height: width * 1.6 } as DOMRect)
    el.getBoundingClientRect = () => rect(100, 100, 80)
    const seen: Keyframe[][] = []
    ;(el as unknown as { animate: unknown }).animate = (k: Keyframe[]) => { seen.push(k); return {} }
    root.append(el)
    // Recorded earlier as a 40-wide mini at the same top-left.
    const prev = document.createElement('div')
    prev.dataset.cardId = 'geo'
    prev.getBoundingClientRect = () => rect(100, 100, 40)
    const holder = document.createElement('div'); holder.append(prev)
    recordCardRects(holder)
    flipTableau(root)
    const expected = flightOffset({ left: 100, top: 100, width: 40, height: 64 }, { left: 100, top: 100, width: 80, height: 128 })
    expect(seen[0][0]).toEqual({ translate: `${expected.x}px ${expected.y}px`, scale: String(expected.scale) })
  })
})

describe('rearrange selection under StrictMode', () => {
  it('swaps exactly once (no side effects inside a state updater)', async () => {
    const { StrictMode } = await import('react')
    mockRects()
    releaseFlips()
    const onSwap = vi.fn()
    render(<StrictMode><RearrangeScreen player={player(false)} onSwap={onSwap} onReady={vi.fn()} /></StrictMode>)
    releaseFlips()
    fireEvent.click(screen.getByRole('button', { name: /^5 of spades.*tap to mark/i }))
    fireEvent.click(screen.getByRole('button', { name: /8 of spades.*tap to swap/i }))
    expect(onSwap).toHaveBeenCalledTimes(1)
    expect(onSwap).toHaveBeenCalledWith(0, 0)
  })
})
