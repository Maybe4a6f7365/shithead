// ============================================================================
// TableScreen — THE shared play/endgame table (DESIGN.md §3.1), used by both
// SP and MP (§9 refactor note: the two tables converge on the same
// components). Z3/Z4 are pinned to the viewer ("me"); opponents only ever
// render as backs + counts in the OpponentStrip (Appendix A.1).
//
// Interaction model (§6.1): tap-select → explicit PLAY button. No action ever
// fires on a single tap of a card. Invalid taps shake + explain in the feed.
//
// This file wires the table together and owns the viewer's actions. The parts
// with a life of their own live in ./table:
//   usePileSequence    what the pile shows while the latest action plays out
//   usePlayDraft       the selected cards and the armed pick-up guard
//   useActionFeedback  effect banner, skip, going-out moment, announcements
//   useTableReactions  emotes, broadcasts and custom messages
//   cardStates         how each of the viewer's cards looks and reads
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup, useReducedMotion } from 'framer-motion'
import type { Card as CardT, GameState } from '../engine'
import { canPlay, getInterruptBurnCards, getPhysicalTopRun, getQuickFollowUpCards, getTopCard, getTopRank, pileSize } from '../engine'
import { CardDefs } from './Card'
import { useYourTurnRipple } from './yourTurnRipple'
import { OpponentStrip, orderSeats, SpatialTurnMarker, type Seat } from './OpponentStrip'
import { PileArea } from './PileArea'
import { ActionFeed } from './ActionFeed'
import { HandFan } from './HandFan'
import { TableauWell } from './TableauWell'
import { ActionBar } from './ActionBar'
import { QuietMenu } from './QuietMenu'
import { Announcer, useAnnouncer } from './Announcer'
import { feedLine } from './feedText'
import { useSoundFromLog, emitSoundDebounced, type SoundName } from './soundManager'
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
import { SpecialEffectFeedback } from './SpecialEffectFeedback'
import { TurnAttentionBeacon, vibrate, type AlertSettings } from './turnAlerts'
import { OutMoment } from './WinMoment'
import { SpectatorIndicator } from './SpectatorIndicator'
import { activeZoneOf, nextRankSelection, type Zone } from './table/selection'
import { viewerCardStates } from './table/cardStates'
import { useTransient } from './table/useTransient'
import { usePlayDraft } from './table/usePlayDraft'
import { usePileSequence } from './table/usePileSequence'
import { useActionFeedback } from './table/useActionFeedback'
import { speakerNameForEvent, useTableReactions } from './table/useTableReactions'

export interface TableScreenProps extends AlertSettings {
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
  /** Reactions are gated separately from gameplay: a queued watcher may talk at
      the table with every play action dead. Defaults to actionsEnabled. */
  reactionsEnabled?: boolean
  /** Labels this viewer's own optimistic reaction, which renders before (and
      instead of) the server echo. Needed when the dealt roster cannot name the
      viewer — a queued watcher is absent from state.players. */
  viewerName?: string
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

const NO_CARDS: CardT[] = []
const NO_ROWS = { hand: NO_CARDS, faceUp: NO_CARDS, faceDown: NO_CARDS }
/** §6.3: a second action within this window of the last accepted one is ignored. */
const SUBMIT_DEBOUNCE_MS = 300

export function TableScreen({
  state, viewerId, viewerActive: viewerTurn, spectating = false, spectatorCount = 0,
  actionsEnabled = true, reactionsEnabled, viewerName,
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
  const isViewerTurn = current?.id === viewerId
  const top = getTopCard(state)
  const topRank = getTopRank(state)
  const ps = pileSize(state)
  const inPlay = state.phase === 'play' || state.phase === 'endgame'

  const announcer = useAnnouncer()
  const reduceMotion = useReducedMotion()
  const { flash, showFlash, later } = useTransient()
  const [invalidId, setInvalidId] = useState<string | null>(null)
  const [dismissedQuickSourceSeq, setDismissedQuickSourceSeq] = useState<number | null>(null)

  // Light touch feedback for card handling. Follows the turn-alert switch so
  // one setting silences every vibration; unsupported devices do nothing.
  const haptic = (pattern: number | number[]) => {
    if (turnAlertsEnabled) vibrate(pattern)
  }
  /** A passing notice: in the feed, and politely to assistive tech. */
  const notice = (text: string, ms: number) => {
    showFlash(text, ms)
    announcer.sayPolite(text)
  }

  const { specialEffect, outMoment } = useActionFeedback({
    state, viewerId, viewerTurn, topRank, reduceMotion, error, announcer, haptic,
  })
  const sequence = usePileSequence({
    state, viewerId, reduceMotion, top, pileCount: ps, topRank, onBurn: () => haptic(28),
  })
  // While a face-down flip plays, the table behaves as if the action has not
  // landed yet: no input, no playable highlights, no turn ripple.
  const { blindActive, heldHandOf } = sequence
  const viewerActive = viewerTurn && !blindActive

  // The turn just reached the viewer: ripple their playable cards left to right.
  const screenRef = useRef<HTMLDivElement>(null)
  useYourTurnRipple(
    screenRef,
    isViewerTurn && viewerActive && state.phase !== 'roundEnd' && state.phase !== 'gameOver'
      ? `turn-${state.turnCount}`
      : null,
    reduceMotion,
  )
  useSoundFromLog(state, soundOn)
  const reactions = useTableReactions({
    viewerId, viewerName, spectating, canReact: reactionsEnabled ?? actionsEnabled,
    latestEmote, latestBroadcast, latestChat,
    onSendEmote, onSendBroadcast, onSendChat, onLocalChatAccepted,
    onNotSent: text => notice(text, 2200),
  })

  // ---- The viewer's cards ----
  const zone: Zone | null = viewer ? activeZoneOf(viewer) : null
  const zoneCards = viewer ? viewer[zone ?? 'hand'] : NO_CARDS
  const playableNow = useCallback((c: CardT) => canPlay(c, topRank), [topRank])
  const anyPlayable = viewerActive && zone !== 'faceDown' && zoneCards.some(playableNow)
  const { selection, selectedCards, setSelection, pickupArmed, setPickupArmed } = usePlayDraft({
    phase: state.phase, actionSeq: state.seq ?? state.turnCount, viewerId, viewerActive, zone, zoneCards, topRank,
    onDraftDropped: text => notice(text, 3000),
  })

  // ---- Out-of-turn offers: burn-in and quick follow-up ----
  const interruptCards = useMemo(
    () => (actionsEnabled && !blindActive && !viewerTurn && onBurnIn ? getInterruptBurnCards(state, viewerId) : NO_CARDS),
    [actionsEnabled, blindActive, state, viewerId, viewerTurn, onBurnIn],
  )
  const interruptIds = useMemo(() => new Set(interruptCards.map(card => card.id)), [interruptCards])
  const quickFollowUpCards = useMemo(
    () => (actionsEnabled && !blindActive && onQuickFollowUp ? getQuickFollowUpCards(state, viewerId) : NO_CARDS),
    [actionsEnabled, blindActive, state, viewerId, onQuickFollowUp],
  )
  const quickFollowUpIds = useMemo(() => new Set(quickFollowUpCards.map(card => card.id)), [quickFollowUpCards])
  const physicalRun = getPhysicalTopRun(state)
  const canBurnIn = interruptCards.length > 0 && physicalRun !== null
  const canQuickFollowUp = quickFollowUpCards.length > 0
  const quickSourceSeq = state.pendingQuickFollowUp?.playerId === viewerId
    ? state.pendingQuickFollowUp.sourceSeq
    : null
  const showQuickFollowUp = canQuickFollowUp && dismissedQuickSourceSeq !== quickSourceSeq
  const quickActionVisible = showQuickFollowUp && (!viewerActive || selection.length === 0)
  const canPreselect = Boolean(
    viewer && !viewer.isAI && !viewer.isOut && (zone === 'hand' || zone === 'faceUp') &&
    inPlay && !canQuickFollowUp && !canBurnIn && !blindActive,
  )

  // ---- Feed: transient flash > server error > latest table event ----
  // Turn ownership has a persistent, spatial cue in the header/opponent seat.
  // Repeating "Your turn" here turns the feed into a second status badge and
  // pushes the last useful table event out of view.
  const lastEvent = feedLine(state, { meId: viewerId, players: state.players })
  const feed = flash
    ? { text: flash, key: `flash-${flash}`, tone: 'error' as const }
    : error
      ? { text: error, key: `err-${error}`, tone: 'error' as const }
      : lastEvent
        ? { text: lastEvent.text, key: lastEvent.key, tone: 'normal' as const }
        : { text: null, key: 'idle', tone: 'normal' as const }

  // ---- Actions ----
  const explain = (text: string, cardId?: string) => {
    showFlash(text, 3000)
    announcer.sayAssertive(text)
    if (cardId) {
      setInvalidId(cardId)
      emitSoundDebounced('invalid')
      haptic([12, 40, 12])
      later(300, () => setInvalidId(null))
    }
  }
  const explainReconnect = () => notice('Reconnecting — prepared cards kept', 2200)

  const lastSubmitAt = useRef(0)
  /** May an action go out now? Explains itself when the connection is the reason. */
  const maySubmit = (): boolean => {
    if (!actionsEnabled) { explainReconnect(); return false }
    return Date.now() - lastSubmitAt.current >= SUBMIT_DEBOUNCE_MS
  }
  /** Send one action. Once it is out, the draft is spent. */
  const submit = (send: () => void | boolean, sound: SoundName) => {
    if (!maySubmit()) return
    if (send() === false) { explainReconnect(); return }
    lastSubmitAt.current = Date.now()
    emitSoundDebounced(sound)
    setSelection([])
    setPickupArmed(false)
  }

  const commitPlay = () => {
    if (!viewerActive || selectedCards.length === 0) return
    submit(() => onPlay(selectedCards), selectedCards.length > 1 ? 'play_multi' : 'play')
  }

  const commitBurnIn = () => {
    if (!canBurnIn || !onBurnIn) return
    submit(() => onBurnIn(interruptCards), 'burn')
  }

  const commitQuickFollowUp = () => {
    const card = quickFollowUpCards[0]
    if (!card || !onQuickFollowUp) return
    submit(() => onQuickFollowUp(card), 'play')
  }

  const dismissQuickFollowUp = () => {
    if (quickSourceSeq === null) return
    setDismissedQuickSourceSeq(quickSourceSeq)
    showFlash('Quick match skipped — take your turn', 2200)
  }

  // Picking up with a playable card in hand takes a second, confirming tap
  // within 3s (§6.1). The draft is set aside meanwhile and comes back if the
  // pick-up could not be sent.
  const pickupDraftBackup = useRef<string[]>([])
  const commitPickup = () => {
    if (!viewerActive || ps === 0) return
    if (!maySubmit()) return
    if (anyPlayable && !pickupArmed) {
      pickupDraftBackup.current = selection
      setSelection([])
      setPickupArmed(true)
      later(3000, () => setPickupArmed(false))
      showFlash('Pick up anyway? — tap again', 3000)
      return
    }
    const restoreOnFailure = pickupArmed ? pickupDraftBackup.current : selection
    if (onPickUp() === false) {
      if (restoreOnFailure.length > 0) setSelection(restoreOnFailure)
      pickupDraftBackup.current = []
      setPickupArmed(false)
      explainReconnect()
      return
    }
    lastSubmitAt.current = Date.now()
    pickupDraftBackup.current = []
    setSelection([])
    setPickupArmed(false)
  }

  const tapCard = (card: CardT, cardZone: Zone) => {
    if (blindActive) return
    const preparingNextTurn = !viewerActive && canPreselect && cardZone === zone
    if (!viewerActive && !preparingNextTurn) return
    setPickupArmed(false)
    if (cardZone !== zone) return // only the active zone is live (D6)
    const isSelected = selection.includes(card.id)
    if (zone === 'faceDown') {
      // Blind plays are single cards (D7): tap toggles a single selection.
      // Remember where the card sits: the reveal flies out of this slot.
      if (!isSelected) sequence.rememberBlindOrigin(card.id)
      setSelection(isSelected ? [] : [card.id])
    } else if (!playableNow(card)) {
      explain(
        topRank
          ? `${card.rank === 'JOKER' ? 'The Joker' : `The ${card.rank}`} cannot be played on the ${topRank}`
          : 'That card cannot be played now',
        card.id,
      )
      return
    } else {
      setSelection(nextRankSelection(selection, card, zoneCards))
    }
    haptic(8)
    emitSoundDebounced(isSelected ? 'deselect' : 'select')
  }

  // Stable, ref-routed activators — Card's memo ignores onActivate identity,
  // so these must never go stale semantically (they read the latest render).
  const latest = useRef({ viewer, tapCard })
  latest.current = { viewer, tapCard }
  const onHandId = useCallback((id: string) => {
    const card = latest.current.viewer?.hand.find(x => x.id === id)
    if (card) latest.current.tapCard(card, 'hand')
  }, [])
  const onFaceUpId = useCallback((id: string) => {
    const card = latest.current.viewer?.faceUp.find(x => x.id === id)
    if (card) latest.current.tapCard(card, 'faceUp')
  }, [])
  const onFaceDownId = useCallback((id: string) => {
    const card = latest.current.viewer?.faceDown.find(x => x.id === id)
    if (card) latest.current.tapCard(card, 'faceDown')
  }, [])

  const { states, hints, downStates, downHints } = viewerCardStates({
    viewer: viewer ?? NO_ROWS, zone, zoneCards, viewerActive, selection,
    selectedRank: selectedCards[0]?.rank ?? null, invalidId,
    canBurnIn, interruptIds, quickFollowUpIds, quickActionVisible,
    canPreselect, playable: playableNow,
  })

  // ---- Seats ----
  const seats: Seat[] = orderSeats(state.players, viewerId).map(p => ({
    player: p,
    faceUp: p.faceUp,
    hideFaceUp: spectating,
    handCount: (heldHandOf(p.id) ?? p.hand).length,
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

  // Once the final row is the zone in play it stays full size, on and off the
  // turn. Sizing it by whose turn it is made the row (and the pile above it)
  // grow and shrink with every turn.
  const endgameZoneLive = zone === 'faceUp' || zone === 'faceDown'
  const visibleSystemEvent = latestSystemEvent?.kind === 'ondra-mode' && state.phase === 'gameOver'
    ? null
    : latestSystemEvent ?? null

  return (
    <div
      ref={screenRef}
      className="app-viewport last-call-screen game-screen bg-felt text-cream flex flex-col table-select-none"
      data-game-phase={state.phase}
      data-viewer-active={viewerActive ? 'true' : 'false'}
      data-viewer-role={spectating ? 'spectator' : 'player'}
      data-active-zone={zone ?? undefined}
      data-selection-count={selection.length}
    >
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />
      <TurnAttentionBeacon active={attentionAlertActive} />
      <div className="table-reaction-feedback-stack" aria-label="Table reactions">
        <SystemEventFeedback event={visibleSystemEvent} />
        <ChatFeedback event={reactions.chat} playerName={speakerNameForEvent(reactions.chat, state)} />
        <BroadcastFeedback event={reactions.broadcast} playerName={speakerNameForEvent(reactions.broadcast, state)} />
        <EmoteFeedback event={reactions.emote} playerName={speakerNameForEvent(reactions.emote, state)} />
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
            data-my-turn={isViewerTurn && viewerTurn ? 'true' : 'false'}
            aria-current={isViewerTurn && viewerTurn ? 'step' : undefined}
            aria-label={isViewerTurn && viewerTurn
              ? 'Your turn'
              : `${current?.name ?? 'Table'}'s turn`}
          >
            <span className="table-turn-label__indicator" aria-hidden="true" />
            <span className="table-turn-label__copy">
              <span className="table-turn-label__eyebrow" aria-hidden="true">Turn</span>
              <strong className="table-turn-label__name">
                {isViewerTurn && viewerTurn ? 'Your move' : current?.name ?? 'Table'}
              </strong>
            </span>
          </div>
          <div className="game-tools table-tools" aria-label="Table controls">
            {/* A watcher cannot play but the table still hears them, so the
                composer sits where a player expects it — and where its picker
                panel is anchored. A read-only render (no send handlers wired)
                stays read-only. */}
            {(!spectating || Boolean(onSendEmote || onSendBroadcast || onSendChat)) && (
              <EmoteButton
                key={viewerId}
                onSend={reactions.sendEmote}
                onSendBroadcast={reactions.sendBroadcast}
                onSendChat={reactions.sendChat}
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
          data-burning={sequence.burning ? 'true' : 'false'}
          data-burn-key={sequence.pile.burnKey}
        >
          <SpecialEffectFeedback effect={specialEffect} />
          <OutMoment event={outMoment?.key.startsWith(`${viewerId}:`) ? outMoment : null} />
          <PileArea
            stockCount={state.stock.length}
            {...sequence.pile}
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
          onActivateFaceUp={(viewerActive || canPreselect) && zone === 'faceUp' ? onFaceUpId : undefined}
          onActivateFaceDown={viewerActive && zone === 'faceDown' ? onFaceDownId : undefined}
        />
      )}

      {/* Z4 — ActionBar + hand fan, flush to safe-area bottom */}
      {viewer && !spectating ? <footer
        className="app-bottom-zone game-footer table-hand-zone"
        data-hand-count={(heldHandOf(viewer.id) ?? viewer.hand).length}
        data-active-zone={zone ?? undefined}
      >
        {isViewerTurn && viewerTurn && (
          <SpatialTurnMarker
            owner="local"
            label="Your move"
            className="table-hand-zone__turn-marker"
            layoutId={reduceMotion ? undefined : 'active-turn-marker'}
          />
        )}
        <div className="table-hand-zone__inner" onClick={e => e.stopPropagation()}>
          {/* Always rendered: an idle bar holds the row between turns. */}
          {(
            <ActionBar
              selectionCount={viewerActive ? selection.length : 0}
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
            cards={heldHandOf(viewer.id) ?? viewer.hand}
            states={states}
            ariaHints={hints}
            onSelect={(viewerActive || canPreselect) && zone === 'hand' ? onHandId : undefined}
            orderKey={viewerId}
            entryFrom={sequence.handEntryFrom}
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
