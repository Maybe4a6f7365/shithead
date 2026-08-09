import type { GameRules } from '../engine'

export interface RoundRulesControlProps {
  rules: GameRules
  editable?: boolean
  onChange?: (patch: Partial<GameRules>) => void
  compact?: boolean
  label?: string
  tone?: 'felt' | 'paper'
}

/** The two room options that must be agreed before a round is dealt. */
export function RoundRulesControl({
  rules,
  editable = false,
  onChange,
  compact = false,
  label = 'Round rules',
  tone = 'felt',
}: RoundRulesControlProps) {
  const options: Array<{
    key: keyof GameRules
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
