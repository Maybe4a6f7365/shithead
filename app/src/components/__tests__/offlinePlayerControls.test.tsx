// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PlayerSummary } from '../../engine/protocol'
import { OfflinePlayerControls, OFFLINE_KICK_DELAY_MS } from '../OfflinePlayerControls'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const START = new Date('2026-08-20T12:00:00.000Z').getTime()

function player(
  id: string,
  name: string,
  connected: boolean,
  offlineSince?: number,
): PlayerSummary {
  return {
    id,
    name,
    isAI: false,
    connected,
    offlineSince,
    isOut: false,
    cardCount: { hand: 3, faceUp: 2, faceDown: 1 },
  }
}

describe('offline player controls', () => {
  it('is host-only and stays hidden until the continuous offline spell reaches 20 seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const players = [
      player('host-id', 'Host', true),
      player('away-id', 'Mira', false, START),
    ]

    const guestView = render(
      <OfflinePlayerControls players={players} isHost={false} onKick={vi.fn()} />,
    )
    act(() => vi.advanceTimersByTime(OFFLINE_KICK_DELAY_MS))
    expect(screen.queryByLabelText('Offline player controls')).toBeNull()
    guestView.unmount()

    vi.setSystemTime(START)
    render(<OfflinePlayerControls players={players} isHost onKick={vi.fn()} />)
    act(() => vi.advanceTimersByTime(OFFLINE_KICK_DELAY_MS - 1))
    expect(screen.queryByRole('button', { name: 'Remove offline player Mira' })).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('button', { name: 'Remove offline player Mira' })).toBeTruthy()
  })

  it('requires confirmation, removes the correct player, and disappears when they reconnect', () => {
    vi.useFakeTimers()
    vi.setSystemTime(START + OFFLINE_KICK_DELAY_MS)
    const onKick = vi.fn()
    const offlinePlayers = [
      player('host-id', 'Host', true),
      player('target-id', 'Mira', false, START),
      player('other-id', 'Bea', false, START),
    ]
    const { rerender } = render(
      <OfflinePlayerControls players={offlinePlayers} isHost onKick={onKick} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove offline player Mira' }))
    expect(onKick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm remove Mira' }).textContent).toBe('Remove Mira?')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Mira' }))
    expect(onKick).toHaveBeenCalledTimes(1)
    expect(onKick).toHaveBeenCalledWith('target-id')

    fireEvent.click(screen.getByRole('button', { name: 'Remove offline player Bea' }))
    expect(screen.getByRole('button', { name: 'Confirm remove Bea' })).toBeTruthy()
    rerender(
      <OfflinePlayerControls
        players={offlinePlayers.map(summary => summary.id === 'other-id'
          ? player('other-id', 'Bea', true)
          : summary)}
        isHost
        onKick={onKick}
      />,
    )

    expect(screen.queryByRole('button', { name: /Bea/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm remove Bea' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove offline player Mira' })).toBeTruthy()
  })
})
