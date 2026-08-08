import type { Card as CardType, Rank, Suit } from '../game/types'

const SUIT_COLORS: Record<string, string> = { '♠': '#1a1a1a', '♣': '#1a1a1a', '♥': '#a23a1e', '♦': '#a23a1e' }
const SUIT_PATH: Record<string, string> = {
  '♠': 'M12 2C9 2 6 5 6 9c0 3 2 5 6 9 4-4 6-6 6-9 0-4-3-7-6-7zm0 18l-2 2h4l-2-2z',
  '♥': 'M12 21s-8-6-8-12c0-3 2-6 5-6 2 0 3 1 3 1s1-1 3-1c3 0 5 3 5 6 0 6-8 12-8 12z',
  '♦': 'M12 2l8 10-8 10-8-10z',
  '♣': 'M12 2c-2 0-4 2-4 5 0 1 0 2 1 3-2 0-4 2-4 4s2 4 4 4c1 0 2 0 3-1v3h2v-3c1 1 2 1 3 1 2 0 4-2 4-4s-2-4-4-4c1-1 1-2 1-3 0-3-2-5-4-5z',
}

interface Props {
  card?: CardType
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
  playable?: boolean
  className?: string
}

// Sizes in viewBox units: 200x300 (2:3 portrait). CSS scales the container.
const SIZES = {
  sm: { w: 96, h: 144, font: 14, corner: 14, center: 38 },
  md: { w: 144, h: 216, font: 18, corner: 18, center: 56 },
  lg: { w: 200, h: 300, font: 24, corner: 26, center: 80 },
}

export function Card({ card, faceDown, size = 'md', onClick, selected, disabled, playable, className }: Props) {
  const sz = SIZES[size]
  const baseClass = `rounded-lg shadow-md select-none transition-all ${
    selected ? 'ring-2 ring-[#c8a35a] -translate-y-2 shadow-xl' : ''
  } ${playable ? 'ring-2 ring-[#2d4a2b] cursor-pointer' : ''} ${disabled ? 'opacity-50' : ''} ${className ?? ''}`

  const clickHandler = !disabled && onClick ? { onClick } : {}

  // Face-down card back
  if (faceDown || !card) {
    return (
      <div
        className={`${baseClass} bg-gradient-to-br from-[#a23a1e] to-[#7a2a14] border-2 border-[#5a1a0a] flex items-center justify-center`}
        style={{ width: sz.w, height: sz.h }}
        {...clickHandler}
      >
        <svg viewBox="0 0 200 300" width={sz.w * 0.92} height={sz.h * 0.92}>
          {/* Inner border */}
          <rect x="8" y="8" width="184" height="284" rx="6" fill="none" stroke="#c8a35a" strokeWidth="2" opacity="0.8"/>
          <rect x="14" y="14" width="172" height="272" rx="4" fill="none" stroke="#c8a35a" strokeWidth="1" opacity="0.6"/>
          {/* Diagonal pattern */}
          <pattern id="backPattern" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="20" stroke="#c8a35a" strokeWidth="1" opacity="0.4"/>
          </pattern>
          <rect x="14" y="14" width="172" height="272" fill="url(#backPattern)"/>
          {/* Central S monogram */}
          <text x="100" y="170" fontSize="80" textAnchor="middle" fill="#c8a35a" fontFamily="serif" fontWeight="bold" opacity="0.95">S</text>
          {/* Decorative diamonds */}
          <path d="M40 40 l8 10 -8 10 -8-10z" fill="#c8a35a"/>
          <path d="M160 40 l8 10 -8 10 -8-10z" fill="#c8a35a"/>
          <path d="M40 260 l8 10 -8 10 -8-10z" fill="#c8a35a"/>
          <path d="M160 260 l8 10 -8 10 -8-10z" fill="#c8a35a"/>
        </svg>
      </div>
    )
  }

  const color = card.rank === 'JOKER' ? '#7a2a14' : (SUIT_COLORS[card.suit ?? ''] ?? '#1a1a1a')
  const suitGlyph = card.suit ?? ''
  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K'
  const isAce = card.rank === 'A'
  const isNum = !isFace && !isAce && card.rank !== 'JOKER'

  // Pip positions for numbered cards (center arrangement)
  const renderPips = () => {
    const n = card.rank === 'A' ? 1 : card.rank === 'J' ? 0 : card.rank === 'Q' ? 0 : card.rank === 'K' ? 0 : parseInt(card.rank)
    if (n === 0 || isAce) return null
    const positions: Array<[number, number]> = []
    if (n === 1) positions.push([100, 150])
    else if (n === 2) { positions.push([100, 90]); positions.push([100, 210]) }
    else if (n === 3) { positions.push([100, 70]); positions.push([100, 150]); positions.push([100, 230]) }
    else if (n === 4) { positions.push([70, 80]); positions.push([130, 80]); positions.push([70, 220]); positions.push([130, 220]) }
    else if (n === 5) { positions.push([70, 80]); positions.push([130, 80]); positions.push([100, 150]); positions.push([70, 220]); positions.push([130, 220]) }
    else if (n === 6) { positions.push([70, 80]); positions.push([130, 80]); positions.push([70, 150]); positions.push([130, 150]); positions.push([70, 220]); positions.push([130, 220]) }
    else if (n === 7) { positions.push([70, 80]); positions.push([130, 80]); positions.push([70, 150]); positions.push([130, 150]); positions.push([70, 220]); positions.push([130, 220]); positions.push([100, 115]) }
    else if (n === 8) { positions.push([70, 70]); positions.push([130, 70]); positions.push([70, 130]); positions.push([130, 130]); positions.push([70, 170]); positions.push([130, 170]); positions.push([70, 230]); positions.push([130, 230]) }
    else if (n === 9) { positions.push([70, 70]); positions.push([130, 70]); positions.push([70, 130]); positions.push([130, 130]); positions.push([100, 150]); positions.push([70, 170]); positions.push([130, 170]); positions.push([70, 230]); positions.push([130, 230]) }
    else if (n === 10) { positions.push([70, 65]); positions.push([130, 65]); positions.push([70, 105]); positions.push([130, 105]); positions.push([100, 130]); positions.push([70, 170]); positions.push([130, 170]); positions.push([100, 200]); positions.push([70, 235]); positions.push([130, 235]) }

    return positions.map(([x, y], i) => (
      <g key={i} transform={`translate(${x - 12} ${y - 12}) scale(${sz.center / 24})`}>
        <path d={SUIT_PATH[suitGlyph]} fill={color} />
      </g>
    ))
  }

  return (
    <div
      className={`${baseClass} bg-[#faf8f3] border-2 border-[#2d4a2b]/40 relative overflow-hidden`}
      style={{ width: sz.w, height: sz.h }}
      {...clickHandler}
    >
      {/* Paper grain */}
      <svg viewBox="0 0 200 300" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <defs>
          <pattern id={`grain-${card.id}`} patternUnits="userSpaceOnUse" width="3" height="3">
            <circle cx="1" cy="1" r="0.3" fill="#a23a1e" opacity="0.08"/>
          </pattern>
          <linearGradient id={`shade-${card.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#faf8f3"/>
            <stop offset="100%" stopColor="#ede8d8"/>
          </linearGradient>
        </defs>
        <rect width="200" height="300" fill={`url(#shade-${card.id})`}/>
        <rect width="200" height="300" fill={`url(#grain-${card.id})`}/>
        {/* Ornate border */}
        <rect x="6" y="6" width="188" height="288" rx="4" fill="none" stroke="#a23a1e" strokeWidth="1.5" opacity="0.5"/>
        <rect x="10" y="10" width="180" height="280" rx="2" fill="none" stroke="#2d4a2b" strokeWidth="0.5" opacity="0.4"/>
        {/* Corner flourishes */}
        <path d="M10 20 q10 -10 20 0" fill="none" stroke="#a23a1e" strokeWidth="0.8" opacity="0.5"/>
        <path d="M190 20 q-10 -10 -20 0" fill="none" stroke="#a23a1e" strokeWidth="0.8" opacity="0.5"/>
        <path d="M10 280 q10 10 20 0" fill="none" stroke="#a23a1e" strokeWidth="0.8" opacity="0.5"/>
        <path d="M190 280 q-10 10 -20 0" fill="none" stroke="#a23a1e" strokeWidth="0.8" opacity="0.5"/>
      </svg>

      {/* Top-left corner */}
      <div className="absolute top-1.5 left-2 flex flex-col items-center leading-none" style={{ color }}>
        <span className="font-black" style={{ fontSize: sz.corner }}>{card.rank}</span>
        {suitGlyph && (
          <svg viewBox="0 0 24 24" width={sz.corner * 0.9} height={sz.corner * 0.9}>
            <path d={SUIT_PATH[suitGlyph]} fill={color}/>
          </svg>
        )}
      </div>

      {/* Center */}
      {card.rank === 'JOKER' ? (
        <svg viewBox="0 0 200 300" className="absolute inset-0 w-full h-full">
          <text x="100" y="60" fontSize="20" textAnchor="middle" fill={color} fontFamily="serif" fontWeight="bold" letterSpacing="2">JOKER</text>
          <text x="100" y="255" fontSize="20" textAnchor="middle" fill={color} fontFamily="serif" fontWeight="bold" letterSpacing="2">JOKER</text>
          {/* Crown */}
          <g transform="translate(70 100)">
            <path d="M0 30 L10 10 L20 25 L30 5 L40 25 L50 10 L60 30 Z" fill="#c8a35a" stroke="#7a2a14" strokeWidth="1"/>
            <circle cx="10" cy="8" r="3" fill="#a23a1e"/>
            <circle cx="30" cy="3" r="3" fill="#a23a1e"/>
            <circle cx="50" cy="8" r="3" fill="#a23a1e"/>
          </g>
          {/* Face */}
          <circle cx="100" cy="160" r="35" fill="#faf8f3" stroke="#7a2a14" strokeWidth="2"/>
          <circle cx="88" cy="155" r="3" fill="#1a1a1a"/>
          <circle cx="112" cy="155" r="3" fill="#1a1a1a"/>
          <path d="M85 175 q15 12 30 0" fill="none" stroke="#a23a1e" strokeWidth="2"/>
          {/* Bells */}
          <circle cx="55" cy="120" r="6" fill="#c8a35a"/>
          <circle cx="145" cy="120" r="6" fill="#c8a35a"/>
        </svg>
      ) : isFace ? (
        <svg viewBox="0 0 200 300" className="absolute inset-0 w-full h-full">
          {/* Portrait silhouette */}
          <g transform="translate(100 165)">
            {/* Body */}
            <path d={`M-45 80 q0 -50 45 -55 q45 5 45 55 z`} fill={color} opacity="0.9"/>
            {/* Head */}
            <circle cx="0" cy="-15" r="35" fill="#faf8f3" stroke={color} strokeWidth="2"/>
            {/* Crown (for K, Q) */}
            {(card.rank === 'K' || card.rank === 'Q') && (
              <g transform="translate(0 -50)">
                <path d="M-20 10 L-15 -5 L-10 8 L0 -10 L10 8 L15 -5 L20 10 Z" fill="#c8a35a" stroke="#7a2a14" strokeWidth="1"/>
              </g>
            )}
            {/* Jester hat (for J) */}
            {card.rank === 'J' && (
              <g transform="translate(0 -55)">
                <path d="M-25 15 L-30 -10 L-15 5 L0 -15 L15 5 L30 -10 L25 15 Z" fill="#a23a1e"/>
                <circle cx="-25" cy="-15" r="4" fill="#c8a35a"/>
                <circle cx="25" cy="-15" r="4" fill="#c8a35a"/>
                <circle cx="0" cy="-15" r="4" fill="#c8a35a"/>
              </g>
            )}
            {/* Face features */}
            <circle cx="-12" cy="-15" r="2.5" fill="#1a1a1a"/>
            <circle cx="12" cy="-15" r="2.5" fill="#1a1a1a"/>
            <path d="M-8 0 q8 6 16 0" fill="none" stroke="#1a1a1a" strokeWidth="1.5"/>
          </g>
          {/* Top label */}
          <text x="100" y="35" fontSize="14" textAnchor="middle" fill={color} fontFamily="serif" fontWeight="bold">{card.rank}</text>
          {/* Bottom label (mirrored) */}
          <text x="100" y="280" fontSize="14" textAnchor="middle" fill={color} fontFamily="serif" fontWeight="bold" transform="rotate(180 100 280)">{card.rank}</text>
        </svg>
      ) : isAce ? (
        <svg viewBox="0 0 200 300" className="absolute inset-0 w-full h-full">
          <g transform={`translate(${100 - sz.center / 2} ${150 - sz.center / 2}) scale(${sz.center / 24})`}>
            <path d={SUIT_PATH[suitGlyph]} fill={color}/>
          </g>
          <text x="100" y="270" fontSize="14" textAnchor="middle" fill={color} fontFamily="serif" fontWeight="bold">A</text>
        </svg>
      ) : (
        <svg viewBox="0 0 200 300" className="absolute inset-0 w-full h-full">
          {renderPips()}
        </svg>
      )}

      {/* Special card badges */}
      {card.rank === '2' && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-[#c8a35a] rounded text-[8px] font-bold text-[#1a1a1a] tracking-wider">
          WILD
        </div>
      )}
      {card.rank === '10' && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-[#a23a1e] rounded text-[8px] font-bold text-[#faf8f3] tracking-wider">
          CLEAR
        </div>
      )}

      {/* Bottom-right corner (rotated) */}
      <div className="absolute bottom-1.5 right-2 flex flex-col items-center leading-none rotate-180" style={{ color }}>
        <span className="font-black" style={{ fontSize: sz.corner }}>{card.rank}</span>
        {suitGlyph && (
          <svg viewBox="0 0 24 24" width={sz.corner * 0.9} height={sz.corner * 0.9}>
            <path d={SUIT_PATH[suitGlyph]} fill={color}/>
          </svg>
        )}
      </div>
    </div>
  )
}
