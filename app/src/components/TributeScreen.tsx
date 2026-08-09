import { useEffect, useRef, useState } from 'react'
import type { Player } from '../engine'
import { Card, CardDefs, type CardVisualState } from './Card'

export interface TributeScreenProps {
  winner: Player
  loser: Player
  viewerId: string
  onSwap: (winnerCardId: string, loserCardId: string) => void
  onSkip: () => void
  error?: string | null
}

/** Optional one-for-one exchange after both public final rows are settled. */
export function TributeScreen({ winner, loser, viewerId, onSwap, onSkip, error }: TributeScreenProps) {
  const [winnerCardId, setWinnerCardId] = useState<string | null>(null)
  const [loserCardId, setLoserCardId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitGuard = useRef(false)
  const canChoose = viewerId === winner.id

  useEffect(() => {
    if (!error) return
    submitGuard.current = false
    setSubmitting(false)
  }, [error])

  useEffect(() => {
    if (!submitting) return
    const retry = window.setTimeout(() => {
      submitGuard.current = false
      setSubmitting(false)
    }, 3000)
    return () => window.clearTimeout(retry)
  }, [submitting])

  const submit = (action: () => void) => {
    if (!canChoose || submitGuard.current) return
    submitGuard.current = true
    setSubmitting(true)
    action()
  }

  const swap = () => {
    if (!winnerCardId || !loserCardId) return
    submit(() => onSwap(winnerCardId, loserCardId))
  }

  return (
    <div className="app-viewport tribute-screen bg-felt text-cream table-select-none overflow-y-auto">
      <CardDefs />
      <main className="w-full max-w-[560px] min-h-full mx-auto px-s4 py-s5 flex flex-col">
        <header className="text-center">
          <div className="text-label font-bold tracking-label uppercase text-cream-dim">Winner exchange</div>
          <h1 className="font-display text-title font-semibold mt-s1">
            {canChoose ? 'Choose two face-up cards' : `${winner.name} is choosing`}
          </h1>
          <p className="text-feed text-cream-dim mt-s2">
            {canChoose
              ? `Swap one of your final cards with one of ${loser.name}'s, or keep both rows as they are.`
              : `Only ${winner.name}, the previous winner, may make this optional exchange.`}
          </p>
        </header>

        <div className="flex-1 flex flex-col justify-center gap-s5 py-s5">
          <TributeRow
            title={`${winner.name}'s final cards`}
            player={winner}
            selectedId={winnerCardId}
            disabled={!canChoose || submitting}
            onSelect={setWinnerCardId}
            hint="card to give"
          />
          <TributeRow
            title={`${loser.name}'s final cards`}
            player={loser}
            selectedId={loserCardId}
            disabled={!canChoose || submitting}
            onSelect={setLoserCardId}
            hint="card to take"
          />
        </div>

        {error && <p role="alert" className="text-small text-danger-bright text-center mb-s2">{error} You can try again.</p>}
        {canChoose ? (
          <footer className="app-bottom-zone flex gap-s2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(onSkip)}
              className="flex-1 min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-cream/80 disabled:opacity-50"
            >
              Keep cards
            </button>
            <button
              type="button"
              disabled={!winnerCardId || !loserCardId || submitting}
              onClick={swap}
              className="flex-1 min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase disabled:opacity-45"
            >
              {submitting ? 'Exchanging…' : 'Exchange'}
            </button>
          </footer>
        ) : (
          <p className="app-bottom-zone min-h-[48px] flex items-center justify-center text-body text-cream-dim">Waiting for the winner…</p>
        )}
      </main>
    </div>
  )
}

function TributeRow({
  title, player, selectedId, disabled, onSelect, hint,
}: {
  title: string
  player: Player
  selectedId: string | null
  disabled: boolean
  onSelect: (id: string) => void
  hint: string
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-label font-bold tracking-label uppercase text-cream-dim text-center mb-s2">{title}</h2>
      <div className="tribute-row flex justify-center gap-s2 overflow-x-auto px-s2 pt-s3">
        {player.faceUp.map((card, index) => {
          const state: CardVisualState = selectedId === card.id ? 'selected' : disabled ? 'rest' : 'playable'
          return (
            <div key={card.id} className="shrink-0 pb-s4">
              <Card
                card={card}
                state={state}
                ariaHint={`${hint}, ${index + 1} of ${player.faceUp.length}${selectedId === card.id ? ', selected' : ''}`}
                onActivate={disabled ? undefined : () => onSelect(card.id)}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
