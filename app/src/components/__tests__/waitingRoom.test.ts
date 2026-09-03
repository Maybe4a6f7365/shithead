// @vitest-environment jsdom
// ============================================================================
// Regression test for the broken waiting-room host flow (Appendix A.9):
// the host/guest branch must be driven by room.hostId === myPlayerId.
// Production shipped the guest branch to the host; this pins the fix.
// ============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { inviteUrl, WaitingRoom, waitingRoomRole } from '../WaitingRoom'
import type { RoomSummary } from '../../engine/protocol'
import { DEFAULT_GAME_RULES } from '../../engine'

function room(partial: Partial<RoomSummary> = {}): RoomSummary {
  return {
    code: 'LPHGPC',
    phase: 'waiting',
    hostId: 'host-1',
    maxPlayers: 5,
    easterEggEnabled: true,
    spectatorCount: 0,
    spectatorQueueSize: 0,
    createdAt: 0,
    rules: { ...DEFAULT_GAME_RULES },
    players: [
      { id: 'host-1', name: 'Greta', isAI: false, connected: true, isOut: false, cardCount: { hand: 0, faceUp: 0, faceDown: 0 } },
      { id: 'guest-2', name: 'Hans', isAI: false, connected: true, isOut: false, cardCount: { hand: 0, faceUp: 0, faceDown: 0 } },
    ],
    ...partial,
  }
}

const noop = () => {}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('waitingRoomRole', () => {
  it('returns host iff room.hostId === myPlayerId', () => {
    expect(waitingRoomRole(room(), 'host-1')).toBe('host')
    expect(waitingRoomRole(room(), 'guest-2')).toBe('guest')
    expect(waitingRoomRole(room({ hostId: 'guest-2' }), 'guest-2')).toBe('host')
  })
})

describe('WaitingRoom', () => {
  it('host sees START GAME and "You are the host."', () => {
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    expect(screen.getByRole('button', { name: /start game/i })).toBeTruthy()
    expect(screen.getByText(/you are the host/i)).toBeTruthy()
    expect(screen.queryByText(/waiting for the host to start/i)).toBeNull()
  })

  it('guest sees the waiting state and NO start control', () => {
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'guest-2', onStart: noop, onLeave: noop }))
    expect(screen.getByText(/waiting for the host to start/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull()
  })

  it('host below 2 players gets an inline explanation, not a dead button', () => {
    const solo = room({ players: [room().players[0]] })
    render(createElement(WaitingRoom, { room: solo, myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    const btn = screen.getByRole('button', { name: /start game/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false) // enabled — tapping explains
    fireEvent.click(btn)
    expect(screen.getByText(/need at least 2 players/i)).toBeTruthy()
  })

  it('lets only the host change authoritative round rules', () => {
    const change = vi.fn()
    const { rerender } = render(createElement(WaitingRoom, {
      room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop, onRulesChange: change,
    }))
    fireEvent.click(screen.getByRole('switch', { name: /jokers/i }))
    expect(change).toHaveBeenCalledWith({ includeJokers: false })
    fireEvent.click(screen.getByRole('radio', { name: /3 decks/i }))
    expect(change).toHaveBeenCalledWith({ deckCount: 3 })

    rerender(createElement(WaitingRoom, {
      room: room(), myPlayerId: 'guest-2', onStart: noop, onLeave: noop, onRulesChange: change,
    }))
    expect((screen.getByRole('switch', { name: /jokers/i }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: /3 decks/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves deck choices with radiogroup arrow keys', () => {
    const change = vi.fn()
    render(createElement(WaitingRoom, {
      room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop, onRulesChange: change,
    }))
    const one = screen.getByRole('radio', { name: /1 deck$/i })
    one.focus()
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: /number of decks/i }), { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: /2 decks/i })).toBe(document.activeElement)
    expect(change).toHaveBeenCalledWith({ deckCount: 2 })
  })

  it('shares a room link with the native share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText: vi.fn() } })
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    fireEvent.click(screen.getByRole('button', { name: /invite/i }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
      url: inviteUrl('LPHGPC'),
      text: expect.stringContaining('LPHGPC'),
    })))
    expect(await screen.findByText(/invite shared/i)).toBeTruthy()
  })

  it('copies the full invite link when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    fireEvent.click(screen.getByRole('button', { name: /invite/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl('LPHGPC')))
    expect(screen.getByText(/invite link copied/i)).toBeTruthy()
  })

  it('shows a selectable invite URL when browser sharing and copying are blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    fireEvent.click(screen.getByRole('button', { name: /invite/i }))
    const field = await screen.findByRole('textbox', { name: /invite link/i }) as HTMLInputElement
    expect(field.value).toBe(inviteUrl('LPHGPC'))
    expect(screen.getByRole('alert').textContent).toMatch(/select the invite link/i)
  })

  it('keeps an offline host visible and waits for reconnection', () => {
    const offlineHost = room({
      players: room().players.map(player => player.id === 'host-1' ? { ...player, connected: false } : player),
    })
    render(createElement(WaitingRoom, { room: offlineHost, myPlayerId: 'guest-2', onStart: noop, onLeave: noop }))
    expect(screen.getByText(/host · offline/i)).toBeTruthy()
    expect(screen.getByText(/host to reconnect/i)).toBeTruthy()
  })

  it('explains that every seat must be online before starting', () => {
    const offlineGuest = room({
      players: room().players.map(player => player.id === 'guest-2' ? { ...player, connected: false } : player),
    })
    render(createElement(WaitingRoom, { room: offlineGuest, myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    fireEvent.click(screen.getByRole('button', { name: /start game/i }))
    expect(screen.getByText(/everyone must be online/i)).toBeTruthy()
  })
})

// ============================================================================
// Reactions in the waiting room: picker trigger mounts only when a send fn is
// supplied, and a click on the first emoji forwards the canonical EmoteId.
// ============================================================================
import { REACTION_OPTIONS } from '../reactionCatalog'

describe('reactions in waiting room', () => {
  it('renders the reaction picker trigger when onSendEmote is provided', () => {
    render(createElement(WaitingRoom, {
      room: room(),
      myPlayerId: 'host-1',
      onStart: noop,
      onLeave: noop,
      onSendEmote: vi.fn(),
    }))
    const trigger = screen.getByRole('button', { name: /open reactions/i }) as HTMLButtonElement
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('forwards an emote click to onSendEmote', () => {
    const onSendEmote = vi.fn()
    render(createElement(WaitingRoom, {
      room: room(),
      myPlayerId: 'host-1',
      onStart: noop,
      onLeave: noop,
      onSendEmote,
    }))
    fireEvent.click(screen.getByRole('button', { name: /open reactions/i }))
    const first = REACTION_OPTIONS[0]
    const matches = screen.getAllByRole('button', { name: first.label })
    expect(matches.length).toBeGreaterThan(0)
    fireEvent.click(matches[0])
    expect(onSendEmote).toHaveBeenCalledWith(first.id)
  })

  it('does not render the reaction picker when onSendEmote is omitted', () => {
    render(createElement(WaitingRoom, { room: room(), myPlayerId: 'host-1', onStart: noop, onLeave: noop }))
    expect(screen.queryByRole('button', { name: /open reactions/i })).toBeNull()
  })
})
