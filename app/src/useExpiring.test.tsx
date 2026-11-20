// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useExpiring } from './useExpiring'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useExpiring', () => {
  it('shows a value for its time and then clears it', () => {
    const { result } = renderHook(() => useExpiring<string>())
    expect(result.current[0]).toBeNull()

    act(() => result.current[1].show('Too low', 3000))
    expect(result.current[0]).toBe('Too low')
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current[0]).toBe('Too low')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current[0]).toBeNull()
  })

  it('lets a newer value replace the current one and restart the clock', () => {
    const { result } = renderHook(() => useExpiring<string>())
    act(() => result.current[1].show('first', 3000))
    act(() => { vi.advanceTimersByTime(2500) })
    act(() => result.current[1].show('second', 3000))

    // The first value's time is up; the second must not go with it.
    act(() => { vi.advanceTimersByTime(600) })
    expect(result.current[0]).toBe('second')
    act(() => { vi.advanceTimersByTime(2400) })
    expect(result.current[0]).toBeNull()
  })

  it('gives the same value shown twice its full time the second time', () => {
    const { result } = renderHook(() => useExpiring<string>())
    act(() => result.current[1].show('Too low', 3000))
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => result.current[1].show('Too low', 3000))
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current[0]).toBe('Too low')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current[0]).toBeNull()
  })

  it('clears at once on request and leaves no timer behind', () => {
    const { result } = renderHook(() => useExpiring<number>())
    act(() => result.current[1].show(7, 3000))
    act(() => result.current[1].clear())
    expect(result.current[0]).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps one slot for its whole life and stops its timer on unmount', () => {
    const { result, rerender, unmount } = renderHook(() => useExpiring<string>())
    const slot = result.current[1]
    act(() => slot.show('bye', 3000))
    rerender()
    expect(result.current[1]).toBe(slot)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
