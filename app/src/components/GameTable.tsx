// ============================================================================
// GameTable — single-player wrapper: AI ticking, hot-seat pass gate,
// rearrange sequencing, game-over overlay. The table itself is TableScreen.
// ============================================================================
import { useEffect, useState } from 'react'
import { useSPGame, resolveViewerId, needsPassGate } from '../sp/SPSinglePlayer'
import { TableScreen } from './TableScreen'
import { RearrangeScreen } from './RearrangeScreen'
import { PassGate } from './PassGate'
import { GameOverOverlay } from './GameOverOverlay'
import { RulesSheet } from './RulesSheet'

const AI_TICK_MS = 900

export function GameTable({ onLeave }: { onLeave: () => void }) {
  const state = useSPGame(s => s.state)
  const meId = useSPGame(s => s.meId)
  const revealedId = useSPGame(s => s.revealedId)
  const readyIds = useSPGame(s => s.readyIds)
  const lastError = useSPGame(s => s.lastError)
  const initConfigs = useSPGame(s => s.configs)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('shithead:sound') !== 'off')

  const { playCards, pickUpPile, endRearrange, rearrange, tickAI, revealFor, rematch, reset } = useSPGame.getState()

  const { players, currentPlayerIdx, phase, loserId, turnCount } = state
  const current = players[currentPlayerIdx]
  const loser = players.find(p => p.id === loserId)
  const meIsShithead = loserId !== null && loserId === meId

  // Auto-tick AI turns.
  useEffect(() => {
    if (!current || current.isOut || loserId) return
    if (!current.isAI) return
    if (phase !== 'play' && phase !== 'endgame') return
    const t = setTimeout(() => tickAI(), AI_TICK_MS)
    return () => clearTimeout(t)
  }, [current?.id, current?.isAI, current?.isOut, phase, turnCount, loserId, tickAI])

  // AI players never rearrange — auto-ready any stragglers.
  useEffect(() => {
    if (phase !== 'rearrange') return
    for (const p of players) {
      if (p.isAI && !readyIds.includes(p.id)) endRearrange(p.id)
    }
  }, [phase, players, readyIds, endRearrange])

  const toggleSound = () => {
    setSoundOn(on => {
      localStorage.setItem('shithead:sound', on ? 'off' : 'on')
      return !on
    })
  }

  const leave = () => { reset(); onLeave() }

  // ---- Rearrange phase: each human arranges in turn (pass gate for non-me) ----
  if (phase === 'rearrange') {
    const next = players.find(p => !readyIds.includes(p.id))
    if (next) {
      const isMe = next.id === meId
      const revealed = revealedId === next.id
      if (!isMe && !revealed) {
        return <PassGate player={next} onReveal={() => revealFor(next.id)} />
      }
      return (
        <RearrangeScreen
          player={next}
          onSwap={(h, u) => rearrange(next.id, h, u)}
          onReady={() => endRearrange(next.id)}
        />
      )
    }
  }

  const viewerId = resolveViewerId(players, currentPlayerIdx, meId, revealedId)
  const gateNeeded = (phase === 'play' || phase === 'endgame') &&
    needsPassGate(players, currentPlayerIdx, meId, revealedId)
  const viewer = players.find(p => p.id === viewerId)

  return (
    <>
      {viewer && (phase === 'play' || phase === 'endgame' || phase === 'gameOver') && (
        <TableScreen
          state={state}
          viewerId={viewer.id}
          viewerActive={current?.id === viewer.id && !current?.isAI && !loserId}
          error={lastError}
          onPlay={cards => playCards(viewer.id, cards)}
          onPickUp={() => pickUpPile(viewer.id)}
          onLeave={leave}
          onOpenRules={() => setRulesOpen(true)}
          soundOn={soundOn}
          onToggleSound={toggleSound}
        />
      )}

      {gateNeeded && current && (
        <PassGate player={current} onReveal={() => revealFor(current.id)} />
      )}

      {phase === 'gameOver' && loser && (
        <GameOverOverlay
          result={meIsShithead ? 'lose' : 'win'}
          shitheadName={loser.name}
          canRematch={initConfigs.length > 0}
          onRematch={() => rematch()}
          onLeave={leave}
        />
      )}

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}
