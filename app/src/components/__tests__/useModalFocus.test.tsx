// @vitest-environment jsdom
import { useRef, type ReactNode, type RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useModalFocus, type ModalFocusOptions } from '../useModalFocus'

afterEach(cleanup)

function Layer({ name, children, ...options }: ModalFocusOptions & { name: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, options)
  if (options.open === false) return null
  return <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>{children}</div>
}

const button = (name: string) => screen.getByRole('button', { name })

function pressTab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  return event
}

describe('useModalFocus', () => {
  it('moves focus to the first control, or to the one asked for', () => {
    const { unmount } = render(<Layer name="one"><button>First</button><button>Second</button></Layer>)
    expect(document.activeElement).toBe(button('First'))
    unmount()

    render(
      <Layer name="two" initialFocus=".primary">
        <button>First</button><button className="primary">Primary</button>
      </Layer>,
    )
    expect(document.activeElement).toBe(button('Primary'))
  })

  it('skips disabled and hidden controls, and falls back to the layer itself', () => {
    const { unmount } = render(
      <Layer name="one"><button disabled>Off</button><button hidden>Gone</button><a href="#x">Link</a></Layer>,
    )
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Link' }))
    unmount()

    render(<Layer name="empty"><p>Nothing to press</p></Layer>)
    const layer = screen.getByRole('dialog', { name: 'empty' })
    expect(document.activeElement).toBe(layer)
    expect(pressTab().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(layer)
  })

  it('cycles Tab inside the layer in both directions and leaves the middle alone', () => {
    render(<Layer name="one"><button>First</button><button>Middle</button><button>Last</button></Layer>)

    button('Last').focus()
    expect(pressTab().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button('First'))

    expect(pressTab(true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button('Last'))

    // In between, the browser's own Tab order does the work.
    button('Middle').focus()
    expect(pressTab().defaultPrevented).toBe(false)
    expect(pressTab(true).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(button('Middle'))
  })

  it('pulls focus back in when it has ended up outside', () => {
    render(<><button>Outside</button><Layer name="one"><button>First</button><button>Last</button></Layer></>)
    button('Outside').focus()
    pressTab()
    expect(document.activeElement).toBe(button('First'))
    button('Outside').focus()
    pressTab(true)
    expect(document.activeElement).toBe(button('Last'))
  })

  it('returns focus to where it was, or to the element it is told to', () => {
    function Harness({ open, returnFocus }: { open: boolean; returnFocus?: RefObject<HTMLElement | null> }) {
      return <Layer name="one" open={open} returnFocus={returnFocus}><button>Inside</button></Layer>
    }
    const first = render(<><button>Trigger</button><button>Other</button><Harness open={false} /></>)
    button('Trigger').focus()
    first.rerender(<><button>Trigger</button><button>Other</button><Harness open /></>)
    expect(document.activeElement).toBe(button('Inside'))
    first.rerender(<><button>Trigger</button><button>Other</button><Harness open={false} /></>)
    expect(document.activeElement).toBe(button('Trigger'))
    first.unmount()

    const other: RefObject<HTMLButtonElement | null> = { current: null }
    const second = render(<><button>Trigger</button><button ref={other}>Other</button><Harness open={false} /></>)
    button('Trigger').focus()
    second.rerender(<><button>Trigger</button><button ref={other}>Other</button><Harness open returnFocus={other} /></>)
    second.rerender(<><button>Trigger</button><button ref={other}>Other</button><Harness open={false} returnFocus={other} /></>)
    expect(document.activeElement).toBe(button('Other'))
  })

  it('calls the newest Escape handler without moving focus when the callback changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Layer name="one" onEscape={first}><button>First</button><button>Last</button></Layer>)
    button('Last').focus()
    view.rerender(<Layer name="one" onEscape={second}><button>First</button><button>Last</button></Layer>)
    expect(document.activeElement).toBe(button('Last'))

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape alone on a layer that has to be answered', () => {
    render(<Layer name="blocking"><button>Answer</button></Layer>)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
  })

  it('lets only the newest of two open layers trap Tab, and Escape close the open sheet', () => {
    // A rules sheet is open when the round ends: the game-over dialog mounts
    // second and cannot be dismissed.
    const closeSheet = vi.fn()
    const view = render(<Layer name="sheet" onEscape={closeSheet}><button>Close sheet</button></Layer>)
    view.rerender(
      <>
        <Layer name="sheet" onEscape={closeSheet}><button>Close sheet</button></Layer>
        <Layer name="game over"><button>Rematch</button><button>Leave</button></Layer>
      </>,
    )
    expect(document.activeElement).toBe(button('Rematch'))

    // The sheet underneath must not pull focus out of the newer dialog.
    expect(pressTab().defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(button('Rematch'))
    button('Leave').focus()
    pressTab()
    expect(document.activeElement).toBe(button('Rematch'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeSheet).toHaveBeenCalledTimes(1)
  })

  it('closes only the newest of two dismissable layers, then hands the keyboard back', () => {
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    const view = render(<Layer name="first" onEscape={closeFirst}><button>One</button></Layer>)
    view.rerender(
      <>
        <Layer name="first" onEscape={closeFirst}><button>One</button></Layer>
        <Layer name="second" onEscape={closeSecond}><button>Two</button></Layer>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeSecond).toHaveBeenCalledTimes(1)
    expect(closeFirst).not.toHaveBeenCalled()

    view.rerender(<Layer name="first" onEscape={closeFirst}><button>One</button></Layer>)
    expect(document.activeElement).toBe(button('One'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeFirst).toHaveBeenCalledTimes(1)
    // The remaining layer traps Tab again.
    expect(pressTab().defaultPrevented).toBe(true)
  })
})
