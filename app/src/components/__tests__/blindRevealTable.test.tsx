// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { GameEvent, GameState, Player } from '../../engine'
import { TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  // jsdom has no layout; give every element a card-sized box so geometry resolves.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 100, top: 300, width: 80, height: 128, right: 180, bottom: 428, x: 100, y: 300, toJSON() {} } as DOMRect,
  )
})
afterEach(cleanup)

const pileFive = { id: 'pile-five', rank: '5' as const, suit: '♦' as const }

function stateWith(opts: { played?: 'ok' | 'fail'; seq: number }): GameState {
  const blind = { id: 'blind-card', rank: '9' as const, suit: '♠' as const }
  const log: GameEvent[] = opts.played === 'ok'
    ? [
        { type: 'BLIND_REVEAL', playerId: 'me', card: blind, success: true },
        { type: 'PLAY_CARDS', playerId: 'me', cards: [blind] },
      ]
    : opts.played === 'fail'
      ? [
          { type: 'BLIND_REVEAL', playerId: 'me', card: { id: 'blind-card', rank: '2' as const, suit: '♠' as const }, success: false },
          { type: 'PICK_UP_PILE', playerId: 'me' },
        ]
      : []
  const mine: Player = {
    id: 'me', name: 'Me',
    hand: opts.played === 'fail' ? [{ id: 'blind-card', rank: '2', suit: '♠' }, pileFive] : [],
    faceUp: [], faceDown: opts.played ? [] : [blind], isOut: false,
  }
  const other: Player = {
    id: 'other', name: 'Other', hand: [{ id: 'o1', rank: '4', suit: '♣' }], faceUp: [], faceDown: [], isOut: false,
  }
  return {
    phase: 'endgame', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [],
    pile: opts.played === 'ok'
      ? [{ cards: [pileFive], cleared: false }, { cards: [blind], cleared: false }]
      : opts.played === 'fail' ? [] : [{ cards: [pileFive], cleared: false }],
    currentPlayerIdx: 1, playDirection: 1, turnCount: opts.seq,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null,
    log, seq: opts.seq,
  }
}

const props = {
  viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
  onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
}

describe('blind reveal on the table', () => {
  it('holds the previous pile top until the flip is done, then lands the card', async () => {
    const view = render(<TableScreen state={stateWith({ seq: 5 })} {...props} />)
    expect(view.container.querySelector('.blind-reveal')).toBeNull()

    view.rerender(<TableScreen state={stateWith({ played: 'ok', seq: 6 })} {...props} />)
    const overlay = view.container.querySelector('.blind-reveal')
    expect(overlay?.getAttribute('data-blind-result')).toBe('success')
    // While the flip plays the pile still shows the previous top (the 5), not the 9.
    const topLabel = () => view.container.querySelector('.waste-pile__entry [role="img"]')?.getAttribute('aria-label')
    expect(topLabel()).toMatch(/5 of diamonds/i)

    await waitFor(() => expect(view.container.querySelector('.blind-reveal')).toBeNull(), { timeout: 3000 })
    expect(topLabel()).toMatch(/9 of spades/i)
  })

  it('does not replay a reveal that was already in the log at mount', () => {
    const view = render(<TableScreen state={stateWith({ played: 'ok', seq: 6 })} {...props} />)
    expect(view.container.querySelector('.blind-reveal')).toBeNull()
  })

  it('shows the failed flip over the old pile before the pickup lands', async () => {
    const view = render(<TableScreen state={stateWith({ seq: 5 })} {...props} />)
    view.rerender(<TableScreen state={stateWith({ played: 'fail', seq: 6 })} {...props} />)
    expect(view.container.querySelector('.blind-reveal')?.getAttribute('data-blind-result')).toBe('fail')
    expect(view.container.querySelector('.waste-pile__entry [role="img"]')?.getAttribute('aria-label')).toMatch(/5 of diamonds/i)
    await waitFor(() => expect(view.container.querySelector('.blind-reveal')).toBeNull(), { timeout: 3000 })
  })
})
