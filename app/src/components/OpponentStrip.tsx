// ============================================================================
// OpponentStrip (Z1) — 1–4 seats + stable ordering by turn order relative to
// me; seats never re-order or disappear between turns (§3.1–3.3).
// OpponentSeat: compact phone-first seat. Public and hidden final cards use
// the same overlaid three-stack silhouette as the local tableau.
// ============================================================================
import { memo } from 'react'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import type { Card as CardT, Player } from '../engine'

export interface Seat {
  player: Player
  /** Player views may show face-up cards; spectator views mask every owned card. */
  faceUp: CardT[]
  /** Spectator views preserve only the count and render these as card backs. */
  hideFaceUp?: boolean
  handCount: number
  faceDownCount: number
  offline?: boolean
}

export interface SpatialTurnMarkerProps {
  owner: string
  label: string
  className?: string
  /** Undefined under reduced motion, which makes relocation instantaneous. */
  layoutId?: string
}

/**
 * One physical turn marker is shared by opponent seats and the local hand
 * rail. CSS positions it out of flow; layoutId only animates its relocation.
 */
export function SpatialTurnMarker({ owner, label, className, layoutId }: SpatialTurnMarkerProps) {
  return (
    <motion.span
      aria-hidden="true"
      className={clsx('table-turn-marker', className)}
      data-turn-marker-owner={owner}
      layoutId={layoutId}
      layout={layoutId ? 'position' : false}
      transition={layoutId
        ? { layout: { duration: 0.26, ease: [0.16, 1, 0.3, 1] } }
        : { duration: 0 }}
    >
      <span className="table-turn-marker__dot" />
      <span className="table-turn-marker__label">{label}</span>
    </motion.span>
  )
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

export const OpponentSeat = memo(function OpponentSeat({
  seat,
  active,
  turnMarkerLayoutId,
}: {
  seat: Seat
  active: boolean
  turnMarkerLayoutId?: string
}) {
  const { player } = seat
  const name = player.name.length > 10 ? `${player.name.slice(0, 10)}…` : player.name
  // An emptied hand keeps its slot for stable seat geometry, but drops the card
  // silhouette so a spent opponent never reads as still holding one.
  const handEmpty = seat.handCount === 0
  return (
    <div
      className={clsx(
        'opponent-seat',
        active && 'opponent-seat--active',
        seat.offline && 'opponent-seat--offline',
        player.isOut && 'opponent-seat--out',
      )}
      data-active={active ? 'true' : 'false'}
      data-offline={seat.offline ? 'true' : 'false'}
      data-out={player.isOut ? 'true' : 'false'}
      data-hand-count={seat.handCount}
      aria-current={active ? 'step' : undefined}
      aria-label={`${player.name}: ${seat.handCount} in hand, ${seat.faceUp.length} face up${seat.hideFaceUp ? ' hidden' : ''}, ${seat.faceDownCount} face down${active ? ', their turn' : ''}${seat.offline ? ', offline' : ''}${player.isOut ? ', out' : ''}`}
    >
      <div className="opponent-seat__identity">
        <span
          className={clsx(
            'opponent-seat__name text-feed font-medium truncate max-w-full',
            active ? 'text-gold-bright' : 'text-cream-dim',
            player.isOut && 'line-through',
          )}
        >
          {name}
        </span>
        {(seat.offline || player.isOut) && (
          <span
            className="opponent-seat__status text-micro font-semibold tracking-micro"
            data-state={player.isOut ? 'out' : 'offline'}
          >
            {player.isOut ? 'Out' : 'Offline'}
          </span>
        )}
      </div>
      <div className="opponent-seat__cards">
        <div className="opponent-seat__hand">
          <div
            className={clsx('opponent-hand-count', handEmpty && 'opponent-hand-count--empty')}
            role="img"
            aria-label={`${seat.handCount} cards in hand`}
            data-count={seat.handCount}
            data-empty={handEmpty ? 'true' : 'false'}
          >
            {!handEmpty && (
              <span className="absolute inset-0 flex items-center justify-center text-micro font-semibold text-cream" aria-hidden="true">
                {seat.handCount}
              </span>
            )}
          </div>
        </div>
        {/* Stable public final-card rail below the username. */}
        <div className="opponent-seat__tableau">
          <div className="final-mini-row" aria-label={`${player.name}'s final cards`}>
            {Array.from({ length: 3 }).map((_, index) => {
              const card = seat.faceUp[index]
              const hasHidden = index < seat.faceDownCount
              return (
                <span className="final-mini-stack" key={index} data-final-stack={index + 1}>
                  {/* One slot silhouette spans both card positions and sits behind
                      them, so a lone face-down card still shows the empty space
                      above it without a second outline drawn over the card. */}
                  {(!hasHidden || !card) && (
                    <span className="final-mini-card final-mini-card--slot" aria-hidden="true" />
                  )}
                  {hasHidden && (
                    <span className="final-mini-card final-mini-card--down" role="img" aria-label={`Face-down final card ${index + 1} of ${seat.faceDownCount}`} />
                  )}
                  {card && seat.hideFaceUp ? (
                    <span
                      className="final-mini-card final-mini-card--up final-mini-card--hidden"
                      role="img"
                      aria-label={`Hidden face-up card ${index + 1} of ${seat.faceUp.length}`}
                    />
                  ) : card ? (
                    <span
                      className="final-mini-card final-mini-card--up"
                      role="img"
                      aria-label={`${card.rank === 'JOKER' ? 'Joker' : card.rank}, face-up final card ${index + 1} of 3`}
                    >
                      <span className={clsx((card.suit === '♥' || card.suit === '♦' || card.rank === 'JOKER') ? 'text-burgundy' : 'text-ink')} aria-hidden="true">
                        {card.rank === 'JOKER' ? 'JK' : card.rank}
                      </span>
                    </span>
                  ) : null}
                </span>
              )
            })}
          </div>
        </div>
      </div>
      {active && !seat.offline && !player.isOut && (
        <SpatialTurnMarker
          owner={`opponent:${player.id}`}
          label="Playing"
          className="opponent-seat__turn-marker opponent-seat__turn-marker--active"
          layoutId={turnMarkerLayoutId}
        />
      )}
    </div>
  )
})

export interface OpponentStripProps {
  seats: Seat[]
  activeSeatId: string | null
  turnMarkerLayoutId?: string
  ariaLabel?: string
}

export function OpponentStrip({
  seats,
  activeSeatId,
  turnMarkerLayoutId,
  ariaLabel = 'Opponents',
}: OpponentStripProps) {
  return (
    <div
      className="opponent-strip"
      role="list"
      aria-label={ariaLabel}
      data-seat-count={seats.length}
    >
      {seats.map(s => (
        <div className="opponent-strip__item" role="listitem" key={s.player.id}>
          <OpponentSeat
            seat={s}
            active={s.player.id === activeSeatId}
            turnMarkerLayoutId={turnMarkerLayoutId}
          />
        </div>
      ))}
    </div>
  )
}
