// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Card as CardT } from '../../engine'
import { ActionBar } from '../ActionBar'
import { Card } from '../Card'
import { ConnectionBadge } from '../ConnectionBadge'

afterEach(cleanup)

const five: CardT = { id: 'opaque-five', rank: '5', suit: '♣' }

describe('connection status control', () => {
  it('keeps the online label visible and gives retry a 44px minimum target', () => {
    const view = render(<ConnectionBadge status="connected" />)
    expect(screen.getByText('online')).toBeTruthy()

    view.rerender(<ConnectionBadge status="offline" onRetry={vi.fn()} />)
    const retry = screen.getByRole('button', { name: /connection offline\. retry/i })
    expect(retry.className).toContain('min-h-[44px]')
    expect(screen.getByText(/offline — retry/i)).toBeTruthy()
  })
})

describe('turn action semantics', () => {
  it('labels related actions as a group rather than a keyboard toolbar', () => {
    render(
      <ActionBar
        selectionCount={1}
        canPickUp
        pickupArmed={false}
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: /turn actions/i })).toBeTruthy()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})

describe('card selection state', () => {
  it('exposes pressed state only on interactive cards', () => {
    const { rerender } = render(<Card card={five} state="selected" onActivate={vi.fn()} />)
    expect(screen.getByRole('button', { pressed: true })).toBeTruthy()

    rerender(<Card card={five} state="playable" onActivate={vi.fn()} />)
    expect(screen.getByRole('button', { pressed: false })).toBeTruthy()

    rerender(<Card card={five} state="rest" />)
    expect(screen.getByRole('img').getAttribute('aria-pressed')).toBeNull()
  })
})
