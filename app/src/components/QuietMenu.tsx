// ============================================================================
// QuietMenu — top-right "Menu" text button (44×44, label style, cream 62%)
// with a sheet-style dropdown: rules, local alerts, room controls, and leave.
// Leave asks once when a match is running (§6.3).
// ============================================================================
import { useEffect, useRef, useState } from 'react'

function MenuIcon({ name }: { name: 'rules' | 'sound' | 'bell' | 'attention' | 'egg' | 'leave' }) {
  if (name === 'rules') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
      </svg>
    )
  }
  if (name === 'sound') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
        <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" />
      </svg>
    )
  }
  if (name === 'bell') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M6.5 16.5h11L16 14V10a4 4 0 0 0-8 0v4l-1.5 2.5Z" />
        <path d="M10 19a2.3 2.3 0 0 0 4 0" />
      </svg>
    )
  }
  if (name === 'attention') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
    )
  }
  if (name === 'egg') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3c-3 0-6.5 6-6.5 11a6.5 6.5 0 0 0 13 0C18.5 9 15 3 12 3Z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 5H5v14h5M13 8l4 4-4 4M8 12h9" />
    </svg>
  )
}

export interface QuietMenuProps {
  onOpenRules: () => void
  soundOn: boolean
  onToggleSound: () => void
  turnAlertsEnabled?: boolean
  onToggleTurnAlerts?: () => void
  adhdMode?: boolean
  onToggleAdhdMode?: () => void
  easterEggEnabled?: boolean
  onToggleEasterEgg?: () => void
  onLeave: () => void
  matchRunning: boolean
}

export function QuietMenu({
  onOpenRules,
  soundOn,
  onToggleSound,
  turnAlertsEnabled = true,
  onToggleTurnAlerts,
  adhdMode = false,
  onToggleAdhdMode,
  easterEggEnabled,
  onToggleEasterEgg,
  onLeave,
  matchRunning,
}: QuietMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const openRules = () => {
    // RulesSheet captures the currently focused element so it can restore it
    // on close. Move focus to the persistent trigger before the menu item is
    // unmounted and before the sheet opens.
    trigger.current?.focus()
    setOpen(false)
    setConfirmingLeave(false)
    onOpenRules()
  }

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
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus()
  }, [open])

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ) ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      ref={ref}
      className="quiet-menu relative"
      data-open={open ? 'true' : 'false'}
      data-confirming-leave={confirmingLeave ? 'true' : 'false'}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="quiet-menu__trigger icon-button"
        aria-label="Menu"
      >
        <svg className="quiet-menu__glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          onKeyDown={moveMenuFocus}
          className="quiet-menu__popover surface-panel absolute right-0 top-full z-sheet min-w-[190px] bg-felt-deep rounded-button py-s1 overflow-hidden"
        >
          <button
            type="button" role="menuitem"
            onClick={openRules}
            className="quiet-menu__item w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            <span className="quiet-menu__item-icon"><MenuIcon name="rules" /></span>
            <span className="quiet-menu__item-label">Rules</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={turnAlertsEnabled}
            aria-label={`Turn alerts: ${turnAlertsEnabled ? 'on' : 'off'}`}
            onClick={onToggleTurnAlerts}
            className="quiet-menu__item quiet-menu__item--turn-alerts w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            <span className="quiet-menu__item-icon"><MenuIcon name="bell" /></span>
            <span className="quiet-menu__item-label">Turn alerts</span>
            <span className="quiet-menu__item-value" aria-hidden="true">{turnAlertsEnabled ? 'On' : 'Off'}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!soundOn}
            aria-label={`Mute sounds: ${soundOn ? 'off' : 'on'}`}
            onClick={onToggleSound}
            className="quiet-menu__item quiet-menu__item--sound w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            <span className="quiet-menu__item-icon"><MenuIcon name="sound" /></span>
            <span className="quiet-menu__item-label">Mute sounds</span>
            <span className="quiet-menu__item-value" aria-hidden="true">{soundOn ? 'Off' : 'On'}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={adhdMode}
            aria-label={`ADHD mode: ${adhdMode ? 'on' : 'off'}`}
            onClick={onToggleAdhdMode}
            className="quiet-menu__item quiet-menu__item--attention w-full text-left px-s4 min-h-[44px] text-body text-cream"
          >
            <span className="quiet-menu__item-icon"><MenuIcon name="attention" /></span>
            <span className="quiet-menu__item-label">ADHD mode</span>
            <span className="quiet-menu__item-value" aria-hidden="true">{adhdMode ? 'On' : 'Off'}</span>
          </button>
          {easterEggEnabled !== undefined && (
            <>
              <div className="quiet-menu__divider h-px bg-hairline mx-s4" role="separator" />
              {onToggleEasterEgg ? (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={easterEggEnabled}
                  aria-label={`Easter egg: ${easterEggEnabled ? 'on' : 'off'}`}
                  onClick={onToggleEasterEgg}
                  className="quiet-menu__item quiet-menu__item--easter-egg w-full text-left px-s4 min-h-[44px] text-body text-cream"
                >
                  <span className="quiet-menu__item-icon"><MenuIcon name="egg" /></span>
                  <span className="quiet-menu__item-label">Easter egg</span>
                  <span className="quiet-menu__item-value" aria-hidden="true">{easterEggEnabled ? 'On' : 'Off'}</span>
                </button>
              ) : (
                <div
                  role="menuitemcheckbox"
                  aria-checked={easterEggEnabled}
                  aria-disabled="true"
                  tabIndex={-1}
                  aria-label={`Easter egg: ${easterEggEnabled ? 'on' : 'off'}; host controlled`}
                  className="quiet-menu__item quiet-menu__item--easter-egg quiet-menu__item--locked w-full text-left px-s4 min-h-[44px] text-body text-cream"
                >
                  <span className="quiet-menu__item-icon"><MenuIcon name="egg" /></span>
                  <span className="quiet-menu__item-label">Easter egg</span>
                  <span className="quiet-menu__item-value" aria-hidden="true">{easterEggEnabled ? 'On' : 'Off'} · Host</span>
                </div>
              )}
            </>
          )}
          <div className="quiet-menu__divider h-px bg-hairline mx-s4" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => (confirmingLeave ? onLeave() : matchRunning ? setConfirmingLeave(true) : onLeave())}
            className={`quiet-menu__item quiet-menu__item--leave w-full text-left px-s4 min-h-[44px] text-body ${confirmingLeave ? 'font-semibold text-danger-bright' : 'text-cream'}`}
            data-confirming={confirmingLeave ? 'true' : 'false'}
          >
            <span className="quiet-menu__item-icon"><MenuIcon name="leave" /></span>
            <span className="quiet-menu__item-label">{confirmingLeave ? 'Leave the game?' : 'Leave'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
