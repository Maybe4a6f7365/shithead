// ============================================================================
// Card — the star of the show (DESIGN.md §2.5, §9).
// Fluid 5:7 geometry driven by --card-w; state machine per §2.5 table;
// real <button> when interactive; React.memo'd; shared SVG defs (CardDefs)
// fix the duplicate-ID bug. Woodcut art + gold "S" back are PRESERVED.
// ============================================================================
import { memo, useMemo } from 'react'
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
  /** Extra hint folded into the aria-label ("playable" / "selected" / …). */
  ariaHint?: string
}

const SUIT_NAME: Record<Suit, string> = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' }
const SUIT_SYMBOL_ID: Record<Suit, string> = { '♠': 'suit-spade', '♥': 'suit-heart', '♦': 'suit-diamond', '♣': 'suit-club' }

/** Deterministic ±2.5° in-pile tilt from the card id (§2.5). */
export function pileTilt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const m = ((h % 101) + 101) % 101 // |h| can overflow negative — normalize
  return (m / 100) * 5 - 2.5
}

/**
 * Shared SVG defs, rendered ONCE per screen (fixes the duplicate
 * `id="backPattern"` bug). Suit glyphs are single-path, currentColor,
 * viewBox 0 0 16 16, drawn once and <use>d everywhere (§2.6).
 */
export function CardDefs() {
  return (
    <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        <symbol id="suit-spade" viewBox="0 0 16 16">
          <path d="M8 1C5.5 3.5 2.5 6.2 2.5 9a3.6 3.6 0 0 0 4.4 3.5c-.5 1.2-1.1 2-1.9 2.5h6c-.8-.5-1.4-1.3-1.9-2.5A3.6 3.6 0 0 0 13.5 9C13.5 6.2 10.5 3.5 8 1z" />
        </symbol>
        <symbol id="suit-heart" viewBox="0 0 16 16">
          <path d="M8 14S1.5 9.8 1.5 5.9C1.5 3.6 3.3 2 5.3 2c1.1 0 2.1.5 2.7 1.4C8.6 2.5 9.6 2 10.7 2c2 0 3.8 1.6 3.8 3.9C14.5 9.8 8 14 8 14z" />
        </symbol>
        <symbol id="suit-diamond" viewBox="0 0 16 16">
          <path d="M8 1l5 7-5 7-5-7z" />
        </symbol>
        <symbol id="suit-club" viewBox="0 0 16 16">
          <path d="M8 1a3.4 3.4 0 0 0-1.6 6.4A3.4 3.4 0 1 0 7 12.2c-.3 1.1-.9 2-1.7 2.8h5.4c-.8-.8-1.4-1.7-1.7-2.8a3.4 3.4 0 1 0 .6-4.8A3.4 3.4 0 0 0 8 1z" />
        </symbol>
        <pattern id="card-back-diagonal" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="20" stroke="var(--color-gold)" strokeWidth="1" opacity="0.4" />
        </pattern>
      </defs>
    </svg>
  )
}

function SuitGlyph({ suit, size, className }: { suit: Suit; size: number | string; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} className={className} style={{ display: 'block' }}>
      <use href={`#${SUIT_SYMBOL_ID[suit]}`} fill="currentColor" />
    </svg>
  )
}

export function cardAriaLabel(card: CardT | undefined, faceDown: boolean | undefined, hint?: string): string {
  if (faceDown || !card) return 'Face-down card'
  const base = card.rank === 'JOKER'
    ? 'Joker'
    : `${rankName(card.rank)} of ${card.suit ? SUIT_NAME[card.suit] : 'unknown suit'}`
  return hint ? `${base}, ${hint}` : base
}

function rankName(rank: CardT['rank']): string {
  switch (rank) {
    case 'A': return 'Ace'
    case 'J': return 'Jack'
    case 'Q': return 'Queen'
    case 'K': return 'King'
    default: return rank
  }
}

// ---------------------------------------------------------------------------
// Art layers (woodcut, preserved from the original renderer; 200x300 art
// space centered inside the 200x280 (5:7) viewBox via translate(0 -10)).
// ---------------------------------------------------------------------------

const PIP_LAYOUTS: Record<string, Array<[number, number]>> = {
  '2': [[100, 90], [100, 210]],
  '3': [[100, 70], [100, 150], [100, 230]],
  '4': [[70, 80], [130, 80], [70, 220], [130, 220]],
  '5': [[70, 80], [130, 80], [100, 150], [70, 220], [130, 220]],
  '6': [[70, 80], [130, 80], [70, 150], [130, 150], [70, 220], [130, 220]],
  '7': [[70, 80], [130, 80], [70, 150], [130, 150], [70, 220], [130, 220], [100, 115]],
  '8': [[70, 70], [130, 70], [70, 130], [130, 130], [70, 170], [130, 170], [70, 230], [130, 230]],
  '9': [[70, 70], [130, 70], [70, 130], [130, 130], [100, 150], [70, 170], [130, 170], [70, 230], [130, 230]],
  '10': [[70, 65], [130, 65], [70, 105], [130, 105], [100, 130], [70, 170], [130, 170], [100, 200], [70, 235], [130, 235]],
}

function CenterArt({ card }: { card: CardT }) {
  const suit = card.suit
  const suitId = suit ? SUIT_SYMBOL_ID[suit] : null

  if (card.rank === 'JOKER') {
    return (
      <g transform="translate(0 -10)">
        <text x="100" y="60" fontSize="20" textAnchor="middle" fill="currentColor" fontFamily="ui-serif, Georgia, serif" fontWeight="bold" letterSpacing="2">JOKER</text>
        <text x="100" y="255" fontSize="20" textAnchor="middle" fill="currentColor" fontFamily="ui-serif, Georgia, serif" fontWeight="bold" letterSpacing="2">JOKER</text>
        {/* Crown */}
        <g transform="translate(70 100)">
          <path d="M0 30 L10 10 L20 25 L30 5 L40 25 L50 10 L60 30 Z" fill="var(--color-gold)" stroke="var(--color-burgundy)" strokeWidth="1" />
          <circle cx="10" cy="8" r="3" fill="var(--color-burgundy)" />
          <circle cx="30" cy="3" r="3" fill="var(--color-burgundy)" />
          <circle cx="50" cy="8" r="3" fill="var(--color-burgundy)" />
        </g>
        {/* Face */}
        <circle cx="100" cy="160" r="35" fill="var(--color-cream)" stroke="var(--color-burgundy)" strokeWidth="2" />
        <circle cx="88" cy="155" r="3" fill="var(--color-ink)" />
        <circle cx="112" cy="155" r="3" fill="var(--color-ink)" />
        <path d="M85 175 q15 12 30 0" fill="none" stroke="var(--color-burgundy)" strokeWidth="2" />
        {/* Bells */}
        <circle cx="55" cy="120" r="6" fill="var(--color-gold)" />
        <circle cx="145" cy="120" r="6" fill="var(--color-gold)" />
      </g>
    )
  }

  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    return (
      <g transform="translate(0 -10)">
        <g transform="translate(100 165)">
          <path d="M-45 80 q0 -50 45 -55 q45 5 45 55 z" fill="currentColor" opacity="0.9" />
          <circle cx="0" cy="-15" r="35" fill="var(--color-cream)" stroke="currentColor" strokeWidth="2" />
          {(card.rank === 'K' || card.rank === 'Q') && (
            <g transform="translate(0 -50)">
              <path d="M-20 10 L-15 -5 L-10 8 L0 -10 L10 8 L15 -5 L20 10 Z" fill="var(--color-gold)" stroke="var(--color-burgundy)" strokeWidth="1" />
            </g>
          )}
          {card.rank === 'J' && (
            <g transform="translate(0 -55)">
              <path d="M-25 15 L-30 -10 L-15 5 L0 -15 L15 5 L30 -10 L25 15 Z" fill="var(--color-burgundy)" />
              <circle cx="-25" cy="-15" r="4" fill="var(--color-gold)" />
              <circle cx="25" cy="-15" r="4" fill="var(--color-gold)" />
              <circle cx="0" cy="-15" r="4" fill="var(--color-gold)" />
            </g>
          )}
          <circle cx="-12" cy="-15" r="2.5" fill="var(--color-ink)" />
          <circle cx="12" cy="-15" r="2.5" fill="var(--color-ink)" />
          <path d="M-8 0 q8 6 16 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" />
        </g>
        <text x="100" y="35" fontSize="14" textAnchor="middle" fill="currentColor" fontFamily="ui-serif, Georgia, serif" fontWeight="bold">{card.rank}</text>
        <text x="100" y="280" fontSize="14" textAnchor="middle" fill="currentColor" fontFamily="ui-serif, Georgia, serif" fontWeight="bold" transform="rotate(180 100 280)">{card.rank}</text>
      </g>
    )
  }

  if (card.rank === 'A') {
    return (
      <g transform="translate(0 -10)">
        {suitId && (
          <g transform="translate(60 110) scale(5)">
            <use href={`#${suitId}`} fill="currentColor" />
          </g>
        )}
        <text x="100" y="270" fontSize="14" textAnchor="middle" fill="currentColor" fontFamily="ui-serif, Georgia, serif" fontWeight="bold">A</text>
      </g>
    )
  }

  // Numbered cards — preserved woodcut pip arrangements.
  const positions = PIP_LAYOUTS[card.rank] ?? []
  return (
    <g transform="translate(0 -10)">
      {suitId && positions.map(([x, y], i) => (
        <g key={i} transform={`translate(${x - 28} ${y - 28}) scale(3.5)`}>
          <use href={`#${suitId}`} fill="currentColor" />
        </g>
      ))}
    </g>
  )
}

function CardBack() {
  return (
    <svg viewBox="0 0 200 280" className="absolute inset-0 w-full h-full" aria-hidden="true">
      {/* Gold inner frame */}
      <rect x="8" y="8" width="184" height="264" rx="6" fill="none" stroke="var(--color-gold)" strokeWidth="2" opacity="0.8" />
      <rect x="14" y="14" width="172" height="252" rx="4" fill="none" stroke="var(--color-gold)" strokeWidth="1" opacity="0.6" />
      <rect x="14" y="14" width="172" height="252" fill="url(#card-back-diagonal)" />
      {/* Central S monogram — the brand mark, preserved */}
      <text x="100" y="160" fontSize="80" textAnchor="middle" fill="var(--color-gold)" fontFamily="ui-serif, Georgia, serif" fontWeight="bold" opacity="0.95">S</text>
      {/* Corner diamonds */}
      <path d="M40 36 l8 10 -8 10 -8-10z" fill="var(--color-gold)" />
      <path d="M160 36 l8 10 -8 10 -8-10z" fill="var(--color-gold)" />
      <path d="M40 234 l8 10 -8 10 -8-10z" fill="var(--color-gold)" />
      <path d="M160 234 l8 10 -8 10 -8-10z" fill="var(--color-gold)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------

function CardInner({ card, faceDown, state = 'rest', size = 'full', onActivate, ariaHint }: CardProps) {
  const interactive = !!onActivate
  const isBack = faceDown || !card

  // Suit ink: red suits burgundy, black suits ink, joker burgundy (§2.1).
  const inkColor = !isBack && card
    ? (card.rank === 'JOKER' || card.suit === '♥' || card.suit === '♦'
        ? 'var(--color-burgundy)'
        : 'var(--color-ink)')
    : undefined

  const label = cardAriaLabel(card, faceDown, ariaHint)
  const style: React.CSSProperties = {}
  if (state === 'in-pile' && card) style['--pile-tilt' as string] = `${pileTilt(card.id)}deg`

  const body = isBack ? (
    <div className="absolute inset-0 bg-burgundy" style={{ borderRadius: 'inherit' }}>
      <CardBack />
    </div>
  ) : (
    <>
      {/* Woodcut frame lines (preserved; suit-ink at 40% opacity, §2.5) */}
      <svg viewBox="0 0 200 280" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" aria-hidden="true" style={{ color: inkColor }}>
        <rect x="6" y="6" width="188" height="268" rx="4" fill="none" stroke="var(--color-burgundy)" strokeWidth="1.5" opacity="0.5" />
        <rect x="10" y="10" width="180" height="260" rx="2" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
        <path d="M10 20 q10 -10 20 0" fill="none" stroke="var(--color-burgundy)" strokeWidth="0.8" opacity="0.5" />
        <path d="M190 20 q-10 -10 -20 0" fill="none" stroke="var(--color-burgundy)" strokeWidth="0.8" opacity="0.5" />
        <path d="M10 260 q10 10 20 0" fill="none" stroke="var(--color-burgundy)" strokeWidth="0.8" opacity="0.5" />
        <path d="M190 260 q-10 10 -20 0" fill="none" stroke="var(--color-burgundy)" strokeWidth="0.8" opacity="0.5" />
      </svg>

      {/* Center art */}
      <svg viewBox="0 0 200 280" className="absolute inset-0 w-full h-full" aria-hidden="true" style={{ color: inkColor }}>
        <CenterArt card={card!} />
      </svg>

      {/* Corner indices: top-left + bottom-right rotated 180° (§2.5) */}
      {(['tl', 'br'] as const).map(corner => (
        <div
          key={corner}
          aria-hidden="true"
          className={clsx(
            'absolute flex flex-col items-center leading-none font-ui font-bold',
            corner === 'tl' ? 'top-0 left-0' : 'bottom-0 right-0 rotate-180',
          )}
          style={{
            color: inkColor,
            width: 'calc(var(--card-w) * 0.24 * var(--card-scale))',
            margin: 'calc(var(--card-w) * 0.06 * var(--card-scale))',
            fontSize: 'calc(max(12px, var(--card-w) * 0.21) * var(--card-scale))',
          }}
        >
          <span>{card!.rank === 'JOKER' ? 'J' : card!.rank}</span>
          {card!.suit && (
            <span style={{ marginTop: 1 }}>
              <SuitGlyph suit={card!.suit} size="calc(var(--card-w) * 0.16 * var(--card-scale))" />
            </span>
          )}
        </div>
      ))}

      {/* Special-card badges (preserved) */}
      {card!.rank === '2' && size === 'full' && (
        <div className="absolute bottom-s1 left-1/2 -translate-x-1/2 px-s1 rounded-sm bg-gold text-ink text-micro font-bold tracking-micro">
          WILD
        </div>
      )}
      {card!.rank === '10' && size === 'full' && (
        <div className="absolute bottom-s1 left-1/2 -translate-x-1/2 px-s1 rounded-sm bg-burgundy text-cream text-micro font-bold tracking-micro">
          CLEAR
        </div>
      )}
    </>
  )

  const className = clsx('card overflow-hidden table-select-none', size === 'mini' && 'card--mini')

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

/**
 * Memoized with a custom comparison that ignores onActivate: interactive
 * handlers in this app are routed through refs (stable semantics), so a
 * skipped re-render never leaves a stale closure behind. Playing one card
 * thus re-renders only the cards whose visual state actually changed.
 */
export const Card = memo(CardInner, (prev, next) =>
  prev.card === next.card &&
  prev.faceDown === next.faceDown &&
  prev.state === next.state &&
  prev.size === next.size &&
  prev.ariaHint === next.ariaHint
)
