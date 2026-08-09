// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Card as CardT } from '../../engine'
import { HandFan } from '../HandFan'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

function card(index: number): CardT {
  return { id: `pickup-${index}`, rank: '5', suit: '♣' }
}

describe('large pickup hand regression', () => {
  it('keeps the same hand layout when crossing the old 12-card threshold', () => {
    const twelveCards = Array.from({ length: 12 }, (_, index) => card(index))
    const { container, rerender } = render(<HandFan cards={twelveCards} states={new Map()} />)

    expect(container.querySelector('.hand-fan')).toBeTruthy()
    expect(container.querySelector('.hand-fan__row')).toBeTruthy()
    expect(container.querySelector('.large-hand')).toBeNull()

    const seventeenCards = Array.from({ length: 17 }, (_, index) => card(index))
    rerender(<HandFan cards={seventeenCards} states={new Map()} />)

    expect(container.querySelector('.hand-fan')).toBeTruthy()
    expect(container.querySelector('.hand-fan__row')).toBeTruthy()
    expect(container.querySelector('.large-hand')).toBeNull()
  })

  it('keeps all 17 cards in one reachable horizontal row, in source order', () => {
    const cards = Array.from({ length: 17 }, (_, index) => card(index))
    const onSelect = vi.fn()
    const { container } = render(<HandFan cards={cards} states={new Map()} onSelect={onSelect} />)

    const rail = screen.getByRole('group', { name: /your hand, 17 cards; scroll horizontally/i })
    const row = container.querySelector('.hand-fan__row')
    const buttons = Array.from(rail.querySelectorAll('button'))
    expect(row).toBeTruthy()
    // The hidden measuring card is the first direct child; every actual card
    // remains a direct sibling in one row.
    expect(row?.children).toHaveLength(18)
    expect(container.querySelector('.large-hand')).toBeNull()
    expect(buttons).toHaveLength(17)
    expect(buttons[0].getAttribute('aria-label')).toMatch(/1 of 17$/i)
    expect(buttons[16].getAttribute('aria-label')).toMatch(/17 of 17$/i)

    buttons.forEach(button => fireEvent.click(button))
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(cards.map(({ id }) => id))
  })
})
