// ============================================================================
// MultiplayerGameTable — every MP screen on top of useMultiplayerRoom:
// connecting / waiting room / rearrange / table / game-over, plus the
// full-screen connection states of §4.6. The table itself is the SAME
// TableScreen as single-player (§9 convergence): face-down endgame cards,
// masked stock (count only), BLIND_REVEAL via the log, seq-guarded states.
// ============================================================================
import { useEffect, useId, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useMultiplayerRoom } from '../net/useMultiplayerRoom'
import { ConnectionBadge, type BadgeStatus } from './ConnectionBadge'
import { WaitingRoom } from './WaitingRoom'
import { RearrangeScreen } from './RearrangeScreen'
import { burnCleanupDelay, TableScreen } from './TableScreen'
import { GameOverOverlay } from './GameOverOverlay'
import { RulesSheet } from './RulesSheet'
import { TributeScreen } from './TributeScreen'
import { SystemEventFeedback } from './EmoteButton'
import type { SystemEvent } from '../engine/protocol'
import {
  latestAcceptedGameplayAction,
  useTurnAlertController,
  useTurnAlertPreferences,
} from './turnAlerts'
import { gameOverResults } from './gameOverResults'

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function LobbySystemFeedback({ event }: { event: SystemEvent | null }) {
  if (event?.kind !== 'player-left') return null
  return (
    <div className="table-reaction-feedback-stack table-reaction-feedback-stack--lobby" aria-label="Table notices">
      <SystemEventFeedback event={event} />
    </div>
  )
}

export interface MultiplayerGameTableProps {
  roomId: string
  playerName: string
  intent: 'create' | 'join'
  onLeave: () => void
}

export function MultiplayerGameTable({ roomId, playerName, intent, onLeave }: MultiplayerGameTableProps) {
  const {
    status, attempt, maxAttempts, room, gameState, playerId,
    error, notice, latestEmote, latestBroadcast, latestChat, recentCustomMessages, latestSystemEvent,
    send, sendEmote, sendBroadcast, sendChat, quickFollowUp, retry, tryAgain, leave,
  } = useMultiplayerRoom({ roomId, playerName, intent })

  const [rulesOpen, setRulesOpen] = useState(false)
  const [iAmReady, setIAmReady] = useState(false)
  const [rematchPending, setRematchPending] = useState(false)
  const [pendingRematchVote, setPendingRematchVote] = useState<'yes' | 'no' | null>(null)
  const rematchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rematchVoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phase = gameState?.phase
  const viewerRematchVote = room?.rematchVotes?.find(vote => vote.playerId === playerId)?.vote ?? 'pending'
  const {
    preferences,
    toggleSound,
    toggleTurnAlerts,
    toggleRepeatTurnAlerts,
    toggleAdhdMode,
    selectAdhdSound,
  } = useTurnAlertPreferences()
  const currentPlayerId = gameState?.players[gameState.currentPlayerIdx]?.id ?? null
  const reduceMotion = useReducedMotion()
  const latestGameplayAction = latestAcceptedGameplayAction(gameState?.log ?? [])
  const attentionAlertActive = useTurnAlertController({
    phase: phase ?? room?.phase ?? null,
    currentPlayerId,
    turnCount: gameState?.turnCount ?? null,
    latestGameplayActorId: latestGameplayAction?.actorId ?? null,
    latestGameplayActionBurned: latestGameplayAction?.burned ?? false,
    repeatTurnAlertDelayMs: burnCleanupDelay(reduceMotion),
    localHumanTurn: Boolean(playerId && currentPlayerId === playerId && phase !== 'gameOver'),
    ...preferences,
  })

  // READY state resets whenever a (new) rearrange phase begins.
  useEffect(() => {
    if (phase === 'rearrange') setIAmReady(false)
  }, [phase])

  useEffect(() => {
    if (phase !== 'gameOver' || notice) {
      setRematchPending(false)
      setPendingRematchVote(null)
    }
  }, [phase, notice])

  useEffect(() => {
    setPendingRematchVote(null)
    if (rematchVoteTimer.current) clearTimeout(rematchVoteTimer.current)
    rematchVoteTimer.current = null
  }, [viewerRematchVote])

  useEffect(() => () => {
    if (rematchTimer.current) clearTimeout(rematchTimer.current)
    if (rematchVoteTimer.current) clearTimeout(rematchVoteTimer.current)
  }, [])

  const quit = () => {
    // A socket that is already offline cannot confirm a leave. Returning to
    // the menu keeps resume credentials, matching the "seat kept" promise.
    if (status === 'connected' || status === 'restored' || status === 'reconnecting') leave()
    onLeave()
  }

  const requestRematch = () => {
    if (rematchPending) return
    if (!send({ type: 'START_GAME' })) return
    setRematchPending(true)
    if (rematchTimer.current) clearTimeout(rematchTimer.current)
    rematchTimer.current = setTimeout(() => setRematchPending(false), 3000)
  }

  const requestRematchVote = (vote: 'yes' | 'no') => {
    if (pendingRematchVote || viewerRematchVote === vote) return
    if (!send({ type: 'REMATCH_VOTE', vote: vote === 'yes' })) return
    setPendingRematchVote(vote)
    if (rematchVoteTimer.current) clearTimeout(rematchVoteTimer.current)
    rematchVoteTimer.current = setTimeout(() => setPendingRematchVote(null), 3000)
  }

  // ---- Full-screen connection states (§4.6) ----
  if (error) {
    return (
      <StatePanel
        title={
          error.kind === 'invalid-room' ? 'Room not found'
          : error.kind === 'room-full' ? 'Room is full'
          : error.kind === 'session-expired' ? 'Session expired'
          : 'Something went wrong'
        }
        copy={
          error.kind === 'invalid-room' ? 'Check the code and try again.'
          : error.kind === 'room-full' ? 'This room already has all its players.'
          : error.kind === 'session-expired' ? error.message || 'This game has moved on.'
          : "It's us, not you."
        }
        actions={
          error.kind === 'invalid-room'
            ? <><PrimaryBtn onClick={tryAgain}>Try again</PrimaryBtn><GhostBtn onClick={quit}>Menu</GhostBtn></>
          : error.kind === 'server-error'
            ? <><PrimaryBtn onClick={tryAgain}>Retry</PrimaryBtn><GhostBtn onClick={quit}>Menu</GhostBtn></>
            : <GhostBtn onClick={quit}>Menu</GhostBtn>
        }
      />
    )
  }

  const badgeStatus: BadgeStatus =
    status === 'offline' ? 'offline'
    : status === 'reconnecting' ? 'reconnecting'
    : status === 'restored' ? 'restored'
    : status === 'connected' ? 'connected'
    : 'connecting'

  const badge = (
    <ConnectionBadge status={badgeStatus} attempt={attempt} maxAttempts={maxAttempts} onRetry={retry} />
  )

  if (status === 'idle' || status === 'connecting' || status === 'offline' || !room || !playerId) {
    return (
      <div className="app-viewport last-call-screen connection-screen bg-felt text-cream flex flex-col p-s4" data-status={status}>
        <div className="connection-screen__badge">{badge}</div>
        <main className="connection-screen__body flex-1 flex flex-col items-center justify-center text-center">
          {status === 'offline' ? (
            <>
              <p className="connection-screen__kicker text-label font-bold tracking-label uppercase text-cream-dim">Table paused</p>
              <h1 className="connection-screen__title font-display text-title font-semibold">Connection lost</h1>
              <p className="connection-screen__copy text-body text-cream-dim mt-s2">
                The room went quiet. Your seat is normally kept; after a finished game, an undecided offline seat may be released when the host starts a rematch.
              </p>
              <div className="connection-screen__actions mt-s5 flex flex-col gap-s2 w-full max-w-[280px]">
                <PrimaryBtn onClick={retry}>Retry</PrimaryBtn>
                <GhostBtn onClick={quit}>Menu · seat kept</GhostBtn>
              </div>
            </>
          ) : (
            <>
              <p className="connection-screen__copy text-body text-cream-dim" role="status">Joining room…</p>
              <div className="connection-screen__actions mt-s5 w-full max-w-[280px]">
                <GhostBtn onClick={quit}>Cancel</GhostBtn>
              </div>
            </>
          )}
        </main>
      </div>
    )
  }

  // ---- Waiting room (host branch driven by room.hostId === playerId) ----
  if (room.phase === 'waiting') {
    return (
      <>
        <LobbySystemFeedback event={latestSystemEvent} />
        <WaitingRoom
          room={room}
          myPlayerId={playerId}
          onStart={() => send({ type: 'START_GAME' })}
          onRulesChange={rules => send({ type: 'SET_RULES', rules })}
          onLeave={quit}
        />
      </>
    )
  }

  if (!gameState) {
    return (
      <div className="app-viewport last-call-screen connection-screen bg-felt text-cream flex flex-col p-s4" data-status="dealing">
        <div className="connection-screen__badge">{badge}</div>
        <main className="connection-screen__body flex-1 flex items-center justify-center">
          <p className="connection-screen__copy text-body text-cream-dim" role="status">Dealing…</p>
        </main>
      </div>
    )
  }

  // ---- Rearrange ----
  if (gameState.phase === 'rearrange') {
    const me = gameState.players.find(p => p.id === playerId)
    if (!me) {
      return (
        <StatePanel title="Game in progress" copy="You joined after this round was dealt, so you cannot play in the current game." actions={<GhostBtn onClick={quit}>Leave</GhostBtn>} />
      )
    }
    return (
      <RearrangeScreen
        player={me}
        waitingForOthers={iAmReady}
        onSwap={(h, u) => send({ type: 'REARRANGE', handIdx: h, upIdx: u })}
        onReady={() => { send({ type: 'READY' }); setIAmReady(true) }}
      />
    )
  }

  if (gameState.phase === 'tribute' && gameState.pendingTribute) {
    const winner = gameState.players.find(player => player.id === gameState.pendingTribute?.winnerId)
    const lastPlace = gameState.players.find(player => player.id === gameState.pendingTribute?.loserId)
    if (winner && lastPlace) {
      return (
        <TributeScreen
          winner={winner}
          loser={lastPlace}
          viewerId={playerId}
          error={notice}
          onSwap={(winnerCardId, loserCardId) => send({ type: 'TRIBUTE_SWAP', winnerCardId, loserCardId })}
          onSkip={() => send({ type: 'TRIBUTE_SKIP' })}
        />
      )
    }
  }

  const me = gameState.players.find(p => p.id === playerId)
  const isHost = room.hostId === playerId
  const loser = gameState.players.find(p => p.id === gameState.loserId)
  const offlineSeats = new Set(room.players.filter(p => !p.connected).map(p => p.id))
  const voteByPlayer = new Map((room.rematchVotes ?? []).map(vote => [vote.playerId, vote.vote] as const))
  const rematchVotes = room.players.map(player => ({
    playerId: player.id,
    name: player.name,
    vote: voteByPlayer.get(player.id) ?? 'pending' as const,
    connected: player.connected,
  }))
  const yesVotes = rematchVotes.filter(vote => vote.vote === 'yes')
  const everyOnlinePlayerVoted = rematchVotes.length > 0 && rematchVotes.every(vote =>
    !vote.connected || vote.vote !== 'pending'
  )
  const hostVotedYes = voteByPlayer.get(room.hostId) === 'yes'
  const everyYesVoterOnline = yesVotes.every(vote => vote.connected)
  const canSendRoomAction = status === 'connected' || status === 'restored'
  const canStartRematch = isHost && canSendRoomAction && everyOnlinePlayerVoted && hostVotedYes &&
    yesVotes.length >= 2 && everyYesVoterOnline
  const resultsView = gameOverResults(gameState)
  const startRematchHint = !canSendRoomAction
    ? 'Reconnecting… rematch controls will return when you are online.'
    : !everyOnlinePlayerVoted
      ? 'Waiting for every online player to vote.'
    : !hostVotedYes
      ? 'The host must vote Yes or leave the room.'
      : yesVotes.length < 2
        ? 'At least two Yes votes are needed.'
        : !everyYesVoterOnline
          ? 'Every Yes voter must be online.'
          : undefined
  const gameOverOverlay = gameState.phase === 'gameOver' ? (
    <GameOverOverlay
      result={!me || !loser ? 'neutral' : gameState.loserId === playerId ? 'lose' : 'win'}
      shitheadName={loser?.name}
      canRematch={false}
      waitingCopy={!canSendRoomAction
        ? 'Reconnecting… voting will resume when you are online.'
        : isHost ? undefined : 'Waiting for host to start the rematch…'}
      onLeave={quit}
      rules={room.rules ?? gameState.rules}
      rulesEditable={isHost}
      onRulesChange={isHost ? rules => send({ type: 'SET_RULES', rules }) : undefined}
      leaderboard={resultsView.leaderboard}
      statsNote={resultsView.statsNote}
      rematchVotes={rematchVotes}
      viewerRematchVote={viewerRematchVote}
      onRematchVote={canSendRoomAction ? requestRematchVote : undefined}
      rematchVotePending={pendingRematchVote !== null}
      pendingRematchVote={pendingRematchVote}
      canStartRematch={canStartRematch}
      onStartRematch={isHost ? requestRematch : undefined}
      startRematchPending={rematchPending}
      startRematchHint={startRematchHint}
    />
  ) : null

  if (!me) {
    if (gameState.phase === 'gameOver') {
      return (
        <>
          <div className="app-viewport last-call-screen game-screen bg-felt text-cream" aria-hidden="true">
            <div className="connection-screen__badge">{badge}</div>
          </div>
          {gameOverOverlay}
        </>
      )
    }
    // Late joiner mid-match: state the current limitation, not a promise
    // about a future seat the server has not dealt yet.
    return (
      <StatePanel title="Game in progress" copy="You joined after this round was dealt, so you cannot play in the current game." actions={<GhostBtn onClick={quit}>Leave</GhostBtn>} />
    )
  }

  return (
    <>
      <TableScreen
        state={gameState}
        viewerId={playerId}
        viewerActive={gameState.players[gameState.currentPlayerIdx]?.id === playerId && gameState.phase !== 'gameOver'}
        actionsEnabled={status === 'connected' || status === 'restored'}
        error={notice}
        onPlay={cards => send({ type: 'PLAY', cards })}
        onQuickFollowUp={card => quickFollowUp(card.id)}
        onBurnIn={cards => send({ type: 'BURN_IN', cards })}
        onPickUp={() => send({ type: 'PICK_UP' })}
        onLeave={quit}
        onOpenRules={() => setRulesOpen(true)}
        soundOn={preferences.soundOn}
        onToggleSound={toggleSound}
        turnAlertsEnabled={preferences.turnAlertsEnabled}
        onToggleTurnAlerts={toggleTurnAlerts}
        repeatTurnAlertsEnabled={preferences.repeatTurnAlertsEnabled}
        onToggleRepeatTurnAlerts={toggleRepeatTurnAlerts}
        adhdMode={preferences.adhdMode}
        onToggleAdhdMode={toggleAdhdMode}
        adhdSound={preferences.adhdSound}
        onSelectAdhdSound={selectAdhdSound}
        attentionAlertActive={attentionAlertActive}
        easterEggEnabled={room.easterEggEnabled}
        onToggleEasterEgg={isHost
          ? () => send({ type: 'SET_EASTER_EGG', enabled: !room.easterEggEnabled })
          : undefined}
        connectionBadge={badge}
        seatOffline={id => offlineSeats.has(id)}
        latestEmote={latestEmote}
        onSendEmote={sendEmote}
        latestBroadcast={latestBroadcast}
        onSendBroadcast={sendBroadcast}
        latestChat={latestChat}
        onSendChat={sendChat}
        recentCustomMessages={recentCustomMessages}
        latestSystemEvent={latestSystemEvent}
      />

      {gameOverOverlay}

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}

// ---------- shared bits ----------

export function StatePanel({ title, copy, actions }: { title: string; copy: string; actions: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const copyId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))

    ;(focusables()[0] ?? dialog).focus()
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
      className="phase-overlay state-panel-overlay fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={copyId}
      tabIndex={-1}
    >
      <div className="phase-card state-panel w-full max-w-[320px] bg-cream text-ink rounded-button p-s5 text-center">
        <p className="phase-card__kicker state-panel__kicker text-label font-bold tracking-label uppercase text-ink-soft">Table notice</p>
        <h1 id={titleId} className="phase-card__title state-panel__title font-display text-title font-semibold">{title}</h1>
        <p id={copyId} className="phase-card__copy state-panel__copy text-body text-ink-soft mt-s2">{copy}</p>
        <div className="phase-card__actions state-panel__actions mt-s5 flex flex-col gap-s2">{actions}</div>
      </div>
    </div>
  )
}

function PrimaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="phase-action phase-action--primary primary-action w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
    >
      {children}
    </button>
  )
}

function GhostBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="phase-action phase-action--quiet w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-burgundy"
    >
      {children}
    </button>
  )
}
