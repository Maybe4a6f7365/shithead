// ============================================================================
// TableauWell — each public final card sits directly above its hidden card.
// Six cards therefore read as three physical stacks instead of two wasteful
// rows. Minis upgrade to full cards while setup/endgame is interactive.
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
  const stackCount = Math.max(faceUp.length, faceDown.length)
  return (
    <div
      className="tableau-well mx-s4"
      style={{ scrollbarWidth: 'none' }}
      aria-label="Your tableau"
    >
      <div className="tableau-stacks" data-size={fullSize ? 'full' : 'mini'}>
        {Array.from({ length: stackCount }).map((_, index) => {
          const hidden = faceDown[index]
          const shown = faceUp[index]
          return (
            <div
              key={`${hidden?.id ?? 'empty'}:${shown?.id ?? 'empty'}:${index}`}
              className="tableau-stack"
              data-tableau-stack={index + 1}
            >
              {hidden && (
                <div className="tableau-stack__down">
                  <Card
                    faceDown
                    size={size}
                    state={faceDownStates?.get(hidden.id) ?? 'rest'}
                    ariaHint={faceDownHints?.get(hidden.id) ?? `${index + 1} of ${faceDown.length}`}
                    onActivate={onActivateFaceDown ? () => onActivateFaceDown(hidden.id) : undefined}
                  />
                </div>
              )}
              {shown && (
                <div className="tableau-stack__up">
                  <Card
                    card={shown}
                    size={size}
                    state={faceUpStates?.get(shown.id) ?? 'rest'}
                    ariaHint={faceUpHints?.get(shown.id)}
                    onActivate={onActivateFaceUp ? () => onActivateFaceUp(shown.id) : undefined}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {stackCount === 0 && (
        <span className="text-small text-cream-dim self-center">Tableau clear</span>
      )}
    </div>
  )
}
