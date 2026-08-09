// ============================================================================
// GameOverOverlay — victory (§4.8) and charming tipped-crown defeat (§4.9).
// Scrim + centered cream panel, max 320px, s5 padding. No confetti, no loops,
// no 🤡. The gold rule draws itself in 400ms; the "S" motif tips in once.
// ============================================================================
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { GameRules } from '../engine'
import { RoundRulesControl } from './RoundRulesControl'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface GameOverOverlayProps {
  result: 'win' | 'lose' | 'neutral'
  shitheadName?: string
  /** MP: rematch is host-only; guests see "Waiting for host…". */
  canRematch: boolean
  waitingForHost?: boolean
  waitingCopy?: string
  onRematch?: () => void
  onLeave: () => void
  rules?: GameRules
  rulesEditable?: boolean
  onRulesChange?: (patch: Partial<GameRules>) => void
  rematchPending?: boolean
}

export function GameOverOverlay({
  result, shitheadName, canRematch, waitingForHost, waitingCopy, onRematch, onLeave,
  rules, rulesEditable = false, onRulesChange, rematchPending = false,
}: GameOverOverlayProps) {
  const reduceMotion = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const winnerCopy = shitheadName
    ? `${shitheadName} kept the cards. ${shitheadName} is the Shithead.`
    : 'The round ended without a recorded last-place player.'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    const preferred = dialog.querySelector<HTMLElement>('.game-over-card__actions button:not([disabled])')

    ;(preferred ?? focusables()[0] ?? dialog).focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      ref={dialogRef}
      className="phase-overlay game-over-overlay fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4"
      data-result={result}
      role="dialog"
      aria-modal="true"
      aria-label={result === 'win' ? 'Round over — you are clear' : result === 'lose' ? 'Round over — you are the Shithead' : 'Round over'}
      tabIndex={-1}
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0.15 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
        className="phase-card game-over-card w-full max-w-[370px] max-h-full overflow-y-auto bg-cream text-ink rounded-button p-s5 text-center"
      >
        {result === 'lose' && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { rotate: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { rotate: 8, opacity: 1 }}
            transition={reduceMotion ? { duration: 0.15 } : { duration: 0.6, ease: [0.34, 1.3, 0.4, 1] }}
            className="game-over-card__mark mx-auto mb-s3 w-8 h-11 rounded-[3px] bg-burgundy flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="font-display text-gold text-xl font-semibold">S</span>
          </motion.div>
        )}
        <div className="phase-card__kicker game-over-card__kicker text-label font-bold tracking-label uppercase text-ink-soft">Round over</div>
        <h1 className="phase-card__title game-over-card__title font-display text-display font-semibold text-burgundy mt-s1">
          {result === 'win' ? "You're clear" : result === 'lose' ? 'Shithead.' : 'Round complete'}
        </h1>
        <motion.div
          className="phase-card__rule game-over-card__rule mx-auto my-s3 h-[2px] w-12 bg-gold"
          initial={reduceMotion ? { opacity: 0 } : { width: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { width: 48 }}
          transition={reduceMotion ? { duration: 0.15 } : { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          aria-hidden="true"
        />
        <p className="phase-card__copy game-over-card__copy text-body text-ink">
          {result === 'win'
            ? winnerCopy
            : result === 'lose'
              ? 'Last one holding cards. The crown is yours — wear it well.'
              : winnerCopy}
        </p>
        {rules && (
          <div className="game-over-card__rules mt-s5 text-left">
            <RoundRulesControl
              rules={rules}
              editable={rulesEditable}
              onChange={onRulesChange}
              compact
              tone="paper"
              label="Next round"
            />
          </div>
        )}
        <div className="phase-card__actions game-over-card__actions mt-s5 flex flex-col gap-s2">
          {canRematch && onRematch ? (
            <button
              type="button"
              onClick={onRematch}
              disabled={rematchPending}
              className="phase-action phase-action--primary primary-action w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
            >
              {rematchPending ? 'Starting…' : 'Rematch'}
            </button>
          ) : waitingForHost ? (
            <p className="phase-card__waiting min-h-[48px] flex items-center justify-center text-body text-ink-soft" role="status">{waitingCopy ?? 'Waiting for host…'}</p>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            className="phase-action phase-action--quiet w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-burgundy"
          >
            Leave
          </button>
        </div>
      </motion.div>
    </div>
  )
}
