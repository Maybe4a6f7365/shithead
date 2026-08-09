// ============================================================================
// HotSeatLobby (§7.4) — 2–5 player rows on felt: name input with visible
// label, HUMAN/AI segmented control (44px, text-based, never color-only),
// Easy/Medium/Hard when AI. "+ Add player" ghost row disappears at 5.
// DEAL pinned above the safe-area bottom. Two rows pre-filled (You + 1 AI).
// ============================================================================
import { useState } from 'react'
import clsx from 'clsx'
import { useSPGame } from '../sp/SPSinglePlayer'
import { DEFAULT_GAME_RULES, type GameRules } from '../engine'
import { loadSavedName, saveName } from './NameField'
import { RoundRulesControl } from './RoundRulesControl'

interface PlayerConfig {
  name: string
  isAI: boolean
  difficulty?: 'easy' | 'medium' | 'hard'
}

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

export function HotSeatLobby({ onBack }: { onBack: () => void }) {
  const initGame = useSPGame(s => s.initGame)
  const [players, setPlayers] = useState<PlayerConfig[]>(() => [
    { name: loadSavedName('You'), isAI: false },
    { name: 'Hans', isAI: true, difficulty: 'medium' },
  ])
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_GAME_RULES })

  const update = (idx: number, patch: Partial<PlayerConfig>) =>
    setPlayers(ps => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)))

  const deal = () => {
    const first = players[0]
    if (first && !first.isAI) saveName(first.name)
    initGame(players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` })), rules)
  }

  return (
    <div className="app-viewport pregame-screen pregame-screen--offline bg-felt text-cream flex flex-col">
      <main className="screen-content pregame-shell hot-seat-lobby flex-1 overflow-y-auto w-full max-w-[440px] mx-auto px-s4 py-s5">
        <header className="pregame-header">
          <button
            type="button"
            onClick={onBack}
            className="pregame-back min-h-[44px] text-label font-bold tracking-label uppercase text-cream-dim"
          >
            <span aria-hidden="true">←</span> Menu
          </button>
          <p className="pregame-kicker">
            <span aria-hidden="true">♦</span> Same phone
          </p>
          <h1 className="pregame-title font-display text-title font-semibold">Play offline</h1>
          <p className="pregame-intro text-body text-cream-dim">Set the seats, agree the house rules, then deal.</p>
        </header>

        <section className="pregame-section pregame-section--rules" aria-labelledby="offline-rules-title">
          <h2 id="offline-rules-title" className="pregame-section__title font-display text-body font-semibold">
            House rules
          </h2>
          <RoundRulesControl
            rules={rules}
            editable
            label="Round rules"
            onChange={patch => setRules(current => ({ ...current, ...patch }))}
          />
        </section>

        <section className="pregame-section pregame-section--seats" aria-labelledby="seats-title">
          <div className="pregame-section__heading">
            <div>
              <p className="pregame-section__kicker text-label font-bold tracking-label uppercase text-cream-dim">At the table</p>
              <h2 id="seats-title" className="pregame-section__title font-display text-body font-semibold">Seats</h2>
            </div>
            <span className="seat-count text-small text-cream-dim" aria-label={`${players.length} of 5 seats filled`}>
              {players.length}/5
            </span>
          </div>

          <ol className="seat-list flex flex-col gap-s4">
            {players.map((p, i) => (
              <li key={i} className="setup-card seat-card surface-panel player-config flex flex-col gap-s2">
              <div className="seat-card__identity flex items-end gap-s2">
                <div className="setup-field flex-1">
                  <label
                    htmlFor={`player-${i}`}
                    className="form-label block text-label font-bold tracking-label uppercase text-cream-dim mb-s1"
                  >
                    Seat {i + 1}
                  </label>
                  <input
                    id={`player-${i}`}
                    value={p.name}
                    onChange={e => update(i, { name: e.target.value.slice(0, 12) })}
                    placeholder={`Player ${i + 1}`}
                    maxLength={12}
                    autoComplete="off"
                    className="modern-input player-name-input w-full min-h-[48px] px-s3 rounded-button bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline text-body"
                  />
                </div>
                {players.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPlayers(ps => ps.filter((_, j) => j !== i))}
                    aria-label={`Remove seat ${i + 1}`}
                    className="seat-card__remove min-w-[44px] min-h-[48px] text-body text-cream-dim"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>

              {/* HUMAN / AI segmented — text-based, never color-only */}
              <div className="seat-card__type segmented-control flex rounded-button overflow-hidden border border-hairline" role="group" aria-label={`Seat ${i + 1} player type`}>
                {(['HUMAN', 'AI'] as const).map(t => {
                  const active = p.isAI === (t === 'AI')
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update(i, { isAI: t === 'AI', difficulty: t === 'AI' ? (p.difficulty ?? 'medium') : undefined })}
                      className={clsx(
                        'segmented-control__option flex-1 min-h-[44px] text-label tracking-label uppercase',
                        active ? 'bg-burgundy text-cream font-bold' : 'text-cream-dim',
                      )}
                    >
                      {t === 'HUMAN' ? 'Human' : 'AI'}
                    </button>
                  )
                })}
              </div>

              {p.isAI && (
                <div className="seat-card__difficulty segmented-control flex rounded-button overflow-hidden border border-hairline" role="group" aria-label={`Seat ${i + 1} AI difficulty`}>
                  {DIFFICULTIES.map(d => {
                    const active = p.difficulty === d
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update(i, { difficulty: d })}
                        className={clsx(
                          'segmented-control__option flex-1 min-h-[44px] text-label tracking-label uppercase',
                          active ? 'bg-burgundy text-cream font-bold' : 'text-cream-dim',
                        )}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              )}
              </li>
            ))}
          </ol>

          {players.length < 5 && (
            <button
              type="button"
              onClick={() => setPlayers(ps => [...ps, { name: '', isAI: true, difficulty: 'medium' }])}
              className="add-seat-action w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-cream/80"
            >
              <span aria-hidden="true">+</span> Add a seat
            </button>
          )}
        </section>
      </main>

      <footer className="app-bottom-zone pregame-action-bar px-s4 pt-s2 w-full max-w-[440px] mx-auto">
        <button
          type="button"
          onClick={deal}
          className="primary-action deal-action w-full px-s5 text-button font-bold tracking-button uppercase"
        >
          Deal cards
        </button>
      </footer>
    </div>
  )
}
