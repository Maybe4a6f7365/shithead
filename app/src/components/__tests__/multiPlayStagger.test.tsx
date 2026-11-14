// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GameEvent, GameState, Player } from '../../engine'
import { TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  // Seats sit top-left, everything else (the pile) lower right: a real flight.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset?.seatId
      ? { left: 10, top: 10, width: 60, height: 40, right: 70, bottom: 50, x: 10, y: 10, toJSON() {} } as DOMRect
      : { left: 200, top: 300, width: 80, height: 128, right: 280, bottom: 428, x: 200, y: 300, toJSON() {} } as DOMRect
  })
})
afterEach(cleanup)

const props = {
  viewerId: 'me', viewerActive: false, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
  onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
}

function state(count: 0 | 1 | 2 | 3, seq: number): GameState {
  const played = [
    { id: 'e1', rank: '8' as const, suit: '♣' as const },
    { id: 'e2', rank: '8' as const, suit: '♦' as const },
    { id: 'e3', rank: '8' as const, suit: '♥' as const },
  ].slice(0, count)
  const log: GameEvent[] = count ? [{ type: 'PLAY_CARDS', playerId: 'other', cards: played }] : []
  const mine: Player = { id: 'me', name: 'Me', hand: [{ id: 'm1', rank: '9', suit: '♠' }], faceUp: [], faceDown: [], isOut: false }
  const other: Player = { id: 'other', name: 'Other', hand: [{ id: 'o9', rank: '4', suit: '♣' }], faceUp: [], faceDown: [], isOut: false }
  return {
    phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [{ id: 's1', rank: '6', suit: '♠' }],
    pile: count ? [{ cards: played, cleared: false }] : [], currentPlayerIdx: 1, playDirection: 1, turnCount: seq,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log, seq,
  } as GameState
}

describe('multi-card play stagger', () => {
  it('flies the other cards in as ghosts and delays the top card behind them', () => {
    const view = render(<TableScreen state={state(0, 4)} {...props} />)
    view.rerender(<TableScreen state={state(3, 5)} {...props} />)
    expect(view.container.querySelectorAll('.waste-pile__ghost')).toHaveLength(2)
    const top = view.container.querySelector('.waste-pile__entry') as HTMLElement
    // The top card waits for its turn: invisible until the ghosts have started.
    expect(top.style.opacity).toBe('0')
  })

  it('leaves a single-card play alone', () => {
    const view = render(<TableScreen state={state(0, 4)} {...props} />)
    view.rerender(<TableScreen state={state(1, 5)} {...props} />)
    expect(view.container.querySelectorAll('.waste-pile__ghost')).toHaveLength(0)
    expect((view.container.querySelector('.waste-pile__entry') as HTMLElement).style.opacity).toBe('1')
  })
})
