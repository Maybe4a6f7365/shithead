// ============================================================================
// WaitingRoom (§7.3) — fixes the broken host flow. The host/guest branch is
// driven by room.hostId === myPlayerId from authoritative room state ONLY.
// Text on felt (§7 shared frame); no dashed empty slots — the count line
// says it.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type {
  BroadcastEvent,
  BroadcastId,
  ChatEvent,
  EmoteEvent,
  EmoteId,
  RoomSummary,
  SystemEvent,
} from '../engine/protocol'
import { DEFAULT_GAME_RULES, type GameRules } from '../engine'
import { RoundRulesControl } from './RoundRulesControl'
import {
  BroadcastFeedback,
  ChatFeedback,
  EmoteButton,
  EmoteFeedback,
  SystemEventFeedback,
} from './EmoteButton'

/** Resolve a display name for a reaction event from authoritative roster state. */
function playerNameForEvent(
  event: { playerId: string } | null | undefined,
  room: Pick<RoomSummary, 'players'>,
  fallbackId: string,
): string | undefined {
  if (!event) return undefined
  const found = room.players.find(p => p.id === event.playerId)
  return found?.name ?? (event.playerId === fallbackId ? 'You' : undefined)
}

/** The one rule that decides what you see. Exported for the regression test. */
export function waitingRoomRole(room: Pick<RoomSummary, 'hostId'>, myPlayerId: string): 'host' | 'guest' {
  return room.hostId === myPlayerId ? 'host' : 'guest'
}

export interface WaitingRoomProps {
  room: RoomSummary
  myPlayerId: string
  onStart: () => void
  onLeave: () => void
  onRulesChange?: (patch: Partial<GameRules>) => void
  heading?: string
  // Reaction channel (all optional — old renders still work).
  onSendEmote?: (emote: EmoteId) => void
  onSendBroadcast?: (broadcast: BroadcastId) => void
  onSendChat?: (text: string) => void | boolean
  recentCustomMessages?: readonly string[]
  latestEmote?: EmoteEvent | null
  latestBroadcast?: BroadcastEvent | null
  latestChat?: ChatEvent | null
  latestSystemEvent?: SystemEvent | null
}

export function inviteUrl(roomCode: string, origin = window.location.origin): string {
  const url = new URL('/', origin)
  url.searchParams.set('room', roomCode)
  return url.toString()
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* use the selection fallback below */ }

  const field = document.createElement('textarea')
  field.value = value
  field.readOnly = true
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  field.setSelectionRange(0, value.length)
  let copied = false
  try { copied = document.execCommand?.('copy') ?? false } catch { /* denied */ }
  field.remove()
  return copied
}

export function WaitingRoom({
  room,
  myPlayerId,
  onStart,
  onLeave,
  onRulesChange,
  heading,
  onSendEmote,
  onSendBroadcast,
  onSendChat,
  recentCustomMessages,
  latestEmote,
  latestBroadcast,
  latestChat,
  latestSystemEvent,
}: WaitingRoomProps) {
  const [shareStatus, setShareStatus] = useState<{ message: string; failed?: boolean } | null>(null)
  const [startHint, setStartHint] = useState<string | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHost = waitingRoomRole(room, myPlayerId) === 'host'
  const enough = room.players.length >= 2
  const everyoneOnline = room.players.every(player => player.connected)
  const hostOnline = room.players.find(player => player.id === room.hostId)?.connected !== false
  const url = useMemo(() => inviteUrl(room.code), [room.code])

  useEffect(() => () => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
  }, [])

  const showShareStatus = (message: string, failed = false) => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
    setShareStatus({ message, failed })
    if (!failed) statusTimer.current = setTimeout(() => setShareStatus(null), 2500)
  }

  const copy = async () => {
    const copied = await copyText(room.code)
    showShareStatus(copied ? 'Room code copied.' : 'Copy was blocked. Select the invite link below.', !copied)
  }

  const invite = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Shithead', text: `Join my Shithead room: ${room.code}`, url })
        showShareStatus('Invite shared.')
        return
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return
      }
    }
    const copied = await copyText(url)
    showShareStatus(copied ? 'Invite link copied.' : 'Sharing was blocked. Select the invite link below.', !copied)
  }

  const start = () => {
    if (!enough) {
      setStartHint('Need at least 2 players.')
      setTimeout(() => setStartHint(null), 3000)
      return
    }
    if (!everyoneOnline) {
      setStartHint('Everyone must be online before the round can start.')
      setTimeout(() => setStartHint(null), 3000)
      return
    }
    onStart()
  }

  return (
    <div className="app-viewport pregame-screen pregame-screen--waiting bg-felt text-cream flex flex-col" style={{ position: 'relative' }}>
      <main className="waiting-room-main screen-content pregame-shell flex-1 overflow-y-auto w-full max-w-[440px] mx-auto px-s4 py-s5 flex flex-col justify-start">
        <header className="pregame-header waiting-room-header">
          <p className="pregame-kicker">
            <span aria-hidden="true">♠</span> Private table
          </p>
          <h1 className="pregame-title font-display text-title font-semibold">{heading ?? 'Waiting room'}</h1>
          <p className="pregame-intro text-body text-cream-dim">Share the code and get everyone to the table.</p>
        </header>

        <section className="room-code-ticket room-code-panel text-center" aria-labelledby="room-code-label">
          <span className="room-code-ticket__pip room-code-ticket__pip--left" aria-hidden="true" />
          <span className="room-code-ticket__pip room-code-ticket__pip--right" aria-hidden="true" />
          <div id="room-code-label" className="room-code-ticket__label text-label font-bold tracking-label uppercase text-cream-dim">Room code</div>
          <div className="room-code-ticket__code font-display text-code font-semibold tracking-code text-cream mt-s1" aria-label={`Room code ${room.code.split('').join(' ')}`}>
            {room.code}
          </div>
          <div className="room-code-ticket__actions flex justify-center gap-s2 mt-s2">
            <button
              type="button"
              onClick={copy}
              className="room-code-action min-h-[44px] min-w-[88px] px-s4 text-label font-bold tracking-label uppercase text-cream/80"
            >
              <span aria-hidden="true">♣</span> Copy code
            </button>
            <button
              type="button"
              onClick={invite}
              className="room-code-action room-code-action--invite min-h-[44px] min-w-[88px] px-s4 text-label font-bold tracking-label uppercase text-cream/80"
            >
              Invite <span aria-hidden="true">↗</span>
            </button>
          </div>
          <p
            className={`room-code-ticket__status min-h-[20px] mt-s1 text-small ${shareStatus?.failed ? 'text-danger-bright' : 'text-gold-bright'}`}
            role={shareStatus?.failed ? 'alert' : 'status'}
            aria-live={shareStatus?.failed ? 'assertive' : 'polite'}
          >
            {shareStatus?.message ?? ''}
          </p>
          {shareStatus?.failed && (
            <label className="room-code-ticket__fallback block mt-s2 text-left text-label font-bold tracking-label uppercase text-cream-dim">
              Invite link
              <input
                readOnly
                value={url}
                onFocus={event => event.currentTarget.select()}
                className="modern-input mt-s1 w-full min-h-[44px] px-s3 rounded-button bg-felt-deep text-cream border border-hairline text-small normal-case tracking-normal"
              />
            </label>
          )}
        </section>

        <section className="pregame-section waiting-room-seats" aria-labelledby="waiting-seats-title">
          <div className="pregame-section__heading">
            <div>
              <p className="pregame-section__kicker text-label font-bold tracking-label uppercase text-cream-dim">At the table</p>
              <h2 id="waiting-seats-title" className="pregame-section__title font-display text-body font-semibold">Players</h2>
            </div>
            <span className="seat-count text-small text-cream-dim" aria-label={`${room.players.length} of ${room.maxPlayers} seats filled`}>
              {room.players.length}/{room.maxPlayers}
            </span>
          </div>
          <ul className="waiting-seat-list" aria-label="Players in room">
            {room.players.map(p => (
              <li key={p.id} className="waiting-seat flex items-center justify-between py-s3 border-t border-hairline">
                <span className="waiting-seat__name text-body font-semibold text-cream">
                  {p.name}{p.id === myPlayerId ? ' (you)' : ''}
                </span>
                <span
                  className={clsx(
                    'waiting-seat__status text-micro font-semibold tracking-micro',
                    p.id === room.hostId && p.connected ? 'text-gold-bright' : p.connected ? 'text-muted-felt' : 'text-danger-bright',
                  )}
                >
                  {p.id === room.hostId ? `host${p.connected ? '' : ' · offline'}` : p.connected ? 'online' : 'offline'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="pregame-section waiting-room-rules" aria-label="House rules">
          <RoundRulesControl
            rules={room.rules ?? DEFAULT_GAME_RULES}
            editable={isHost}
            onChange={onRulesChange}
          />
        </section>

        {isHost ? (
          <div className="waiting-room-action waiting-room-action--host mt-s5">
            <p className="waiting-room-action__status text-feed text-cream-dim mb-s2"><span aria-hidden="true">♦</span> You are the host.</p>
            <button
              type="button"
              onClick={start}
              className="primary-action w-full px-s5 text-button font-bold tracking-button uppercase"
            >
              Start game
            </button>
            {startHint && <p role="alert" className="waiting-room-action__hint mt-s2 text-small text-danger-bright">{startHint}</p>}
          </div>
        ) : (
          <p className="waiting-room-action waiting-room-action--guest text-feed text-cream-dim mt-s5 mb-s2" role="status">
            {hostOnline ? 'Waiting for the host to start…' : 'Waiting for the host to reconnect…'}
          </p>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="leave-room-action mt-s4 w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-cream/80"
        >
          Leave
        </button>
      </main>
      {onSendEmote && (
        <div className="waiting-room__reaction-control" style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 5 }}>
          <EmoteButton
            key={myPlayerId}
            onSend={onSendEmote}
            onSendBroadcast={onSendBroadcast ?? (() => undefined)}
            onSendChat={onSendChat ?? (() => undefined)}
            recentCustomMessages={recentCustomMessages ?? []}
          />
        </div>
      )}
      <div className="waiting-room__feedback-stack" aria-label="Table reactions">
        <EmoteFeedback event={latestEmote ?? null} playerName={playerNameForEvent(latestEmote, room, myPlayerId)} />
        <BroadcastFeedback event={latestBroadcast ?? null} playerName={playerNameForEvent(latestBroadcast, room, myPlayerId)} />
        <ChatFeedback event={latestChat ?? null} playerName={playerNameForEvent(latestChat, room, myPlayerId)} />
        <SystemEventFeedback event={latestSystemEvent ?? null} />
      </div>
    </div>
  )
}
