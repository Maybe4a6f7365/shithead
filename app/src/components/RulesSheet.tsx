// ============================================================================
// RulesSheet — bottom sheet (slides up 260ms, scrim behind, ×/Esc to close),
// one scrolling body column (§7.5). In-game it covers up to 70dvh and is
// non-blocking in MP.
// ============================================================================
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const SECTIONS: Array<{ title: string; lines: string[] }> = [
  {
    title: 'Goal',
    lines: ['Get rid of all your cards.', 'The last player holding cards is the Shithead.'],
  },
  {
    title: 'Setup',
    lines: [
      'Each player gets 3 face-down cards and 6 visible cards.',
      'Choose any 3 visible cards for your face-up final row. The other 3 become your hand.',
      'Before each round, the host chooses 1–3 decks and whether Jokers and the winner exchange are enabled.',
    ],
  },
  {
    title: 'On your turn',
    lines: [
      'Normally, play one card — or any number of cards of the same rank — that matches or beats the effective pile rank.',
      'Draw from the stock to refill your hand to 3.',
      'Quick draw — if a refill card matches the rank you just played, you may add that freshly drawn card before the next player plays. Only cards drawn by that play qualify; another matching refill can continue the chain.',
      "Can't play — or prefer not to? Pick up the whole pile.",
      'Hand empty: play your face-up cards. Those gone: flip a face-down card blind.',
    ],
  },
  {
    title: 'Special cards',
    lines: [
      '2 — reset. Playable on anything; it removes the active rank constraint, so anything may follow.',
      '3 — copy. Playable on anything; it counts exactly like the effective card beneath it.',
      '7 — low. The next response must be 7 or lower. Only 2, 3 and Joker bypass this; 10 cannot be played on an effective 7.',
      '8 — skip. Skips one active player per 8 played; equal-rank 8s stack.',
      '10 — burn. Removes the pile from the game; you lead again.',
      'Four or more matching cards at the physical top — burns the pile, even when the run was built across turns.',
      'Burn in — out of turn, play all matching cards from your visible active row if they complete that top run to 4 or more. The pile burns and you lead.',
      'Joker (when enabled) — playable on anything and burns the pile. It does not substitute for another rank.',
    ],
  },
  {
    title: 'Empty pile',
    lines: ['Any card may lead an empty pile.'],
  },
  {
    title: 'The Shithead',
    lines: [
      'When everyone else is out, the player still holding cards loses.',
      'If winner exchange is enabled, the previous winner may swap one of their 3 chosen face-up final cards with one chosen face-up final card belonging to the previous Shithead — or skip.',
    ],
  },
]

export function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    closeButton.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter(element => !element.hasAttribute('hidden'))
      if (controls.length === 0) return

      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="sheet-scrim rules-scrim fixed inset-0 z-scrim" role="presentation">
      <button
        type="button"
        aria-label="Close rules"
        onClick={onClose}
        tabIndex={-1}
        className="sheet-backdrop rules-backdrop absolute inset-0 w-full h-full bg-scrim cursor-default"
      />
      <motion.section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-sheet-title"
        initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
        transition={reduceMotion ? { duration: 0.15 } : { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        className="sheet-panel rules-sheet absolute bottom-0 left-0 right-0 z-sheet bg-cream text-ink max-h-[70dvh] overflow-y-auto mx-auto max-w-[400px] p-s5 pb-s7"
        style={{ borderRadius: 'var(--radius-sheet)' }}
      >
        <header className="sheet-header rules-sheet__header flex items-center justify-between mb-s3">
          <div>
            <p className="sheet-kicker text-label font-bold tracking-label uppercase text-ink-soft">Know the table</p>
            <h2 id="rules-sheet-title" className="sheet-title font-display text-title font-semibold">Rules</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sheet-close rules-sheet__close min-w-[44px] min-h-[44px] text-body text-ink-soft"
          >
            ✕
          </button>
        </header>
        <div className="sheet-body rules-sheet__body">
          {SECTIONS.map((s, sectionIndex) => (
            <section key={s.title} className="rules-section mb-s4" data-section={sectionIndex + 1}>
              <h3 className="rules-section__title text-label font-bold tracking-label uppercase text-burgundy mb-s1">{s.title}</h3>
              <div className="rules-section__copy">
                {s.lines.map((l, i) => (
                  <p key={i} className="text-body text-ink">{l}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </motion.section>
    </div>
  )
}
