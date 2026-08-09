import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { EMOTE_IDS, type EmoteEvent, type EmoteId } from '../engine/protocol'

const EMOTES: Record<EmoteId, { glyph: string; label: string }> = {
  'thumbs-up': { glyph: '👍', label: 'Nice' },
  laugh: { glyph: '😂', label: 'Laugh' },
  wow: { glyph: '😮', label: 'Wow' },
  fire: { glyph: '🔥', label: 'Fire' },
  sad: { glyph: '😞', label: 'Sad' },
  cry: { glyph: '😭', label: 'Cry' },
  heart: { glyph: '❤️', label: 'Love it' },
  clap: { glyph: '👏', label: 'Applause' },
}

export interface EmoteButtonProps {
  onSend: (emote: EmoteId) => void
}

export function EmoteButton({ onSend }: EmoteButtonProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowRight' ? (current + 1 + items.length) % items.length
          : event.key === 'ArrowLeft' ? (current - 1 + items.length) % items.length
            : event.key === 'ArrowDown' ? (current + 4 + items.length) % items.length
              : (current - 4 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="emote-control" ref={root} data-open={open ? 'true' : 'false'}>
      <button
        ref={trigger}
        type="button"
        className="emote-control__trigger icon-button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Send an emote"
      >
        <svg
          className="emote-control__glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20 11.5a8 8 0 1 1-3.1-6.34A7.96 7.96 0 0 1 20 11.5Z" />
          <path d="M8.5 10h.01M15.5 10h.01M8.75 14a4.7 4.7 0 0 0 6.5 0" />
          <path d="m17.5 17.5 2.5 1-.75-2.75" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Choose an emote"
            className="emote-picker"
            onKeyDown={moveMenuFocus}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.16 }}
          >
            <div className="emote-picker__header" role="presentation">
              <strong className="emote-picker__title">Reactions</strong>
            </div>
            <div className="emote-picker__grid" role="presentation">
              {EMOTE_IDS.map(id => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="emote-picker__item"
                  data-emote={id}
                  aria-label={EMOTES[id].label}
                  onClick={() => {
                    onSend(id)
                    setOpen(false)
                    trigger.current?.focus()
                  }}
                >
                  <span aria-hidden="true">{EMOTES[id].glyph}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function EmoteFeedback({ event, playerName }: { event: EmoteEvent | null; playerName?: string }) {
  const [visible, setVisible] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!event) return
    setVisible(true)
    const timeout = window.setTimeout(() => setVisible(false), 1900)
    return () => window.clearTimeout(timeout)
  }, [event?.playerId, event?.emote, event?.ts])

  return (
    <AnimatePresence>
      {event && visible && (
        <div className="emote-feedback-layer" data-emote={event.emote}>
          <motion.div
            className="emote-feedback"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.72 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 1.08 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="emote-feedback__glyph" aria-hidden="true">{EMOTES[event.emote].glyph}</span>
            <span className="emote-feedback__name">{playerName ?? 'Player'}</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
