// ============================================================================
// What the table shows when someone reacts: an emoji, a ready-made line, a
// chat message, or a notice from the room itself. Each appears briefly beside
// the name of whoever sent it.
// ============================================================================
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { BroadcastEvent, ChatEvent, EmoteEvent, SystemEvent, ViewerRole } from '../engine/protocol'
import { BROADCAST_BY_ID, ONDRA_COPY, PLAYER_LEFT_COPY, REACTION_BY_ID } from './reactionCatalog'
import { EASE_SLIDE } from './motion'

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

/**
 * A queued watcher talks on the same channels as a seated player, so every
 * bubble says which one you are hearing. The marker is derived from the
 * server-stamped role: a locally constructed event has none and stays untagged.
 */
const WATCHING_LABEL = 'watching'

const isWatching = (event: { role?: ViewerRole } | null | undefined) => event?.role === 'spectator'

export function EmoteFeedback({ event, playerName }: { event: EmoteEvent | null; playerName?: string }) {
  const reduceMotion = useReducedMotion()
  const visible = useTimedVisibility(event ? `${event.playerId}:${event.emote}:${event.ts}` : null, 2100)
  const option = event ? REACTION_BY_ID[event.emote] : null
  const watching = isWatching(event)
  const name = playerName ?? 'Player'

  return (
    <AnimatePresence>
      {event && option && visible && (
        <div className="reaction-feedback-layer reaction-feedback-layer--emoji" data-emote={event.emote}>
          <motion.div
            className="emote-feedback reaction-feedback reaction-feedback--emoji"
            role="status"
            aria-live="polite"
            data-speaker-role={watching ? 'spectator' : 'player'}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.82 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.03 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: EASE_SLIDE }}
          >
            <span className="visually-hidden">
              {name}{watching ? `, ${WATCHING_LABEL},` : ''} reacted: {option.label}
            </span>
            <img className="emote-feedback__art" src={option.asset} alt="" aria-hidden="true" draggable="false" />
            <span className="emote-feedback__name" aria-hidden="true">
              {name}
              {watching && <span className="reaction-feedback__watching"> · {WATCHING_LABEL}</span>}
            </span>
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
      watching={isWatching(event)}
      text={option?.text ?? ''}
    />
  )
}

export function ChatFeedback({ event, playerName }: { event: ChatEvent | null; playerName?: string }) {
  return (
    <SpeechFeedback
      eventKey={event ? `${event.playerId}:${event.text}:${event.ts}` : null}
      playerName={playerName ?? 'Player'}
      watching={isWatching(event)}
      text={event?.text ?? ''}
    />
  )
}

function SpeechFeedback({ eventKey, playerName, text, watching = false }: {
  eventKey: string | null
  playerName: string
  text: string
  watching?: boolean
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
            data-speaker-role={watching ? 'spectator' : 'player'}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2, ease: EASE_SLIDE }}
          >
            <span className="reaction-feedback__speaker">
              <span className="reaction-feedback__speaker-name">{playerName}</span>
              {watching && <span className="reaction-feedback__watching">· {WATCHING_LABEL}</span>}
            </span>
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
