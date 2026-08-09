// ============================================================================
// WaitingRoom (§7.3) — fixes the broken host flow. The host/guest branch is
// driven by room.hostId === myPlayerId from authoritative room state ONLY.
// Text on felt (§7 shared frame); no dashed empty slots — the count line
// says it.
// ============================================================================
import { useState } from 'react'
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

export function WaitingRoom({ room, myPlayerId, onStart, onLeave, onRulesChange, heading }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false)
  const [startHint, setStartHint] = useState<string | null>(null)
  const isHost = waitingRoomRole(room, myPlayerId) === 'host'
  const enough = room.players.length >= 2
  const everyoneOnline = room.players.every(player => player.connected)
  const hostOnline = room.players.find(player => player.id === room.hostId)?.connected !== false

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard denied */ }
  }

  const invite = async () => {
    const url = `${window.location.origin}/?room=${room.code}`
    if (navigator.share) {
      try { await navigator.share({ title: 'Shithead', text: `Join my Shithead room: ${room.code}`, url }) } catch { /* cancelled */ }
    } else {
      copy()
    }
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
      <main className="waiting-room-main flex-1 overflow-y-auto w-full max-w-[400px] mx-auto px-s4 py-s6 flex flex-col justify-start">
        <div className="text-center mb-s5">
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
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={invite}
              className="min-h-[44px] min-w-[88px] px-s4 text-label font-bold tracking-label uppercase text-cream/80"
            >
              Invite
            </button>
          </div>
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
              className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
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
