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

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setConfirmingLeave(false) }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setConfirmingLeave(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="min-w-[44px] min-h-[44px] px-s2 text-label font-bold tracking-label uppercase text-cream/60"
      >
        Menu
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-sheet min-w-[180px] bg-felt-deep rounded-button py-s1"
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
          {confirmingLeave ? (
            <button
              type="button" role="menuitem"
              onClick={onLeave}
              className="w-full text-left px-s4 min-h-[44px] text-body font-semibold text-danger-bright"
            >
              Leave the game?
            </button>
          ) : (
            <button
              type="button" role="menuitem"
              onClick={() => (matchRunning ? setConfirmingLeave(true) : onLeave())}
              className="w-full text-left px-s4 min-h-[44px] text-body text-cream"
            >
              Leave
            </button>
          )}
        </div>
      )}
    </div>
  )
}
