// ============================================================================
// OpponentStrip (Z1) — 1–4 seats + stable ordering by turn order relative to
// me; seats never re-order or disappear between turns (§3.1–3.3).
// OpponentSeat (§3.2): mini back + count, up to 3 mini faces, 3 mini backs,
// name (feed, truncated 10 chars), gold under-bar turn marker, offline state.
// ============================================================================
import { memo } from 'react'
import clsx from 'clsx'
import type { Card as CardT, Player } from '../engine'

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
        'flex flex-col items-center justify-between w-[84px] min-h-[88px] py-s1 rounded-button',
        active && 'bg-felt-raised',
      )}
      aria-label={`${player.name}: ${seat.handCount} in hand, ${seat.faceUp.length} face up, ${seat.faceDownCount} face down${active ? ', their turn' : ''}${seat.offline ? ', offline' : ''}${player.isOut ? ', out' : ''}`}
    >
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
      <div className="flex items-center gap-[4px]">
        <div className="relative w-[18px] h-[26px] rounded-[2px] bg-burgundy shadow-[var(--shadow-card-rest)]" role="img" aria-label={`${seat.handCount} cards in hand`}>
          <span className="absolute inset-0 flex items-center justify-center text-micro font-semibold text-cream" aria-hidden="true">
            {seat.handCount}
          </span>
        </div>
        {/* Stable public final-card rail below the username. */}
        <div className="final-mini-row" aria-label={`${player.name}'s final cards`}>
        <div className="final-mini-row__line">
          {Array.from({ length: 3 }).map((_, index) => {
            const card = seat.faceUp[index]
            return card ? (
              <div
                key={`up-${index}`}
                className="final-mini-card final-mini-card--up"
                role="img"
                aria-label={`${card.rank === 'JOKER' ? 'Joker' : card.rank}, face-up final card ${index + 1} of 3`}
              >
                <span className={clsx((card.suit === '♥' || card.suit === '♦' || card.rank === 'JOKER') ? 'text-burgundy' : 'text-ink')} aria-hidden="true">
                  {card.rank === 'JOKER' ? 'JK' : card.rank}
                </span>
              </div>
            ) : <span key={`up-${index}`} className="final-mini-card final-mini-card--empty" aria-hidden="true" />
          })}
        </div>
        <div className="final-mini-row__line">
          {Array.from({ length: 3 }).map((_, index) => index < seat.faceDownCount ? (
            <span key={`down-${index}`} className="final-mini-card final-mini-card--down" role="img" aria-label={`Face-down final card ${index + 1} of ${seat.faceDownCount}`} />
          ) : <span key={`down-${index}`} className="final-mini-card final-mini-card--empty" aria-hidden="true" />)}
        </div>
        </div>
      </div>
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
      className="flex items-start justify-start sm:justify-center gap-s2 min-h-[88px] overflow-x-auto"
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
