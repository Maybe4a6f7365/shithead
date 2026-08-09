import { memo } from 'react'
import clsx from 'clsx'
import type { Card as CardT, Suit } from '../engine'

export type CardVisualState =
  | 'rest' | 'playable' | 'selected' | 'joinable' | 'invalid' | 'in-pile' | 'disabled'

export interface CardProps {
  card?: CardT
  faceDown?: boolean
  state?: CardVisualState
  size?: 'mini' | 'full'
  onActivate?: () => void
  ariaHint?: string
}

const SUIT_NAME: Record<Suit, string> = {
  '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs',
}

/** Kept as a screen-level compatibility hook; modern cards use text glyphs. */
export function CardDefs() {
  return null
}

/** Deterministic ±2.5° in-pile tilt from the opaque card id. */
export function pileTilt(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0
  const normalized = ((hash % 101) + 101) % 101
  return (normalized / 100) * 5 - 2.5
}

export function cardAriaLabel(card: CardT | undefined, faceDown: boolean | undefined, hint?: string): string {
  if (faceDown || !card) return hint ? `Face-down card, ${hint}` : 'Face-down card'
  const base = card.rank === 'JOKER'
    ? 'Joker'
    : `${rankName(card.rank)} of ${card.suit ? SUIT_NAME[card.suit] : 'unknown suit'}`
  return hint ? `${base}, ${hint}` : base
}

function rankName(rank: CardT['rank']): string {
  if (rank === 'A') return 'Ace'
  if (rank === 'J') return 'Jack'
  if (rank === 'Q') return 'Queen'
  if (rank === 'K') return 'King'
  return rank
}

function CardBack() {
  return (
    <div className="card-back" aria-hidden="true">
      <span className="card-back__orbit" />
      <span className="card-back__mark">S</span>
    </div>
  )
}

function CardFace({ card, size }: { card: CardT; size: 'mini' | 'full' }) {
  const isWarm = card.rank === 'JOKER' || card.suit === '♥' || card.suit === '♦'
  const rank = card.rank === 'JOKER' ? 'JK' : card.rank
  const effect = card.rank === '2' ? 'RESET'
    : card.rank === '3' ? 'MIRROR'
      : card.rank === '7' ? '≤7'
        : card.rank === '8' ? 'SKIP'
          : card.rank === '10' ? 'BURN'
            : null

  return (
    <div className={clsx('card-face', isWarm ? 'card-face--warm' : 'card-face--cool')}>
      <div className="card-index card-index--top" aria-hidden="true">
        <strong>{rank}</strong>
        {card.suit && <span>{card.suit}</span>}
      </div>
      <div className="card-center" aria-hidden="true">
        <span className="card-center__rank">{rank}</span>
        {card.suit && <span className="card-center__suit">{card.suit}</span>}
      </div>
      <div className="card-index card-index--bottom" aria-hidden="true">
        <strong>{rank}</strong>
        {card.suit && <span>{card.suit}</span>}
      </div>
      {effect && size === 'full' && <span className="card-effect" aria-hidden="true">{effect}</span>}
    </div>
  )
}

function CardInner({ card, faceDown, state = 'rest', size = 'full', onActivate, ariaHint }: CardProps) {
  const interactive = Boolean(onActivate)
  const isBack = faceDown || !card
  const label = cardAriaLabel(card, faceDown, ariaHint)
  const style: React.CSSProperties = {}
  if (state === 'in-pile' && card) style['--pile-tilt' as string] = `${pileTilt(card.id)}deg`
  const className = clsx('card table-select-none', size === 'mini' && 'card--mini')
  const body = isBack ? <CardBack /> : <CardFace card={card} size={size} />

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        data-state={state}
        style={style}
        onClick={onActivate}
        aria-label={label}
      >
        {body}
      </button>
    )
  }

  return (
    <div className={className} data-state={state} style={style} role="img" aria-label={label}>
      {body}
    </div>
  )
}

export const Card = memo(CardInner, (previous, next) =>
  previous.card === next.card &&
  previous.faceDown === next.faceDown &&
  previous.state === next.state &&
  previous.size === next.size &&
  previous.ariaHint === next.ariaHint
)
