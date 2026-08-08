import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSPGame } from '../sp/SPSinglePlayer'
import type { Card } from '../engine'
import {
  canPlay, getCurrentPlayer, getTopCard, pileSize,
} from '../engine'
import { Card as CardView } from './Card'

export function GameTable() {
  const state = useSPGame(s => s.state)
  const { playCards, pickUpPile, endRearrange, rearrange, tickAI, reset } = useSPGame()
  const { players, pile, stock, currentPlayerIdx, phase, loserId, turnCount } = state
  const currentPlayer = players[currentPlayerIdx]

  // Auto-tick AI
  useEffect(() => {
    if (!currentPlayer || currentPlayer.isOut || loserId) return
    if (!currentPlayer.isAI) return
    if (phase !== 'play' && phase !== 'endgame') return
    const t = setTimeout(() => tickAI(), 900)
    return () => clearTimeout(t)
  }, [currentPlayer?.id, phase, turnCount, loserId])

  // =============== WINNER ===============
  if (loserId) {
    const loser = players.find(p => p.id === loserId)
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 shadow-2xl text-center">
          <motion.div animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ duration: 1, repeat: Infinity }} className="text-6xl mb-3">🤡</motion.div>
          <h1 className="text-2xl font-bold text-[#1a1a1a] mb-1">{loser?.name}</h1>
          <h2 className="text-5xl font-black text-[#a23a1e] mb-4 tracking-tight">SHITHEAD</h2>
          <button onClick={reset} className="w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition">
            NEW GAME
          </button>
        </motion.div>
      </div>
    )
  }

  // =============== REARRANGE ===============
  if (phase === 'rearrange' && currentPlayer) {
    return <RearrangeUI player={currentPlayer} onSwap={(h, u) => rearrange(currentPlayer.id, h, u)} onReady={() => endRearrange(currentPlayer.id)} />
  }

  if (!currentPlayer) return null

  // =============== PLAY / ENDGAME ===============
  const top = getTopCard(state)
  const ps = pileSize(state)

  return (
    <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
      {/* Status bar */}
      <div className="flex justify-between items-center mb-2 text-[#faf8f3] text-xs">
        <div className="flex gap-3">
          <span>Stock: <b>{stock.length}</b></span>
          <span>Pile: <b>{ps}</b></span>
        </div>
        <div className="flex gap-2 items-center">
          {phase === 'endgame' && <span className="px-2 py-0.5 bg-[#a23a1e] rounded text-[10px] font-bold animate-pulse">ENDGAME</span>}
          <span>Turn {turnCount + 1}</span>
        </div>
      </div>

      {/* Opponents */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {players.map((p, i) => {
          if (i === currentPlayerIdx) return <div key={p.id} />
          const isCur = i === currentPlayerIdx
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
          {ps > 1 && <div className="text-[#c8a35a] text-[10px] mt-1">+{ps - 1} under</div>}
        </div>
      </div>

      {/* Player area */}
      <div className="bg-[#faf8f3]/5 rounded-2xl p-3 backdrop-blur">
        <div className="flex justify-between items-center mb-2 px-1">
          <span className="text-[#faf8f3] font-bold text-sm">
            {currentPlayer.name}
            {currentPlayer.isAI && <span className="text-[#c8a35a] text-xs ml-1.5">🤖</span>}
          </span>
          {currentPlayer.isAI && <span className="text-[#c8a35a] text-[10px]">thinking…</span>}
        </div>

        {/* Face-up */}
        {(phase === 'play' || phase === 'endgame') && (
          <div className="flex justify-center gap-2 mb-2 min-h-[120px]">
            {currentPlayer.faceUp.map(c => {
              const playable = canPlay(c, top?.rank ?? null) && !currentPlayer.isAI
              return <CardView key={c.id} card={c} size="md" playable={playable} onClick={() => playable && playCards(currentPlayer.id, [c])} />
            })}
            {currentPlayer.faceUp.length === 0 && <div className="text-[#faf8f3]/30 text-xs self-center">No face-up cards</div>}
          </div>
        )}

        {/* Hand */}
        <div className="flex justify-center gap-1.5 flex-wrap min-h-[120px]">
          {currentPlayer.hand.map(c => {
            const playable = canPlay(c, top?.rank ?? null) && !currentPlayer.isAI
            return <CardView key={c.id} card={c} size="md" playable={playable} onClick={() => playable && playCards(currentPlayer.id, [c])} />
          })}
          {!currentPlayer.isAI && (
            <button onClick={() => pickUpPile(currentPlayer.id)} disabled={ps === 0} className="px-3 py-3 rounded-lg bg-[#a23a1e] text-[#faf8f3] font-bold text-xs self-center disabled:opacity-30">
              PICK UP {ps > 0 ? `(${ps})` : ''}
            </button>
          )}
        </div>

        {/* Face-down (endgame) */}
        {phase === 'endgame' && currentPlayer.faceDown.length > 0 && (
          <div className="flex justify-center gap-2 mt-2">
            {currentPlayer.faceDown.map(c => (
              <CardView key={c.id} faceDown size="md" onClick={() => !currentPlayer.isAI && playCards(currentPlayer.id, [c])} />
            ))}
          </div>
        )}
      </div>

      <div className="text-center mt-2 text-[10px] text-[#c8a35a]/70 uppercase tracking-wider">
        {phase === 'play' && (currentPlayer.isAI ? 'AI thinking…' : 'Your turn')}
        {phase === 'endgame' && (currentPlayer.isAI ? 'AI playing blind…' : 'Endgame — blind face-down plays')}
      </div>
    </div>
  )
}

function RearrangeUI({ player, onSwap, onReady }: {
  player: import('../engine').Player; onSwap: (h: number, u: number) => void; onReady: () => void
}) {
  const [selectedHand, setSelectedHand] = useStateSafe<number | null>(null)
  return (
    <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
      <div className="text-center mb-3 text-[#faf8f3]">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Rearrange phase</div>
        <div className="font-bold text-lg">{player.name}</div>
        {player.isAI && <div className="text-xs text-[#c8a35a]">🤖 thinking…</div>}
      </div>

      {!player.isAI ? (
        <>
          <div className="bg-[#faf8f3]/10 rounded-2xl p-4 backdrop-blur">
            <div className="text-[#c8a35a] text-xs text-center mb-3">
              {selectedHand !== null
                ? 'Tap a face-up card to swap'
                : 'Tap a hand card to move to face-up row'}
            </div>

            <div className="flex justify-center gap-2 mb-4 min-h-[144px]">
              {player.faceUp.map((c, idx) => (
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
              {player.hand.map((c, idx) => (
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

          <button onClick={onReady} className="mt-4 w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition">
            READY TO PLAY →
          </button>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#faf8f3]">
          <div className="text-center">
            <div className="text-4xl mb-3 animate-bounce">🎴</div>
            <div className="text-sm opacity-70">Setting up optimal hand…</div>
            <button onClick={onReady} className="mt-6 px-4 py-2 bg-[#a23a1e] rounded-lg text-sm">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Hook alias since we already useState elsewhere in this file
import { useState as useStateSafe } from 'react'
