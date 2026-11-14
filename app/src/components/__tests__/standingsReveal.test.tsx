// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { GameOverOverlay, type GameOverLeaderboardRow } from '../GameOverOverlay'
import {
  REVEAL_MAX_STEP_MS, REVEAL_START_MS, revealStandings, standingsDelay, standingsStep,
} from '../standingsReveal'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('framer-motion', async importOriginal => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduced,
}))

describe('standings timing', () => {
  it('reveals the last row first and the winner last', () => {
    const delays = [0, 1, 2, 3].map(index => standingsDelay(index, 4))
    expect(delays[3]).toBe(REVEAL_START_MS)
    expect(delays).toEqual([...delays].sort((a, b) => b - a))
    expect(new Set(delays).size).toBe(4)
  })

  it('squeezes big tables so the count-down stays short', () => {
    expect(standingsStep(1)).toBe(0)
    expect(standingsStep(2)).toBe(REVEAL_MAX_STEP_MS)
    expect(standingsStep(5)).toBe(170)
    expect(standingsDelay(0, 9) - REVEAL_START_MS).toBeLessThanOrEqual(900)
  })
})

const row = (playerId: string, name: string, place: number, isLoser = false): GameOverLeaderboardRow => ({
  playerId, name, place, isLoser, cardsPlayed: 10, tensPlayed: 1, burns: 1, pickups: 1, largestPickup: 4,
})
const board = [row('a', 'Alex', 1), row('b', 'Bea', 2), row('c', 'Cy', 3), row('d', 'Dee', 4, true)]

const calls: Array<{ el: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = []

beforeEach(() => {
  calls.length = 0
  motion.reduced = false
  ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const cancel = vi.fn()
    calls.push({ el: this, keyframes, options, cancel })
    return { cancel }
  }
})
afterEach(() => {
  cleanup()
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  vi.restoreAllMocks()
})

const overlay = (rows = board) => (
  <GameOverOverlay result="win" shitheadName="Dee" canRematch={false} onLeave={vi.fn()} leaderboard={rows} />
)
const rowCalls = () => calls.filter(c => c.el.tagName === 'TR')

describe('standings reveal on the game-over card', () => {
  it('lands the rows from last place to first', () => {
    render(overlay())
    const rows = rowCalls()
    expect(rows).toHaveLength(4)
    const byName = Object.fromEntries(rows.map(c => [c.el.querySelector('th span')?.textContent, Number(c.options.delay)]))
    expect(byName.Dee).toBe(REVEAL_START_MS)
    expect(byName.Dee).toBeLessThan(byName.Cy)
    expect(byName.Cy).toBeLessThan(byName.Bea)
    expect(byName.Bea).toBeLessThan(byName.Alex)
    expect(rows.every(c => c.options.fill === 'backwards')).toBe(true)
    expect(rows[0].keyframes[0]).toMatchObject({ opacity: 0, translate: '0px 14px' })
  })

  it('stamps the Shithead tag a beat after the loser row lands', () => {
    render(overlay())
    const tag = calls.find(c => c.el.classList.contains('game-over-loser-tag'))!
    const loserRow = rowCalls().find(c => c.el.getAttribute('data-loser') === 'true')!
    expect(Number(tag.options.delay)).toBe(Number(loserRow.options.delay) + 200)
    expect(tag.keyframes[0]).toMatchObject({ opacity: 0, scale: '2.4' })
    expect(tag.keyframes.at(-1)).toMatchObject({ opacity: 1, scale: '1', rotate: '-3deg' })
    expect(tag.options.fill).toBe('both')
  })

  it('fades the highlights in after the rows', () => {
    render(overlay())
    const lastRowStart = Math.max(...rowCalls().map(c => Number(c.options.delay)))
    const highlights = calls.filter(c => c.el.tagName === 'LI')
    expect(highlights).toHaveLength(3)
    expect(Math.min(...highlights.map(c => Number(c.options.delay)))).toBeGreaterThan(lastRowStart)
  })

  it('fires the winner burst when the first-place row lands, positioned over the leaderboard', async () => {
    const view = render(overlay())
    expect(view.container.querySelector('.game-over-row-burst')).toBeNull()
    await waitFor(() => expect(view.container.querySelector('.game-over-row-burst')).not.toBeNull(), { timeout: 3000 })
    const burst = view.container.querySelector('.game-over-row-burst') as HTMLElement
    expect(burst.getAttribute('aria-hidden')).toBe('true')
    expect(burst.closest('.game-over-leaderboard')).not.toBeNull()
    // Outside the clipping scroll region, so particles are not cut off.
    expect(burst.closest('.game-over-table-scroll')).toBeNull()
  })

  it('skips to the end on a tap anywhere (cancels everything, no late burst)', async () => {
    const view = render(overlay())
    fireEvent.pointerDown(view.container.querySelector('.game-over-overlay')!)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(c => c.cancel.mock.calls.length === 1)).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 1800))
    expect(view.container.querySelector('.game-over-row-burst')).toBeNull()
  })

  it('stays still under reduced motion', () => {
    motion.reduced = true
    render(overlay())
    expect(rowCalls()).toHaveLength(0)
  })

  it('does nothing without a leaderboard, and does not replay on re-render', () => {
    const none = render(<GameOverOverlay result="neutral" canRematch={false} onLeave={vi.fn()} />)
    expect(rowCalls()).toHaveLength(0)
    none.unmount()
    const view = render(overlay())
    const first = rowCalls().length
    view.rerender(overlay(board.map(r => ({ ...r, cardsPlayed: 11 }))))
    expect(rowCalls()).toHaveLength(first)
  })

  it('revealStandings returns null with no rows', () => {
    expect(revealStandings(document.createElement('div'))).toBeNull()
    expect(revealStandings(null)).toBeNull()
  })
})
