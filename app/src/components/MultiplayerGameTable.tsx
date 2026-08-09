// ============================================================================
// MultiplayerGameTable — every MP screen on top of useMultiplayerRoom:
// connecting / waiting room / rearrange / table / game-over, plus the
// full-screen connection states of §4.6. The table itself is the SAME
// TableScreen as single-player (§9 convergence): face-down endgame cards,
// masked stock (count only), BLIND_REVEAL via the log, seq-guarded states.
// ============================================================================
import { useEffect, useState } from 'react'
import { useMultiplayerRoom } from '../net/useMultiplayerRoom'
import { ConnectionBadge, type BadgeStatus } from './ConnectionBadge'
import { WaitingRoom } from './WaitingRoom'
import { RearrangeScreen } from './RearrangeScreen'
import { TableScreen } from './TableScreen'
import { GameOverOverlay } from './GameOverOverlay'
import { RulesSheet } from './RulesSheet'

export interface MultiplayerGameTableProps {
  roomId: string
  playerName: string
  intent: 'create' | 'join'
  onLeave: () => void
}

export function MultiplayerGameTable({ roomId, playerName, intent, onLeave }: MultiplayerGameTableProps) {
  const {
    status, attempt, maxAttempts, room, gameState, playerId,
    error, notice, send, retry, tryAgain, leave,
  } = useMultiplayerRoom({ roomId, playerName, intent })

  const [rulesOpen, setRulesOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('shithead:sound') !== 'off')
  const [iAmReady, setIAmReady] = useState(false)
  const phase = gameState?.phase

  // READY state resets whenever a (new) rearrange phase begins.
  useEffect(() => {
    if (phase === 'rearrange') setIAmReady(false)
  }, [phase === 'rearrange']) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSound = () => {
    setSoundOn(on => {
      localStorage.setItem('shithead:sound', on ? 'off' : 'on')
      return !on
    })
  }

  const quit = () => { leave(); onLeave() }

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
                <GhostBtn onClick={quit}>Leave</GhostBtn>
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
    const host = room.players.find(p => p.id === room.hostId)
    if (host && !host.connected && host.id !== playerId) {
      return (
        <StatePanel
          title="Host left"
          copy="The room is closed."
          actions={<GhostBtn onClick={quit}>Leave</GhostBtn>}
        />
      )
    }
    return (
      <WaitingRoom
        room={room}
        myPlayerId={playerId}
        onStart={() => send({ type: 'START_GAME' })}
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
        <StatePanel title="Game in progress" copy="You'll be in next round." actions={<GhostBtn onClick={quit}>Leave</GhostBtn>} />
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

  const me = gameState.players.find(p => p.id === playerId)
  if (!me) {
    // Late joiner mid-match (§7.3).
    return (
      <StatePanel title="Game in progress" copy="You'll be in next round." actions={<GhostBtn onClick={quit}>Leave</GhostBtn>} />
    )
  }

  const isHost = room.hostId === playerId
  const loser = gameState.players.find(p => p.id === gameState.loserId)
  const offlineSeats = new Set(room.players.filter(p => !p.connected).map(p => p.id))

  return (
    <>
      <TableScreen
        state={gameState}
        viewerId={playerId}
        viewerActive={gameState.players[gameState.currentPlayerIdx]?.id === playerId && gameState.phase !== 'gameOver'}
        error={notice}
        onPlay={cards => send({ type: 'PLAY', cards })}
        onPickUp={() => send({ type: 'PICK_UP' })}
        onLeave={quit}
        onOpenRules={() => setRulesOpen(true)}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        connectionBadge={badge}
        seatOffline={id => offlineSeats.has(id)}
      />

      {gameState.phase === 'gameOver' && loser && (
        <GameOverOverlay
          result={gameState.loserId === playerId ? 'lose' : 'win'}
          shitheadName={loser.name}
          canRematch={isHost}
          waitingForHost={!isHost}
          onRematch={isHost ? () => send({ type: 'START_GAME' }) : undefined}
          onLeave={quit}
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
