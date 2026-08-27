// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Card as CardT, Player } from '../../engine'
import { Card } from '../Card'
import { HandFan, sortHandByDisplay } from '../HandFan'
import { OpponentSeat } from '../OpponentStrip'
import { PileArea } from '../PileArea'
import { QuietMenu } from '../QuietMenu'
import { TableScreen } from '../TableScreen'
import { TableauWell } from '../TableauWell'
import { EmoteButton } from '../EmoteButton'

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

describe('hand display ordering', () => {
  it('uses canonical rank order, preserves ties, and places Joker last', () => {
    const cards = [
      card(1, 'JOKER'), card(2, '10'), card(3, '4'), card(4, 'J'),
      card(5, '3'), card(6, '2'), card(7, '4'), card(8, 'A'),
    ]

    expect(sortHandByDisplay(cards)).toEqual([
      'opaque-secret-3', 'opaque-secret-7', 'opaque-secret-4', 'opaque-secret-8',
      'opaque-secret-6', 'opaque-secret-5', 'opaque-secret-2', 'opaque-secret-1',
    ])
  })

  it('stays canonically sorted after a simulated pickup and exposes no reorder hooks', async () => {
    const initial = [card(1, '6'), card(2, '4')]
    const { container, rerender } = render(<HandFan cards={initial} states={new Map()} onSelect={vi.fn()} />)
    rerender(<HandFan cards={[...initial, card(3, '5'), card(4, 'JOKER')]} states={new Map()} onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /4 of clubs, 1 of 4/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /5 of clubs, 2 of 4/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /6 of clubs, 3 of 4/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /joker, 4 of 4/i })).toBeTruthy()
    })

    const firstCard = container.querySelector('.hand-fan__card') as HTMLElement
    fireEvent.pointerDown(firstCard, { pointerId: 1, pointerType: 'mouse', clientX: 10 })
    fireEvent.pointerMove(firstCard, { pointerId: 1, pointerType: 'mouse', clientX: 200 })
    fireEvent.pointerUp(firstCard, { pointerId: 1, pointerType: 'mouse', clientX: 200 })
    fireEvent.keyDown(screen.getByRole('group', { name: /your hand/i }), { key: 'ArrowRight', altKey: true })

    expect(container.querySelector('[data-reorderable], [data-reordering], [data-dragging]')).toBeNull()
    expect(screen.getByRole('group', { name: /your hand/i }).getAttribute('aria-label')).not.toMatch(/reorder|drag|alt/i)
    expect(screen.getByRole('button', { name: /4 of clubs, 1 of 4/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /5 of clubs, 2 of 4/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /6 of clubs, 3 of 4/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /joker, 4 of 4/i })).toBeTruthy()
  })
})

describe('hidden-card accessibility', () => {
  it('announces position without putting an opaque id in the DOM', () => {
    const { container } = render(<Card faceDown card={card(7)} ariaHint="2 of 3, blind play" />)
    expect(screen.getByRole('img', { name: /face-down card, 2 of 3, blind play/i })).toBeTruthy()
    expect(container.innerHTML).not.toContain('opaque-secret-7')
  })
})

describe('large pickup hand', () => {
  it('keeps the normal hand rail at thirteen cards without dropping actions', () => {
    const cards = Array.from({ length: 13 }, (_, index) => card(index))
    const { container } = render(<HandFan cards={cards} states={new Map()} onSelect={vi.fn()} />)
    expect(screen.getByRole('group', { name: /your hand, 13 cards; scroll horizontally/i })).toBeTruthy()
    expect(container.querySelector('.hand-fan__row')).toBeTruthy()
    expect(container.querySelector('.large-hand')).toBeNull()
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
    expect(container.querySelectorAll('[data-final-stack]')).toHaveLength(3)
    expect(container.querySelector('.opponent-hand-count')?.getAttribute('data-empty')).toBe('false')
  })

  it('drops the hand card silhouette once the opponent holds nothing', () => {
    const player: Player = {
      id: 'p', name: 'Greta', hand: [], faceDown: [],
      faceUp: [card(1, '2')], isOut: false,
    }
    const { container } = render(
      <OpponentSeat
        seat={{ player, faceUp: player.faceUp, handCount: 0, faceDownCount: 2 }}
        active={false}
      />,
    )
    const count = container.querySelector('.opponent-hand-count')
    expect(count?.getAttribute('data-empty')).toBe('true')
    expect(count?.textContent).toBe('')
    // The slot itself stays so seats keep their geometry when a hand empties.
    expect(count).toBeTruthy()
    expect(screen.getByRole('img', { name: /0 cards in hand/i })).toBeTruthy()
  })
})

describe('stacked final tableau', () => {
  it('layers each face-up card over its hidden partner in three columns', () => {
    const faceUp = [card(1, '5'), card(2, '7'), card(3, '10')]
    const faceDown = [card(4), card(5), card(6)]
    const { container } = render(<TableauWell faceUp={faceUp} faceDown={faceDown} fullSize />)
    const stacks = container.querySelectorAll('[data-tableau-stack]')
    expect(stacks).toHaveLength(3)
    stacks.forEach(stack => {
      expect(stack.querySelector('.tableau-stack__down')).toBeTruthy()
      expect(stack.querySelector('.tableau-stack__up')).toBeTruthy()
    })
  })
})

describe('copy-card pile feedback', () => {
  it('shows the effective rank beneath a physical 3 without hiding pile depth', () => {
    render(<PileArea stockCount={4} top={card(1, '3')} pileCount={2} effectiveRank="7" />)
    expect(screen.getByText('= 7 · +1')).toBeTruthy()
    expect(screen.getByLabelText('Three copies 7; 1 card underneath')).toBeTruthy()
  })
})

describe('emote picker', () => {
  it('moves focus into the reaction dialog and restores it when Escape closes', async () => {
    render(<EmoteButton onSend={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /open reactions/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('tab', { name: /emoji/i })).toBe(document.activeElement)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })
})

describe('quiet menu keyboard navigation', () => {
  it('focuses menu items, supports arrows, and restores the trigger on Escape', async () => {
    render(
      <QuietMenu
        onOpenRules={vi.fn()}
        soundOn
        onToggleSound={vi.fn()}
        onLeave={vi.fn()}
        matchRunning
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Rules' })).toBe(document.activeElement)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemcheckbox', { name: 'Turn alerts: on' })).toBe(document.activeElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })

  it('exposes local alert choices and lets the host toggle the Easter egg', () => {
    const toggleTurnAlerts = vi.fn()
    const toggleRepeatTurnAlerts = vi.fn()
    const toggleSound = vi.fn()
    const toggleAdhdMode = vi.fn()
    const selectAdhdSound = vi.fn()
    const toggleEasterEgg = vi.fn()
    render(
      <QuietMenu
        onOpenRules={vi.fn()}
        soundOn
        onToggleSound={toggleSound}
        turnAlertsEnabled
        onToggleTurnAlerts={toggleTurnAlerts}
        repeatTurnAlertsEnabled={false}
        onToggleRepeatTurnAlerts={toggleRepeatTurnAlerts}
        adhdMode={false}
        onToggleAdhdMode={toggleAdhdMode}
        adhdSound="beat"
        onSelectAdhdSound={selectAdhdSound}
        easterEggEnabled
        onToggleEasterEgg={toggleEasterEgg}
        onLeave={vi.fn()}
        matchRunning
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    const turnAlerts = screen.getByRole('menuitemcheckbox', { name: 'Turn alerts: on' })
    const repeatTurnAlerts = screen.getByRole('menuitemcheckbox', { name: 'Repeat-turn alerts: off' })
    const muteSounds = screen.getByRole('menuitemcheckbox', { name: 'Mute sounds: off' })
    const adhdMode = screen.getByRole('menuitemcheckbox', { name: 'ADHD mode: off' })
    const beatSound = screen.getByRole('menuitemradio', { name: 'ADHD sound: Beat' })
    const chimeSound = screen.getByRole('menuitemradio', { name: 'ADHD sound: Chime' })
    const easterEgg = screen.getByRole('menuitemcheckbox', { name: 'Easter egg: on' })
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(5)
    expect(turnAlerts.getAttribute('aria-checked')).toBe('true')
    expect(repeatTurnAlerts.getAttribute('aria-checked')).toBe('false')
    expect(muteSounds.getAttribute('aria-checked')).toBe('false')
    expect(adhdMode.getAttribute('aria-checked')).toBe('false')
    expect(easterEgg.tagName).toBe('BUTTON')
    adhdMode.focus()
    fireEvent.keyDown(adhdMode, { key: 'ArrowDown' })
    expect(beatSound).toBe(document.activeElement)
    fireEvent.keyDown(beatSound, { key: 'ArrowDown' })
    expect(chimeSound).toBe(document.activeElement)

    fireEvent.click(turnAlerts)
    fireEvent.click(repeatTurnAlerts)
    fireEvent.click(muteSounds)
    fireEvent.click(adhdMode)
    expect(beatSound.getAttribute('aria-checked')).toBe('true')
    expect(chimeSound.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(chimeSound)
    fireEvent.click(easterEgg)
    expect(toggleTurnAlerts).toHaveBeenCalledOnce()
    expect(toggleRepeatTurnAlerts).toHaveBeenCalledOnce()
    expect(toggleSound).toHaveBeenCalledOnce()
    expect(toggleAdhdMode).toHaveBeenCalledOnce()
    expect(selectAdhdSound).toHaveBeenCalledWith('chime')
    expect(toggleEasterEgg).toHaveBeenCalledOnce()
  })

  it('shows guests the host Easter setting without making it actionable or keyboard-reachable', () => {
    render(
      <QuietMenu
        onOpenRules={vi.fn()}
        soundOn
        onToggleSound={vi.fn()}
        turnAlertsEnabled
        onToggleTurnAlerts={vi.fn()}
        adhdMode
        onToggleAdhdMode={vi.fn()}
        easterEggEnabled={false}
        onLeave={vi.fn()}
        matchRunning
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    const locked = screen.getByRole('menuitemcheckbox', { name: 'Easter egg: off; host controlled' })
    expect(locked.tagName).toBe('DIV')
    expect(locked.getAttribute('aria-disabled')).toBe('true')
    expect(locked.getAttribute('tabindex')).toBe('-1')

    const adhdMode = screen.getByRole('menuitemcheckbox', { name: 'ADHD mode: on' })
    adhdMode.focus()
    fireEvent.keyDown(adhdMode, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Leave' })).toBe(document.activeElement)
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
          phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
          players: [mine, other], stock: [],
          pile: [{ cards: [card(9, '3')], cleared: false }],
          currentPlayerIdx: 0, playDirection: 1, turnCount: 1,
          winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
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

describe('out-of-turn burn in', () => {
  it('highlights every matching visible card and submits the complete set', () => {
    const fours = [card(1, '4'), card(2, '4'), card(3, '4')]
    const mine: Player = {
      id: 'me', name: 'Me', hand: [...fours, card(7, 'A')],
      faceUp: [card(10, 'K')], faceDown: [card(11, '4')], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [card(20, '6')],
      faceUp: [card(21, '7')], faceDown: [card(22, '8')], isOut: false,
    }
    const burnIn = vi.fn()
    render(
      <TableScreen
        state={{
          phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
          players: [other, mine], stock: [],
          pile: [{ cards: [card(30, '4')], cleared: false }],
          currentPlayerIdx: 0, playDirection: 1, turnCount: 3,
          winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 3,
        }}
        viewerId="me"
        viewerActive={false}
        onPlay={vi.fn()}
        onBurnIn={burnIn}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('img', { name: /4 of clubs, can burn in now/i })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /burn in with 3 cards of rank 4/i }))
    expect(burnIn).toHaveBeenCalledTimes(1)
    expect(burnIn.mock.calls[0][0].map((played: CardT) => played.id)).toEqual(fours.map(played => played.id))
  })

  it('never offers a blind face-down burn in', () => {
    const mine: Player = {
      id: 'me', name: 'Me', hand: [], faceUp: [],
      faceDown: [card(1, '4'), card(2, '4'), card(3, '4')], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [card(20, '6')],
      faceUp: [], faceDown: [], isOut: false,
    }
    render(
      <TableScreen
        state={{
          phase: 'endgame', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
          players: [other, mine], stock: [],
          pile: [{ cards: [card(30, '4')], cleared: false }],
          currentPlayerIdx: 0, playDirection: 1, turnCount: 3,
          winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 3,
        }}
        viewerId="me"
        viewerActive={false}
        onPlay={vi.fn()}
        onBurnIn={vi.fn()}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /burn in/i })).toBeNull()
  })
})
