// ============================================================================
// What a freshly accepted action sets off besides the cards moving: the
// special-effect banner, the skip shown on the seats an 8 passes, the viewer's
// going-out moment, and the screen-reader announcements (action, turn, error).
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import type { GameState, Rank } from '../../engine'
import type { useAnnouncer } from '../Announcer'
import { feedLine, latestAnimatedEvents } from '../feedText'
import { actionSettleMs } from '../actionTiming'
import { passOverSeats, skippedSeatIds } from '../seatFx'
import { specialEffectFromEvents, type SpecialEffect } from '../SpecialEffectFeedback'
import { outMomentCopy, type OutMomentEvent } from '../WinMoment'

export interface ActionFeedbackArgs {
  state: GameState
  viewerId: string
  /** It is the viewer's turn and they may act. */
  viewerTurn: boolean
  topRank: Rank | null
  reduceMotion: boolean | null
  /** Server-side error text (multiplayer). */
  error?: string | null
  announcer: ReturnType<typeof useAnnouncer>
  haptic: (pattern: number | number[]) => void
}

export function useActionFeedback({
  state, viewerId, viewerTurn, topRank, reduceMotion, error, announcer, haptic,
}: ActionFeedbackArgs) {
  const [specialEffect, setSpecialEffect] = useState<SpecialEffect | null>(null)
  const [outMoment, setOutMoment] = useState<OutMomentEvent | null>(null)

  // An action already on the table when it mounts is history, not news.
  const lastActionSeq = useRef(state.seq ?? state.turnCount)
  const cancelSeatPass = useRef<() => void>(() => {})
  useEffect(() => () => cancelSeatPass.current(), [])
  useEffect(() => {
    const cursor = state.seq ?? state.turnCount
    if (lastActionSeq.current === cursor) return
    lastActionSeq.current = cursor
    const fresh = latestAnimatedEvents(state.log)
    if (fresh.length === 0) return
    setSpecialEffect(specialEffectFromEvents(fresh, cursor, topRank))
    // An 8 shows on the players it passes over, once it has landed.
    const played = fresh.find(e => e.type === 'PLAY_CARDS')
    if (!reduceMotion && played?.type === 'PLAY_CARDS' && played.cards[0]?.rank === '8' && !fresh.some(e => e.type === 'CLEAR_PILE')) {
      cancelSeatPass.current()
      cancelSeatPass.current = passOverSeats(
        skippedSeatIds(state, played.playerId, played.cards.length), viewerId, actionSettleMs(state.log, false),
      )
    }
    const line = feedLine(state, { meId: viewerId, players: state.players })
    if (line) announcer.sayPolite(line.text)
    // The viewer just shed their last card while the round carries on. When
    // the same action ends the round, the round-over card celebrates instead.
    const viewerWentOut = fresh.some(e => e.type === 'PLAYER_OUT' && e.playerId === viewerId)
    if (viewerWentOut && !fresh.some(e => e.type === 'GAME_OVER')) {
      const place = Math.max(1, state.players.filter(player => player.isOut).length)
      const copy = outMomentCopy(place)
      setOutMoment({ key: `${viewerId}:${cursor}`, place })
      announcer.sayPolite(`${copy.title}. ${copy.detail}.`)
      haptic([30, 60, 30, 60, 90])
    }
    if (fresh.some(e => e.type === 'GAME_OVER')) {
      const loser = state.players.find(p => p.id === state.loserId)
      announcer.sayPolite(`Round over. ${loser?.name ?? ''} is the Shithead.`)
    }
    // Once per accepted action; everything else is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq, state.turnCount, state.log])

  const current = state.players[state.currentPlayerIdx]
  const lastTurnKey = useRef('')
  useEffect(() => {
    const key = `${current?.id ?? 'none'}-${viewerId}-${viewerTurn ? 'active' : 'passive'}`
    if (key === lastTurnKey.current) return
    lastTurnKey.current = key
    if (!current) return
    if (current.id === viewerId && viewerTurn) {
      announcer.sayPolite('Your turn')
    } else {
      announcer.sayPolite(`${current.name}'s turn`)
    }
    // Once per change of turn, not when a player is renamed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, viewerId, viewerTurn])

  // Surface external (server) errors assertively.
  useEffect(() => { if (error) announcer.sayAssertive(error) }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  return { specialEffect, outMoment }
}
