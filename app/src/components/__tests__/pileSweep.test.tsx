// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Card, GameEvent, GameState, Player } from '../../engine'
import { TableScreen } from '../TableScreen'
import { sweepLayers } from '../PileSweep'

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset?.seatId
      ? { left: 10, top: 10, width: 60, height: 40, right: 70, bottom: 50, x: 10, y: 10, toJSON() {} } as DOMRect
      : { left: 200, top: 300, width: 80, height: 128, right: 280, bottom: 428, x: 200, y: 300, toJSON() {} } as DOMRect
  })
})
afterEach(cleanup)

describe('sweepLayers', () => {
  it('thickens with the pile but stays capped', () => {
    expect([0, 1, 2, 4, 7, 50].map(sweepLayers)).toEqual([1, 1, 2, 2, 3, 3])
  })
})

const pile: Card[] = [
  { id: 'p1', rank: '5', suit: '♦' }, { id: 'p2', rank: '9', suit: '♣' }, { id: 'p3', rank: 'K', suit: '♥' },
]
const props = {
  viewerId: 'me', viewerActive: false, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
  onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
}

function state(taker: 'none' | 'other' | 'me', seq: number): GameState {
  const taken = taker !== 'none'
  const log: GameEvent[] = taken ? [{ type: 'PICK_UP_PILE', playerId: taker }] : []
  const mine: Player = { id: 'me', name: 'Me', hand: [{ id: 'm1', rank: '4', suit: '♠' }, ...(taker === 'me' ? pile : [])], faceUp: [], faceDown: [], isOut: false }
  const other: Player = { id: 'other', name: 'Other', hand: [{ id: 'o1', rank: '4', suit: '♣' }, ...(taker === 'other' ? pile : [])], faceUp: [], faceDown: [], isOut: false }
  return {
    phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [{ id: 's1', rank: '6', suit: '♠' }],
    pile: taken ? [] : [{ cards: pile, cleared: false }], currentPlayerIdx: 1, playDirection: 1, turnCount: seq,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log, seq,
  } as GameState
}

describe('pile pickup sweep', () => {
  it('sweeps the old top card toward an opponent who took the pile, then clears', async () => {
    const view = render(<TableScreen state={state('none', 4)} {...props} />)
    view.rerender(<TableScreen state={state('other', 5)} {...props} />)
    const sweep = view.container.querySelector('.pile-sweep')
    expect(sweep).not.toBeNull()
    expect(sweep!.querySelectorAll('.card').length).toBe(sweepLayers(3))
    expect(sweep!.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/5 of diamonds/i)
    await waitFor(() => expect(view.container.querySelector('.pile-sweep')).toBeNull(), { timeout: 3000 })
  })

  it('also sweeps when the viewer takes the pile', () => {
    const view = render(<TableScreen state={state('none', 4)} {...props} />)
    view.rerender(<TableScreen state={state('me', 5)} {...props} />)
    expect(view.container.querySelector('.pile-sweep')).not.toBeNull()
  })

  it('does not replay a pickup that was already in the log at mount', () => {
    const view = render(<TableScreen state={state('other', 5)} {...props} />)
    expect(view.container.querySelector('.pile-sweep')).toBeNull()
  })
})
