// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Card as CardT, Player } from '../../engine'
import { Card } from '../Card'
import { HandFan } from '../HandFan'
import { OpponentSeat } from '../OpponentStrip'
import { TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

function card(index: number, rank: CardT['rank'] = '5'): CardT {
  return { id: `opaque-secret-${index}`, rank, suit: rank === 'JOKER' ? null : '♣' }
}

describe('hidden-card accessibility', () => {
  it('announces position without putting an opaque id in the DOM', () => {
    const { container } = render(<Card faceDown card={card(7)} ariaHint="2 of 3, blind play" />)
    expect(screen.getByRole('img', { name: /face-down card, 2 of 3, blind play/i })).toBeTruthy()
    expect(container.innerHTML).not.toContain('opaque-secret-7')
  })
})

describe('large pickup hand', () => {
  it('uses the counted horizontal rail at thirteen cards without dropping actions', () => {
    const cards = Array.from({ length: 13 }, (_, index) => card(index))
    render(<HandFan cards={cards} states={new Map()} onSelect={vi.fn()} />)
    expect(screen.getByText('13 cards')).toBeTruthy()
    expect(screen.getByRole('group', { name: /13 cards; scroll horizontally/i })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(13)
    expect(screen.getByRole('button', { name: /, 1 of 13$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /, 13 of 13$/i })).toBeTruthy()
  })
})

describe('opponent final-card information', () => {
  it('shows stable three-by-three slots and spells Joker as JK visually', () => {
    const player: Player = {
      id: 'p', name: 'Greta', hand: [], faceDown: [],
      faceUp: [card(1, 'JOKER'), card(2, 'A'), card(3, '10')], isOut: false,
    }
    const { container } = render(
      <OpponentSeat
        seat={{ player, faceUp: player.faceUp, handCount: 17, faceDownCount: 2 }}
        active={false}
      />,
    )
    expect(screen.getByText('JK')).toBeTruthy()
    expect(screen.getByRole('img', { name: /joker, face-up final card 1 of 3/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /17 cards in hand/i })).toBeTruthy()
    expect(container.querySelectorAll('.final-mini-card')).toHaveLength(6)
  })
})

describe('voluntary pickup', () => {
  it('stays available with a playable card, clears selection, and requires confirmation', () => {
    const mine: Player = {
      id: 'me', name: 'Me', hand: [card(1, '5')],
      faceUp: [card(2, 'A')], faceDown: [card(3, '4')], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [card(4, '6')],
      faceUp: [card(5, '7')], faceDown: [card(6, '8')], isOut: false,
    }
    const pickUp = vi.fn()
    render(
      <TableScreen
        state={{
          phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false },
          players: [mine, other], stock: [],
          pile: [{ cards: [card(9, '3')], cleared: false }],
          currentPlayerIdx: 0, playDirection: 1, turnCount: 1,
          winnerId: null, loserId: null, pendingTribute: null, log: [], seq: 1,
        }}
        viewerId="me"
        viewerActive
        onPlay={vi.fn()}
        onPickUp={pickUp}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /5 of clubs, playable/i }))
    fireEvent.click(screen.getByRole('button', { name: /^pick up$/i }))
    expect(pickUp).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^play/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }))
    expect(pickUp).toHaveBeenCalledTimes(1)
  })
})
