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
  it('keeps all 17 cards in one reachable row, in source order', () => {
    const cards = Array.from({ length: 17 }, (_, index) => card(index))
    const onSelect = vi.fn()
    const { container } = render(<HandFan cards={cards} states={new Map()} onSelect={onSelect} />)

    const rail = screen.getByRole('group', { name: /17 cards; scroll horizontally/i })
    const row = container.querySelector('.large-hand__row')
    const buttons = Array.from(rail.querySelectorAll('button'))
    expect(row).toBeTruthy()
    expect(row?.children).toHaveLength(17)
    expect(container.querySelectorAll('.large-hand__column')).toHaveLength(0)
    expect(buttons).toHaveLength(17)
    expect(buttons[0].getAttribute('aria-label')).toMatch(/1 of 17$/i)
    expect(buttons[16].getAttribute('aria-label')).toMatch(/17 of 17$/i)

    buttons.forEach(button => fireEvent.click(button))
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(cards.map(({ id }) => id))
  })
})
