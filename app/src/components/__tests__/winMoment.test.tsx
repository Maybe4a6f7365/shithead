// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUT_MOMENT_MS, OutMoment, burstParticles, outMomentCopy, placeLabel } from '../WinMoment'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('win moment', () => {
  it('labels finishing places', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(placeLabel)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'],
    )
    expect(outMomentCopy(1)).toEqual({ title: 'First out', detail: 'You win this round' })
    expect(outMomentCopy(3)).toEqual({ title: "You're out", detail: '3rd place · safe' })
  })

  it('builds a deterministic burst', () => {
    expect(burstParticles()).toEqual(burstParticles())
    expect(burstParticles(8)).toHaveLength(8)
  })

  it('shows once, stays decorative, and removes itself', () => {
    vi.useFakeTimers()
    const { rerender } = render(<OutMoment event={null} />)
    expect(screen.queryByTestId('out-moment')).toBeNull()

    rerender(<OutMoment event={{ key: 'me:7', place: 1 }} />)
    const moment = screen.getByTestId('out-moment')
    expect(moment.getAttribute('aria-hidden')).toBe('true')
    expect(moment.textContent).toContain('First out')

    act(() => { vi.advanceTimersByTime(OUT_MOMENT_MS) })
    expect(screen.queryByTestId('out-moment')).toBeNull()
    // The same event must not replay on an unrelated re-render.
    rerender(<OutMoment event={{ key: 'me:7', place: 1 }} />)
    expect(screen.queryByTestId('out-moment')).toBeNull()
  })
})
