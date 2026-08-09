// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Card, GameState, Player } from '../../engine'
import { GameOverOverlay } from '../GameOverOverlay'
import { StatePanel } from '../MultiplayerGameTable'
import { PassGate } from '../PassGate'
import { QuietMenu } from '../QuietMenu'
import { TableScreen } from '../TableScreen'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

function card(id: string, rank: Card['rank'] = '5'): Card {
  return { id, rank, suit: rank === 'JOKER' ? null : '♣' }
}

function player(id: string, hand: Card[] = []): Player {
  return {
    id,
    name: id === 'me' ? 'Me' : 'Taylor',
    hand,
    faceUp: [card(`${id}-up`, 'A')],
    faceDown: [card(`${id}-down`, '4')],
    isOut: false,
  }
}

function tableState(): GameState {
  return {
    phase: 'play',
    rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [player('me', [card('mine')]), player('other', [card('theirs', '6')])],
    stock: [],
    pile: [{ cards: [card('pile', '4')], cleared: false }],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 1,
    winnerId: null,
    loserId: null,
    pendingTribute: null,
    log: [],
    seq: 1,
  }
}

describe('blocking dialog focus', () => {
  it('focuses and traps the pass-gate reveal action', () => {
    render(<PassGate player={player('other')} onReveal={vi.fn()} />)
    const reveal = screen.getByRole('button', { name: /reveal taylor's hand/i })
    expect(reveal).toBe(document.activeElement)

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(reveal).toBe(document.activeElement)
  })

  it('focuses the primary game-over action, traps Tab, and restores prior focus', () => {
    const prior = document.createElement('button')
    document.body.append(prior)
    prior.focus()
    const { unmount } = render(
      <GameOverOverlay
        result="win"
        canRematch
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    )
    const rematch = screen.getByRole('button', { name: 'Rematch' })
    const leave = screen.getByRole('button', { name: 'Leave' })
    expect(rematch).toBe(document.activeElement)

    leave.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(rematch).toBe(document.activeElement)
    rematch.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(leave).toBe(document.activeElement)

    unmount()
    expect(prior).toBe(document.activeElement)
    prior.remove()
  })

  it('treats state notices as modal and keeps focus on their actions', () => {
    render(
      <StatePanel
        title="Room not found"
        copy="Check the code."
        actions={<><button type="button">Try again</button><button type="button">Menu</button></>}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Room not found' })
    const first = screen.getByRole('button', { name: 'Try again' })
    const last = screen.getByRole('button', { name: 'Menu' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(first).toBe(document.activeElement)

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toBe(document.activeElement)
  })
})

describe('table shortcut isolation', () => {
  it('returns focus to the durable menu trigger before opening Rules', () => {
    let focusedWhenRulesOpened: Element | null = null
    render(
      <QuietMenu
        onOpenRules={() => { focusedWhenRulesOpened = document.activeElement }}
        soundOn
        onToggleSound={vi.fn()}
        onLeave={vi.fn()}
        matchRunning
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rules' }))
    expect(focusedWhenRulesOpened).toBe(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not act through editors, modifiers, menus, or modal overlays', async () => {
    const onPlay = vi.fn()
    const { container } = render(
      <>
        <input aria-label="Chat input" />
        <textarea aria-label="Notes" />
        <select aria-label="Choice"><option>One</option></select>
        <div contentEditable aria-label="Editable note" />
        <TableScreen
          state={tableState()}
          viewerId="me"
          viewerActive
          onPlay={onPlay}
          onPickUp={vi.fn()}
          onLeave={vi.fn()}
          onOpenRules={vi.fn()}
          soundOn={false}
          onToggleSound={vi.fn()}
        />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: /5 of clubs, playable/i }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat input' }), { key: 'p' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'p' })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Choice' }), { key: 'p' })
    fireEvent.keyDown(screen.getByLabelText('Editable note'), { key: 'p' })
    fireEvent.keyDown(document, { key: 'p', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'p', metaKey: true })
    fireEvent.keyDown(document, { key: 'p', altKey: true })
    fireEvent.keyDown(document, { key: 'P', shiftKey: true })
    expect(onPlay).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'p' })
    expect(onPlay).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    container.append(modal)
    fireEvent.keyDown(document, { key: 'p' })
    expect(onPlay).not.toHaveBeenCalled()
    modal.remove()

    fireEvent.keyDown(document, { key: 'p' })
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.game-turn-label')?.hasAttribute('aria-live')).toBe(false)
  })
})
