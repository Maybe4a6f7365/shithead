// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createRoomMock = vi.hoisted(() => vi.fn())
vi.mock('../../net/useMultiplayerRoom', () => ({ createRoom: createRoomMock }))

import { JoinCreateScreen } from '../JoinCreateScreen'

afterEach(() => {
  cleanup()
  createRoomMock.mockReset()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('JoinCreateScreen async navigation guard', () => {
  it('locks competing navigation while create is pending', () => {
    createRoomMock.mockReturnValue(new Promise(() => {}))
    render(<JoinCreateScreen onEnterRoom={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Greta' } })
    fireEvent.click(screen.getByRole('button', { name: /create room/i }))
    expect((screen.getByRole('button', { name: /menu/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /join room/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores a stale room response after the screen unmounts', async () => {
    let resolve!: (value: string) => void
    createRoomMock.mockReturnValue(new Promise<string>(done => { resolve = done }))
    const enter = vi.fn()
    const view = render(<JoinCreateScreen onEnterRoom={enter} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Greta' } })
    fireEvent.click(screen.getByRole('button', { name: /create room/i }))
    view.unmount()
    await act(async () => { resolve('ABC123'); await Promise.resolve() })
    expect(enter).not.toHaveBeenCalled()
  })
})

describe('JoinCreateScreen form accessibility', () => {
  it('associates a missing-name error with the name field and clears it on edit', () => {
    render(<JoinCreateScreen onEnterRoom={vi.fn()} onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /join room/i }))

    const name = screen.getByLabelText(/your name/i)
    const error = screen.getByRole('alert')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(error.id)
    expect(document.activeElement).toBe(name)

    fireEvent.change(name, { target: { value: 'Greta' } })
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(name.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('associates and clears a room-code error, then joins through form submission', () => {
    const enter = vi.fn()
    render(<JoinCreateScreen onEnterRoom={enter} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Greta' } })

    const code = screen.getByLabelText(/room code/i)
    fireEvent.click(screen.getByRole('button', { name: /join room/i }))

    const error = screen.getByRole('alert')
    expect(code.getAttribute('aria-invalid')).toBe('true')
    expect(code.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
    expect(document.activeElement).toBe(code)

    fireEvent.change(code, { target: { value: 'abc123' } })
    expect(code.getAttribute('aria-invalid')).toBeNull()
    expect(code.getAttribute('aria-describedby')).toBe('join-code-hint')
    expect(screen.queryByRole('alert')).toBeNull()

    const form = code.closest('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form!)
    expect(enter).toHaveBeenCalledWith('ABC123', 'Greta', 'join')
  })
})
