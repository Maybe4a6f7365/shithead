// ============================================================================
// What the pile shows while the latest action plays out.
//
// The authoritative state jumps straight to the result of an action; the table
// tells it in order. Everything here is derived from the latest action during
// render, so the pile never paints a frame of a state the player has not been
// shown yet:
//
//   blind flip   the pile and the taker's hand stay as they were until the
//                face-down card has turned
//   burn         the card that causes it flies to the pile first, then the
//                pile burns (straight away after a blind flip, whose reveal
//                already put the card there, and under reduced motion)
//   pick-up      the stack sweeps to whoever took it
//
// A newer action replaces whatever is still playing; nothing plays over a pile
// that has moved on. An action already in the log when the table mounts
// (reconnect, late join) is history and is not replayed.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Card as CardT, GameState, Rank } from '../../engine'
import { getMirroredCard } from '../../engine'
import type { BlindRevealData } from '../BlindReveal'
import type { PileSweepData } from '../PileSweep'
import { burnCleanupMs, type BurnReason } from '../BurnFx'
import { peekCardRect, peekSeatRect, type FlightRect } from '../cardFlight'
import { latestAnimatedEvents } from '../feedText'
import { playArrivalMs } from '../actionTiming'
import type { PileAreaProps } from '../PileArea'

/** The cards of the same rank lying on top of the pile, newest first. */
export function topRunCards(state: Pick<GameState, 'pile'>): CardT[] {
  const run: CardT[] = []
  for (let index = state.pile.length - 1; index >= 0; index--) {
    const entry = state.pile[index]
    if (entry.cleared || entry.cards.length === 0) continue
    const rank = run[0]?.rank ?? entry.cards[0].rank
    if (entry.cards.some(card => card.rank !== rank)) break
    run.push(...entry.cards)
  }
  return run
}

export function burnCleanupDelay(reduceMotion: boolean | null, reason?: BurnReason | null): number {
  return reduceMotion ? 140 : burnCleanupMs(reason)
}

interface BurnSnapshot {
  actionKey: string
  reason: BurnReason
  top: CardT | null
  pileCount: number
  effectiveRank: Rank | null
  /** Quartet: the four cards that made the set, top card first. */
  fan: CardT[] | null
}

interface BlindHold {
  key: string
  top: CardT | null
  pileCount: number
  effectiveRank: Rank | null
  /** A failed flip hands the pile to the player; their hand waits for the flip. */
  hand: CardT[] | null
}

function handFanRect(): FlightRect | null {
  const rect = document.querySelector('.hand-fan')?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
}

export interface PileSequenceArgs {
  state: GameState
  viewerId: string
  reduceMotion: boolean | null
  /** The pile as the authoritative state has it now. */
  top: CardT | null
  pileCount: number
  topRank: Rank | null
  /** The pile has started to burn. */
  onBurn: () => void
}

export function usePileSequence({
  state, viewerId, reduceMotion, top, pileCount, topRank, onBurn,
}: PileSequenceArgs) {
  const actionSeq = state.seq ?? state.turnCount

  // The table as it stood before the latest action: what a hold keeps showing.
  const previousPile = useRef({ top, pileCount, effectiveRank: topRank, run: topRunCards(state) })
  const previousPlayers = useRef(state.players)

  // ---- Blind flip ----
  // A face-down play is revealed by the flip, not by anything else on screen.
  // While it plays, the table behaves as if the action has not landed yet: no
  // input, no playable highlights, no turn ripple, and the taker's hand waits.
  const blindEvent = useMemo(() => {
    const event = latestAnimatedEvents(state.log).find(e => e.type === 'BLIND_REVEAL')
    return event?.type === 'BLIND_REVEAL'
      ? { key: `blind-${actionSeq}`, playerId: event.playerId, card: event.card, success: event.success }
      : null
  }, [state.log, actionSeq])
  const [dismissedBlind, setDismissedBlind] = useState<string | null>(() => blindEvent?.key ?? null)
  const blindActive = Boolean(blindEvent) && !reduceMotion && blindEvent?.key !== dismissedBlind

  // The reveal flies out of the slot the viewer tapped.
  const blindOrigin = useRef<FlightRect | null>(null)
  const rememberBlindOrigin = useCallback((cardId: string) => {
    blindOrigin.current = peekCardRect(cardId)
  }, [])
  const blindHold = useRef<BlindHold | null>(null)
  if (blindEvent && blindHold.current?.key !== blindEvent.key) {
    blindHold.current = {
      key: blindEvent.key,
      ...previousPile.current,
      hand: blindEvent.success
        ? null
        : previousPlayers.current.find(player => player.id === blindEvent.playerId)?.hand ?? null,
    }
  }
  const blind = useMemo<BlindRevealData | null>(() => {
    if (!blindEvent || !blindActive) return null
    const mine = blindEvent.playerId === viewerId
    const handRect = handFanRect()
    return {
      key: blindEvent.key,
      card: blindEvent.card,
      success: blindEvent.success,
      from: mine ? blindOrigin.current : peekSeatRect(blindEvent.playerId),
      toward: blindEvent.success ? null : mine ? handRect : peekSeatRect(blindEvent.playerId),
    }
    // Measured once, when a reveal starts: the rects must not follow re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blindEvent?.key, blindActive])
  const onBlindDone = useCallback((key: string) => setDismissedBlind(key), [])
  const held = blindActive ? blindHold.current : null
  /** The hand a player is still shown holding while their failed flip plays. */
  const heldHandOf = (playerId: string): CardT[] | null =>
    held?.hand && blindEvent?.playerId === playerId ? held.hand : null

  // ---- Burn ----
  const burnEvent = useMemo(() => {
    const events = latestAnimatedEvents(state.log)
    const clear = events.find(e => e.type === 'CLEAR_PILE')
    if (clear?.type !== 'CLEAR_PILE') return null
    const play = events.find(e => e.type === 'PLAY_CARDS')
    const cards = play?.type === 'PLAY_CARDS' ? play.cards : []
    return {
      // The first card of a play is the one on top of the pile (getTopCard).
      key: `${actionSeq}:${clear.reason}:${cards[0]?.id ?? 'empty'}`,
      reason: clear.reason,
      cards,
      blind: events.some(e => e.type === 'BLIND_REVEAL'),
    }
  }, [state.log, actionSeq])
  const burnHold = useRef<BurnSnapshot | null>(null)
  if (burnEvent && burnHold.current?.actionKey !== burnEvent.key) {
    const playedTop = burnEvent.cards[0] ?? previousPile.current.top
    burnHold.current = {
      actionKey: burnEvent.key,
      reason: burnEvent.reason,
      top: playedTop,
      pileCount: previousPile.current.pileCount + burnEvent.cards.length,
      effectiveRank: playedTop?.rank === '3' ? previousPile.current.effectiveRank : playedTop?.rank ?? null,
      fan: burnEvent.reason === 'quartet' ? [...burnEvent.cards, ...previousPile.current.run].slice(0, 4) : null,
    }
  }
  const [burnDoneKey, setBurnDoneKey] = useState<string | null>(() => burnEvent?.key ?? null)
  const [burnLandedKey, setBurnLandedKey] = useState<string | null>(null)
  // The burning pile as it was, from the card's arrival to the end of the burn.
  const burn = burnEvent && burnEvent.key !== burnDoneKey ? burnHold.current : null
  const burnKey = burn?.actionKey ?? null
  const burnNeedsArrival = Boolean(burnEvent) && !burnEvent?.blind && !reduceMotion
  const burning = Boolean(burn) && !blindActive && (!burnNeedsArrival || burnLandedKey === burnKey)
  const burnArriveMs = playArrivalMs(burnEvent?.cards.length ?? 1)
  useEffect(() => {
    if (!burnKey || !burnNeedsArrival) return
    const timer = setTimeout(() => setBurnLandedKey(burnKey), burnArriveMs)
    return () => clearTimeout(timer)
  }, [burnKey, burnNeedsArrival, burnArriveMs])
  const burningKey = burning ? burnKey : null
  const burnReason = burn?.reason
  useEffect(() => {
    if (!burningKey) return
    onBurn()
    const timer = setTimeout(() => setBurnDoneKey(burningKey), burnCleanupDelay(reduceMotion, burnReason))
    return () => clearTimeout(timer)
    // One timer per burn: it must not restart when anything else changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burningKey])

  // ---- Pick-up ----
  // A failed blind flip has its own sweep, so it is excluded here.
  const pickupEvent = useMemo(() => {
    const events = latestAnimatedEvents(state.log)
    const pickup = events.find(e => e.type === 'PICK_UP_PILE')
    if (pickup?.type !== 'PICK_UP_PILE' || events.some(e => e.type === 'BLIND_REVEAL')) return null
    return { key: `pickup-${actionSeq}`, playerId: pickup.playerId }
  }, [state.log, actionSeq])
  const [dismissedPickup, setDismissedPickup] = useState<string | null>(() => pickupEvent?.key ?? null)
  const pickupHold = useRef<{ key: string; top: CardT | null; pileCount: number } | null>(null)
  if (pickupEvent && pickupHold.current?.key !== pickupEvent.key) {
    pickupHold.current = { key: pickupEvent.key, top: previousPile.current.top, pileCount: previousPile.current.pileCount }
  }
  const sweepActive = Boolean(pickupEvent) && !reduceMotion && pickupEvent?.key !== dismissedPickup
  const sweep = useMemo<PileSweepData | null>(() => {
    const hold = pickupHold.current
    if (!pickupEvent || !sweepActive || !hold?.top) return null
    const handRect = handFanRect()
    return {
      key: pickupEvent.key,
      card: hold.top,
      count: hold.pileCount,
      takerId: pickupEvent.playerId,
      toward: pickupEvent.playerId === viewerId ? handRect : peekSeatRect(pickupEvent.playerId),
    }
    // Measured once, when a sweep starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupEvent?.key, sweepActive])
  const onSweepDone = useCallback((key: string) => setDismissedPickup(key), [])

  // ---- Flights ----
  const latestPlay = useMemo(() => {
    const play = latestAnimatedEvents(state.log).find(event => event.type === 'PLAY_CARDS')
    return play?.type === 'PLAY_CARDS' ? play : null
  }, [state.log])
  // Who played the card now on top; an opponent's seat is its flight origin.
  const playedBy = latestPlay && latestPlay.playerId !== viewerId ? latestPlay.playerId : null
  // A multi-card play lands as a quick staggered sequence, top card last.
  const group = latestPlay && latestPlay.cards.length > 1 ? latestPlay.cards : null
  // Cards that just arrived in the viewer's hand fly in from the stock (draw)
  // or the pile (pick-up).
  const handEntryFrom = useMemo<'stock' | 'pile' | null>(() => {
    const events = latestAnimatedEvents(state.log)
    if (events.some(e => e.type === 'PICK_UP_PILE' && e.playerId === viewerId)) return 'pile'
    if (events.some(e => e.type === 'DRAW' && e.playerId === viewerId)) return 'stock'
    return null
  }, [state.log, viewerId])

  useEffect(() => {
    previousPile.current = { top, pileCount, effectiveRank: topRank, run: topRunCards({ pile: state.pile }) }
    previousPlayers.current = state.players
  }, [top, pileCount, topRank, state.pile, state.players])

  const shown = held ?? burn
  const pile = {
    top: shown ? shown.top : top,
    pileCount: shown ? shown.pileCount : pileCount,
    effectiveRank: shown ? shown.effectiveRank : topRank,
    burning: burning && !held,
    burnKey: burn?.actionKey,
    burnReason: burn?.reason,
    burnFan: burn?.fan,
    blind,
    onBlindDone,
    sweep,
    onSweepDone,
    suppressEntryId: blindEvent?.success ? blindEvent.card.id : null,
    playedBy,
    group,
    mirrorOf: shown ? null : getMirroredCard(state),
  } satisfies Partial<PileAreaProps>

  return {
    /** A face-down flip is playing; the action behind it is not on screen yet. */
    blindActive,
    rememberBlindOrigin,
    heldHandOf,
    handEntryFrom,
    /** The burn itself is playing: its card has landed and no flip is in the way. */
    burning,
    /** Everything PileArea needs to show the pile at this point of the action. */
    pile,
  }
}
