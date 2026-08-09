// ============================================================================
// MultiplayerGameTable — every MP screen on top of useMultiplayerRoom:
// connecting / waiting room / rearrange / table / game-over, plus the
// full-screen connection states of §4.6. The table itself is the SAME
// TableScreen as single-player (§9 convergence): face-down endgame cards,
// masked stock (count only), BLIND_REVEAL via the log, seq-guarded states.
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { useMultiplayerRoom } from '../net/useMultiplayerRoom'
import { ConnectionBadge, type BadgeStatus } from './ConnectionBadge'
import { WaitingRoom } from './WaitingRoom'
import { RearrangeScreen } from './RearrangeScreen'
import { TableScreen } from './TableScreen'
import { GameOverOverlay } from './GameOverOverlay'
import { RulesSheet } from './RulesSheet'
import { TributeScreen } from './TributeScreen'

export interface MultiplayerGameTableProps {
  roomId: string
  playerName: string
  intent: 'create' | 'join'
  onLeave: () => void
}

export function MultiplayerGameTable({ roomId, playerName, intent, onLeave }: MultiplayerGameTableProps) {
  const {
    status, attempt, maxAttempts, room, gameState, playerId,
    error, notice, latestEmote, send, sendEmote, retry, tryAgain, leave,
  } = useMultiplayerRoom({ roomId, playerName, intent })

  const [rulesOpen, setRulesOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('shithead:sound') !== 'off')
  const [iAmReady, setIAmReady] = useState(false)
  const [rematchPending, setRematchPending] = useState(false)
  const rematchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phase = gameState?.phase

  // READY state resets whenever a (new) rearrange phase begins.
  useEffect(() => {
    if (phase === 'rearrange') setIAmReady(false)
  }, [phase])

  useEffect(() => {
    if (phase !== 'gameOver' || notice) setRematchPending(false)
  }, [phase, notice])

  useEffect(() => () => {
    if (rematchTimer.current) clearTimeout(rematchTimer.current)
  }, [])

  const toggleSound = () => {
    setSoundOn(on => {
      localStorage.setItem('shithead:sound', on ? 'off' : 'on')
      return !on
    })
  }

  const quit = () => {
    // A socket that is already offline cannot confirm a leave. Returning to
    // the menu keeps resume credentials, matching the "seat kept" promise.
    if (status === 'connected' || status === 'restored' || status === 'reconnecting') leave()
    onLeave()
  }

  const requestRematch = () => {
    if (rematchPending) return
    setRematchPending(true)
    send({ type: 'START_GAME' })
    if (rematchTimer.current) clearTimeout(rematchTimer.current)
    rematchTimer.current = setTimeout(() => setRematchPending(false), 3000)
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
          : error.kind === 'session-expired' ? 'This game has moved on.'
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
      <div className="app-viewport bg-felt text-cream flex flex-col p-s4">
        <div>{badge}</div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          {status === 'offline' ? (
            <>
              <h1 className="font-display text-title font-semibold">Connection lost</h1>
              <p className="text-body text-cream-dim mt-s2">The room went quiet. Your seat is kept for a while.</p>
              <div className="mt-s5 flex flex-col gap-s2 w-full max-w-[280px]">
                <PrimaryBtn onClick={retry}>Retry</PrimaryBtn>
                <GhostBtn onClick={quit}>Menu · seat kept</GhostBtn>
              </div>
            </>
          ) : (
            <>
              <p className="text-body text-cream-dim">Joining room…</p>
              <div className="mt-s5 w-full max-w-[280px]">
                <GhostBtn onClick={quit}>Cancel</GhostBtn>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ---- Waiting room (host branch driven by room.hostId === playerId) ----
  if (room.phase === 'waiting') {
    return (
      <WaitingRoom
        room={room}
        myPlayerId={playerId}
        onStart={() => send({ type: 'START_GAME' })}
        onRulesChange={rules => send({ type: 'SET_RULES', rules })}
        onLeave={quit}
      />
    )
  }

  if (!gameState) {
    return (
      <div className="app-viewport bg-felt text-cream flex flex-col p-s4">
        <div>{badge}</div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body text-cream-dim">Dealing…</p>
        </div>
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
  if (!me) {
    if (gameState.phase === 'gameOver') {
      return (
        <WaitingRoom
          room={{ ...room, phase: 'waiting' }}
          myPlayerId={playerId}
          heading="Next round"
          onStart={() => send({ type: 'START_GAME' })}
          onRulesChange={rules => send({ type: 'SET_RULES', rules })}
          onLeave={quit}
        />
      )
    }
    // Late joiner mid-match: state the current limitation, not a promise
    // about a future seat the server has not dealt yet.
    return (
      <StatePanel title="Game in progress" copy="You joined after this round was dealt, so you cannot play in the current game." actions={<GhostBtn onClick={quit}>Leave</GhostBtn>} />
    )
  }

  const isHost = room.hostId === playerId
  const loser = gameState.players.find(p => p.id === gameState.loserId)
  const offlineSeats = new Set(room.players.filter(p => !p.connected).map(p => p.id))
  const everyoneOnline = room.players.every(player => player.connected)

  return (
    <>
      <TableScreen
        state={gameState}
        viewerId={playerId}
        viewerActive={gameState.players[gameState.currentPlayerIdx]?.id === playerId && gameState.phase !== 'gameOver'}
        error={notice}
        onPlay={cards => send({ type: 'PLAY', cards })}
        onBurnIn={cards => send({ type: 'BURN_IN', cards })}
        onPickUp={() => send({ type: 'PICK_UP' })}
        onLeave={quit}
        onOpenRules={() => setRulesOpen(true)}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        connectionBadge={badge}
        seatOffline={id => offlineSeats.has(id)}
        latestEmote={latestEmote}
        onSendEmote={sendEmote}
      />

      {gameState.phase === 'gameOver' && (
        <GameOverOverlay
          result={!loser ? 'neutral' : gameState.loserId === playerId ? 'lose' : 'win'}
          shitheadName={loser?.name}
          canRematch={isHost && everyoneOnline}
          waitingForHost={!isHost || !everyoneOnline}
          waitingCopy={isHost ? 'Waiting for everyone to reconnect…' : 'Waiting for host…'}
          onRematch={isHost && everyoneOnline ? requestRematch : undefined}
          rematchPending={rematchPending}
          onLeave={quit}
          rules={room.rules ?? gameState.rules}
          rulesEditable={isHost}
          onRulesChange={isHost ? rules => send({ type: 'SET_RULES', rules }) : undefined}
        />
      )}

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}

// ---------- shared bits ----------

function StatePanel({ title, copy, actions }: { title: string; copy: string; actions: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4" role="alertdialog" aria-label={title}>
      <div className="w-full max-w-[320px] bg-cream text-ink rounded-button p-s5 text-center">
        <h1 className="font-display text-title font-semibold">{title}</h1>
        <p className="text-body text-ink-soft mt-s2">{copy}</p>
        <div className="mt-s5 flex flex-col gap-s2">{actions}</div>
      </div>
    </div>
  )
}

function PrimaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
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
      className="w-full min-h-[48px] rounded-button text-button font-bold tracking-button uppercase text-burgundy"
    >
      {children}
    </button>
  )
}
