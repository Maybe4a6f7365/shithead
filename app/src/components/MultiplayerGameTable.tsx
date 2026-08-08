// ============================================================================
// Multiplayer game table — wires WebSocket protocol to UI
// ============================================================================
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMultiplayerRoom } from '../net/useMultiplayerRoom'
import type { GameState, Card } from '../engine'
import { canPlay, getCurrentPlayer, getTopCard, pileSize } from '../engine'
import { Card as CardView } from './Card'

interface Props {
  roomId: string
  onLeave: () => void
}

export function MultiplayerGameTable({ roomId, onLeave }: Props) {
  const { status, room, gameState, error, chat, send } = useMultiplayerRoom(roomId)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [playerName] = useState(() => sessionStorage.getItem(`shithead:name:${roomId}`) ?? 'Player')

  // Detect our player ID from WELCOME / ROOM_STATE messages — we need to know who's "me"
  // For simplicity, we let the server echo our playerId in WELCOME; but the hook doesn't expose it.
  // Let's track it via game state: the only player whose faceDown we can see is us.
  useEffect(() => {
    if (!gameState) return
    // We can find our ID by checking which player has unmasked face-down cards
    // But that's brittle. Better: server should include viewerPlayerId in GAME_STATE.
    // For now, assume the FIRST player with real faceDown data is us.
    // Hack: client knows its name; match by name.
    const me = gameState.players.find(p => p.name === playerName && p.faceDown[0]?.rank !== '3')
    if (me && !myPlayerId) setMyPlayerId(me.id)
  }, [gameState, playerName, myPlayerId])

  // Send CREATE_ROOM or JOIN_ROOM on connect
  useEffect(() => {
    if (status !== 'connected') return
    // Heuristic: if we got here from MultiplayerLobby.handleCreate, we want CREATE
    // If from handleJoin, we want JOIN. We encode this in sessionStorage.
    const intent = sessionStorage.getItem(`shithead:intent:${roomId}`) ?? 'create'
    if (intent === 'join') {
      send({ type: 'JOIN_ROOM', code: roomId, playerName })
    } else {
      send({ type: 'CREATE_ROOM', playerName })
    }
  }, [status, roomId, playerName, send])

  if (status === 'connecting' || status === 'idle') {
    return <LoadingScreen message="Connecting to room…" />
  }
  if (status === 'error' || status === 'disconnected') {
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <h2 className="text-xl font-black text-[#a23a1e] mb-2">Connection Lost</h2>
          <p className="text-[#2d4a2b]/70 text-sm mb-4">{error ?? 'Trying to reconnect…'}</p>
          <button onClick={onLeave} className="px-4 py-2 bg-[#2d4a2b] text-[#faf8f3] rounded-lg">Leave</button>
        </div>
      </div>
    )
  }

  if (!room) return <LoadingScreen message="Loading room…" />

  // LOBBY (waiting for players)
  if (room.phase === 'waiting') {
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 text-center">
          <h1 className="text-sm uppercase tracking-wider text-[#2d4a2b]/50 mb-1">Room Code</h1>
          <div className="text-5xl font-mono font-black text-[#a23a1e] mb-4 tracking-widest">{room.code}</div>
          <p className="text-xs text-[#2d4a2b]/70 mb-4">Share this code with friends</p>

          <div className="space-y-2 mb-4">
            {room.players.map(p => (
              <div key={p.id} className="flex justify-between items-center p-3 bg-[#2d4a2b]/10 rounded-lg">
                <span className="font-bold text-[#1a1a1a]">{p.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${p.connected ? 'bg-[#2d4a2b] text-[#faf8f3]' : 'bg-[#a23a1e]/20 text-[#a23a1e]'}`}>
                  {p.connected ? 'CONNECTED' : 'OFFLINE'}
                </span>
              </div>
            ))}
          </div>

          {myPlayerId === room.hostId && (
            <button
              onClick={() => send({ type: 'START_GAME' })}
              disabled={room.players.length < 2}
              className="w-full py-3 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black disabled:opacity-50"
            >
              {room.players.length < 2 ? 'WAITING FOR PLAYERS…' : 'START GAME'}
            </button>
          )}
          {myPlayerId !== room.hostId && (
            <p className="text-sm text-[#2d4a2b]/60">Waiting for host to start…</p>
          )}

          <button onClick={onLeave} className="mt-3 text-xs text-[#2d4a2b]/40 hover:underline">← Leave room</button>
        </div>
      </div>
    )
  }

  if (!gameState) return <LoadingScreen message="Loading game…" />

  // REARRANGE
  if (gameState.phase === 'rearrange') {
    return <RearrangeView gameState={gameState} myPlayerId={myPlayerId} onSwap={(h, u) => send({ type: 'REARRANGE', handIdx: h, upIdx: u })} onReady={() => send({ type: 'READY' })} />
  }

  // GAME OVER
  if (gameState.phase === 'gameOver' && gameState.loserId) {
    const loser = gameState.players.find(p => p.id === gameState.loserId)
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 text-center">
          <motion.div animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ duration: 1, repeat: Infinity }} className="text-6xl mb-3">🤡</motion.div>
          <h1 className="text-2xl font-bold text-[#1a1a1a] mb-1">{loser?.name}</h1>
          <h2 className="text-5xl font-black text-[#a23a1e] mb-4 tracking-tight">SHITHEAD</h2>
          <button onClick={onLeave} className="w-full py-3 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black">LEAVE</button>
        </motion.div>
      </div>
    )
  }

  // PLAY / ENDGAME
  const cur = getCurrentPlayer(gameState)
  const top = getTopCard(gameState)
  const ps = pileSize(gameState)
  const isMyTurn = cur?.id === myPlayerId
  const myPlayer = gameState.players.find(p => p.id === myPlayerId)

  return (
    <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
      {/* Status bar */}
      <div className="flex justify-between items-center mb-2 text-[#faf8f3] text-xs">
        <div className="flex gap-3">
          <span>Stock: <b>{gameState.stock.length}</b></span>
          <span>Pile: <b>{ps}</b></span>
        </div>
        <div className="flex gap-2 items-center">
          {gameState.phase === 'endgame' && <span className="px-2 py-0.5 bg-[#a23a1e] rounded text-[10px] font-bold animate-pulse">ENDGAME</span>}
          <span>{room.code}</span>
        </div>
      </div>

      {/* Opponents */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {gameState.players.map((p) => {
          if (p.id === myPlayerId) return <div key={p.id} />
          const isCur = p.id === cur?.id
          return (
            <div key={p.id} className={`p-1.5 rounded-lg text-center text-[10px] ${p.isOut ? 'opacity-30 grayscale' : isCur ? 'bg-[#a23a1e] text-[#faf8f3]' : 'bg-[#faf8f3]/10 text-[#faf8f3]'}`}>
              <div className="font-bold truncate">{p.name}</div>
              <div className="opacity-70">H{p.hand.length} U{p.faceUp.length} D{p.faceDown.length}</div>
            </div>
          )
        })}
      </div>

      {/* Center: pile + draw */}
      <div className="flex-1 flex items-center justify-center gap-6 my-1 min-h-[180px]">
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#faf8f3]/70 mb-1 uppercase tracking-wider">Draw</div>
          <CardView faceDown size="md" />
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#faf8f3]/70 mb-1 uppercase tracking-wider">Pile</div>
          <AnimatePresence mode="wait">
            {top ? (
              <motion.div key={top.id} initial={{ scale: 1.3, opacity: 0, y: -20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.25 }}>
                <CardView card={top} size="md" />
              </motion.div>
            ) : (
              <CardView faceDown size="md" />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Player area */}
      <div className="bg-[#faf8f3]/5 rounded-2xl p-3 backdrop-blur">
        <div className="flex justify-between items-center mb-2 px-1">
          <span className="text-[#faf8f3] font-bold text-sm">{myPlayer?.name ?? 'You'}</span>
          {!isMyTurn && cur && <span className="text-[#c8a35a] text-[10px]">{cur.name}'s turn</span>}
        </div>

        {/* Face-up */}
        {(gameState.phase === 'play' || gameState.phase === 'endgame') && myPlayer && (
          <div className="flex justify-center gap-2 mb-2 min-h-[120px]">
            {myPlayer.faceUp.map(c => {
              const playable = isMyTurn && canPlay(c, top?.rank ?? null)
              return (
                <CardView key={c.id} card={c} size="md" playable={playable} onClick={() => playable && send({ type: 'PLAY', cards: [c] })} />
              )
            })}
          </div>
        )}

        {/* Hand */}
        <div className="flex justify-center gap-1.5 flex-wrap min-h-[120px]">
          {myPlayer?.hand.map(c => {
            const playable = isMyTurn && canPlay(c, top?.rank ?? null)
            return <CardView key={c.id} card={c} size="md" playable={playable} onClick={() => playable && send({ type: 'PLAY', cards: [c] })} />
          })}
          {isMyTurn && (
            <button onClick={() => send({ type: 'PICK_UP' })} disabled={ps === 0} className="px-3 py-3 rounded-lg bg-[#a23a1e] text-[#faf8f3] font-bold text-xs self-center disabled:opacity-30">
              PICK UP {ps > 0 ? `(${ps})` : ''}
            </button>
          )}
        </div>

        {/* Face-down (endgame) */}
        {gameState.phase === 'endgame' && myPlayer && myPlayer.faceDown.length > 0 && (
          <div className="flex justify-center gap-2 mt-2">
            {myPlayer.faceDown.map(c => (
              <CardView key={c.id} faceDown size="md" onClick={() => isMyTurn && send({ type: 'PLAY', cards: [c] })} />
            ))}
          </div>
        )}
      </div>

      <button onClick={onLeave} className="text-center mt-2 text-[10px] text-[#faf8f3]/40 hover:underline uppercase tracking-wider">Leave</button>
    </div>
  )
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center">
      <div className="text-center text-[#faf8f3]">
        <div className="text-4xl mb-3 animate-pulse">♠</div>
        <p className="text-sm opacity-70">{message}</p>
      </div>
    </div>
  )
}

function RearrangeView({ gameState, myPlayerId, onSwap, onReady }: {
  gameState: GameState; myPlayerId: string | null; onSwap: (h: number, u: number) => void; onReady: () => void
}) {
  const me = gameState.players.find(p => p.id === myPlayerId)
  const [selectedHand, setSelectedHand] = useState<number | null>(null)

  if (!me) return <LoadingScreen message="Joining…" />

  return (
    <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
      <div className="text-center mb-3 text-[#faf8f3]">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Rearrange phase</div>
        <div className="font-bold text-lg">{me.name}</div>
      </div>

      <div className="bg-[#faf8f3]/10 rounded-2xl p-4 backdrop-blur">
        <div className="text-[#c8a35a] text-xs text-center mb-3">
          {selectedHand !== null
            ? 'Tap a face-up card to swap'
            : 'Tap a hand card to move to face-up row'}
        </div>

        <div className="flex justify-center gap-2 mb-4 min-h-[144px]">
          {me.faceUp.map((c, idx) => (
            <CardView
              key={c.id}
              card={c}
              size="md"
              playable={selectedHand !== null}
              onClick={() => {
                if (selectedHand !== null) {
                  onSwap(selectedHand, idx)
                  setSelectedHand(null)
                }
              }}
            />
          ))}
        </div>

        <div className="flex justify-center gap-2 flex-wrap min-h-[144px]">
          {me.hand.map((c, idx) => (
            <CardView
              key={c.id}
              card={c}
              size="md"
              selected={selectedHand === idx}
              playable={selectedHand === null}
              onClick={() => setSelectedHand(idx)}
            />
          ))}
        </div>
      </div>

      <button onClick={onReady} className="mt-4 w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl">
        READY TO PLAY →
      </button>
    </div>
  )
}
