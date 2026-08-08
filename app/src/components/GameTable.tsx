import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGame } from '../game/state'
import { canPlay, playClearsPile, isQuartet } from '../game/rules'
import { pickAIMove } from '../game/ai'
import { Card } from './Card'

export function GameTable() {
  const { state, playCards, pickUpPile, reset, rearrange, endRearrange } = useGame()
  const { players, pile, stock, currentPlayerIdx, phase, winner, turnCount } = state
  const currentPlayer = players[currentPlayerIdx]
  const [rearrangeMode, setRearrangeMode] = useState(false)
  const [selectedHand, setSelectedHand] = useState<number | null>(null)
  const [rearrangeConfirm, setRearrangeConfirm] = useState(false)
  const [scoreboard, setScoreboard] = useState<Record<string, number>>({})

  // Track losses → score
  useEffect(() => {
    if (winner) {
      setScoreboard(prev => ({ ...prev, [winner]: (prev[winner] ?? 0) + 1 }))
    }
  }, [winner])

  // Auto-play AI turns
  useEffect(() => {
    if (!currentPlayer || currentPlayer.isOut || phase === 'lobby' || phase === 'rearrange' || phase === 'roundEnd' || winner) return
    if (!currentPlayer.isAI) return
    const t = setTimeout(() => {
      const move = pickAIMove(currentPlayer, state, currentPlayer.aiDifficulty ?? 'medium')
      if (move.type === 'play') playCards(currentPlayer.id, move.cards)
      else pickUpPile(currentPlayer.id)
    }, 900)
    return () => clearTimeout(t)
  }, [currentPlayer?.id, phase, turnCount])

  // =============== REARRANGE PHASE ===============
  if (phase === 'rearrange') {
    if (!currentPlayer) return null
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
        <div className="text-center mb-3 text-[#faf8f3]">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Rearrange phase</div>
          <div className="font-bold text-lg">{currentPlayer.name}</div>
          {currentPlayer.isAI && <div className="text-xs text-[#c8a35a]">🤖 thinking…</div>}
        </div>

        {!currentPlayer.isAI ? (
          <>
            <div className="bg-[#faf8f3]/10 rounded-2xl p-4 backdrop-blur">
              <div className="text-[#c8a35a] text-xs text-center mb-3">
                {rearrangeMode
                  ? `Tap a face-up card to swap with selected hand card`
                  : `Tap your hand cards to move them to the face-up row. Keep strong cards (high, 2s, 10s) face-up.`}
              </div>

              {/* Face-up */}
              <div className="flex justify-center gap-2 mb-4 min-h-[144px]">
                {currentPlayer.faceUp.map((c, idx) => (
                  <div key={c.id} className="flex flex-col items-center">
                    <Card
                      card={c}
                      size="md"
                      onClick={() => {
                        if (rearrangeMode && selectedHand !== null) {
                          rearrange(currentPlayer.id, selectedHand, idx)
                          setSelectedHand(null)
                          setRearrangeMode(false)
                        }
                      }}
                      playable={rearrangeMode}
                    />
                    <div className="text-[#c8a35a] text-[10px] mt-1">UP {idx + 1}</div>
                  </div>
                ))}
              </div>

              {/* Hand */}
              <div className="flex justify-center gap-2 flex-wrap min-h-[144px]">
                {currentPlayer.hand.map((c, idx) => (
                  <div key={c.id} className="flex flex-col items-center">
                    <Card
                      card={c}
                      size="md"
                      selected={selectedHand === idx}
                      playable={!rearrangeMode}
                      onClick={() => {
                        if (!rearrangeMode) {
                          setSelectedHand(idx)
                          setRearrangeMode(true)
                        }
                      }}
                    />
                    <div className="text-[#c8a35a] text-[10px] mt-1">HAND {idx + 1}</div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                endRearrange(currentPlayer.id)
                // Auto-advance: end rearrange for everyone, move to play
              }}
              className="mt-4 w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition"
            >
              READY TO PLAY →
            </button>
          </>
        ) : (
          // AI rearrange — auto-decide
          <div className="flex-1 flex items-center justify-center text-[#faf8f3]">
            <div className="text-center">
              <div className="text-4xl mb-3 animate-bounce">🎴</div>
              <div className="text-sm opacity-70">Setting up optimal hand…</div>
              <button
                onClick={() => {
                  // For AI: end rearrange immediately (skip UI)
                  endRearrange(currentPlayer.id)
                }}
                className="mt-6 px-4 py-2 bg-[#a23a1e] rounded-lg text-sm"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // =============== WINNER SCREEN ===============
  if (winner) {
    const loser = players.find(p => p.id === winner)
    const sorted = Object.entries(scoreboard).sort(([,a],[,b]) => b - a)
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 shadow-2xl">
          <div className="text-center">
            <motion.div initial={{ rotate: -20 }} animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ duration: 1, repeat: Infinity }} className="text-6xl mb-3">🤡</motion.div>
            <h1 className="text-3xl font-black text-[#a23a1e] mb-1">{loser?.name}</h1>
            <h2 className="text-5xl font-black text-[#a23a1e] mb-3 tracking-tight">SHITHEAD</h2>
            <p className="text-[#2d4a2b]/70 mb-5 text-sm">Last one holding cards.</p>

            {sorted.length > 0 && (
              <div className="bg-[#2d4a2b]/10 rounded-xl p-3 mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-[#2d4a2b]/70 mb-2">Loss Count</div>
                {sorted.map(([pid, count]) => {
                  const p = players.find(pp => pp.id === pid)
                  return (
                    <div key={pid} className="flex justify-between text-sm py-1">
                      <span className="text-[#1a1a1a]">{p?.name}</span>
                      <span className="font-bold text-[#a23a1e]">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <button onClick={reset} className="w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition">
              NEW GAME
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  if (!currentPlayer) return null

  const topPileEntry = pile[pile.length - 1]
  const topCard = topPileEntry?.cards[0]
  const pileSize = pile.reduce((sum, e) => sum + (e.cleared ? 0 : e.cards.length), 0)
  const canPickUp = pileSize > 0 && !currentPlayer.isAI && (currentPlayer.hand.some(c => !canPlay(c, topCard?.rank ?? null)) || currentPlayer.hand.length === 0)

  // =============== MAIN PLAY ===============
  return (
    <div className="min-h-screen bg-[#2d4a2b] flex flex-col p-3 max-w-lg mx-auto">
      {/* Top status bar */}
      <div className="flex justify-between items-center mb-2 text-[#faf8f3] text-xs">
        <div className="flex gap-3">
          <span>Stock: <b>{stock.length}</b></span>
          <span>Pile: <b>{pileSize}</b></span>
        </div>
        <div className="flex gap-2 items-center">
          {phase === 'endgame' && <span className="px-2 py-0.5 bg-[#a23a1e] rounded text-[10px] font-bold animate-pulse">ENDGAME</span>}
          <span>Turn {turnCount + 1}</span>
        </div>
      </div>

      {/* Opponents row */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {players.map((p, i) => {
          if (i === currentPlayerIdx) return <div key={p.id} />
          const isActive = i === currentPlayerIdx
          return (
            <div key={p.id} className={`p-1.5 rounded-lg text-center text-[10px] ${p.isOut ? 'opacity-30 grayscale' : isActive ? 'bg-[#a23a1e] text-[#faf8f3]' : 'bg-[#faf8f3]/10 text-[#faf8f3]'}`}>
              <div className="font-bold truncate">{p.name}</div>
              <div className="opacity-70">H{p.hand.length} U{p.faceUp.length} D{p.faceDown.length}</div>
              {p.isOut && <div className="text-[9px] font-bold">OUT</div>}
            </div>
          )
        })}
      </div>

      {/* Center pile + draw */}
      <div className="flex-1 flex items-center justify-center gap-6 my-1 min-h-[180px]">
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#faf8f3]/70 mb-1 uppercase tracking-wider">Draw</div>
          <Card faceDown size="md" />
        </div>

        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#faf8f3]/70 mb-1 uppercase tracking-wider">Pile</div>
          <AnimatePresence mode="wait">
            {topCard ? (
              <motion.div key={topCard.id} initial={{ scale: 1.3, opacity: 0, y: -20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.25 }}>
                <Card card={topCard} size="md" />
              </motion.div>
            ) : (
              <Card faceDown size="md" />
            )}
          </AnimatePresence>
          {pileSize > 1 && <div className="text-[#c8a35a] text-[10px] mt-1">+{pileSize - 1} under</div>}
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

        {/* Face-up cards (playable in normal phase + endgame) */}
        {(phase === 'play' || phase === 'endgame') && (
          <div className="flex justify-center gap-2 mb-2 min-h-[120px]">
            {currentPlayer.faceUp.map((c) => {
              const playable = canPlay(c, topCard?.rank ?? null)
              return (
                <Card
                  key={c.id}
                  card={c}
                  size="md"
                  playable={playable && !currentPlayer.isAI}
                  onClick={() => playable && playCards(currentPlayer.id, [c])}
                />
              )
            })}
            {currentPlayer.faceUp.length === 0 && (
              <div className="text-[#faf8f3]/30 text-xs self-center">No face-up cards</div>
            )}
          </div>
        )}

        {/* Hand cards */}
        <div className="flex justify-center gap-1.5 flex-wrap min-h-[120px]">
          {currentPlayer.hand.map(c => {
            const playable = canPlay(c, topCard?.rank ?? null)
            return (
              <Card
                key={c.id}
                card={c}
                size="md"
                playable={playable && !currentPlayer.isAI}
                onClick={() => playable && playCards(currentPlayer.id, [c])}
              />
            )
          })}
          {!currentPlayer.isAI && (
            <button
              onClick={() => pickUpPile(currentPlayer.id)}
              disabled={pileSize === 0}
              className="px-3 py-3 rounded-lg bg-[#a23a1e] text-[#faf8f3] font-bold text-xs self-center disabled:opacity-30"
            >
              PICK UP {pileSize > 0 ? `(${pileSize})` : ''}
            </button>
          )}
        </div>

        {/* Face-down cards (endgame only) */}
        {phase === 'endgame' && currentPlayer.faceDown.length > 0 && (
          <div className="flex justify-center gap-2 mt-2">
            {currentPlayer.faceDown.map(c => (
              <Card
                key={c.id}
                faceDown
                size="md"
                onClick={() => !currentPlayer.isAI && playCards(currentPlayer.id, [c])}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="text-center mt-2 text-[10px] text-[#c8a35a]/70 uppercase tracking-wider">
        {phase === 'play' && (currentPlayer.isAI ? 'AI thinking…' : 'Your turn')}
        {phase === 'endgame' && (currentPlayer.isAI ? 'AI playing blind…' : 'Endgame — blind face-down plays')}
      </div>
    </div>
  )
}
