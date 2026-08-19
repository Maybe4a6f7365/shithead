import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type {
  BroadcastEvent,
  BroadcastId,
  ChatEvent,
  EmoteEvent,
  EmoteId,
  SystemEvent,
} from '../engine/protocol'
import { isValidChatText, MAX_CHAT_MESSAGE_LENGTH, normalizeChatText } from '../engine/protocol'
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
  onSendChat?: (text: string) => void | boolean
  recentCustomMessages?: readonly string[]
}

export function EmoteButton({
  onSend,
  onSendBroadcast = () => undefined,
  onSendChat = () => undefined,
  recentCustomMessages = [],
}: EmoteButtonProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ReactionTab>('emoji')
  const [emojiFocus, setEmojiFocus] = useState(0)
  const [textFocus, setTextFocus] = useState(0)
  const [composingChat, setComposingChat] = useState(false)
  const [chatText, setChatText] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const emojiTab = useRef<HTMLButtonElement>(null)
  const textTab = useRef<HTMLButtonElement>(null)
  const chatInput = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const emojiPanelId = useId()
  const textPanelId = useId()
  const chatInputId = useId()
  const chatCountId = useId()
  const recentMessagesId = useId()
  const presetsId = useId()
  const recentMessagesKey = recentCustomMessages.join('\u0000')
  const previousRecentMessagesKey = useRef(recentMessagesKey)
  const reduceMotion = useReducedMotion()

  const closeAndReturnFocus = () => {
    setComposingChat(false)
    setChatText('')
    setOpen(false)
    trigger.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeAndReturnFocus()
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

  useEffect(() => {
    if (open && composingChat) chatInput.current?.focus()
  }, [open, composingChat])

  // A delayed authoritative self echo can insert or promote an MRU item while
  // this menu is already open. Return roving focus to the stable first choice
  // instead of leaving the focused preset with tabIndex=-1 after indices move.
  useEffect(() => {
    if (previousRecentMessagesKey.current === recentMessagesKey) return
    previousRecentMessagesKey.current = recentMessagesKey
    if (!open || tab !== 'text' || composingChat) return
    setTextFocus(0)
    root.current?.querySelector<HTMLButtonElement>('[data-broadcast-index="0"]')?.focus()
  }, [recentMessagesKey, open, tab, composingChat])

  useEffect(() => {
    if (open) return
    setComposingChat(false)
    setChatText('')
  }, [open])

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
    const items = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[data-broadcast-index]') ?? [],
    )
    const last = items.length - 1
    if (last < 0) return
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.broadcastIndex ?? textFocus)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
        : event.key === 'ArrowDown' ? Math.min(last, current + 1)
          : Math.max(0, current - 1)
    setTextFocus(next)
    items[next]?.focus()
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
    type FocusableControl = HTMLButtonElement | HTMLInputElement
    const focusable = Array.from(
      root.current?.querySelectorAll<FocusableControl>('[data-reaction-focusable="true"]:not([tabindex="-1"])') ?? [],
    ).filter(element => !element.disabled && element.offsetParent !== null)
    // jsdom has no layout and reports offsetParent null. Keep the rendered
    // controls as a deterministic fallback for accessibility tests.
    const rendered = focusable.length > 0
      ? focusable
      : Array.from(root.current?.querySelectorAll<FocusableControl>('[data-reaction-focusable="true"]:not([tabindex="-1"])') ?? [])
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
    setComposingChat(false)
    setChatText('')
    if (next === 'emoji') setEmojiFocus(0)
    else setTextFocus(0)
  }

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = normalizeChatText(chatText)
    if (!isValidChatText(text)) return
    if (onSendChat(text) === false) return
    closeAndReturnFocus()
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
                  Emoji <span aria-hidden="true">{REACTION_OPTIONS.length}</span>
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
                  Text <span aria-hidden="true">{BROADCAST_OPTIONS.length + recentCustomMessages.length + 1}</span>
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
                  {composingChat ? (
                    <form className="reaction-picker__composer" onSubmit={submitChat}>
                      <label className="reaction-picker__composer-label" htmlFor={chatInputId}>
                        Custom message
                      </label>
                      <input
                        ref={chatInput}
                        id={chatInputId}
                        className="reaction-picker__composer-input"
                        type="text"
                        value={chatText}
                        maxLength={MAX_CHAT_MESSAGE_LENGTH}
                        placeholder="Say something to the table…"
                        autoComplete="off"
                        enterKeyHint="send"
                        dir="auto"
                        aria-describedby={chatCountId}
                        data-reaction-focusable="true"
                        onChange={event => setChatText(event.target.value)}
                      />
                      <div className="reaction-picker__composer-footer">
                        <span className="reaction-picker__composer-count" id={chatCountId}>
                          {chatText.length}/{MAX_CHAT_MESSAGE_LENGTH}
                        </span>
                        <div className="reaction-picker__composer-actions">
                          <button
                            type="button"
                            className="reaction-picker__composer-cancel"
                            onClick={closeAndReturnFocus}
                            data-reaction-focusable="true"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="reaction-picker__composer-send"
                            disabled={!isValidChatText(normalizeChatText(chatText))}
                            data-reaction-focusable="true"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <div className="reaction-picker__text-list" onKeyDown={moveTextFocus}>
                      <button
                        type="button"
                        className="reaction-picker__text reaction-picker__text--custom"
                        data-broadcast-index={0}
                        data-reaction-focusable="true"
                        tabIndex={textFocus === 0 ? 0 : -1}
                        aria-label="Custom message"
                        onFocus={() => setTextFocus(0)}
                        onClick={() => setComposingChat(true)}
                      >
                        <span className="reaction-picker__custom-title">Custom message</span>
                        <span className="reaction-picker__custom-hint">Write your own broadcast</span>
                      </button>
                      {recentCustomMessages.length > 0 && (
                        <div
                          className="reaction-picker__text-group reaction-picker__text-group--recent"
                          role="group"
                          aria-labelledby={recentMessagesId}
                        >
                          <span className="reaction-picker__section-label" id={recentMessagesId}>Recent messages</span>
                          {recentCustomMessages.map((message, index) => {
                            const itemIndex = index + 1
                            return (
                              <button
                                key={message}
                                type="button"
                                className="reaction-picker__text reaction-picker__text--recent"
                                data-broadcast-index={itemIndex}
                                data-reaction-focusable="true"
                                tabIndex={itemIndex === textFocus ? 0 : -1}
                                aria-label={`Send again: ${message}`}
                                dir="auto"
                                onFocus={() => setTextFocus(itemIndex)}
                                onClick={() => {
                                  if (onSendChat(message) === false) return
                                  closeAndReturnFocus()
                                }}
                              >
                                <span className="reaction-picker__recent-copy">{message}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <div
                        className="reaction-picker__text-group reaction-picker__text-group--presets"
                        role={recentCustomMessages.length > 0 ? 'group' : undefined}
                        aria-labelledby={recentCustomMessages.length > 0 ? presetsId : undefined}
                      >
                        {recentCustomMessages.length > 0 && (
                          <span className="reaction-picker__section-label" id={presetsId}>Presets</span>
                        )}
                        {BROADCAST_OPTIONS.map((option, index) => {
                          const itemIndex = recentCustomMessages.length + index + 1
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className="reaction-picker__text"
                              data-broadcast={option.id}
                              data-broadcast-index={itemIndex}
                              data-reaction-focusable="true"
                              tabIndex={itemIndex === textFocus ? 0 : -1}
                              aria-label={`Broadcast: ${option.label}`}
                              dir="auto"
                              onFocus={() => setTextFocus(itemIndex)}
                              onClick={() => {
                                onSendBroadcast(option.id)
                                closeAndReturnFocus()
                              }}
                            >
                              {option.text}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
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

export function ChatFeedback({ event, playerName }: { event: ChatEvent | null; playerName?: string }) {
  return (
    <SpeechFeedback
      eventKey={event ? `${event.playerId}:${event.text}:${event.ts}` : null}
      playerName={playerName ?? 'Player'}
      text={event?.text ?? ''}
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
