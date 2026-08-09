// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { Card, GameState, Player } from '../../engine'
import { ActionBar } from '../ActionBar'
import { OpponentSeat } from '../OpponentStrip'
import { pileEntryChoreography, pileEntryKind, pileRuleChipInitial, PileArea } from '../PileArea'
import { burnCleanupDelay, TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const card = (id: string, rank: Card['rank']): Card => ({
  id,
  rank,
  suit: rank === 'JOKER' ? null : '♣',
})

describe('modern game-screen hierarchy', () => {
  it('uses one persistent turn cue and keeps the event feed free for game events', () => {
    const me: Player = {
      id: 'me', name: 'Me', hand: [card('me-five', '5')], faceUp: [], faceDown: [], isOut: false,
    }
    const hans: Player = {
      id: 'hans', name: 'Hans', hand: [card('hans-six', '6')], faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, hans], stock: [], pile: [], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }

    const { container, rerender } = render(
      <TableScreen
        state={state}
        viewerId="me"
        viewerActive
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )

    const turn = screen.getByLabelText('Your turn')
    expect(turn.getAttribute('aria-current')).toBe('step')
    expect(turn.querySelector('.table-turn-label__eyebrow')?.textContent).toBe('Turn')
    expect(turn.querySelector('.table-turn-label__name')?.textContent).toBe('Your move')
    expect(container.querySelector('.action-feed')?.textContent).toBe('')
    expect(container.querySelector('.table-pile-stage')).toBeTruthy()
    expect(container.querySelector('[data-turn-marker-owner="local"]')).toBeTruthy()
    expect(container.querySelector('.table-hand-zone__inner .table-turn-marker')).toBeNull()

    rerender(
      <TableScreen
        state={{ ...state, currentPlayerIdx: 1, turnCount: 2, seq: 2 }}
        viewerId="me"
        viewerActive={false}
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-turn-marker-owner="local"]')).toBeNull()
    expect(container.querySelector('[data-turn-marker-owner="opponent:hans"]')).toBeTruthy()
  })

  it('keeps special pile rules visible after the transient reaction', () => {
    const { rerender } = render(
      <PileArea stockCount={8} top={card('seven', '7')} pileCount={2} effectiveRank="7" />,
    )
    expect(screen.getByRole('status').textContent).toBe('Low card: play 7 or lower')
    expect(screen.getByText('Low card')).toBeTruthy()
    expect(screen.getByText('7 or lower')).toBeTruthy()

    rerender(<PileArea stockCount={7} top={card('three', '3')} pileCount={3} effectiveRank="K" />)
    expect(screen.getByRole('status').textContent).toBe('Mirror: plays as K')
    expect(screen.getByText('Plays as K')).toBeTruthy()

    rerender(<PileArea stockCount={6} top={card('two', '2')} pileCount={4} effectiveRank={null} />)
    expect(screen.getByRole('status').textContent).toBe('Reset: any card may follow')
    expect(screen.getByText('Any card')).toBeTruthy()

    expect(pileRuleChipInitial('open', false)).toHaveProperty('scaleY')
    expect(pileRuleChipInitial('mirror', false)).toHaveProperty('x')
    expect(pileRuleChipInitial('low', false)).toHaveProperty('y')
    expect(pileRuleChipInitial('low', true)).toEqual({ opacity: 0 })
  })

  it('ties active state to the opponent identity rather than a detached banner', () => {
    const hans: Player = {
      id: 'hans', name: 'Hans', hand: [card('hans-five', '5')],
      faceUp: [card('hans-ace', 'A')], faceDown: [card('hidden', '4')], isOut: false,
    }
    const { container } = render(
      <OpponentSeat
        seat={{ player: hans, faceUp: hans.faceUp, handCount: 1, faceDownCount: 1 }}
        active
      />,
    )

    const seat = container.querySelector('.opponent-seat')
    expect(seat?.getAttribute('aria-current')).toBe('step')
    expect(container.querySelector('.opponent-seat__identity')).toBeTruthy()
    const marker = container.querySelector('.opponent-seat__turn-marker')
    expect(marker?.getAttribute('data-turn-marker-owner')).toBe('opponent:hans')
    expect(marker?.textContent).toContain('Playing')
  })

  it('separates primary action label and count without changing its accessible name', () => {
    const { container } = render(
      <ActionBar
        selectionCount={2}
        canPickUp
        pickupArmed={false}
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Play 2 selected cards' })).toBeTruthy()
    expect(container.querySelector('.primary-action .action-button__label')?.textContent).toBe('Play')
    expect(container.querySelector('.primary-action .action-button__count')?.textContent).toBe('2')
  })

  it('gives 2, 3, 7 and 8 distinct card-local entry choreography', () => {
    expect(pileEntryKind('2')).toBe('reset')
    expect(pileEntryKind('3')).toBe('mirror')
    expect(pileEntryKind('7')).toBe('low')
    expect(pileEntryKind('8')).toBe('skip')
    expect(pileEntryKind('K')).toBe('standard')

    expect(pileEntryChoreography('reset', 1, false).animate).toHaveProperty('scale')
    expect(pileEntryChoreography('mirror', 1, false).animate).toHaveProperty('x')
    expect(pileEntryChoreography('low', 1, false).animate).toHaveProperty('y')
    expect(pileEntryChoreography('skip', 3, false).animate).toHaveProperty('rotate')
    expect(pileEntryChoreography('skip', 3, false).transition.duration).toBeGreaterThan(
      pileEntryChoreography('skip', 1, false).transition.duration,
    )
    expect(pileEntryChoreography('low', 1, true)).toEqual({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.12 },
    })
  })

  it('keeps the stacked skip count attached to the played eight', () => {
    const { container } = render(
      <PileArea
        stockCount={5}
        top={card('three-eights', '8')}
        pileCount={3}
        effectiveRank="8"
        specialEffect={{ key: 8, kind: 'skip', count: 3, label: 'Skip ×3', detail: '3 seats passed' }}
      />,
    )

    const entry = container.querySelector('.waste-pile__entry')
    expect(entry?.getAttribute('data-entry-effect')).toBe('skip')
    expect(entry?.getAttribute('data-skip-count')).toBe('3')
    expect(container.querySelector('.waste-pile__skip-count')?.textContent).toBe('×3')
    expect(container.querySelector('.pile-area')?.getAttribute('data-skip-count')).toBe('3')
  })

  it('does not let an older burn timer clear a consecutive burn snapshot', () => {
    vi.useFakeTimers()
    const me: Player = {
      id: 'me', name: 'Me', hand: [card('spare', '4')], faceUp: [], faceDown: [], isOut: false,
    }
    const hans: Player = {
      id: 'hans', name: 'Hans', hand: [card('other', '5')], faceUp: [], faceDown: [], isOut: false,
    }
    const before: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, hans], stock: [],
      pile: [{ cards: [card('old-six', '6')], cleared: false }], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }
    const firstTen = card('burn-one', '10')
    const secondTen = card('burn-two', '10')
    const firstBurn: GameState = {
      ...before,
      pile: [],
      turnCount: 2,
      seq: 2,
      log: [
        { type: 'PLAY_CARDS', playerId: 'me', cards: [firstTen] },
        { type: 'CLEAR_PILE', reason: 'ten' },
      ],
    }
    const secondBurn: GameState = {
      ...firstBurn,
      turnCount: 3,
      seq: 3,
      log: [
        ...firstBurn.log,
        { type: 'PLAY_CARDS', playerId: 'me', cards: [secondTen] },
        { type: 'CLEAR_PILE', reason: 'ten' },
      ],
    }
    const props = {
      viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(),
      onLeave: vi.fn(), onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
    }
    const { container, rerender } = render(<TableScreen state={before} {...props} />)

    rerender(<TableScreen state={firstBurn} {...props} />)
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burn-key'))
      .toBe('2:ten:burn-one')
    act(() => vi.advanceTimersByTime(300))

    rerender(<TableScreen state={secondBurn} {...props} />)
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burn-key'))
      .toBe('3:ten:burn-two')
    expect(screen.getByRole('img', { name: /10 of clubs/i })).toBeTruthy()

    // This is when the first action's timer would have fired.
    act(() => vi.advanceTimersByTime(260))
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burning')).toBe('true')
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burn-key'))
      .toBe('3:ten:burn-two')

    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burning')).toBe('false')
    expect(container.querySelector('.table-pile-stage')?.getAttribute('data-burn-key')).toBeNull()
  })

  it('uses a short reduced-motion cleanup without shortening normal burn motion', () => {
    expect(burnCleanupDelay(true)).toBe(140)
    expect(burnCleanupDelay(false)).toBe(560)
    expect(burnCleanupDelay(null)).toBe(560)
  })
})
