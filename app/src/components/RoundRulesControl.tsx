import type { GameRules } from '../engine'

export interface RoundRulesControlProps {
  rules: GameRules
  editable?: boolean
  onChange?: (patch: Partial<GameRules>) => void
  compact?: boolean
  label?: string
  tone?: 'felt' | 'paper'
}

/** The room options that must be agreed before a round is dealt. */
export function RoundRulesControl({
  rules,
  editable = false,
  onChange,
  compact = false,
  label = 'Round rules',
  tone = 'felt',
}: RoundRulesControlProps) {
  const moveDeckChoice = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    if (choices.length === 0) return
    event.preventDefault()
    const current = choices.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? choices.length - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? (current + 1 + choices.length) % choices.length
          : (current - 1 + choices.length) % choices.length
    choices[next]?.focus()
    choices[next]?.click()
  }

  const options: Array<{
    key: 'includeJokers' | 'winnerSwapsFaceUp'
    title: string
    description: string
  }> = [
    {
      key: 'includeJokers',
      title: 'Jokers',
      description: 'Add both Jokers to the deck.',
    },
    {
      key: 'winnerSwapsFaceUp',
      title: 'Winner exchange',
      description: 'Next round, the winner may swap one of their three face-up final cards with one face-up final card belonging to the last-place player.',
    },
  ]

  return (
    <fieldset className={`${compact ? 'round-rules round-rules--compact' : 'round-rules'} ${tone === 'paper' ? 'round-rules--paper' : ''}`}>
      <legend className={`text-label font-bold tracking-label uppercase ${tone === 'paper' ? 'text-ink-soft' : 'text-cream-dim'}`}>{label}</legend>
      <div className="mt-s2 flex flex-col">
        <div className="round-rule-row">
          <span className="min-w-0 pr-s3">
            <span className={`block text-body font-semibold ${tone === 'paper' ? 'text-ink' : 'text-cream'}`}>Decks</span>
            {!compact && (
              <span className={`block text-small mt-s1 ${tone === 'paper' ? 'text-ink-soft' : 'text-cream-dim'}`}>
                Use more decks for a longer round. Equal-rank burns still work the same.
              </span>
            )}
          </span>
          <div className="deck-count-control" role="radiogroup" aria-label="Number of decks" onKeyDown={moveDeckChoice}>
            {([1, 2, 3] as const).map(count => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={(rules.deckCount ?? 1) === count}
                tabIndex={editable && (rules.deckCount ?? 1) === count ? 0 : -1}
                disabled={!editable}
                onClick={() => onChange?.({ deckCount: count })}
                className="deck-count-option"
                aria-label={`${count} ${count === 1 ? 'deck' : 'decks'}`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        {options.map(option => {
          const checked = rules[option.key]
          return (
            <label key={option.key} className="round-rule-row">
              <span className="min-w-0 pr-s3">
                <span className={`block text-body font-semibold ${tone === 'paper' ? 'text-ink' : 'text-cream'}`}>{option.title}</span>
                {!compact && <span className={`block text-small mt-s1 ${tone === 'paper' ? 'text-ink-soft' : 'text-cream-dim'}`}>{option.description}</span>}
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={checked}
                disabled={!editable}
                onChange={event => onChange?.({ [option.key]: event.target.checked })}
                aria-label={option.title}
                className="round-rule-switch"
              />
            </label>
          )
        })}
      </div>
      {!editable && !compact && (
        <p className={`text-small mt-s2 ${tone === 'paper' ? 'text-ink-soft' : 'text-cream-dim'}`}>Only the host can change these rules.</p>
      )}
    </fieldset>
  )
}
