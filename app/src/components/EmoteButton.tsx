import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  BroadcastEvent,
  BroadcastId,
  EmoteEvent,
  EmoteId,
  SystemEvent,
} from '../engine/protocol'
import {
  BROADCAST_BY_ID,
  BROADCAST_OPTIONS,
  ONDRA_COPY,
  PLAYER_LEFT_COPY,
  REACTION_BY_ID,
  REACTION_OPTIONS,
} from './reactionCatalog'

type ReactionTab = 'emoji' | 'text'

const GRID_COLUMNS = 5

export interface EmoteButtonProps {
  onSend: (emote: EmoteId) => void
  onSendBroadcast?: (broadcast: BroadcastId) => void
}

export function EmoteButton({ onSend, onSendBroadcast = () => undefined }: EmoteButtonProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ReactionTab>('emoji')
  const [emojiFocus, setEmojiFocus] = useState(0)
  const [textFocus, setTextFocus] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const emojiTab = useRef<HTMLButtonElement>(null)
  const textTab = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const emojiPanelId = useId()
  const textPanelId = useId()
  const reduceMotion = useReducedMotion()

  const closeAndReturnFocus = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    setEmojiFocus(0)
    setTextFocus(0)
    ;(tab === 'emoji' ? emojiTab.current : textTab.current)?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const focusAt = (selector: string, index: number) => {
    root.current?.querySelectorAll<HTMLButtonElement>(selector)[index]?.focus()
  }

  const moveGridFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const last = REACTION_OPTIONS.length - 1
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.reactionIndex ?? emojiFocus)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
        : event.key === 'ArrowRight' ? Math.min(last, current + 1)
          : event.key === 'ArrowLeft' ? Math.max(0, current - 1)
            : event.key === 'ArrowDown' ? Math.min(last, current + GRID_COLUMNS)
              : Math.max(0, current - GRID_COLUMNS)
    setEmojiFocus(next)
    focusAt('[data-reaction-index]', next)
  }

  const moveTextFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const last = BROADCAST_OPTIONS.length - 1
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.broadcastIndex ?? textFocus)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
        : event.key === 'ArrowDown' ? Math.min(last, current + 1)
          : Math.max(0, current - 1)
    setTextFocus(next)
    focusAt('[data-broadcast-index]', next)
  }

  const moveTabFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next: ReactionTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'emoji' : 'text'
    setTab(next)
    ;(next === 'emoji' ? emojiTab.current : textTab.current)?.focus()
  }

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndReturnFocus()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[data-reaction-focusable="true"]:not([tabindex="-1"])') ?? [],
    ).filter(element => !element.disabled && element.offsetParent !== null)
    // jsdom has no layout and reports offsetParent null. Keep the rendered
    // controls as a deterministic fallback for accessibility tests.
    const rendered = focusable.length > 0
      ? focusable
      : Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-reaction-focusable="true"]:not([tabindex="-1"])') ?? [])
    if (rendered.length === 0) return
    const first = rendered[0]
    const last = rendered[rendered.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const selectTab = (next: ReactionTab) => {
    setTab(next)
    if (next === 'emoji') setEmojiFocus(0)
    else setTextFocus(0)
  }

  return (
    <div className="emote-control reaction-control" ref={root} data-open={open ? 'true' : 'false'}>
      <button
        ref={trigger}
        type="button"
        className="emote-control__trigger reaction-control__trigger icon-button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open reactions"
      >
        <svg
          className="emote-control__glyph reaction-control__glyph"
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
          <>
            <motion.button
              type="button"
              className="reaction-picker__scrim"
              aria-hidden="true"
              tabIndex={-1}
              onClick={closeAndReturnFocus}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.14 }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="emote-picker reaction-picker"
              data-tab={tab}
              onKeyDown={keepFocusInside}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="reaction-picker__header">
                <div>
                  <strong className="reaction-picker__title" id={titleId}>Reactions</strong>
                  <span className="reaction-picker__subtitle">Keep it quick. Keep it filthy.</span>
                </div>
                <button
                  type="button"
                  className="reaction-picker__close"
                  onClick={closeAndReturnFocus}
                  aria-label="Close reactions"
                  data-reaction-focusable="true"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </button>
              </div>

              <div className="reaction-picker__tabs" role="tablist" aria-label="Reaction type" onKeyDown={moveTabFocus}>
                <button
                  ref={emojiTab}
                  type="button"
                  role="tab"
                  id={`${emojiPanelId}-tab`}
                  aria-selected={tab === 'emoji'}
                  aria-controls={emojiPanelId}
                  tabIndex={tab === 'emoji' ? 0 : -1}
                  onClick={() => selectTab('emoji')}
                  data-reaction-focusable="true"
                >
                  Emoji <span aria-hidden="true">28</span>
                </button>
                <button
                  ref={textTab}
                  type="button"
                  role="tab"
                  id={`${textPanelId}-tab`}
                  aria-selected={tab === 'text'}
                  aria-controls={textPanelId}
                  tabIndex={tab === 'text' ? 0 : -1}
                  onClick={() => selectTab('text')}
                  data-reaction-focusable="true"
                >
                  Text <span aria-hidden="true">8</span>
                </button>
              </div>

              {tab === 'emoji' ? (
                <div
                  role="tabpanel"
                  id={emojiPanelId}
                  aria-labelledby={`${emojiPanelId}-tab`}
                  className="reaction-picker__panel reaction-picker__panel--emoji"
                  tabIndex={-1}
                >
                  <div className="emote-picker__grid reaction-picker__grid" role="group" aria-label="Emoji reactions" onKeyDown={moveGridFocus}>
                    {REACTION_OPTIONS.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        className="emote-picker__item reaction-picker__emoji"
                        data-emote={option.id}
                        data-reaction-index={index}
                        data-reaction-focusable="true"
                        tabIndex={index === emojiFocus ? 0 : -1}
                        aria-label={option.label}
                        onFocus={() => setEmojiFocus(index)}
                        onClick={() => {
                          onSend(option.id)
                          closeAndReturnFocus()
                        }}
                      >
                        <img src={option.asset} alt="" aria-hidden="true" draggable="false" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  role="tabpanel"
                  id={textPanelId}
                  aria-labelledby={`${textPanelId}-tab`}
                  className="reaction-picker__panel reaction-picker__panel--text"
                  tabIndex={-1}
                >
                  <div className="reaction-picker__text-list" onKeyDown={moveTextFocus}>
                    {BROADCAST_OPTIONS.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        className="reaction-picker__text"
                        data-broadcast={option.id}
                        data-broadcast-index={index}
                        data-reaction-focusable="true"
                        tabIndex={index === textFocus ? 0 : -1}
                        aria-label={`Broadcast: ${option.label}`}
                        dir="auto"
                        onFocus={() => setTextFocus(index)}
                        onClick={() => {
                          onSendBroadcast(option.id)
                          closeAndReturnFocus()
                        }}
                      >
                        {option.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function useTimedVisibility(key: string | null, duration: number) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!key) {
      setVisible(false)
      return
    }
    setVisible(true)
    const timeout = window.setTimeout(() => setVisible(false), duration)
    return () => window.clearTimeout(timeout)
  }, [key, duration])

  return visible
}

export function EmoteFeedback({ event, playerName }: { event: EmoteEvent | null; playerName?: string }) {
  const reduceMotion = useReducedMotion()
  const visible = useTimedVisibility(event ? `${event.playerId}:${event.emote}:${event.ts}` : null, 2100)
  const option = event ? REACTION_BY_ID[event.emote] : null

  return (
    <AnimatePresence>
      {event && option && visible && (
        <div className="reaction-feedback-layer reaction-feedback-layer--emoji" data-emote={event.emote}>
          <motion.div
            className="emote-feedback reaction-feedback reaction-feedback--emoji"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.82 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.03 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="visually-hidden">{playerName ?? 'Player'} reacted: {option.label}</span>
            <img className="emote-feedback__art" src={option.asset} alt="" aria-hidden="true" draggable="false" />
            <span className="emote-feedback__name" aria-hidden="true">{playerName ?? 'Player'}</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function BroadcastFeedback({ event, playerName }: { event: BroadcastEvent | null; playerName?: string }) {
  const option = event ? BROADCAST_BY_ID[event.broadcast] : null

  return (
    <SpeechFeedback
      eventKey={event && option ? `${event.playerId}:${event.broadcast}:${event.ts}` : null}
      playerName={playerName ?? 'Player'}
      text={option?.text ?? ''}
    />
  )
}

function SpeechFeedback({ eventKey, playerName, text }: {
  eventKey: string | null
  playerName: string
  text: string
}) {
  const reduceMotion = useReducedMotion()
  const visible = useTimedVisibility(eventKey, 3100)

  return (
    <AnimatePresence>
      {eventKey && visible && (
        <div className="reaction-feedback-layer reaction-feedback-layer--broadcast">
          <motion.div
            className="reaction-feedback reaction-feedback--broadcast"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="reaction-feedback__speaker">{playerName}</span>
            <span className="reaction-feedback__message" dir="auto">{text}</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function SystemEventFeedback({ event }: { event: SystemEvent | null }) {
  if (event?.kind === 'ondra-mode') {
    return (
      <SpeechFeedback
        eventKey={`${event.playerId}:${event.message}:${event.ts}`}
        playerName={event.playerName}
        text={ONDRA_COPY[event.message]}
      />
    )
  }

  return <PlayerLeftFeedback event={event?.kind === 'player-left' ? event : null} />
}

function PlayerLeftFeedback({ event }: {
  event: Extract<SystemEvent, { kind: 'player-left' }> | null
}) {
  const reduceMotion = useReducedMotion()
  const visible = useTimedVisibility(
    event ? `${event.kind}:${event.playerId}:${event.message}:${event.ts}` : null,
    3200,
  )
  const copy = event ? `${event.playerName} ${PLAYER_LEFT_COPY[event.message]}` : ''

  return (
    <AnimatePresence>
      {event && visible && (
        <div className="reaction-feedback-layer reaction-feedback-layer--system" data-system-kind="player-left">
          <motion.div
            className="reaction-feedback reaction-feedback--system"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
          >
            <span className="reaction-feedback__system-label">Table</span>
            <span className="reaction-feedback__message" dir="auto">{copy}</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
