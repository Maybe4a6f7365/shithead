// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Card, Player } from '../../engine'
import { TributeScreen } from '../TributeScreen'

const cards = (prefix: string, ranks: Card['rank'][]): Card[] => ranks.map((rank, index) => ({
  id: `${prefix}-${index}`,
  rank,
  suit: rank === 'JOKER' ? null : '♠',
}))

function player(id: string, ranks: Card['rank'][]): Player {
  return { id, name: id, hand: [], faceDown: [], faceUp: cards(id, ranks), isOut: false }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TributeScreen', () => {
  it('submits exactly one public card from each row and blocks double submission', () => {
    vi.useFakeTimers()
    const onSwap = vi.fn()
    render(
      <TributeScreen
        winner={player('Winner', ['3', '4', '5'])}
        loser={player('Last', ['A', 'K', 'Q'])}
        viewerId="Winner"
        onSwap={onSwap}
        onSkip={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /3 of spades, card to give/i }))
    fireEvent.click(screen.getByRole('button', { name: /ace of spades, card to take/i }))
    const exchange = screen.getByRole('button', { name: /^exchange$/i })
    fireEvent.click(exchange)
    fireEvent.click(exchange)
    expect(onSwap).toHaveBeenCalledTimes(1)
    expect(onSwap).toHaveBeenCalledWith('Winner-0', 'Last-0')
  })

  it('allows the winner to decline and unlocks after the retry timeout', () => {
    vi.useFakeTimers()
    const onSkip = vi.fn()
    render(
      <TributeScreen
        winner={player('Winner', ['3', '4', '5'])}
        loser={player('Last', ['A', 'K', 'Q'])}
        viewerId="Winner"
        onSwap={vi.fn()}
        onSkip={onSkip}
      />,
    )
    const keep = screen.getByRole('button', { name: /keep cards/i }) as HTMLButtonElement
    fireEvent.click(keep)
    expect(keep.disabled).toBe(true)
    act(() => vi.advanceTimersByTime(3000))
    expect(keep.disabled).toBe(false)
    fireEvent.click(keep)
    expect(onSkip).toHaveBeenCalledTimes(2)
  })

  it('keeps guests locked to the public waiting view', () => {
    render(
      <TributeScreen
        winner={player('Winner', ['3', '4', '5'])}
        loser={player('Last', ['A', 'K', 'Q'])}
        viewerId="Guest"
        onSwap={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByText(/waiting for the winner/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^exchange$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /keep cards/i })).toBeNull()
  })
})
