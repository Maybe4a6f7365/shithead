import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { GameEvent, Rank } from '../engine'

export type SpecialEffectKind = 'burn' | 'reset' | 'mirror' | 'low' | 'skip'

export interface SpecialEffect {
  key: number
  kind: SpecialEffectKind
  label: string
  detail: string
  /** Number of seats/cards involved when the effect meaningfully stacks. */
  count?: number
}

function displayRank(rank: Rank): string {
  return rank === 'JOKER' ? 'Joker' : rank
}

/**
 * Map the newest accepted engine action to a short, physical table-stamp.
 * Clear-pile feedback takes precedence because a quartet/10/Joker finishes
 * the effect immediately; otherwise the printed rank teaches what changed.
 */
export function specialEffectFromEvents(
  events: GameEvent[],
  key: number,
  effectiveRank: Rank | null,
): SpecialEffect | null {
  const clear = events.find(event => event.type === 'CLEAR_PILE')
  if (clear?.type === 'CLEAR_PILE') {
    return {
      key,
      kind: 'burn',
      label: clear.reason === 'quartet' ? 'Four of a kind' : `${clear.reason === 'ten' ? 'Ten' : 'Joker'} burns`,
      detail: 'Pile cleared',
    }
  }

  const play = events.find(event => event.type === 'PLAY_CARDS')
  if (play?.type !== 'PLAY_CARDS' || play.cards.length === 0) return null

  const rank = play.cards[0].rank
  if (rank === '2') {
    return { key, kind: 'reset', label: 'Reset', detail: 'Any card may follow' }
  }
  if (rank === '3') {
    return {
      key,
      kind: 'mirror',
      label: 'Mirror',
      detail: effectiveRank ? `Still ${displayRank(effectiveRank)}` : 'Open pile',
    }
  }
  if (rank === '7') {
    return { key, kind: 'low', label: 'Low seven', detail: 'Play 7 or lower' }
  }
  if (rank === '8') {
    const count = play.cards.length
    return {
      key,
      kind: 'skip',
      count,
      label: count > 1 ? `Skip ×${count}` : 'Skip',
      detail: count > 1 ? `${count} seats passed` : 'Next seat passed',
    }
  }
  if (rank === '10' || rank === 'JOKER') {
    return { key, kind: 'burn', label: `${displayRank(rank)} burns`, detail: 'Pile cleared' }
  }
  return null
}

export function SpecialEffectFeedback({ effect }: { effect: SpecialEffect | null }) {
  const [visible, setVisible] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!effect) return
    setVisible(true)
    // This is a secondary receipt for the pile animation, not a blink-and-miss
    // toast. Keep it long enough to scan during a fast AI or multiplayer turn.
    const timeout = window.setTimeout(() => setVisible(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [effect?.key])

  return (
    <AnimatePresence>
      {effect && visible && (
        <motion.div
          key={`${effect.key}-${effect.kind}`}
          className="special-effect-feedback"
          data-effect={effect.kind}
          data-count={effect.count}
          aria-hidden="true"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="special-effect-feedback__rule" data-effect={effect.kind}>
            <strong className="special-effect-feedback__label">{effect.label}</strong>
          </span>
          <span className="special-effect-feedback__receipt">
            <span className="special-effect-feedback__detail">{effect.detail}</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
