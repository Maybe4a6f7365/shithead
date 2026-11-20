// ============================================================================
// Keyboard focus for a modal layer (a dialog, a sheet, a blocking notice).
// While the layer is open, focus moves into it, Tab cycles inside it and
// Escape dismisses it if it can be dismissed; when it closes, focus returns to
// where it was.
//
// Layers can overlap: a rules sheet may still be open when the round ends and
// the game-over dialog appears. Only the newest open layer traps Tab, so two
// layers never pull focus back and forth, and Escape goes to the newest layer
// that can be dismissed.
// ============================================================================
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]',
].join(',')

/**
 * What Tab can reach inside the layer, in order. A control with tabindex -1
 * is not a stop (a grid with one roving stop counts once), and neither is
 * anything inside a hidden part.
 */
function focusablesIn(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => element.tabIndex >= 0 && element.closest('[hidden]') === null)
}

export interface ModalFocusOptions {
  /** False while the layer is closed. Defaults to true, for a layer that is only mounted while shown. */
  open?: boolean
  /** A selector inside the layer for the control to focus first. Defaults to the first focusable one. */
  initialFocus?: string
  /** Where focus goes on closing. Defaults to whatever had focus when the layer opened. */
  returnFocus?: RefObject<HTMLElement | null>
  /** Called on Escape. Leave it out for a layer that has to be answered. */
  onEscape?: () => void
}

interface OpenLayer {
  dismissable: () => boolean
}

/** Every open layer, oldest first. */
const openLayers: OpenLayer[] = []

function newestDismissable(): OpenLayer | undefined {
  for (let index = openLayers.length - 1; index >= 0; index--) {
    if (openLayers[index].dismissable()) return openLayers[index]
  }
  return undefined
}

export function useModalFocus(layerRef: RefObject<HTMLElement | null>, options: ModalFocusOptions = {}) {
  const { open = true } = options
  // Callers pass inline callbacks; the newest one is used without re-running
  // the effect, which would move focus again.
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const layer = layerRef.current
    if (!open || !layer) return

    const self: OpenLayer = { dismissable: () => Boolean(latest.current.onEscape) }
    openLayers.push(self)
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const { initialFocus } = latest.current
    const preferred = initialFocus ? layer.querySelector<HTMLElement>(initialFocus) : null
    ;(preferred ?? focusablesIn(layer)[0] ?? layer).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (newestDismissable() !== self) return
        event.preventDefault()
        latest.current.onEscape?.()
        return
      }
      if (event.key !== 'Tab' || openLayers[openLayers.length - 1] !== self) return

      const items = focusablesIn(layer)
      if (items.length === 0) {
        event.preventDefault()
        layer.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const leaving = active === (event.shiftKey ? first : last) || !layer.contains(active)
      if (!leaving) return
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openLayers.splice(openLayers.indexOf(self), 1)
      const target = latest.current.returnFocus?.current ?? previouslyFocused
      if (target?.isConnected) target.focus()
    }
  }, [open, layerRef])
}
