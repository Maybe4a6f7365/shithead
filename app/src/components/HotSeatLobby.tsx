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
    <div className="app-viewport bg-felt text-cream flex flex-col">
      <main className="flex-1 overflow-y-auto w-full max-w-[400px] mx-auto px-s4 py-s6">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] text-label font-bold tracking-label uppercase text-cream-dim mb-s4"
        >
          ← Menu
        </button>
        <h1 className="font-display text-title font-semibold mb-s4">Pass &amp; play</h1>

        <RoundRulesControl
          rules={rules}
          editable
          onChange={patch => setRules(current => ({ ...current, ...patch }))}
        />

        <div className="flex flex-col gap-s4 mt-s5">
          {players.map((p, i) => (
            <div key={i} className="flex flex-col gap-s2">
              <div className="flex items-end gap-s2">
                <div className="flex-1">
                  <label
                    htmlFor={`player-${i}`}
                    className="block text-label font-bold tracking-label uppercase text-cream-dim mb-s1"
                  >
                    Player {i + 1}
                  </label>
                  <input
                    id={`player-${i}`}
                    value={p.name}
                    onChange={e => update(i, { name: e.target.value.slice(0, 12) })}
                    placeholder={`Player ${i + 1}`}
                    maxLength={12}
                    autoComplete="off"
                    className="w-full min-h-[48px] px-s3 rounded-button bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline text-body"
                  />
                </div>
                {players.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPlayers(ps => ps.filter((_, j) => j !== i))}
                    aria-label={`Remove player ${i + 1}`}
                    className="min-w-[44px] min-h-[48px] text-body text-cream-dim"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* HUMAN / AI segmented — text-based, never color-only */}
              <div className="flex rounded-button overflow-hidden border border-hairline" role="group" aria-label={`Player ${i + 1} type`}>
                {(['HUMAN', 'AI'] as const).map(t => {
                  const active = p.isAI === (t === 'AI')
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update(i, { isAI: t === 'AI', difficulty: t === 'AI' ? (p.difficulty ?? 'medium') : undefined })}
                      className={clsx(
                        'flex-1 min-h-[44px] text-label tracking-label uppercase',
                        active ? 'bg-burgundy text-cream font-bold' : 'text-cream-dim',
                      )}
                    >
                      {t === 'HUMAN' ? 'Human' : 'AI'}
                    </button>
                  )
                })}
              </div>

              {p.isAI && (
                <div className="flex rounded-button overflow-hidden border border-hairline" role="group" aria-label={`Player ${i + 1} difficulty`}>
                  {DIFFICULTIES.map(d => {
                    const active = p.difficulty === d
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update(i, { difficulty: d })}
                        className={clsx(
                          'flex-1 min-h-[44px] text-label tracking-label uppercase',
                          active ? 'bg-burgundy text-cream font-bold' : 'text-cream-dim',
                        )}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {players.length < 5 && (
          <button
            type="button"
            onClick={() => setPlayers(ps => [...ps, { name: '', isAI: true, difficulty: 'medium' }])}
            className="mt-s4 w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-cream/80"
          >
            + Add player
          </button>
        )}
      </main>

      <footer className="app-bottom-zone px-s4 pt-s2 w-full max-w-[400px] mx-auto">
        <button
          type="button"
          onClick={deal}
          className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
        >
          Deal
        </button>
      </footer>
    </div>
  )
}
