// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createRoomMock = vi.hoisted(() => vi.fn())
vi.mock('../../net/useMultiplayerRoom', () => ({ createRoom: createRoomMock }))

import { JoinCreateScreen } from '../JoinCreateScreen'

afterEach(() => {
  cleanup()
  createRoomMock.mockReset()
})

describe('JoinCreateScreen async navigation guard', () => {
  it('locks competing navigation while create is pending', () => {
    createRoomMock.mockReturnValue(new Promise(() => {}))
    render(<JoinCreateScreen onEnterRoom={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Greta' } })
    fireEvent.click(screen.getByRole('button', { name: /create room/i }))
    expect((screen.getByRole('button', { name: /menu/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^join$/i }) as HTMLButtonElement).disabled).toBe(true)
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
