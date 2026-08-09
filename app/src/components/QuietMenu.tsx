// ============================================================================
// QuietMenu — top-right "Menu" text button (44×44, label style, cream 62%)
// with a sheet-style dropdown: Rules / Sound toggle / Leave (§3.1, §9).
// Leave asks once when a match is running (§6.3).
// ============================================================================
import { useEffect, useRef, useState } from 'react'

export interface QuietMenuProps {
  onOpenRules: () => void
  soundOn: boolean
  onToggleSound: () => void
  onLeave: () => void
  matchRunning: boolean
}

export function QuietMenu({ onOpenRules, soundOn, onToggleSound, onLeave, matchRunning }: QuietMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setConfirmingLeave(false) }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirmingLeave(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="icon-button"
        aria-label="Menu"
      >
        <span aria-hidden="true" className="text-xl leading-none tracking-[0.08em]">•••</span>
      </button>
      {open && (
        <div
          role="menu"
          onKeyDown={moveMenuFocus}
          className="surface-panel absolute right-0 top-full z-sheet min-w-[190px] bg-felt-deep rounded-button py-s1 overflow-hidden"
        >
          <button
            type="button" role="menuitem"
            onClick={() => { setOpen(false); onOpenRules() }}
            className="w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            Rules
          </button>
          <button
            type="button" role="menuitem"
            onClick={onToggleSound}
            className="w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            Sound: {soundOn ? 'on' : 'off'}
          </button>
          <div className="h-px bg-hairline mx-s4" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => (confirmingLeave ? onLeave() : matchRunning ? setConfirmingLeave(true) : onLeave())}
            className={`w-full text-left px-s4 min-h-[44px] text-body ${confirmingLeave ? 'font-semibold text-danger-bright' : 'text-cream'}`}
          >
            {confirmingLeave ? 'Leave the game?' : 'Leave'}
          </button>
        </div>
      )}
    </div>
  )
}
