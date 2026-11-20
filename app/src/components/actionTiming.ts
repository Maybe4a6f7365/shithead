// ============================================================================
// actionTiming — how long the table needs to finish showing one action.
// Anything that follows an action (the next AI move, the round-over card)
// waits for this, so it never lands on top of an animation that is still
// explaining the previous play.
// ============================================================================
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { GameEvent, GameState } from '../engine'
import { blindRevealMs } from './BlindReveal'
import { burnCleanupMs } from './BurnFx'
import { staggerDelay } from './cardFlight'
import { latestAnimatedEvents } from './feedText'

/** Longest a single card takes to reach the pile (see flightDuration). */
const FLIGHT_MS = 340

/** Time for a play of `cardCount` cards to land on the pile, staggered. */
export function playArrivalMs(cardCount: number): number {
  return Math.round(staggerDelay(Math.max(0, cardCount - 1)) * 1000) + FLIGHT_MS + 20
}

/** Time (ms) until every animation of the latest action has finished. */
export function actionSettleMs(log: GameEvent[], reduceMotion: boolean | null): number {
  if (reduceMotion) return 0
  const events = latestAnimatedEvents(log)
  const blind = events.find(event => event.type === 'BLIND_REVEAL')
  const play = events.find(event => event.type === 'PLAY_CARDS')
  const clear = events.find(event => event.type === 'CLEAR_PILE')
  const burn = clear?.type === 'CLEAR_PILE' ? burnCleanupMs(clear.reason) : 0
  if (blind?.type === 'BLIND_REVEAL') return blindRevealMs(blind.success) + burn
  if (play?.type === 'PLAY_CARDS') return playArrivalMs(play.cards.length) + burn
  return 0
}

/**
 * False while the action that ended the round is still playing out, so the
 * round-over card does not cover the deciding card. A table that mounts into
 * a finished round (reload, reconnect) is ready at once.
 */
export function useGameOverReady(state: Pick<GameState, 'phase' | 'log'> | null, reduceMotion: boolean | null): boolean {
  const over = state?.phase === 'gameOver'
  const [ready, setReady] = useState(over)
  const mountedOver = useRef(over)
  // How long the deciding action still needs, read as the round ends.
  const settleWait = useEffectEvent(() => actionSettleMs(state?.log ?? [], reduceMotion))
  useEffect(() => {
    if (!over) {
      mountedOver.current = false
      setReady(false)
      return
    }
    if (mountedOver.current) return
    const wait = settleWait()
    if (wait <= 0) {
      setReady(true)
      return
    }
    const timer = setTimeout(() => setReady(true), wait + 200)
    return () => clearTimeout(timer)
  }, [over])
  return over && ready
}
