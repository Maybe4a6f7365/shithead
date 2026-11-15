// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ActionBar } from '../ActionBar'

afterEach(cleanup)

const base = { selectionCount: 0, canPickUp: false, pickupArmed: false, onPlay: vi.fn(), onPickUp: vi.fn() }

describe('ActionBar keeps its row', () => {
  it('renders an idle bar instead of nothing when there is no action to offer', () => {
    const { container } = render(<ActionBar {...base} />)
    const bar = container.querySelector('.action-bar')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-mode')).toBe('idle')
    // Same sizing hooks as a live bar, so both occupy the same height.
    expect(bar?.className).toContain('min-h-[var(--actionbar-h)]')
  })

  it('keeps the idle bar out of the accessibility tree and the tab order', () => {
    const { container } = render(<ActionBar {...base} />)
    const bar = container.querySelector('.action-bar')!
    expect(bar.getAttribute('aria-hidden')).toBe('true')
    expect(bar.getAttribute('role')).toBeNull()
    const button = bar.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(button.tabIndex).toBe(-1)
    expect(button.textContent).toBe('')
  })

  it('swaps to the live bar in place when an action becomes available', () => {
    const { container, rerender } = render(<ActionBar {...base} />)
    rerender(<ActionBar {...base} canPickUp />)
    expect(container.querySelectorAll('.action-bar')).toHaveLength(1)
    expect(container.querySelector('.action-bar')?.getAttribute('data-mode')).toBe('pickup')
    rerender(<ActionBar {...base} canPickUp selectionCount={2} />)
    expect(container.querySelector('.action-bar')?.getAttribute('data-mode')).toBe('play')
  })
})
