// ============================================================================
// GameOverOverlay — victory (§4.8) and charming tipped-crown defeat (§4.9).
// Scrim + centered cream panel. Detailed round results widen the panel while
// preserving the compact legacy card. No confetti or looping animation.
// ============================================================================
import { useEffect, useId, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { GameRules } from '../engine'
import { RoundRulesControl } from './RoundRulesControl'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface GameOverLeaderboardRow {
  playerId: string
  name: string
  /** One-based finishing place. Null means the place could not be recovered. */
  place: number | null
  isLoser: boolean
  cardsPlayed: number
  tensPlayed: number
  burns: number
  pickups: number
  largestPickup: number
}

export type RematchVoteChoice = 'yes' | 'no' | 'pending'

export interface GameOverRematchVoteRow {
  playerId: string
  name: string
  vote: RematchVoteChoice
  connected: boolean
}

export type GameOverStatsNote = 'partial' | 'legacy'

export interface GameOverOverlayProps {
  result: 'win' | 'lose' | 'neutral'
  shitheadName?: string
  /** MP: rematch is host-only; guests see "Waiting for host…". */
  canRematch: boolean
  waitingForHost?: boolean
  waitingCopy?: string
  onRematch?: () => void
  onLeave: () => void
  rules?: GameRules
  rulesEditable?: boolean
  onRulesChange?: (patch: Partial<GameRules>) => void
  rematchPending?: boolean
  /** Ordered round results and additive stats, kept separate from engine state. */
  leaderboard?: readonly GameOverLeaderboardRow[]
  /** Shows a clear, canned notice when older or incomplete stats are displayed. */
  statsNote?: GameOverStatsNote
  /** Present only for the multiplayer vote flow. */
  rematchVotes?: readonly GameOverRematchVoteRow[]
  viewerRematchVote?: RematchVoteChoice
  onRematchVote?: (vote: Exclude<RematchVoteChoice, 'pending'>) => void
  rematchVotePending?: boolean
  /** Optimistic choice while the authoritative vote echo is in flight. */
  pendingRematchVote?: Exclude<RematchVoteChoice, 'pending'> | null
  /** Host gate for starting with the players who voted Yes. */
  canStartRematch?: boolean
  onStartRematch?: () => void
  startRematchPending?: boolean
  startRematchHint?: string
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function formatStat(value: number, note?: GameOverStatsNote): string {
  if (note === 'legacy') return '—'
  const count = safeCount(value)
  return note === 'partial' ? `≥${count}` : String(count)
}

function formatPlace(place: number | null): string {
  if (place === null || !Number.isFinite(place) || place < 1) return '—'
  const wholePlace = Math.floor(place)
  const mod100 = wholePlace % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : wholePlace % 10 === 1
      ? 'st'
      : wholePlace % 10 === 2
        ? 'nd'
        : wholePlace % 10 === 3
          ? 'rd'
          : 'th'
  return `${wholePlace}${suffix}`
}

function leadersFor(
  rows: readonly GameOverLeaderboardRow[],
  metric: (row: GameOverLeaderboardRow) => number,
): { names: string; value: number } {
  const value = rows.reduce((max, row) => Math.max(max, safeCount(metric(row))), 0)
  const names = rows
    .filter(row => safeCount(metric(row)) === value)
    .map(row => row.name)
    .join(', ')
  return { names, value }
}

function RoundHighlights({ rows }: { rows: readonly GameOverLeaderboardRow[] }) {
  if (rows.length === 0) return null
  const pickup = leadersFor(rows, row => row.largestPickup)
  const tens = leadersFor(rows, row => row.tensPlayed)
  const burns = leadersFor(rows, row => row.burns)

  return (
    <ul className="game-over-highlights" aria-label="Round highlights">
      <li>
        <span>Biggest scoop</span>
        <strong>{pickup.value > 0 ? `${pickup.names} · ${pickup.value} card${pickup.value === 1 ? '' : 's'}` : 'No pile pickups'}</strong>
      </li>
      <li>
        <span>Ten machine</span>
        <strong>{tens.value > 0 ? `${tens.names} · ${tens.value}` : 'No 10s played'}</strong>
      </li>
      <li>
        <span>Pile burner</span>
        <strong>{burns.value > 0 ? `${burns.names} · ${burns.value}` : 'No burns'}</strong>
      </li>
    </ul>
  )
}

export function GameOverOverlay({
  result, shitheadName, canRematch, waitingForHost, waitingCopy, onRematch, onLeave,
  rules, rulesEditable = false, onRulesChange, rematchPending = false,
  leaderboard, statsNote, rematchVotes, viewerRematchVote = 'pending', onRematchVote,
  rematchVotePending = false, pendingRematchVote = null, canStartRematch = false, onStartRematch,
  startRematchPending = false, startRematchHint,
}: GameOverOverlayProps) {
  const reduceMotion = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const leaderboardTitleId = useId()
  const votingTitleId = useId()
  const votingCountId = useId()
  const votingConsequenceId = useId()
  const votingPendingId = useId()
  const hasVoteFlow = rematchVotes !== undefined
  const yesVotes = rematchVotes?.filter(row => row.vote === 'yes').length ?? 0
  const voteTotal = rematchVotes?.length ?? 0
  const displayedViewerVote = pendingRematchVote ?? viewerRematchVote
  const winnerCopy = shitheadName
    ? `${shitheadName} kept the cards. ${shitheadName} is the Shithead.`
    : 'The round ended without a recorded last-place player.'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    const preferred = dialog.querySelector<HTMLElement>('.game-over-card__actions button:not([disabled])')

    ;(preferred ?? focusables()[0] ?? dialog).focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      ref={dialogRef}
      className="phase-overlay game-over-overlay fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4"
      data-result={result}
      role="dialog"
      aria-modal="true"
      aria-label={result === 'win' ? 'Round over — you are clear' : result === 'lose' ? 'Round over — you are the Shithead' : 'Round over'}
      tabIndex={-1}
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0.15 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
        className={`phase-card game-over-card w-full ${leaderboard || hasVoteFlow ? 'max-w-[560px]' : 'max-w-[370px]'} max-h-full overflow-y-auto bg-cream text-ink rounded-button p-s5 text-center`}
      >
        {result === 'lose' && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { rotate: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { rotate: 8, opacity: 1 }}
            transition={reduceMotion ? { duration: 0.15 } : { duration: 0.6, ease: [0.34, 1.3, 0.4, 1] }}
            className="game-over-card__mark mx-auto mb-s3 w-8 h-11 rounded-[3px] bg-burgundy flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="font-display text-gold text-xl font-semibold">S</span>
          </motion.div>
        )}
        <div className="phase-card__kicker game-over-card__kicker text-label font-bold tracking-label uppercase text-ink-soft">Round over</div>
        <h1 className="phase-card__title game-over-card__title font-display text-display font-semibold text-burgundy mt-s1">
          {result === 'win' ? "You're clear" : result === 'lose' ? 'Shithead.' : 'Round complete'}
        </h1>
        <motion.div
          className="phase-card__rule game-over-card__rule mx-auto my-s3 h-[2px] w-12 bg-gold"
          initial={reduceMotion ? { opacity: 0 } : { width: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { width: 48 }}
          transition={reduceMotion ? { duration: 0.15 } : { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          aria-hidden="true"
        />
        <p className="phase-card__copy game-over-card__copy text-body text-ink">
          {result === 'win'
            ? winnerCopy
            : result === 'lose'
              ? 'Last one holding cards. The crown is yours — wear it well.'
              : winnerCopy}
        </p>
        {leaderboard !== undefined && (
          <section className="game-over-leaderboard" aria-labelledby={leaderboardTitleId}>
            <div className="game-over-section-heading">
              <h2 id={leaderboardTitleId}>Round leaderboard</h2>
              <span>{leaderboard.length} player{leaderboard.length === 1 ? '' : 's'}</span>
            </div>
            {statsNote && (
              <p className="game-over-stats-note" data-stats-note={statsNote}>
                {statsNote === 'legacy'
                  ? 'Detailed statistics were not recorded for this round.'
                  : 'Only recorded events are shown. The ≥ symbol means “at least”.'}
              </p>
            )}
            {leaderboard.length > 0 ? (
              <>
                <div className="game-over-table-scroll" role="region" aria-label="Round statistics" tabIndex={0}>
                  <table className="game-over-table">
                    <caption className="visually-hidden">Finishing places and statistics for this round</caption>
                    <thead>
                      <tr>
                        <th scope="col">Place</th>
                        <th scope="col">Player</th>
                        <th scope="col">Played</th>
                        <th scope="col">10s</th>
                        <th scope="col">Burns</th>
                        <th scope="col">Pickups</th>
                        <th scope="col">Biggest pickup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map(row => (
                        <tr key={row.playerId} data-loser={row.isLoser || undefined}>
                          <td>{formatPlace(row.place)}</td>
                          <th scope="row" aria-label={`${row.name}${row.isLoser ? ', Shithead' : ''}`}>
                            <span>{row.name}</span>
                            {row.isLoser && <span className="game-over-loser-tag">Shithead</span>}
                          </th>
                          <td>{formatStat(row.cardsPlayed, statsNote)}</td>
                          <td>{formatStat(row.tensPlayed, statsNote)}</td>
                          <td>{formatStat(row.burns, statsNote)}</td>
                          <td>{formatStat(row.pickups, statsNote)}</td>
                          <td>{formatStat(row.largestPickup, statsNote)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!statsNote && <RoundHighlights rows={leaderboard} />}
              </>
            ) : (
              <p className="game-over-empty-stats">No round statistics were recorded.</p>
            )}
          </section>
        )}
        {rules && (
          <div className="game-over-card__rules mt-s5 text-left">
            <RoundRulesControl
              rules={rules}
              editable={rulesEditable}
              onChange={onRulesChange}
              compact
              tone="paper"
              label="Next round"
            />
          </div>
        )}
        <div className="phase-card__actions game-over-card__actions mt-s5 flex flex-col gap-s2">
          {hasVoteFlow && (
            <section className="game-over-voting" aria-labelledby={votingTitleId}>
              <div className="game-over-section-heading">
                <h2 id={votingTitleId}>Vote to rematch</h2>
                <strong id={votingCountId} role="status" aria-live="polite">{yesVotes}/{voteTotal} ready</strong>
              </div>
              <p id={votingConsequenceId} className="game-over-vote-consequence">
                Voting No, or being offline without a vote, releases your seat when the host starts.
                {' '}You can update your vote after the brief anti-spam delay while voting remains open.
              </p>
              {onRematchVote && (
                <div
                  className="game-over-vote-actions"
                  aria-describedby={`${votingCountId} ${votingConsequenceId}${rematchVotePending ? ` ${votingPendingId}` : ''}`}
                >
                  <button
                    type="button"
                    className="game-over-vote-button"
                    data-selected={displayedViewerVote === 'yes' || undefined}
                    aria-pressed={displayedViewerVote === 'yes'}
                    aria-describedby={`${votingCountId} ${votingConsequenceId}${rematchVotePending ? ` ${votingPendingId}` : ''}`}
                    disabled={rematchVotePending}
                    onClick={() => onRematchVote('yes')}
                  >
                    Vote yes
                  </button>
                  <button
                    type="button"
                    className="game-over-vote-button"
                    data-selected={displayedViewerVote === 'no' || undefined}
                    aria-pressed={displayedViewerVote === 'no'}
                    aria-describedby={`${votingCountId} ${votingConsequenceId}${rematchVotePending ? ` ${votingPendingId}` : ''}`}
                    disabled={rematchVotePending}
                    onClick={() => onRematchVote('no')}
                  >
                    Vote no
                  </button>
                </div>
              )}
              {rematchVotePending && (
                <p id={votingPendingId} className="game-over-vote-pending" role="status" aria-live="polite">
                  Submitting vote…
                </p>
              )}
              <ul className="game-over-vote-list" aria-label="Rematch votes">
                {rematchVotes.map(row => (
                  <li
                    key={row.playerId}
                    data-connected={row.connected || undefined}
                    aria-label={`${row.name}: ${row.vote === 'yes' ? 'Yes' : row.vote === 'no' ? 'No' : 'Pending'}${row.connected ? '' : ', offline'}`}
                  >
                    <span>{row.name}</span>
                    {!row.connected && <span className="game-over-offline-tag">Offline</span>}
                    <strong className={`game-over-vote-tag game-over-vote-tag--${row.vote}`}>{row.vote === 'yes' ? 'Yes' : row.vote === 'no' ? 'No' : 'Pending'}</strong>
                  </li>
                ))}
              </ul>
              {onStartRematch ? (
                <>
                  <button
                    type="button"
                    onClick={onStartRematch}
                    disabled={!canStartRematch || startRematchPending}
                    aria-label={startRematchPending
                      ? 'Starting rematch'
                      : `Start rematch with ${yesVotes} player${yesVotes === 1 ? '' : 's'}`}
                    className="phase-action phase-action--primary primary-action game-over-start-button w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
                  >
                    {startRematchPending ? 'Starting…' : `Start rematch · ${yesVotes} player${yesVotes === 1 ? '' : 's'}`}
                  </button>
                  {!canStartRematch && !startRematchPending && (
                    <p className="game-over-start-hint" role="status">
                      {startRematchHint ?? 'Every online player must vote, with the host and at least one other player choosing Yes.'}
                    </p>
                  )}
                </>
              ) : (
                <p className="phase-card__waiting game-over-vote-waiting" role="status">
                  {waitingCopy ?? 'Waiting for host to start the rematch…'}
                </p>
              )}
            </section>
          )}
          {!hasVoteFlow && canRematch && onRematch ? (
            <button
              type="button"
              onClick={onRematch}
              disabled={rematchPending}
              className="phase-action phase-action--primary primary-action w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
            >
              {rematchPending ? 'Starting…' : 'Rematch'}
            </button>
          ) : !hasVoteFlow && waitingForHost ? (
            <p className="phase-card__waiting min-h-[48px] flex items-center justify-center text-body text-ink-soft" role="status">{waitingCopy ?? 'Waiting for host…'}</p>
          ) : null}
          <button
            type="button"
            onClick={onLeave}
            className="phase-action phase-action--quiet w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-burgundy"
          >
            Leave
          </button>
        </div>
      </motion.div>
    </div>
  )
}
