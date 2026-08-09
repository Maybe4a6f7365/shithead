// ============================================================================
// ActionFeed — one line, feed size, cream-dim, 24px tall, directly under the
// pile row (DESIGN.md §3.1). Crossfades on change (200ms). Never a log.
// Also carries "Your turn" in gold-bright and transient error copy.
// ============================================================================
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import clsx from 'clsx'

export interface ActionFeedProps {
  text: string | null
  /** Bump to retrigger the crossfade when text repeats. */
  feedKey: string | number
  tone?: 'normal' | 'turn' | 'error'
}

export function ActionFeed({ text, feedKey, tone = 'normal' }: ActionFeedProps) {
  const reduceMotion = useReducedMotion()
  return (
    <div
      className="action-feed h-[24px] flex items-center justify-center overflow-hidden"
      data-tone={tone}
      data-empty={text ? 'false' : 'true'}
      aria-hidden="true"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={feedKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.2 }}
          className={clsx(
            'action-feed__message text-feed font-medium truncate max-w-full px-s4',
            tone === 'turn' && 'text-gold-bright',
            tone === 'error' && 'text-danger-bright',
            tone === 'normal' && 'text-cream-dim',
          )}
        >
          {text ?? ''}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
