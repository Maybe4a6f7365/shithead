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
import { TributeScreen } from './TributeScreen'
import { useTurnAlertController, useTurnAlertPreferences } from './turnAlerts'
import { addRecentCustomMessage } from '../customMessageHistory'

const AI_TICK_MS = 900

export function GameTable({ onLeave }: { onLeave: () => void }) {
  const state = useSPGame(s => s.state)
  const meId = useSPGame(s => s.meId)
  const revealedId = useSPGame(s => s.revealedId)
  const readyIds = useSPGame(s => s.readyIds)
  const lastError = useSPGame(s => s.lastError)
  const initConfigs = useSPGame(s => s.configs)
  const nextRules = useSPGame(s => s.rules)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [declinedQuickSourceSeq, setDeclinedQuickSourceSeq] = useState<number | null>(null)
  const [recentCustomMessagesByViewer, setRecentCustomMessagesByViewer] = useState(
    () => new Map<string, string[]>(),
  )
  const { preferences, toggleSound, toggleTurnAlerts, toggleAdhdMode, selectAdhdSound } = useTurnAlertPreferences()

  const {
    playCards, quickFollowUp, interruptBurn, pickUpPile, endRearrange, rearrange, tickAI, revealFor,
    exchangeTribute, skipTribute, setRules, rematch, reset,
  } = useSPGame.getState()

  const { players, currentPlayerIdx, phase, loserId, turnCount } = state
  const current = players[currentPlayerIdx]
  const loser = players.find(p => p.id === loserId)
  const meIsShithead = loserId !== null && loserId === meId
  const attentionAlertActive = useTurnAlertController({
    phase,
    currentPlayerId: current?.id ?? null,
    localHumanTurn: Boolean(current && !current.isAI && !current.isOut && !loserId),
    ...preferences,
  })

  useEffect(() => {
    if (!state.pendingQuickFollowUp) setDeclinedQuickSourceSeq(null)
  }, [state.pendingQuickFollowUp])

  // Auto-tick AI turns.
  useEffect(() => {
    if (phase === 'tribute') {
      const tributeWinner = players.find(player => player.id === state.pendingTribute?.winnerId)
      if (!tributeWinner?.isAI) return
      const t = setTimeout(() => tickAI(), AI_TICK_MS)
      return () => clearTimeout(t)
    }
    const quickPlayer = players.find(player => player.id === state.pendingQuickFollowUp?.playerId)
    if (quickPlayer?.isAI) {
      const t = setTimeout(() => tickAI(), AI_TICK_MS)
      return () => clearTimeout(t)
    }
    if (!current || current.isOut || loserId || !current.isAI) return
    if (phase !== 'play' && phase !== 'endgame') return
    const t = setTimeout(() => tickAI(), AI_TICK_MS)
    return () => clearTimeout(t)
  }, [current?.id, current?.isAI, current?.isOut, phase, turnCount, loserId, state.pendingTribute?.winnerId, state.pendingQuickFollowUp?.playerId, state.pendingQuickFollowUp?.sourceSeq, players, tickAI])

  // AI players never rearrange — auto-ready any stragglers.
  useEffect(() => {
    if (phase !== 'rearrange') return
    for (const p of players) {
      if (p.isAI && !readyIds.includes(p.id)) endRearrange(p.id)
    }
  }, [phase, players, readyIds, endRearrange])

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

  if (phase === 'tribute' && state.pendingTribute) {
    const winner = players.find(player => player.id === state.pendingTribute?.winnerId)
    const lastPlace = players.find(player => player.id === state.pendingTribute?.loserId)
    if (winner && lastPlace) {
      return (
        <TributeScreen
          winner={winner}
          loser={lastPlace}
          viewerId={winner.id}
          error={lastError}
          onSwap={(winnerCardId, loserCardId) => exchangeTribute(winner.id, winnerCardId, loserCardId)}
          onSkip={() => skipTribute(winner.id)}
        />
      )
    }
  }

  const quickPlayer = players.find(player => player.id === state.pendingQuickFollowUp?.playerId)
  const quickDeclined = state.pendingQuickFollowUp?.sourceSeq === declinedQuickSourceSeq
  const quickViewerId = quickPlayer && !quickPlayer.isAI && !quickDeclined ? quickPlayer.id : null
  const viewerId = quickViewerId ?? resolveViewerId(players, currentPlayerIdx, meId, revealedId)
  const gateNeeded = (phase === 'play' || phase === 'endgame') &&
    !quickViewerId &&
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
          onQuickFollowUp={card => quickFollowUp(viewer.id, card)}
          onDeclineQuickFollowUp={quickViewerId ? () => {
            setDeclinedQuickSourceSeq(state.pendingQuickFollowUp?.sourceSeq ?? null)
          } : undefined}
          quickFollowUpDeclineLabel="Pass"
          onBurnIn={!viewer.isAI ? cards => interruptBurn(viewer.id, cards) : undefined}
          onPickUp={() => pickUpPile(viewer.id)}
          onLeave={leave}
          onOpenRules={() => setRulesOpen(true)}
          soundOn={preferences.soundOn}
          onToggleSound={toggleSound}
          turnAlertsEnabled={preferences.turnAlertsEnabled}
          onToggleTurnAlerts={toggleTurnAlerts}
          adhdMode={preferences.adhdMode}
          onToggleAdhdMode={toggleAdhdMode}
          adhdSound={preferences.adhdSound}
          onSelectAdhdSound={selectAdhdSound}
          attentionAlertActive={attentionAlertActive}
          recentCustomMessages={recentCustomMessagesByViewer.get(viewer.id) ?? []}
          onLocalChatAccepted={text => {
            setRecentCustomMessagesByViewer(current => {
              const next = new Map(current)
              next.set(viewer.id, addRecentCustomMessage(current.get(viewer.id) ?? [], text))
              return next
            })
          }}
        />
      )}

      {gateNeeded && current && (
        <PassGate player={current} onReveal={() => revealFor(current.id)} />
      )}

      {phase === 'gameOver' && (
        <GameOverOverlay
          result={!loser ? 'neutral' : meIsShithead ? 'lose' : 'win'}
          shitheadName={loser?.name}
          canRematch={initConfigs.length > 0}
          onRematch={() => rematch()}
          onLeave={leave}
          rules={nextRules}
          rulesEditable
          onRulesChange={setRules}
        />
      )}

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}
