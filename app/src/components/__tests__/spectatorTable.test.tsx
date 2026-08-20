// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Card, GameState, Player } from '../../engine'
import { TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({ id, rank, suit })

function spectatorState(): GameState {
  const ada: Player = {
    id: 'ada-player',
    name: 'Ada',
    hand: [
      card('PRIVATE_ADA_HAND_QUEEN', 'Q', '♥'),
      card('PRIVATE_ADA_HAND_TEN', '10', '♦'),
    ],
    faceUp: [card('PRIVATE_ADA_FACEUP_JOKER', 'JOKER', null)],
    faceDown: [card('PRIVATE_ADA_FACEDOWN_KING', 'K', '♠')],
    isOut: false,
  }
  const bea: Player = {
    id: 'bea-player',
    name: 'Bea',
    hand: [card('PRIVATE_BEA_HAND_ACE', 'A', '♠')],
    faceUp: [card('PRIVATE_BEA_FACEUP_NINE', '9', '♦')],
    faceDown: [
      card('PRIVATE_BEA_FACEDOWN_JACK', 'J', '♥'),
      card('PRIVATE_BEA_FACEDOWN_EIGHT', '8', '♠'),
    ],
    isOut: false,
  }
  const cai: Player = {
    id: 'cai-player',
    name: 'Cai',
    hand: [
      card('PRIVATE_CAI_HAND_FIVE', '5', '♥'),
      card('PRIVATE_CAI_HAND_FOUR', '4', '♦'),
      card('PRIVATE_CAI_HAND_TWO', '2', '♠'),
    ],
    faceUp: [],
    faceDown: [],
    isOut: false,
  }

  return {
    phase: 'play',
    rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [ada, bea, cai],
    stock: [
      card('MASKED_STOCK_1', '3', null),
      card('MASKED_STOCK_2', '3', null),
      card('MASKED_STOCK_3', '3', null),
      card('MASKED_STOCK_4', '3', null),
    ],
    pile: [{
      cards: [
        card('PUBLIC_PILE_SIX_A', '6', '♣'),
        card('PUBLIC_PILE_SIX_B', '6', '♣'),
        card('PUBLIC_PILE_SIX_C', '6', '♣'),
      ],
      cleared: false,
    }],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 6,
    winnerId: null,
    loserId: null,
    pendingTribute: null,
    pendingQuickFollowUp: null,
    log: [],
    seq: 6,
  }
}

const tableCallbacks = {
  onPlay: vi.fn(),
  onPickUp: vi.fn(),
  onLeave: vi.fn(),
  onOpenRules: vi.fn(),
  onToggleSound: vi.fn(),
}

describe('spectator table', () => {
  it('shows the public round and every player count while masking every player-owned card', () => {
    const state = spectatorState()
    const { container } = render(
      <TableScreen
        state={state}
        viewerId="queued-spectator"
        viewerActive={false}
        spectating
        actionsEnabled={false}
        soundOn={false}
        {...tableCallbacks}
      />,
    )

    expect(container.querySelector('[data-viewer-role="spectator"]')).toBeTruthy()
    expect(screen.getByLabelText("Ada: 2 in hand, 1 face up hidden, 1 face down, their turn")).toBeTruthy()
    expect(screen.getByLabelText('Bea: 1 in hand, 1 face up hidden, 2 face down')).toBeTruthy()
    expect(screen.getByLabelText('Cai: 3 in hand, 0 face up hidden, 0 face down')).toBeTruthy()

    const playerList = screen.getByRole('list', { name: 'Players' })
    expect(within(playerList).getAllByRole('listitem')).toHaveLength(3)
    expect(within(playerList).getByText('Ada')).toBeTruthy()
    expect(within(playerList).getByText('Bea')).toBeTruthy()
    expect(within(playerList).getByText('Cai')).toBeTruthy()

    expect(screen.getByRole('region', { name: 'Stock and play pile' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '6 of clubs' })).toBeTruthy()
    expect(screen.getByLabelText('4 cards in stock')).toBeTruthy()
    expect(screen.getByLabelText('2 cards underneath')).toBeTruthy()

    expect(container.querySelector('.hand-fan-shell')).toBeNull()
    expect(container.querySelector('.tableau-well')).toBeNull()
    expect(container.querySelector('.action-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open reactions' })).toBeNull()
    expect(screen.getByText('Watching this round · waiting for the next deal')).toBeTruthy()

    const rendered = container.innerHTML
    for (const privateCard of state.players.flatMap(player => [
      ...player.hand,
      ...player.faceUp,
      ...player.faceDown,
    ])) {
      expect(rendered).not.toContain(privateCard.id)
    }
    expect(container.textContent).not.toContain('♥')
    expect(container.textContent).not.toContain('♦')
    expect(container.textContent).not.toContain('♠')
    for (const privateLabel of [
      'Queen of hearts',
      '10 of diamonds',
      'Joker',
      'King of spades',
      'Ace of spades',
      '9 of diamonds',
      'Jack of hearts',
      '8 of spades',
      '5 of hearts',
      '4 of diamonds',
      '2 of spades',
    ]) {
      expect(screen.queryByRole('img', { name: privateLabel })).toBeNull()
    }
    expect(screen.getAllByRole('img', { name: /hidden face-up card/i })).toHaveLength(2)
  })

  it('adds the tiny watcher count only to a seated player, with singular and plural labels', () => {
    const state = spectatorState()
    const { container, rerender } = render(
      <TableScreen
        state={state}
        viewerId="ada-player"
        viewerActive={false}
        spectatorCount={0}
        soundOn={false}
        {...tableCallbacks}
      />,
    )

    expect(container.querySelector('[data-viewer-role="player"]')).toBeTruthy()
    expect(screen.queryByLabelText(/spectators? watching and waiting for the next round/i)).toBeNull()

    rerender(
      <TableScreen
        state={state}
        viewerId="ada-player"
        viewerActive={false}
        spectatorCount={1}
        soundOn={false}
        {...tableCallbacks}
      />,
    )
    const singular = screen.getByRole('status', {
      name: '1 spectator watching and waiting for the next round',
    })
    expect(singular.textContent).toBe('1')
    expect(singular.querySelector('svg')).toBeTruthy()

    rerender(
      <TableScreen
        state={state}
        viewerId="ada-player"
        viewerActive={false}
        spectatorCount={2}
        soundOn={false}
        {...tableCallbacks}
      />,
    )
    expect(screen.queryByLabelText('1 spectator watching and waiting for the next round')).toBeNull()
    expect(screen.getByRole('status', {
      name: '2 spectators watching and waiting for the next round',
    }).textContent).toBe('2')
  })
})
