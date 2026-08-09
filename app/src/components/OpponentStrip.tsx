// ============================================================================
// OpponentStrip (Z1) — 1–4 seats + stable ordering by turn order relative to
// me; seats never re-order or disappear between turns (§3.1–3.3).
// OpponentSeat (§3.2): mini back + count, up to 3 mini faces, 3 mini backs,
// name (feed, truncated 10 chars), gold under-bar turn marker, offline state.
// ============================================================================
import { memo } from 'react'
import clsx from 'clsx'
import type { Card as CardT, Player } from '../engine'
import { Card } from './Card'

export interface Seat {
  player: Player
  /** Face-up cards are public knowledge — real cards may be shown mini. */
  faceUp: CardT[]
  handCount: number
  faceDownCount: number
  offline?: boolean
}

/** Stable seat order: next player after me is leftmost (§3.1). */
export function orderSeats(players: Player[], meId: string): Player[] {
  const meIdx = players.findIndex(p => p.id === meId)
  if (meIdx === -1) return players.filter(p => p.id !== meId)
  const out: Player[] = []
  for (let i = 1; i < players.length; i++) {
    out.push(players[(meIdx + i) % players.length])
  }
  return out
}

export const OpponentSeat = memo(function OpponentSeat({ seat, active }: { seat: Seat; active: boolean }) {
  const { player } = seat
  const name = player.name.length > 10 ? `${player.name.slice(0, 10)}…` : player.name
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-between w-[68px] min-h-[72px] py-s1 rounded-button',
        active && 'bg-felt-raised',
      )}
      aria-label={`${player.name}: ${seat.handCount} in hand, ${seat.faceUp.length} face up, ${seat.faceDownCount} face down${active ? ', their turn' : ''}${seat.offline ? ', offline' : ''}${player.isOut ? ', out' : ''}`}
    >
      {/* Miniatures: one back + count; up to 3 faces; face-down strips */}
      <div className="flex items-end gap-[2px] h-[26px]">
        {seat.handCount > 0 && (
          <div className="relative">
            <div className="w-[18px] h-[26px] rounded-[2px] bg-burgundy shadow-[var(--shadow-card-rest)]" aria-hidden="true" />
            <span className="absolute inset-0 flex items-center justify-center text-micro font-semibold text-cream">
              {seat.handCount}
            </span>
          </div>
        )}
        {seat.faceUp.slice(0, 3).map(c => (
          <div key={c.id} className="w-[18px] h-[26px] rounded-[2px] bg-cream flex items-center justify-center shadow-[var(--shadow-card-rest)]" aria-hidden="true">
            <span className={clsx('text-[11px] leading-none font-bold', (c.suit === '♥' || c.suit === '♦' || c.rank === 'JOKER') ? 'text-burgundy' : 'text-ink')}>
              {c.rank === 'JOKER' ? 'J' : c.rank}
            </span>
          </div>
        ))}
        {Array.from({ length: seat.faceDownCount }).map((_, i) => (
          <div key={`d${i}`} className="w-[8px] h-[24px] rounded-[1px] bg-burgundy/80" aria-hidden="true" />
        ))}
      </div>
      <span
        className={clsx(
          'text-feed font-medium truncate max-w-full',
          active ? 'text-gold-bright' : 'text-cream-dim',
          seat.offline && 'opacity-45',
          player.isOut && 'opacity-45 line-through',
        )}
      >
        {name}
      </span>
      {seat.offline ? (
        <span className="text-micro font-semibold tracking-micro text-danger-bright">offline</span>
      ) : (
        <span
          aria-hidden="true"
          className={clsx('w-6 h-[2px] rounded-full', active ? 'bg-gold-bright' : 'bg-transparent')}
        />
      )}
    </div>
  )
})

export interface OpponentStripProps {
  seats: Seat[]
  activeSeatId: string | null
}

export function OpponentStrip({ seats, activeSeatId }: OpponentStripProps) {
  return (
    <div
      className="flex items-start justify-center gap-s2 min-h-[72px]"
      role="list"
      aria-label="Opponents"
    >
      {seats.map(s => (
        <div role="listitem" key={s.player.id}>
          <OpponentSeat seat={s} active={s.player.id === activeSeatId} />
        </div>
      ))}
    </div>
  )
}
