// ============================================================================
// GameTable — single-player wrapper: AI ticking, hot-seat pass gate,
// rearrange sequencing, game-over overlay. The table itself is TableScreen.
// ============================================================================
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useSPGame, resolveViewerId, needsPassGate } from '../sp/SPSinglePlayer'
import { TableScreen } from './TableScreen'
import { burnCleanupDelay } from './table/usePileSequence'
import { RearrangeScreen } from './RearrangeScreen'
import { PassGate } from './PassGate'
import { GameOverOverlay } from './GameOverOverlay'
import { RulesSheet } from './RulesSheet'
import { TributeScreen } from './TributeScreen'
import {
  latestAcceptedGameplayAction,
  useTurnAlertController,
  useTurnAlertPreferences,
} from './turnAlerts'
import { addRecentCustomMessage } from '../customMessageHistory'
import { gameOverResults } from './gameOverResults'
import { useWakeLock } from '../useWakeLock'
import type { GameEvent, GameState } from '../engine'
import { latestActionEvents } from './feedText'
import { actionSettleMs, useGameOverReady } from './actionTiming'

const AI_TICK_MS = 900

/**
 * How long the AI waits before acting. A blind flip or a burn takes longer
 * than the base tick, and the next action must not land
 * on top of an animation that is still explaining the previous one.
 */
export function aiTickDelay(log: GameEvent[], reduceMotion: boolean | null): number {
  if (reduceMotion) return AI_TICK_MS
  const events = latestActionEvents(log)
  const slow = events.some(event => event.type === 'BLIND_REVEAL' || event.type === 'CLEAR_PILE')
  return slow ? Math.max(AI_TICK_MS, actionSettleMs(log, reduceMotion) + 160) : AI_TICK_MS
}

/** Whether the table is waiting on a computer player. */
function aiIsDue(state: GameState): boolean {
  const { players, phase } = state
  if (phase === 'tribute') {
    return Boolean(players.find(player => player.id === state.pendingTribute?.winnerId)?.isAI)
  }
  if (players.find(player => player.id === state.pendingQuickFollowUp?.playerId)?.isAI) return true
  const current = players[state.currentPlayerIdx]
  if (!current || current.isOut || state.loserId || !current.isAI) return false
  return phase === 'play' || phase === 'endgame'
}

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
  const { preferences, settings: alertSettings } = useTurnAlertPreferences()

  const {
    playCards, quickFollowUp, interruptBurn, pickUpPile, endRearrange, rearrange, tickAI, revealFor,
    exchangeTribute, skipTribute, setRules, rematch, reset,
  } = useSPGame.getState()

  const { players, currentPlayerIdx, phase, loserId, turnCount } = state
  const reduceMotion = useReducedMotion()
  const current = players[currentPlayerIdx]
  const latestGameplayAction = latestAcceptedGameplayAction(state.log)
  const loser = players.find(p => p.id === loserId)
  const meIsShithead = loserId !== null && loserId === meId
  const resultsView = phase === 'gameOver' ? gameOverResults(state) : null
  const gameOverReady = useGameOverReady(state, reduceMotion)
  const attentionAlertActive = useTurnAlertController({
    phase,
    currentPlayerId: current?.id ?? null,
    turnCount,
    latestGameplayActorId: latestGameplayAction?.actorId ?? null,
    latestGameplayActionBurned: latestGameplayAction?.burned ?? false,
    repeatTurnAlertDelayMs: burnCleanupDelay(reduceMotion),
    localHumanTurn: Boolean(current && !current.isAI && !current.isOut && !loserId),
    ...preferences,
  })

  useWakeLock(phase === 'play' || phase === 'endgame')

  useEffect(() => {
    if (!state.pendingQuickFollowUp) setDeclinedQuickSourceSeq(null)
  }, [state.pendingQuickFollowUp])

  // Auto-tick AI turns. Every accepted action replaces the state, so the
  // timer restarts once per action.
  useEffect(() => {
    if (!aiIsDue(state)) return
    const timer = setTimeout(() => tickAI(), aiTickDelay(state.log, reduceMotion))
    return () => clearTimeout(timer)
  }, [state, tickAI, reduceMotion])

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
          {...alertSettings}
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

      {gameOverReady && (
        <GameOverOverlay
          result={!loser ? 'neutral' : meIsShithead ? 'lose' : 'win'}
          shitheadName={loser?.name}
          canRematch={initConfigs.length > 0}
          onRematch={() => rematch()}
          onLeave={leave}
          rules={nextRules}
          rulesEditable
          onRulesChange={setRules}
          leaderboard={resultsView?.leaderboard}
          statsNote={resultsView?.statsNote}
        />
      )}

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  )
}
