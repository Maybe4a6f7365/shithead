// ============================================================================
// TableauWell (Z3) — felt-deep flat band holding YOUR face-down row (mini
// backs) and face-up row on one line, left-aligned (§3.1). Minis upgrade to
// full W cards when interactive (rearrange / endgame, §6.4 + §9).
// ============================================================================
import type { Card as CardT } from '../engine'
import { Card, type CardVisualState } from './Card'

export interface TableauWellProps {
  faceUp: CardT[]
  /** Face-down entries (ids only are meaningful — always rendered as backs). */
  faceDown: Array<Pick<CardT, 'id'>>
  faceUpStates?: Map<string, CardVisualState>
  faceDownStates?: Map<string, CardVisualState>
  faceUpHints?: Map<string, string>
  faceDownHints?: Map<string, string>
  onActivateFaceUp?: (id: string) => void
  onActivateFaceDown?: (id: string) => void
  /** Upgrade miniatures to full W cards (rearrange phase / endgame). */
  fullSize?: boolean
}

export function TableauWell({
  faceUp, faceDown, faceUpStates, faceDownStates, faceUpHints, faceDownHints,
  onActivateFaceUp, onActivateFaceDown, fullSize,
}: TableauWellProps) {
  const size = fullSize ? 'full' : 'mini'
  return (
    <div
      className="bg-felt-deep rounded-well p-s3 mx-s4 flex items-end gap-s2 overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
      aria-label="Your tableau"
    >
      {faceDown.map((c, index) => (
        <div key={c.id} className="shrink-0" style={{ paddingBottom: fullSize ? 16 : 0 }}>
          <Card
            faceDown
            size={size}
            state={faceDownStates?.get(c.id) ?? 'rest'}
            ariaHint={faceDownHints?.get(c.id) ?? `${index + 1} of ${faceDown.length}`}
            onActivate={onActivateFaceDown ? () => onActivateFaceDown(c.id) : undefined}
          />
        </div>
      ))}
      {faceUp.map(c => (
        <div key={c.id} className="shrink-0" style={{ paddingBottom: fullSize ? 16 : 0 }}>
          <Card
            card={c}
            size={size}
            state={faceUpStates?.get(c.id) ?? 'rest'}
            ariaHint={faceUpHints?.get(c.id)}
            onActivate={onActivateFaceUp ? () => onActivateFaceUp(c.id) : undefined}
          />
        </div>
      ))}
      {faceDown.length === 0 && faceUp.length === 0 && (
        <span className="text-small text-cream-dim self-center">Tableau clear</span>
      )}
    </div>
  )
}
