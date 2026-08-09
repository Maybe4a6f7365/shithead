// ============================================================================
// GameOverOverlay — victory (§4.8) and charming tipped-crown defeat (§4.9).
// Scrim + centered cream panel, max 320px, s5 padding. No confetti, no loops,
// no 🤡. The gold rule draws itself in 400ms; the "S" motif tips in once.
// ============================================================================
import { motion } from 'framer-motion'

export interface GameOverOverlayProps {
  result: 'win' | 'lose'
  shitheadName: string
  /** MP: rematch is host-only; guests see "Waiting for host…". */
  canRematch: boolean
  waitingForHost?: boolean
  onRematch?: () => void
  onLeave: () => void
}

export function GameOverOverlay({ result, shitheadName, canRematch, waitingForHost, onRematch, onLeave }: GameOverOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4"
      role="dialog"
      aria-modal="true"
      aria-label={result === 'win' ? 'Round over — you are clear' : 'Round over — you are the Shithead'}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
        className="w-full max-w-[320px] bg-cream text-ink rounded-button p-s5 text-center"
      >
        {result === 'lose' && (
          <motion.div
            initial={{ rotate: 0, opacity: 0 }}
            animate={{ rotate: 8, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.34, 1.3, 0.4, 1] }}
            className="mx-auto mb-s3 w-8 h-11 rounded-[3px] bg-burgundy flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="font-display text-gold text-xl font-semibold">S</span>
          </motion.div>
        )}
        <div className="text-label font-bold tracking-label uppercase text-ink-soft">Round over</div>
        <h1 className="font-display text-display font-semibold text-burgundy mt-s1">
          {result === 'win' ? "You're clear" : 'Shithead.'}
        </h1>
        <motion.div
          className="mx-auto my-s3 h-[2px] bg-gold"
          initial={{ width: 0 }}
          animate={{ width: 48 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          aria-hidden="true"
        />
        <p className="text-body text-ink">
          {result === 'win'
            ? `${shitheadName} kept the cards. ${shitheadName} is the Shithead.`
            : 'Last one holding cards. The crown is yours — wear it well.'}
        </p>
        <div className="mt-s5 flex flex-col gap-s2">
          {canRematch && onRematch ? (
            <button
              type="button"
              onClick={onRematch}
              className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
            >
              Rematch
            </button>
          ) : waitingForHost ? (
            <p className="min-h-[48px] flex items-center justify-center text-body text-ink-soft">Waiting for host…</p>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            className="w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-burgundy"
          >
            Leave
          </button>
        </div>
      </motion.div>
    </div>
  )
}
