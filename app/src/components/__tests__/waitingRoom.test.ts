// @vitest-environment jsdom
// ============================================================================
// Regression test for the broken waiting-room host flow (Appendix A.9):
// the host/guest branch must be driven by room.hostId === myPlayerId.
// Production shipped the guest branch to the host; this pins the fix.
// ============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WaitingRoom, waitingRoomRole } from '../WaitingRoom'
import type { RoomSummary } from '../../engine/protocol'

function room(partial: Partial<RoomSummary> = {}): RoomSummary {
  return {
    code: 'LPHGPC',
    phase: 'waiting',
    hostId: 'host-1',
    maxPlayers: 5,
    createdAt: 0,
    players: [
      { id: 'host-1', name: 'Greta', isAI: false, connected: true, isOut: false, cardCount: { hand: 0, faceUp: 0, faceDown: 0 } },
      { id: 'guest-2', name: 'Hans', isAI: false, connected: true, isOut: false, cardCount: { hand: 0, faceUp: 0, faceDown: 0 } },
    ],
    ...partial,
  }
}

const noop = () => {}

afterEach(cleanup)

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
})
