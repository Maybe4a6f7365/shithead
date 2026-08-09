// ============================================================================
// ActionFeed — one line, feed size, cream-dim, 24px tall, directly under the
// pile row (DESIGN.md §3.1). Crossfades on change (200ms). Never a log.
// Also carries "Your turn" in gold-bright and transient error copy.
// ============================================================================
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'

export interface ActionFeedProps {
  text: string | null
  /** Bump to retrigger the crossfade when text repeats. */
  feedKey: string | number
  tone?: 'normal' | 'turn' | 'error'
}

export function ActionFeed({ text, feedKey, tone = 'normal' }: ActionFeedProps) {
  return (
    <div className="h-[24px] flex items-center justify-center overflow-hidden" aria-hidden="true">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={feedKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={clsx(
            'text-feed font-medium truncate max-w-full px-s4',
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
