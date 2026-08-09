// ============================================================================
// WaitingRoom (§7.3) — fixes the broken host flow. The host/guest branch is
// driven by room.hostId === myPlayerId from authoritative room state ONLY.
// Text on felt (§7 shared frame); no dashed empty slots — the count line
// says it.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { RoomSummary } from '../engine/protocol'
import { DEFAULT_GAME_RULES, type GameRules } from '../engine'
import { RoundRulesControl } from './RoundRulesControl'

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

export function WaitingRoom({ room, myPlayerId, onStart, onLeave, onRulesChange, heading }: WaitingRoomProps) {
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
    <div className="app-viewport bg-felt text-cream flex flex-col">
      <main className="waiting-room-main screen-content flex-1 overflow-y-auto w-full max-w-[440px] mx-auto px-s4 py-s5 flex flex-col justify-start">
        <div className="room-code-panel text-center mb-s5">
          {heading && <h1 className="font-display text-title font-semibold mb-s3">{heading}</h1>}
          <div className="text-label font-bold tracking-label uppercase text-cream-dim">Room code</div>
          <div className="font-display text-code font-semibold tracking-code text-cream mt-s1" aria-label={`Room code ${room.code.split('').join(' ')}`}>
            {room.code}
          </div>
          <div className="flex justify-center gap-s2 mt-s2">
            <button
              type="button"
              onClick={copy}
              className="min-h-[44px] min-w-[88px] px-s4 text-label font-bold tracking-label uppercase text-cream/80"
            >
              Copy code
            </button>
            <button
              type="button"
              onClick={invite}
              className="min-h-[44px] min-w-[88px] px-s4 text-label font-bold tracking-label uppercase text-cream/80"
            >
              Invite
            </button>
          </div>
          <p
            className={`min-h-[20px] mt-s1 text-small ${shareStatus?.failed ? 'text-danger-bright' : 'text-gold-bright'}`}
            role={shareStatus?.failed ? 'alert' : 'status'}
            aria-live={shareStatus?.failed ? 'assertive' : 'polite'}
          >
            {shareStatus?.message ?? ''}
          </p>
          {shareStatus?.failed && (
            <label className="block mt-s2 text-left text-label font-bold tracking-label uppercase text-cream-dim">
              Invite link
              <input
                readOnly
                value={url}
                onFocus={event => event.currentTarget.select()}
                className="modern-input mt-s1 w-full min-h-[44px] px-s3 rounded-button bg-felt-deep text-cream border border-hairline text-small normal-case tracking-normal"
              />
            </label>
          )}
        </div>

        <div role="list" aria-label="Players in room">
          {room.players.map(p => (
            <div key={p.id} role="listitem" className="flex items-center justify-between py-s3 border-t border-hairline">
              <span className="text-body font-semibold text-cream">
                {p.name}{p.id === myPlayerId ? ' (you)' : ''}
              </span>
              <span
                className={clsx(
                  'text-micro font-semibold tracking-micro',
                  p.id === room.hostId && p.connected ? 'text-gold-bright' : p.connected ? 'text-muted-felt' : 'text-danger-bright',
                )}
              >
                {p.id === room.hostId ? `host${p.connected ? '' : ' · offline'}` : p.connected ? 'online' : 'offline'}
              </span>
            </div>
          ))}
        </div>
        <p className="text-small text-cream-dim mt-s2 mb-s5">
          {room.players.length} of {room.maxPlayers} players
        </p>

        <RoundRulesControl
          rules={room.rules ?? DEFAULT_GAME_RULES}
          editable={isHost}
          onChange={onRulesChange}
        />

        {isHost ? (
          <div className="mt-s5">
            <p className="text-feed text-cream-dim mb-s2">You are the host.</p>
            <button
              type="button"
              onClick={start}
              className="primary-action w-full px-s5 text-button font-bold tracking-button uppercase"
            >
              Start game
            </button>
            {startHint && <p role="alert" className="mt-s2 text-small text-danger-bright">{startHint}</p>}
          </div>
        ) : (
          <p className="text-feed text-cream-dim mt-s5 mb-s2">
            {hostOnline ? 'Waiting for the host to start…' : 'Waiting for the host to reconnect…'}
          </p>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="mt-s4 w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-cream/80"
        >
          Leave
        </button>
      </main>
    </div>
  )
}
