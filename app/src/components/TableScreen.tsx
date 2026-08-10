// ============================================================================
// TableScreen — THE shared play/endgame table (DESIGN.md §3.1), used by both
// SP and MP (§9 refactor note: the two tables converge on the same
// components). Z3/Z4 are pinned to the viewer ("me"); opponents only ever
// render as backs + counts in the OpponentStrip (Appendix A.1).
//
// Interaction model (§6.1): tap-select → explicit PLAY button. No action ever
// fires on a single tap of a card. Invalid taps shake + explain in the feed.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup, useReducedMotion } from 'framer-motion'
import type { Card as CardT, GameState } from '../engine'
import { canPlay, getInterruptBurnCards, getPhysicalTopRun, getQuickFollowUpCards, getTopCard, getTopRank, pileSize } from '../engine'
import { CardDefs, type CardVisualState } from './Card'
import { OpponentStrip, orderSeats, SpatialTurnMarker, type Seat } from './OpponentStrip'
import { PileArea } from './PileArea'
import { ActionFeed } from './ActionFeed'
import { HandFan } from './HandFan'
import { TableauWell } from './TableauWell'
import { ActionBar } from './ActionBar'
import { QuietMenu } from './QuietMenu'
import { Announcer, useAnnouncer } from './Announcer'
import { feedLine, latestActionEvents, type FeedContext } from './feedText'
import { useSoundFromLog, emitSoundDebounced } from './soundManager'
import {
  BroadcastFeedback,
  EmoteButton,
  EmoteFeedback,
  SystemEventFeedback,
} from './EmoteButton'
import type {
  BroadcastEvent,
  BroadcastId,
  EmoteEvent,
  EmoteId,
  SystemEvent,
} from '../engine/protocol'
import { SpecialEffectFeedback, specialEffectFromEvents, type SpecialEffect } from './SpecialEffectFeedback'

export interface TableScreenProps {
  state: GameState
  /** Whose cards Z3/Z4 render (pinned to the local player; hot-seat gate may
      deliberately switch after a privacy reveal — never per-turn). */
  viewerId: string
  /** True when it is the viewer's turn AND the viewer may act (not AI). */
  viewerActive: boolean
  /** Server-side error text to surface in the feed (MP). */
  error?: string | null
  onPlay: (cards: CardT[]) => void
  /** Race-safe one-card continuation after drawing the rank just played. */
  onQuickFollowUp?: (card: CardT) => void
  /** Local hot-seat hand-off when the previous player declines the race. */
  onDeclineQuickFollowUp?: () => void
  quickFollowUpDeclineLabel?: string
  /** Out-of-turn completion of the physical top run to four or more. */
  onBurnIn?: (cards: CardT[]) => void
  onPickUp: () => void
  onLeave: () => void
  onOpenRules: () => void
  soundOn: boolean
  onToggleSound: () => void
  connectionBadge?: React.ReactNode
  seatOffline?: (playerId: string) => boolean
  /** Multiplayer supplies room events; single-player still gets local feedback. */
  latestEmote?: EmoteEvent | null
  onSendEmote?: (emote: EmoteId) => void
  latestBroadcast?: BroadcastEvent | null
  onSendBroadcast?: (broadcast: BroadcastId) => void
  /** Server-authored table notices and the deliberately rare Ondra easter egg. */
  latestSystemEvent?: SystemEvent | null
}

type Zone = 'hand' | 'faceUp' | 'faceDown'

interface BurnSnapshot {
  actionKey: string
  top: CardT | null
  pileCount: number
  effectiveRank: ReturnType<typeof getTopRank>
}

export function burnCleanupDelay(reduceMotion: boolean | null): number {
  return reduceMotion ? 140 : 560
}

/**
 * Same-rank cards form a multi-play. Choosing another playable rank replaces
 * the whole set in one tap, so the interface never traps the user behind a
 * separate "unselect" step.
 */
export function nextRankSelection(selection: string[], tapped: CardT, cards: CardT[]): string[] {
  if (selection.includes(tapped.id)) return selection.filter(id => id !== tapped.id)
  const selected = cards.find(card => selection.includes(card.id))
  if (selected && selected.rank !== tapped.rank) return [tapped.id]
  return [...selection, tapped.id]
}

export function isMatchingSelfEmoteEcho(
  pending: { emote: EmoteId; sentAt: number } | null,
  latest: EmoteEvent,
  viewerId: string,
  now = Date.now(),
): boolean {
  return Boolean(
    pending &&
    latest.playerId === viewerId &&
    latest.emote === pending.emote &&
    now - pending.sentAt >= 0 && now - pending.sentAt < 2500,
  )
}

export function isMatchingSelfBroadcastEcho(
  pending: { broadcast: BroadcastId; sentAt: number } | null,
  latest: BroadcastEvent,
  viewerId: string,
  now = Date.now(),
): boolean {
  return Boolean(
    pending &&
    latest.playerId === viewerId &&
    latest.broadcast === pending.broadcast &&
    now - pending.sentAt >= 0 && now - pending.sentAt < 2500,
  )
}

export const REACTION_CLIENT_COOLDOWN_MS = 800

export function canSendReaction(lastSentAt: number | null, now = Date.now()): boolean {
  return lastSentAt === null || now - lastSentAt >= REACTION_CLIENT_COOLDOWN_MS
}

function activeZoneOf(p: { hand: CardT[]; faceUp: CardT[]; faceDown: CardT[] }): Zone {
  if (p.hand.length > 0) return 'hand'
  if (p.faceUp.length > 0) return 'faceUp'
  return 'faceDown'
}

export function TableScreen({
  state, viewerId, viewerActive, error, onPlay, onQuickFollowUp,
  onDeclineQuickFollowUp, quickFollowUpDeclineLabel = 'Pass', onBurnIn, onPickUp, onLeave, onOpenRules,
  soundOn, onToggleSound, connectionBadge, seatOffline, latestEmote, onSendEmote,
  latestBroadcast, onSendBroadcast, latestSystemEvent,
}: TableScreenProps) {
  const viewer = state.players.find(p => p.id === viewerId)
  const current = state.players[state.currentPlayerIdx]
  const top = getTopCard(state)
  const topRank = getTopRank(state)
  const ps = pileSize(state)

  const [selection, setSelection] = useState<string[]>([])
  const [invalidId, setInvalidId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)     // transient feed copy (errors, guards)
  const [pickupArmed, setPickupArmed] = useState(false)
  const [dismissedQuickSourceSeq, setDismissedQuickSourceSeq] = useState<number | null>(null)
  const [burning, setBurning] = useState(false)
  const [burnSnapshot, setBurnSnapshot] = useState<BurnSnapshot | null>(null)
  const [specialEffect, setSpecialEffect] = useState<SpecialEffect | null>(null)
  const [displayedEmote, setDisplayedEmote] = useState<EmoteEvent | null>(null)
  const [displayedBroadcast, setDisplayedBroadcast] = useState<BroadcastEvent | null>(null)
  const pendingSelfEmote = useRef<{ emote: EmoteId; sentAt: number } | null>(null)
  const pendingSelfBroadcast = useRef<{ broadcast: BroadcastId; sentAt: number } | null>(null)
  const lastReactionSentAt = useRef<number | null>(null)
  const debounceRef = useRef(0)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const burnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const burnGenerationRef = useRef(0)
  const announcer = useAnnouncer()
  const reduceMotion = useReducedMotion()

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    burnGenerationRef.current += 1
    if (burnTimerRef.current !== null) clearTimeout(burnTimerRef.current)
  }, [])

  // ---- Derived ----
  const zone: Zone | null = viewer ? activeZoneOf(viewer) : null
  const zoneCards: CardT[] = viewer ? viewer[zone ?? 'hand'] : []
  const playableNow = useCallback(
    (c: CardT) => canPlay(c, topRank),
    [topRank],
  )
  const anyPlayable = viewerActive && zone !== 'faceDown' && zoneCards.some(playableNow)

  const selectedCards = useMemo(
    () => zoneCards.filter(c => selection.includes(c.id)),
    [zoneCards, selection],
  )
  const selectedRank = selectedCards[0]?.rank ?? null
  const interruptCards = useMemo(
    () => (!viewerActive && onBurnIn ? getInterruptBurnCards(state, viewerId) : []),
    [state, viewerId, viewerActive, onBurnIn],
  )
  const interruptIds = useMemo(() => new Set(interruptCards.map(card => card.id)), [interruptCards])
  const quickFollowUpCards = useMemo(
    () => (onQuickFollowUp ? getQuickFollowUpCards(state, viewerId) : []),
    [state, viewerId, onQuickFollowUp],
  )
  const quickFollowUpIds = useMemo(() => new Set(quickFollowUpCards.map(card => card.id)), [quickFollowUpCards])
  const physicalRun = getPhysicalTopRun(state)
  const canBurnIn = interruptCards.length > 0 && physicalRun !== null
  const canQuickFollowUp = quickFollowUpCards.length > 0
  const quickSourceSeq = state.pendingQuickFollowUp?.playerId === viewerId
    ? state.pendingQuickFollowUp.sourceSeq
    : null
  const showQuickFollowUp = canQuickFollowUp && dismissedQuickSourceSeq !== quickSourceSeq

  // ---- Feed: transient flash > server error > latest table event ----
  // Turn ownership has a persistent, spatial cue in the header/opponent seat.
  // Repeating "Your turn" here turns the feed into a second status badge and
  // pushes the last useful table event out of view.
  const feedCtx: FeedContext = { meId: viewerId, players: state.players }
  const lastEvent = feedLine(state, feedCtx)
  const isViewerTurn = current?.id === viewerId
  const feed = flash
    ? { text: flash, key: `flash-${flash}`, tone: 'error' as const }
    : error
      ? { text: error, key: `err-${error}`, tone: 'error' as const }
      : lastEvent
        ? { text: lastEvent.text, key: lastEvent.key, tone: 'normal' as const }
        : { text: null, key: 'idle', tone: 'normal' as const }

  // ---- Effects: burn detection, announcements, sounds, turn announce ----
  const lastActionSeq = useRef(state.seq ?? state.turnCount)
  const previousPile = useRef({ top, pileCount: ps, effectiveRank: topRank })
  useEffect(() => {
    const cursor = state.seq ?? state.turnCount
    if (lastActionSeq.current === cursor) return
    lastActionSeq.current = cursor
    const fresh = latestActionEvents(state.log)
    if (fresh.length === 0) return
    const clear = fresh.find(e => e.type === 'CLEAR_PILE')
    if (clear?.type === 'CLEAR_PILE') {
      const burnPlay = fresh.find(event => event.type === 'PLAY_CARDS')
      const playedTop = burnPlay?.type === 'PLAY_CARDS'
        ? burnPlay.cards[burnPlay.cards.length - 1] ?? previousPile.current.top
        : previousPile.current.top
      const actionKey = `${cursor}:${clear.reason}:${playedTop?.id ?? 'empty'}`
      const generation = burnGenerationRef.current + 1
      burnGenerationRef.current = generation
      if (burnTimerRef.current !== null) clearTimeout(burnTimerRef.current)
      setBurnSnapshot({
        actionKey,
        top: playedTop,
        pileCount: previousPile.current.pileCount + (burnPlay?.type === 'PLAY_CARDS' ? burnPlay.cards.length : 0),
        effectiveRank: playedTop?.rank === '3' ? previousPile.current.effectiveRank : playedTop?.rank ?? null,
      })
      setBurning(true)
      burnTimerRef.current = setTimeout(() => {
        if (burnGenerationRef.current !== generation) return
        setBurning(false)
        setBurnSnapshot(snapshot => snapshot?.actionKey === actionKey ? null : snapshot)
        burnTimerRef.current = null
      }, burnCleanupDelay(reduceMotion))
    }
    setSpecialEffect(specialEffectFromEvents(fresh, cursor, topRank))
    const ctx: FeedContext = { meId: viewerId, players: state.players }
    const line = feedLine(state, ctx)
    if (line) announcer.sayPolite(line.text)
    if (fresh.some(e => e.type === 'GAME_OVER')) {
      const loser = state.players.find(p => p.id === state.loserId)
      announcer.sayPolite(`Round over. ${loser?.name ?? ''} is the Shithead.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq, state.turnCount, state.log])

  useEffect(() => {
    previousPile.current = { top, pileCount: ps, effectiveRank: topRank }
  }, [top, ps, topRank])

  const lastTurnKey = useRef('')
  useEffect(() => {
    const key = `${current?.id}-${state.turnCount}`
    if (key === lastTurnKey.current) return
    lastTurnKey.current = key
    if (!current) return
    if (current.id === viewerId && viewerActive) {
      announcer.sayPolite('Your turn')
      emitSoundDebounced('turn_yours')
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(12)
    } else {
      announcer.sayPolite(`${current.name}'s turn`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, state.turnCount, viewerId, viewerActive])

  useSoundFromLog(state, soundOn)

  useEffect(() => {
    if (!latestEmote) return
    const pending = pendingSelfEmote.current
    if (isMatchingSelfEmoteEcho(pending, latestEmote, viewerId)) {
      pendingSelfEmote.current = null
      return
    }
    setDisplayedEmote(latestEmote)
  }, [latestEmote, viewerId])

  useEffect(() => {
    if (!latestBroadcast) return
    const pending = pendingSelfBroadcast.current
    if (isMatchingSelfBroadcastEcho(pending, latestBroadcast, viewerId)) {
      pendingSelfBroadcast.current = null
      return
    }
    setDisplayedBroadcast(latestBroadcast)
  }, [latestBroadcast, viewerId])

  // Surface external (server) errors assertively.
  useEffect(() => { if (error) announcer.sayAssertive(error) }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selection is invalid when the zone/turn changes — reset.
  useEffect(() => {
    setSelection(sel => sel.filter(id => zoneCards.some(c => c.id === id)))
    setPickupArmed(false)
  }, [zone, viewerId, state.turnCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Actions ----
  const explain = (text: string, cardId?: string) => {
    setFlash(text)
    announcer.sayAssertive(text)
    if (cardId) {
      setInvalidId(cardId)
      emitSoundDebounced('invalid')
      later(300, () => setInvalidId(null))
    }
    later(3000, () => setFlash(f => (f === text ? null : f)))
  }

  const commitPlay = () => {
    if (selectedCards.length === 0) return
    if (Date.now() - debounceRef.current < 300) return // §6.3 input debounce
    debounceRef.current = Date.now()
    emitSoundDebounced(selectedCards.length > 1 ? 'play_multi' : 'play')
    setSelection([])
    setPickupArmed(false)
    onPlay(selectedCards)
  }

  const commitPickup = () => {
    if (!viewerActive || ps === 0) return
    if (Date.now() - debounceRef.current < 300) return
    // Picking up is always a separate intent; never leave a stale play set.
    setSelection([])
    if (anyPlayable && !pickupArmed) {
      // §6.1: guard — second confirming tap within 3s.
      setPickupArmed(true)
      setFlash('Pick up anyway? — tap again')
      later(3000, () => setPickupArmed(false))
      later(3000, () => setFlash(f => (f === 'Pick up anyway? — tap again' ? null : f)))
      return
    }
    debounceRef.current = Date.now()
    setPickupArmed(false)
    onPickUp()
  }

  const commitBurnIn = () => {
    if (!canBurnIn || !onBurnIn) return
    if (Date.now() - debounceRef.current < 300) return
    debounceRef.current = Date.now()
    emitSoundDebounced('burn')
    setSelection([])
    setPickupArmed(false)
    onBurnIn(interruptCards)
  }

  const commitQuickFollowUp = () => {
    const card = quickFollowUpCards[0]
    if (!card || !onQuickFollowUp) return
    if (Date.now() - debounceRef.current < 300) return
    debounceRef.current = Date.now()
    emitSoundDebounced('play')
    setSelection([])
    setPickupArmed(false)
    onQuickFollowUp(card)
  }

  const dismissQuickFollowUp = () => {
    if (quickSourceSeq === null) return
    setDismissedQuickSourceSeq(quickSourceSeq)
    setFlash('Quick match skipped — take your turn')
    later(2200, () => setFlash(value => value === 'Quick match skipped — take your turn' ? null : value))
  }

  const sendEmote = (emote: EmoteId) => {
    const sentAt = Date.now()
    if (!canSendReaction(lastReactionSentAt.current, sentAt)) return
    lastReactionSentAt.current = sentAt
    const event: EmoteEvent = { playerId: viewerId, emote, ts: sentAt }
    if (onSendEmote) pendingSelfEmote.current = { emote, sentAt }
    setDisplayedEmote(event)
    onSendEmote?.(emote)
  }

  const sendBroadcast = (broadcast: BroadcastId) => {
    const sentAt = Date.now()
    if (!canSendReaction(lastReactionSentAt.current, sentAt)) return
    lastReactionSentAt.current = sentAt
    const event: BroadcastEvent = { playerId: viewerId, broadcast, ts: sentAt }
    if (onSendBroadcast) pendingSelfBroadcast.current = { broadcast, sentAt }
    setDisplayedBroadcast(event)
    onSendBroadcast?.(broadcast)
  }

  const tapCard = (card: CardT, cardZone: Zone) => {
    if (!viewerActive) return
    setPickupArmed(false)
    if (cardZone !== zone) return // only the active zone is live (D6)
    if (zone === 'faceDown') {
      // Blind plays are single cards (D7): tap toggles a single selection.
      const isSelected = selection.includes(card.id)
      setSelection(isSelected ? [] : [card.id])
      emitSoundDebounced(isSelected ? 'deselect' : 'select')
      return
    }

    if (!playableNow(card)) {
      explain(
        topRank
          ? `${card.rank === 'JOKER' ? 'The Joker' : `The ${card.rank}`} cannot be played on the ${topRank}`
          : 'That card cannot be played now',
        card.id,
      )
      return
    }
    const next = nextRankSelection(selection, card, zoneCards)
    if (next === selection) {
      explain('Four cards maximum per play', card.id)
      return
    }
    setSelection(next)
    emitSoundDebounced(selection.includes(card.id) ? 'deselect' : 'select')
  }

  // Stable, ref-routed activators — Card's memo ignores onActivate, so these
  // must never go stale semantically (they always read the latest render).
  const latest = useRef({ viewer, zone, tapCard })
  latest.current = { viewer, zone, tapCard }
  const onHandId = useCallback((id: string) => {
    const l = latest.current
    const c = l.viewer?.hand.find(x => x.id === id)
    if (c) l.tapCard(c, 'hand')
  }, [])
  const onFaceUpId = useCallback((id: string) => {
    const l = latest.current
    const c = l.viewer?.faceUp.find(x => x.id === id)
    if (c) l.tapCard(c, 'faceUp')
  }, [])
  const onFaceDownId = useCallback((id: string) => {
    const l = latest.current
    const c = l.viewer?.faceDown.find(x => x.id === id)
    if (c) l.tapCard(c, 'faceDown')
  }, [])
  const states = new Map<string, CardVisualState>()
  const hints = new Map<string, string>()
  if (viewer) {
    for (const c of [...viewer.hand, ...viewer.faceUp]) {
      if (selection.includes(c.id)) {
        states.set(c.id, 'selected')
        hints.set(c.id, 'selected')
        continue
      }
      if (quickFollowUpIds.has(c.id)) {
        states.set(c.id, 'joinable')
        hints.set(c.id, 'drawn match, quick follow-up available')
        continue
      }
      if (!viewerActive) {
        if (interruptIds.has(c.id)) {
          states.set(c.id, 'joinable')
          hints.set(c.id, 'can burn in now')
        } else {
          states.set(c.id, 'rest')
        }
        continue
      }
      const inZone = zone !== 'faceDown' && zoneCards.some(z => z.id === c.id)
      if (!inZone) { states.set(c.id, 'rest'); continue }
      if (invalidId === c.id) { states.set(c.id, 'invalid'); hints.set(c.id, 'not playable'); continue }
      if (playableNow(c)) {
        if (selectedRank && c.rank !== selectedRank) { states.set(c.id, 'playable'); hints.set(c.id, 'playable, replaces selection') }
        else if (selectedRank) { states.set(c.id, 'joinable'); hints.set(c.id, 'playable') }
        else { states.set(c.id, 'playable'); hints.set(c.id, 'playable') }
      } else {
        states.set(c.id, 'disabled')
        hints.set(c.id, 'not playable')
      }
    }
  }
  const downStates = new Map<string, CardVisualState>()
  const downHints = new Map<string, string>()
  if (viewer && viewerActive && zone === 'faceDown') {
    for (const c of viewer.faceDown) {
      downStates.set(c.id, selection.includes(c.id) ? 'selected' : 'playable')
      downHints.set(c.id, selection.includes(c.id) ? 'selected' : 'blind play')
    }
  }

  // ---- Seats ----
  const seats: Seat[] = orderSeats(state.players, viewerId).map(p => ({
    player: p,
    faceUp: p.faceUp,
    handCount: p.hand.length,
    faceDownCount: p.faceDown.length,
    offline: seatOffline?.(p.id) ?? false,
  }))

  // ---- Keyboard (§6.5): P play, U pick up, Esc clear ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      const editing = target instanceof Element && Boolean(target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      ))
      if (editing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return
      if (e.key === 'Escape') setSelection([])
      if ((e.key === 'q' || e.key === 'Q') && showQuickFollowUp) commitQuickFollowUp()
      if ((e.key === 'b' || e.key === 'B') && canBurnIn) commitBurnIn()
      if (!viewerActive) return
      if (e.key === 'p' || e.key === 'P') commitPlay()
      if (e.key === 'u' || e.key === 'U') commitPickup()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!viewer) return null

  const endgameZoneLive = (viewerActive || canBurnIn) && (zone === 'faceUp' || zone === 'faceDown')
  const emotePlayer = displayedEmote
    ? state.players.find(player => player.id === displayedEmote.playerId)?.name
    : undefined
  const broadcastPlayer = displayedBroadcast
    ? state.players.find(player => player.id === displayedBroadcast.playerId)?.name
    : undefined
  const visibleSystemEvent = latestSystemEvent?.kind === 'ondra-mode' && state.phase === 'gameOver'
    ? null
    : latestSystemEvent ?? null

  return (
    <div
      className="app-viewport last-call-screen game-screen bg-felt text-cream flex flex-col table-select-none"
      data-game-phase={state.phase}
      data-viewer-active={viewerActive ? 'true' : 'false'}
      data-active-zone={zone ?? undefined}
      data-selection-count={selection.length}
    >
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />
      <div className="table-reaction-feedback-stack" aria-label="Table reactions">
        <SystemEventFeedback event={visibleSystemEvent} />
        <BroadcastFeedback event={displayedBroadcast} playerName={broadcastPlayer} />
        <EmoteFeedback event={displayedEmote} playerName={emotePlayer} />
      </div>

      <LayoutGroup id={`table-turn-${viewerId}`}>
      <div className="game-shell table-shell">
      <header className="game-header table-header">
        <div className="game-topbar table-topbar">
          <div className="game-connection table-connection">{connectionBadge}</div>
          <div
            className="game-turn-label table-turn-label"
            data-my-turn={isViewerTurn && viewerActive ? 'true' : 'false'}
            aria-current={isViewerTurn && viewerActive ? 'step' : undefined}
            aria-label={isViewerTurn && viewerActive
              ? 'Your turn'
              : `${current?.name ?? 'Table'}'s turn`}
          >
            <span className="table-turn-label__indicator" aria-hidden="true" />
            <span className="table-turn-label__copy">
              <span className="table-turn-label__eyebrow" aria-hidden="true">Turn</span>
              <strong className="table-turn-label__name">
                {isViewerTurn && viewerActive ? 'Your move' : current?.name ?? 'Table'}
              </strong>
            </span>
          </div>
          <div className="game-tools table-tools" aria-label="Table controls">
            <EmoteButton onSend={sendEmote} onSendBroadcast={sendBroadcast} />
            <QuietMenu
              onOpenRules={onOpenRules}
              soundOn={soundOn}
              onToggleSound={onToggleSound}
              onLeave={onLeave}
              matchRunning
            />
          </div>
        </div>
        <OpponentStrip
          seats={seats}
          activeSeatId={current?.id ?? null}
          turnMarkerLayoutId={reduceMotion ? undefined : 'active-turn-marker'}
        />
      </header>

      <main
        className="game-center table-playfield"
        aria-label="Play area"
        data-empty-pile={ps === 0 ? 'true' : 'false'}
        onClick={() => { setSelection([]); setPickupArmed(false) }}
      >
        <div
          className="table-pile-stage"
          data-burning={burning ? 'true' : 'false'}
          data-burn-key={burnSnapshot?.actionKey}
        >
          <SpecialEffectFeedback effect={specialEffect} />
          <PileArea
            stockCount={state.stock.length}
            top={burning && burnSnapshot ? burnSnapshot.top : top}
            pileCount={burning && burnSnapshot ? burnSnapshot.pileCount : ps}
            effectiveRank={burning && burnSnapshot ? burnSnapshot.effectiveRank : topRank}
            burning={burning}
            burnKey={burnSnapshot?.actionKey}
            specialEffect={specialEffect}
            teachHint={ps === 0 && viewerActive}
          />
        </div>
        <div className="game-feed table-feed">
          <ActionFeed text={feed.text} feedKey={feed.key} tone={feed.tone} />
        </div>
      </main>

      {/* Z3 — tableau well */}
      <TableauWell
        faceUp={viewer.faceUp}
        faceDown={viewer.faceDown}
        fullSize={endgameZoneLive}
        faceUpStates={states}
        faceUpHints={hints}
        faceDownStates={downStates}
        faceDownHints={downHints}
        onActivateFaceUp={viewerActive && zone === 'faceUp' ? onFaceUpId : undefined}
        onActivateFaceDown={viewerActive && zone === 'faceDown' ? onFaceDownId : undefined}
      />

      {/* Z4 — ActionBar + hand fan, flush to safe-area bottom */}
      <footer
        className="app-bottom-zone game-footer table-hand-zone"
        data-hand-count={viewer.hand.length}
        data-active-zone={zone ?? undefined}
      >
        {isViewerTurn && viewerActive && (
          <SpatialTurnMarker
            owner="local"
            label="Your move"
            className="table-hand-zone__turn-marker"
            layoutId={reduceMotion ? undefined : 'active-turn-marker'}
          />
        )}
        <div className="table-hand-zone__inner" onClick={e => e.stopPropagation()}>
          {(viewerActive || canBurnIn || canQuickFollowUp) && (
            <ActionBar
              selectionCount={selection.length}
              canPickUp={viewerActive && ps > 0}
              pickupArmed={pickupArmed}
              onPlay={commitPlay}
              onPickUp={commitPickup}
              quickFollowUp={showQuickFollowUp ? {
                count: quickFollowUpCards.length,
                rank: quickFollowUpCards[0].rank,
              } : undefined}
              onQuickFollowUp={showQuickFollowUp ? commitQuickFollowUp : undefined}
              onDismissQuickFollowUp={showQuickFollowUp
                ? viewerActive ? dismissQuickFollowUp : onDeclineQuickFollowUp
                : undefined}
              dismissQuickFollowUpLabel={viewerActive ? 'Normal turn' : quickFollowUpDeclineLabel}
              burnIn={canBurnIn && physicalRun ? { count: interruptCards.length, rank: physicalRun.rank } : undefined}
              onBurnIn={canBurnIn ? commitBurnIn : undefined}
            />
          )}
          <HandFan
            cards={viewer.hand}
            states={states}
            ariaHints={hints}
            onSelect={viewerActive && zone === 'hand' ? onHandId : undefined}
          />
        </div>
      </footer>
      </div>
      </LayoutGroup>
    </div>
  )
}
