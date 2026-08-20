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
import { useSoundFromLog, emitSoundDebounced, type AdhdAlertSound } from './soundManager'
import {
  BroadcastFeedback,
  ChatFeedback,
  EmoteButton,
  EmoteFeedback,
  SystemEventFeedback,
} from './EmoteButton'
import type {
  BroadcastEvent,
  BroadcastId,
  ChatEvent,
  EmoteEvent,
  EmoteId,
  SystemEvent,
} from '../engine/protocol'
import {
  acceptedCustomMessageBurst,
  CUSTOM_MESSAGE_BURST_LIMIT,
  CUSTOM_MESSAGE_BURST_WINDOW_MS,
  isValidChatText,
  normalizeChatText,
} from '../engine/protocol'
import { SpecialEffectFeedback, specialEffectFromEvents, type SpecialEffect } from './SpecialEffectFeedback'
import { TurnAttentionBeacon } from './turnAlerts'
import { SpectatorIndicator } from './SpectatorIndicator'

export interface TableScreenProps {
  state: GameState
  /** Whose cards Z3/Z4 render (pinned to the local player; hot-seat gate may
      deliberately switch after a privacy reveal — never per-turn). */
  viewerId: string
  /** True when it is the viewer's turn AND the viewer may act (not AI). */
  viewerActive: boolean
  /** Dedicated read-only view for an authenticated queued spectator. */
  spectating?: boolean
  /** Connected queued spectators; displayed only to seated players. */
  spectatorCount?: number
  /** False while multiplayer is waiting for a fresh post-auth snapshot. */
  actionsEnabled?: boolean
  /** Synchronous transport-epoch guard for the disconnect transition before
      the actionsEnabled render catches up. */
  canSubmitAction?: () => boolean
  /** Optional in-memory bridge used by the multiplayer wrapper to retain a
      local draft while the table is temporarily unmounted by offline UI. */
  initialSelectionDraft?: string[]
  onSelectionDraftChange?: (selection: string[]) => void
  /** Server-side error text to surface in the feed (MP). */
  error?: string | null
  onPlay: (cards: CardT[]) => void | boolean
  /** Race-safe one-card continuation after drawing the rank just played. */
  onQuickFollowUp?: (card: CardT) => void | boolean
  /** Local hot-seat hand-off when the previous player declines the race. */
  onDeclineQuickFollowUp?: () => void
  quickFollowUpDeclineLabel?: string
  /** Out-of-turn completion of the physical top run to four or more. */
  onBurnIn?: (cards: CardT[]) => void | boolean
  onPickUp: () => void | boolean
  onLeave: () => void
  onOpenRules: () => void
  soundOn: boolean
  onToggleSound: () => void
  turnAlertsEnabled?: boolean
  onToggleTurnAlerts?: () => void
  repeatTurnAlertsEnabled?: boolean
  onToggleRepeatTurnAlerts?: () => void
  adhdMode?: boolean
  onToggleAdhdMode?: () => void
  adhdSound?: AdhdAlertSound
  onSelectAdhdSound?: (sound: AdhdAlertSound) => void
  attentionAlertActive?: boolean
  /** Authoritative multiplayer room option; only the host gets a callback. */
  easterEggEnabled?: boolean
  onToggleEasterEgg?: () => void
  connectionBadge?: React.ReactNode
  seatOffline?: (playerId: string) => boolean
  /** Multiplayer supplies room events; single-player still gets local feedback. */
  latestEmote?: EmoteEvent | null
  onSendEmote?: (emote: EmoteId) => void | boolean
  latestBroadcast?: BroadcastEvent | null
  onSendBroadcast?: (broadcast: BroadcastId) => void | boolean
  latestChat?: ChatEvent | null
  onSendChat?: (text: string) => void | boolean
  /** Accepted custom messages owned by this viewer in the current session. */
  recentCustomMessages?: readonly string[]
  /** Local-only receipt used by GameTable to retain per-viewer history. */
  onLocalChatAccepted?: (text: string) => void
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

/**
 * Revalidate a local hand/face-up draft against the latest authoritative pile.
 * A multi-card choice is atomic: ownership, rank, or legality changes clear the
 * complete draft rather than silently playing only the surviving subset.
 */
export function reconcilePlayableSelection(
  selection: string[],
  cards: CardT[],
  topRank: ReturnType<typeof getTopRank>,
): string[] {
  if (selection.length === 0) return selection
  if (new Set(selection).size !== selection.length) return []
  const byId = new Map(cards.map(card => [card.id, card] as const))
  const selected = selection.flatMap(id => {
    const card = byId.get(id)
    return card ? [card] : []
  })
  if (selected.length !== selection.length) return []
  if (selected.some(card => card.rank !== selected[0].rank)) return []
  if (selected.some(card => !canPlay(card, topRank))) return []
  return selection
}

function sameSelection(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
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
  state, viewerId, viewerActive, spectating = false, spectatorCount = 0,
  actionsEnabled = true, canSubmitAction = () => true,
  initialSelectionDraft = [], onSelectionDraftChange,
  error, onPlay, onQuickFollowUp,
  onDeclineQuickFollowUp, quickFollowUpDeclineLabel = 'Pass', onBurnIn, onPickUp, onLeave, onOpenRules,
  soundOn, onToggleSound,
  turnAlertsEnabled = true, onToggleTurnAlerts,
  repeatTurnAlertsEnabled = false, onToggleRepeatTurnAlerts,
  adhdMode = false, onToggleAdhdMode, adhdSound = 'beat', onSelectAdhdSound, attentionAlertActive = false,
  easterEggEnabled, onToggleEasterEgg,
  connectionBadge, seatOffline, latestEmote, onSendEmote,
  latestBroadcast, onSendBroadcast, latestChat, onSendChat,
  recentCustomMessages = [], onLocalChatAccepted, latestSystemEvent,
}: TableScreenProps) {
  const viewer = state.players.find(p => p.id === viewerId)
  const current = state.players[state.currentPlayerIdx]
  const top = getTopCard(state)
  const topRank = getTopRank(state)
  const ps = pileSize(state)

  const [selection, setSelectionState] = useState<string[]>(() => [...initialSelectionDraft])
  const selectionRef = useRef(selection)
  const selectionZoneRef = useRef<Zone | null>(null)
  const [invalidId, setInvalidId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)     // transient feed copy (errors, guards)
  const [pickupArmed, setPickupArmed] = useState(false)
  const [dismissedQuickSourceSeq, setDismissedQuickSourceSeq] = useState<number | null>(null)
  const [burning, setBurning] = useState(false)
  const [burnSnapshot, setBurnSnapshot] = useState<BurnSnapshot | null>(null)
  const [specialEffect, setSpecialEffect] = useState<SpecialEffect | null>(null)
  const [displayedEmote, setDisplayedEmote] = useState<EmoteEvent | null>(null)
  const [displayedBroadcast, setDisplayedBroadcast] = useState<BroadcastEvent | null>(null)
  const [displayedChat, setDisplayedChat] = useState<ChatEvent | null>(null)
  const selectionOwner = useRef(viewerId)
  const invalidDraftNoticeKey = useRef('')
  const pendingSelfEmote = useRef<{ emote: EmoteId; sentAt: number } | null>(null)
  const pendingSelfBroadcast = useRef<{ broadcast: BroadcastId; sentAt: number } | null>(null)
  // Pass-and-play reuses one mounted table for several viewers. Keep reaction
  // gates per viewer so one local player neither blocks nor lends a fresh
  // burst window to another player when the device changes hands.
  const lastReactionSentAtByViewer = useRef(new Map<string, number>())
  const recentSelfChatTimestampsByViewer = useRef(new Map<string, number[]>())
  const debounceRef = useRef(0)
  const pickupDraftBackup = useRef<string[]>([])
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
  selectionRef.current = selection
  selectionZoneRef.current = zone
  const setSelection = useCallback((next: string[] | ((current: string[]) => string[])) => {
    const resolved = typeof next === 'function' ? next(selectionRef.current) : next
    selectionRef.current = resolved
    // Only stable, visible hand/tableau ids survive the multiplayer offline screen.
    // Never persist a position-based blind choice across resynchronization.
    onSelectionDraftChange?.(
      selectionZoneRef.current === 'hand' || selectionZoneRef.current === 'faceUp' ? resolved : []
    )
    setSelectionState(resolved)
  }, [onSelectionDraftChange])
  const playableNow = useCallback(
    (c: CardT) => canPlay(c, topRank),
    [topRank],
  )
  const anyPlayable = viewerActive && zone !== 'faceDown' && zoneCards.some(playableNow)

  const ownedSelection = selectionOwner.current === viewerId ? selection : []
  const effectiveSelection = useMemo(() => {
    if (state.phase !== 'play' && state.phase !== 'endgame') return []
    if (zone === 'faceDown') {
      return viewerActive && ownedSelection.length <= 1 &&
        ownedSelection.every(id => zoneCards.some(card => card.id === id))
        ? ownedSelection
        : []
    }
    return reconcilePlayableSelection(ownedSelection, zoneCards, topRank)
  }, [ownedSelection, state.phase, topRank, viewerActive, zone, zoneCards])
  const selectedCards = useMemo(
    () => zoneCards.filter(c => effectiveSelection.includes(c.id)),
    [effectiveSelection, zoneCards],
  )
  const selectedRank = selectedCards[0]?.rank ?? null
  const interruptCards = useMemo(
    () => (actionsEnabled && !viewerActive && onBurnIn ? getInterruptBurnCards(state, viewerId) : []),
    [actionsEnabled, state, viewerId, viewerActive, onBurnIn],
  )
  const interruptIds = useMemo(() => new Set(interruptCards.map(card => card.id)), [interruptCards])
  const quickFollowUpCards = useMemo(
    () => (actionsEnabled && onQuickFollowUp ? getQuickFollowUpCards(state, viewerId) : []),
    [actionsEnabled, state, viewerId, onQuickFollowUp],
  )
  const quickFollowUpIds = useMemo(() => new Set(quickFollowUpCards.map(card => card.id)), [quickFollowUpCards])
  const physicalRun = getPhysicalTopRun(state)
  const canBurnIn = interruptCards.length > 0 && physicalRun !== null
  const canQuickFollowUp = quickFollowUpCards.length > 0
  const quickSourceSeq = state.pendingQuickFollowUp?.playerId === viewerId
    ? state.pendingQuickFollowUp.sourceSeq
    : null
  const showQuickFollowUp = canQuickFollowUp && dismissedQuickSourceSeq !== quickSourceSeq
  const quickActionVisible = showQuickFollowUp && (!viewerActive || effectiveSelection.length === 0)
  const canPreselectVisible = Boolean(
    viewer && !viewer.isAI && !viewer.isOut && (zone === 'hand' || zone === 'faceUp') &&
    (state.phase === 'play' || state.phase === 'endgame') && !canQuickFollowUp && !canBurnIn,
  )

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
    const key = `${current?.id ?? 'none'}-${viewerId}-${viewerActive ? 'active' : 'passive'}`
    if (key === lastTurnKey.current) return
    lastTurnKey.current = key
    if (!current) return
    if (current.id === viewerId && viewerActive) {
      announcer.sayPolite('Your turn')
    } else {
      announcer.sayPolite(`${current.name}'s turn`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, viewerId, viewerActive])

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

  useEffect(() => {
    if (!latestChat) return
    setDisplayedChat(latestChat)
  }, [latestChat])

  // Surface external (server) errors assertively.
  useEffect(() => { if (error) announcer.sayAssertive(error) }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep an off-turn draft across harmless actions. Reconcile it against each
  // authoritative hand/pile update and clear it only when it is no longer a
  // complete legal play (or the private hot-seat viewer changes).
  useEffect(() => {
    if (selectionOwner.current !== viewerId) {
      selectionOwner.current = viewerId
      setSelection([])
      setPickupArmed(false)
      return
    }
    setSelection(current => {
      let next: string[]
      if (state.phase !== 'play' && state.phase !== 'endgame') next = []
      else if (zone === 'faceDown') {
        next = viewerActive && current.length <= 1 &&
          current.every(id => zoneCards.some(card => card.id === id))
          ? current
          : []
      } else {
        next = reconcilePlayableSelection(current, zoneCards, topRank)
      }
      return sameSelection(current, next) ? current : next
    })
    setPickupArmed(false)
  }, [state.phase, topRank, viewerActive, viewerId, zone, zoneCards])

  const draftInvalidated = ownedSelection.length > 0 && effectiveSelection.length === 0 &&
    zone !== 'faceDown' && (state.phase === 'play' || state.phase === 'endgame')
  useEffect(() => {
    if (!draftInvalidated) {
      invalidDraftNoticeKey.current = ''
      return
    }
    const key = `${viewerId}:${state.seq ?? state.turnCount}:${ownedSelection.join(',')}`
    if (invalidDraftNoticeKey.current === key) return
    invalidDraftNoticeKey.current = key
    const text = 'Prepared cards no longer fit the pile — choose again'
    setFlash(text)
    announcer.sayPolite(text)
    later(3000, () => setFlash(current => current === text ? null : current))
    // The draft is cleared by the reconciliation effect above in the same
    // commit; this effect only explains why its highlight disappeared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftInvalidated, state.seq, state.turnCount, viewerId])

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

  const explainReconnect = () => {
    const text = 'Reconnecting — prepared cards kept'
    setFlash(text)
    announcer.sayPolite(text)
    later(2200, () => setFlash(current => current === text ? null : current))
  }

  const maySubmitNow = () => actionsEnabled && canSubmitAction()

  const commitPlay = () => {
    if (!viewerActive || selectedCards.length === 0) return
    if (!maySubmitNow()) { explainReconnect(); return }
    if (Date.now() - debounceRef.current < 300) return // §6.3 input debounce
    if (onPlay(selectedCards) === false) { explainReconnect(); return }
    debounceRef.current = Date.now()
    emitSoundDebounced(selectedCards.length > 1 ? 'play_multi' : 'play')
    setSelection([])
    setPickupArmed(false)
  }

  const commitPickup = () => {
    if (!viewerActive || ps === 0) return
    if (!maySubmitNow()) { explainReconnect(); return }
    if (Date.now() - debounceRef.current < 300) return
    if (anyPlayable && !pickupArmed) {
      // §6.1: guard — second confirming tap within 3s.
      pickupDraftBackup.current = effectiveSelection
      setSelection([])
      setPickupArmed(true)
      setFlash('Pick up anyway? — tap again')
      later(3000, () => setPickupArmed(false))
      later(3000, () => setFlash(f => (f === 'Pick up anyway? — tap again' ? null : f)))
      return
    }
    const restoreOnFailure = pickupArmed ? pickupDraftBackup.current : effectiveSelection
    if (onPickUp() === false) {
      if (restoreOnFailure.length > 0) setSelection(restoreOnFailure)
      pickupDraftBackup.current = []
      setPickupArmed(false)
      explainReconnect()
      return
    }
    debounceRef.current = Date.now()
    pickupDraftBackup.current = []
    setSelection([])
    setPickupArmed(false)
  }

  const commitBurnIn = () => {
    if (!canBurnIn || !onBurnIn) return
    if (!maySubmitNow()) { explainReconnect(); return }
    if (Date.now() - debounceRef.current < 300) return
    if (onBurnIn(interruptCards) === false) { explainReconnect(); return }
    debounceRef.current = Date.now()
    emitSoundDebounced('burn')
    setSelection([])
    setPickupArmed(false)
  }

  const commitQuickFollowUp = () => {
    const card = quickFollowUpCards[0]
    if (!card || !onQuickFollowUp) return
    if (!maySubmitNow()) { explainReconnect(); return }
    if (Date.now() - debounceRef.current < 300) return
    if (onQuickFollowUp(card) === false) { explainReconnect(); return }
    debounceRef.current = Date.now()
    emitSoundDebounced('play')
    setSelection([])
    setPickupArmed(false)
  }

  const dismissQuickFollowUp = () => {
    if (quickSourceSeq === null) return
    setDismissedQuickSourceSeq(quickSourceSeq)
    setFlash('Quick match skipped — take your turn')
    later(2200, () => setFlash(value => value === 'Quick match skipped — take your turn' ? null : value))
  }

  const explainReactionReconnect = () => {
    const text = 'Reconnecting — reaction not sent'
    setFlash(text)
    announcer.sayPolite(text)
    later(2200, () => setFlash(current => current === text ? null : current))
  }

  const sendEmote = (emote: EmoteId) => {
    const sentAt = Date.now()
    if (!canSendReaction(lastReactionSentAtByViewer.current.get(viewerId) ?? null, sentAt)) return
    if (!actionsEnabled || onSendEmote?.(emote) === false) {
      explainReactionReconnect()
      return
    }
    lastReactionSentAtByViewer.current.set(viewerId, sentAt)
    const event: EmoteEvent = { playerId: viewerId, emote, ts: sentAt }
    if (onSendEmote) pendingSelfEmote.current = { emote, sentAt }
    setDisplayedEmote(event)
  }

  const sendBroadcast = (broadcast: BroadcastId) => {
    const sentAt = Date.now()
    if (!canSendReaction(lastReactionSentAtByViewer.current.get(viewerId) ?? null, sentAt)) return
    if (!actionsEnabled || onSendBroadcast?.(broadcast) === false) {
      explainReactionReconnect()
      return
    }
    lastReactionSentAtByViewer.current.set(viewerId, sentAt)
    const event: BroadcastEvent = { playerId: viewerId, broadcast, ts: sentAt }
    if (onSendBroadcast) pendingSelfBroadcast.current = { broadcast, sentAt }
    setDisplayedBroadcast(event)
  }

  const sendChat = (rawText: string): boolean => {
    const text = normalizeChatText(rawText)
    if (!isValidChatText(text)) return false
    const sentAt = Date.now()
    if (!canSendReaction(lastReactionSentAtByViewer.current.get(viewerId) ?? null, sentAt)) return false
    if (!actionsEnabled) {
      explainReactionReconnect()
      return false
    }
    const burst = acceptedCustomMessageBurst(
      recentSelfChatTimestampsByViewer.current.get(viewerId) ?? [],
      sentAt,
    )
    if (!burst.accepted) {
      recentSelfChatTimestampsByViewer.current.set(viewerId, burst.timestamps)
      const message = `Custom messages are limited to ${CUSTOM_MESSAGE_BURST_LIMIT} every ${CUSTOM_MESSAGE_BURST_WINDOW_MS / 1000} seconds`
      setFlash(message)
      announcer.sayPolite(message)
      later(2200, () => setFlash(current => current === message ? null : current))
      return false
    }
    if (onSendChat && onSendChat(text) === false) {
      explainReactionReconnect()
      return false
    }
    recentSelfChatTimestampsByViewer.current.set(viewerId, burst.timestamps)
    lastReactionSentAtByViewer.current.set(viewerId, sentAt)
    // Multiplayer waits for the authenticated server echo. This keeps a
    // transport drop or authoritative rate-limit rejection from appearing as
    // a message that other players never received. Single-player remains
    // local-only and can render immediately.
    if (onSendChat) return true
    const event: ChatEvent = { playerId: viewerId, text, ts: sentAt }
    setDisplayedChat(event)
    onLocalChatAccepted?.(text)
    return true
  }

  const tapCard = (card: CardT, cardZone: Zone) => {
    const preparingNextTurn = !viewerActive && canPreselectVisible && cardZone === zone
    if (!viewerActive && !preparingNextTurn) return
    setPickupArmed(false)
    if (cardZone !== zone) return // only the active zone is live (D6)
    if (zone === 'faceDown') {
      // Blind plays are single cards (D7): tap toggles a single selection.
      const isSelected = effectiveSelection.includes(card.id)
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
    const next = nextRankSelection(effectiveSelection, card, zoneCards)
    if (next === effectiveSelection) {
      explain('Four cards maximum per play', card.id)
      return
    }
    setSelection(next)
    emitSoundDebounced(effectiveSelection.includes(card.id) ? 'deselect' : 'select')
  }

  // Stable, ref-routed activators — Card's memo ignores onActivate identity,
  // so these must never go stale semantically (they read the latest render).
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
  const effectiveSelectionIds = new Set(effectiveSelection)
  if (viewer) {
    for (const c of [...viewer.hand, ...viewer.faceUp]) {
      if (quickActionVisible && quickFollowUpIds.has(c.id)) {
        states.set(c.id, 'joinable')
        hints.set(c.id, 'matching card, quick follow-up available')
        continue
      }
      if (canBurnIn && interruptIds.has(c.id)) {
        states.set(c.id, 'joinable')
        hints.set(c.id, 'can burn in now')
        continue
      }
      if (effectiveSelectionIds.has(c.id)) {
        states.set(c.id, 'selected')
        hints.set(c.id, viewerActive ? 'selected' : 'selected for your next turn')
        continue
      }
      if (quickFollowUpIds.has(c.id)) {
        states.set(c.id, 'joinable')
        hints.set(c.id, 'matching card, quick follow-up available')
        continue
      }
      if (invalidId === c.id) {
        states.set(c.id, 'invalid')
        hints.set(c.id, 'not playable')
        continue
      }
      if (!viewerActive) {
        if (interruptIds.has(c.id)) {
          states.set(c.id, 'joinable')
          hints.set(c.id, 'can burn in now')
        } else if (canPreselectVisible && zoneCards.some(zoneCard => zoneCard.id === c.id)) {
          states.set(c.id, 'rest')
          hints.set(c.id, playableNow(c) ? 'available to select for your next turn' : 'not playable on the current pile')
        } else {
          states.set(c.id, 'rest')
        }
        continue
      }
      const inZone = zone !== 'faceDown' && zoneCards.some(z => z.id === c.id)
      if (!inZone) { states.set(c.id, 'rest'); continue }
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
      downStates.set(c.id, effectiveSelectionIds.has(c.id) ? 'selected' : 'playable')
      downHints.set(c.id, effectiveSelectionIds.has(c.id) ? 'selected' : 'blind play')
    }
  }

  // ---- Seats ----
  const seats: Seat[] = orderSeats(state.players, viewerId).map(p => ({
    player: p,
    faceUp: p.faceUp,
    hideFaceUp: spectating,
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

  if (!viewer && !spectating) return null

  const endgameZoneLive = (
    viewerActive || canBurnIn || (canPreselectVisible && zone === 'faceUp')
  ) && (zone === 'faceUp' || zone === 'faceDown')
  const emotePlayer = displayedEmote
    ? state.players.find(player => player.id === displayedEmote.playerId)?.name
    : undefined
  const broadcastPlayer = displayedBroadcast
    ? state.players.find(player => player.id === displayedBroadcast.playerId)?.name
    : undefined
  const chatPlayer = displayedChat
    ? state.players.find(player => player.id === displayedChat.playerId)?.name
    : undefined
  const visibleSystemEvent = latestSystemEvent?.kind === 'ondra-mode' && state.phase === 'gameOver'
    ? null
    : latestSystemEvent ?? null

  return (
    <div
      className="app-viewport last-call-screen game-screen bg-felt text-cream flex flex-col table-select-none"
      data-game-phase={state.phase}
      data-viewer-active={viewerActive ? 'true' : 'false'}
      data-viewer-role={spectating ? 'spectator' : 'player'}
      data-active-zone={zone ?? undefined}
      data-selection-count={effectiveSelection.length}
    >
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />
      <TurnAttentionBeacon active={attentionAlertActive} />
      <div className="table-reaction-feedback-stack" aria-label="Table reactions">
        <SystemEventFeedback event={visibleSystemEvent} />
        <ChatFeedback event={displayedChat} playerName={chatPlayer} />
        <BroadcastFeedback event={displayedBroadcast} playerName={broadcastPlayer} />
        <EmoteFeedback event={displayedEmote} playerName={emotePlayer} />
      </div>

      <LayoutGroup id={`table-turn-${viewerId}`}>
      <div className="game-shell table-shell">
      <header className="game-header table-header">
        <div className="game-topbar table-topbar">
          <div className="game-connection table-connection">
            {connectionBadge}
            {!spectating && <SpectatorIndicator count={spectatorCount} />}
          </div>
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
            {!spectating && (
              <EmoteButton
                key={viewerId}
                onSend={sendEmote}
                onSendBroadcast={sendBroadcast}
                onSendChat={sendChat}
                recentCustomMessages={recentCustomMessages}
              />
            )}
            <QuietMenu
              onOpenRules={onOpenRules}
              soundOn={soundOn}
              onToggleSound={onToggleSound}
              turnAlertsEnabled={turnAlertsEnabled}
              onToggleTurnAlerts={onToggleTurnAlerts}
              repeatTurnAlertsEnabled={repeatTurnAlertsEnabled}
              onToggleRepeatTurnAlerts={onToggleRepeatTurnAlerts}
              adhdMode={adhdMode}
              onToggleAdhdMode={onToggleAdhdMode}
              adhdSound={adhdSound}
              onSelectAdhdSound={onSelectAdhdSound}
              easterEggEnabled={easterEggEnabled}
              onToggleEasterEgg={onToggleEasterEgg}
              onLeave={onLeave}
              matchRunning
            />
          </div>
        </div>
        <OpponentStrip
          seats={seats}
          activeSeatId={current?.id ?? null}
          turnMarkerLayoutId={reduceMotion ? undefined : 'active-turn-marker'}
          ariaLabel={spectating ? 'Players' : 'Opponents'}
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
      {viewer && !spectating && (
        <TableauWell
          faceUp={viewer.faceUp}
          faceDown={viewer.faceDown}
          fullSize={endgameZoneLive}
          faceUpStates={states}
          faceUpHints={hints}
          faceDownStates={downStates}
          faceDownHints={downHints}
          onActivateFaceUp={(viewerActive || canPreselectVisible) && zone === 'faceUp' ? onFaceUpId : undefined}
          onActivateFaceDown={viewerActive && zone === 'faceDown' ? onFaceDownId : undefined}
        />
      )}

      {/* Z4 — ActionBar + hand fan, flush to safe-area bottom */}
      {viewer && !spectating ? <footer
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
              selectionCount={viewerActive ? effectiveSelection.length : 0}
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
            onSelect={(viewerActive || canPreselectVisible) && zone === 'hand' ? onHandId : undefined}
            orderKey={viewerId}
          />
        </div>
      </footer> : (
        <footer className="app-bottom-zone game-footer spectator-waiting-strip" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
            <path d="M2.8 12s3.3-5.2 9.2-5.2S21.2 12 21.2 12s-3.3 5.2-9.2 5.2S2.8 12 2.8 12Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
          <span>Watching this round · waiting for the next deal</span>
        </footer>
      )}
      </div>
      </LayoutGroup>
    </div>
  )
}
