// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Card, GameEvent, GameState, Player } from '../../engine'
import { ActionBar } from '../ActionBar'
import { EmoteButton } from '../EmoteButton'
import { specialEffectFromEvents } from '../SpecialEffectFeedback'
import { TableScreen } from '../TableScreen'
import { RulesSheet } from '../RulesSheet'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

describe('quick matching draw action', () => {
  it('offers one explicit, compact action without a countdown', () => {
    const followUp = vi.fn()
    render(
      <ActionBar
        selectionCount={0}
        canPickUp
        pickupArmed={false}
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
        quickFollowUp={{ count: 1, rank: '7' }}
        onQuickFollowUp={followUp}
      />,
    )

    expect(screen.getByRole('group', { name: /quick follow-up/i })).toBeTruthy()
    const action = screen.getByRole('button', { name: /play the drawn 7 before the next card/i })
    expect(action.textContent).toContain('Quick match')
    expect(action.textContent?.toLowerCase()).not.toContain('second')
    expect(screen.queryByRole('button', { name: /pick up/i })).toBeNull()
    fireEvent.click(action)
    expect(followUp).toHaveBeenCalledTimes(1)
  })

  it('highlights only the entitled drawn card and submits it while off-turn', () => {
    const drawn: Card = { id: 'drawn-five', rank: '5', suit: '♥' }
    const mine: Player = {
      id: 'me', name: 'Me', hand: [drawn, { id: 'old-five', rank: '5', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'other-nine', rank: '9', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [other, mine], stock: [],
      pile: [{ cards: [{ id: 'pile-five', rank: '5', suit: '♦' }], cleared: false }],
      currentPlayerIdx: 0, playDirection: 1, turnCount: 4,
      winnerId: null, loserId: null, pendingTribute: null,
      pendingQuickFollowUp: { playerId: 'me', rank: '5', eligibleCardIds: [drawn.id], sourceSeq: 4 },
      log: [], seq: 4,
    }
    const followUp = vi.fn()

    render(
      <TableScreen
        state={state}
        viewerId="me"
        viewerActive={false}
        onPlay={vi.fn()}
        onQuickFollowUp={followUp}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: /5 of hearts, drawn match, quick follow-up available/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /5 of clubs, 2 of 2/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /play the drawn 5 before the next card/i }))
    expect(followUp).toHaveBeenCalledWith(drawn)
  })

  it('lets an active player dismiss the quick choice and use normal turn controls', () => {
    const drawn: Card = { id: 'drawn-eight', rank: '8', suit: '♥' }
    const mine: Player = {
      id: 'me', name: 'Me', hand: [drawn, { id: 'normal-nine', rank: '9', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'other-four', rank: '4', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [mine, other], stock: [],
      pile: [{ cards: [{ id: 'pile-eight', rank: '8', suit: '♦' }], cleared: false }],
      currentPlayerIdx: 0, playDirection: 1, turnCount: 8,
      winnerId: null, loserId: null, pendingTribute: null,
      pendingQuickFollowUp: { playerId: 'me', rank: '8', eligibleCardIds: [drawn.id], sourceSeq: 8 },
      log: [], seq: 8,
    }

    render(
      <TableScreen
        state={state}
        viewerId="me"
        viewerActive
        onPlay={vi.fn()}
        onQuickFollowUp={vi.fn()}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /play the drawn 8/i })).toBeTruthy()
    const drawnCard = screen.getByRole('button', { name: /8 of hearts, drawn match, quick follow-up available/i })
    fireEvent.click(drawnCard)
    expect(screen.getByRole('button', { name: /8 of hearts, selected/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: /play the drawn 8 before/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /8 of hearts, selected/i }))
    expect(screen.getByRole('button', { name: /play the drawn 8 before/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /continue the normal turn/i }))
    expect(screen.queryByRole('button', { name: /play the drawn 8/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^pick up$/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /9 of clubs, playable/i }))
    expect(screen.getByRole('button', { name: /play 1 selected card/i })).toBeTruthy()
  })
})

describe('expanded table reactions', () => {
  it('includes sad reactions and keeps every option keyboard-sized', () => {
    const send = vi.fn()
    render(<EmoteButton onSend={send} />)
    fireEvent.click(screen.getByRole('button', { name: /send an emote/i }))

    expect(screen.getAllByRole('menuitem')).toHaveLength(8)
    const sad = screen.getByRole('menuitem', { name: 'Sad' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(sad).toBe(document.activeElement)
    const cry = screen.getByRole('menuitem', { name: 'Cry' })
    fireEvent.click(cry)
    expect(send).toHaveBeenCalledWith('cry')
  })
})

describe('rules copy', () => {
  it('documents the exact quick-draw window and the low-seven exception set', () => {
    render(<RulesSheet open onClose={vi.fn()} />)
    expect(screen.getByText(/quick draw .* only cards drawn by that play qualify/i)).toBeTruthy()
    expect(screen.getByText(/only 2, 3 and joker bypass this; 10 cannot be played on an effective 7/i)).toBeTruthy()
  })
})

describe('special-card table stamps', () => {
  const effect = (events: GameEvent[]) => specialEffectFromEvents(events, 9, '6')

  it('explains reset, mirror, low-card and stacked skip effects', () => {
    expect(effect([{ type: 'PLAY_CARDS', playerId: 'p', cards: [{ id: '2', rank: '2', suit: '♣' }] }]))
      .toMatchObject({ kind: 'reset', label: 'Reset', detail: 'Any card may follow' })
    expect(effect([{ type: 'PLAY_CARDS', playerId: 'p', cards: [{ id: '3', rank: '3', suit: '♣' }] }]))
      .toMatchObject({ kind: 'mirror', detail: 'Still 6' })
    expect(effect([{ type: 'PLAY_CARDS', playerId: 'p', cards: [{ id: '7', rank: '7', suit: '♣' }] }]))
      .toMatchObject({ kind: 'low', detail: 'Play 7 or lower' })
    expect(effect([{ type: 'PLAY_CARDS', playerId: 'p', cards: [
      { id: '8a', rank: '8', suit: '♣' },
      { id: '8b', rank: '8', suit: '♠' },
    ] }])).toMatchObject({ kind: 'skip', count: 2, label: 'Skip ×2', detail: '2 seats passed' })
  })

  it('prioritizes the burn result over the printed special rank', () => {
    expect(effect([
      { type: 'PLAY_CARDS', playerId: 'p', cards: [{ id: '10', rank: '10', suit: '♥' }] },
      { type: 'CLEAR_PILE', reason: 'ten' },
    ])).toMatchObject({ kind: 'burn', label: 'Ten burns', detail: 'Pile cleared' })
    expect(effect([{ type: 'CLEAR_PILE', reason: 'quartet' }]))
      .toMatchObject({ kind: 'burn', label: 'Four of a kind' })
  })
})

describe('burn transition', () => {
  it('animates the card that caused the burn instead of the old pile top', async () => {
    const mine: Player = {
      id: 'me', name: 'Me', hand: [{ id: 'spare', rank: '4', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'other', rank: '5', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const before: GameState = {
      phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [mine, other], stock: [],
      pile: [{ cards: [{ id: 'old-six', rank: '6', suit: '♣' }], cleared: false }],
      currentPlayerIdx: 0, playDirection: 1, turnCount: 1,
      winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null,
      log: [], seq: 1,
    }
    const burningTen: Card = { id: 'burning-ten', rank: '10', suit: '♥' }
    const after: GameState = {
      ...before,
      pile: [],
      turnCount: 2,
      log: [
        { type: 'PLAY_CARDS', playerId: 'me', cards: [burningTen] },
        { type: 'CLEAR_PILE', reason: 'ten' },
      ],
      seq: 2,
    }
    const props = {
      viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(),
      onLeave: vi.fn(), onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
    }
    const { rerender } = render(<TableScreen state={before} {...props} />)
    rerender(<TableScreen state={after} {...props} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /10 of hearts/i })).toBeTruthy())
    expect(screen.queryByRole('img', { name: /6 of clubs/i })).toBeNull()
  })
})
