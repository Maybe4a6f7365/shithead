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
import type { Card as CardT, GameState } from '../engine'
import { canPlay, getInterruptBurnCards, getPhysicalTopRun, getTopCard, getTopRank, pileSize } from '../engine'
import { CardDefs, type CardVisualState } from './Card'
import { OpponentStrip, orderSeats, type Seat } from './OpponentStrip'
import { PileArea } from './PileArea'
import { ActionFeed } from './ActionFeed'
import { HandFan } from './HandFan'
import { TableauWell } from './TableauWell'
import { ActionBar } from './ActionBar'
import { QuietMenu } from './QuietMenu'
import { Announcer, useAnnouncer } from './Announcer'
import { feedLine, latestActionEvents, type FeedContext } from './feedText'
import { useSoundFromLog, emitSoundDebounced } from './soundManager'
import { EmoteButton, EmoteFeedback } from './EmoteButton'
import type { EmoteEvent, EmoteId } from '../engine/protocol'

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
}

type Zone = 'hand' | 'faceUp' | 'faceDown'

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

function activeZoneOf(p: { hand: CardT[]; faceUp: CardT[]; faceDown: CardT[] }): Zone {
  if (p.hand.length > 0) return 'hand'
  if (p.faceUp.length > 0) return 'faceUp'
  return 'faceDown'
}

export function TableScreen({
  state, viewerId, viewerActive, error, onPlay, onBurnIn, onPickUp, onLeave, onOpenRules,
  soundOn, onToggleSound, connectionBadge, seatOffline, latestEmote, onSendEmote,
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
  const [burning, setBurning] = useState(false)
  const [displayedEmote, setDisplayedEmote] = useState<EmoteEvent | null>(null)
  const pendingSelfEmote = useRef<{ emote: EmoteId; sentAt: number } | null>(null)
  const debounceRef = useRef(0)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const announcer = useAnnouncer()

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

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
  const physicalRun = getPhysicalTopRun(state)
  const canBurnIn = interruptCards.length > 0 && physicalRun !== null

  // ---- Feed: transient flash > server error > event/turn line ----
  const feedCtx: FeedContext = { meId: viewerId, players: state.players }
  const lastEvent = feedLine(state, feedCtx)
  const isViewerTurn = current?.id === viewerId
  const actionEvents = latestActionEvents(state.log)
  const lastEntry = actionEvents[actionEvents.length - 1]
  const lastActorId =
    lastEntry && 'playerId' in lastEntry ? lastEntry.playerId
    : lastEntry?.type === 'CLEAR_PILE'
      ? [...actionEvents].reverse().find(e => e.type === 'PLAY_CARDS' || e.type === 'BLIND_REVEAL')?.playerId
      : undefined
  const feed = flash
    ? { text: flash, key: `flash-${flash}`, tone: 'error' as const }
    : error
      ? { text: error, key: `err-${error}`, tone: 'error' as const }
      : isViewerTurn && viewerActive && lastActorId !== viewerId
        ? { text: 'Your turn', key: `turn-${state.turnCount}`, tone: 'turn' as const }
        : lastEvent
          ? { text: lastEvent.text, key: lastEvent.key, tone: 'normal' as const }
          : isViewerTurn && viewerActive
            ? { text: 'Your turn', key: `turn-${state.turnCount}`, tone: 'turn' as const }
            : { text: null, key: 'idle', tone: 'normal' as const }

  // ---- Effects: burn detection, announcements, sounds, turn announce ----
  const lastActionSeq = useRef(state.seq ?? state.turnCount)
  useEffect(() => {
    const cursor = state.seq ?? state.turnCount
    if (lastActionSeq.current === cursor) return
    lastActionSeq.current = cursor
    const fresh = latestActionEvents(state.log)
    if (fresh.length === 0) return
    if (fresh.some(e => e.type === 'CLEAR_PILE')) {
      setBurning(true)
      later(420, () => setBurning(false))
    }
    const ctx: FeedContext = { meId: viewerId, players: state.players }
    const line = feedLine(state, ctx)
    if (line) announcer.sayPolite(line.text)
    if (fresh.some(e => e.type === 'GAME_OVER')) {
      const loser = state.players.find(p => p.id === state.loserId)
      announcer.sayPolite(`Round over. ${loser?.name ?? ''} is the Shithead.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq, state.turnCount, state.log])

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
      return
    }
    setDisplayedEmote(latestEmote)
  }, [latestEmote, viewerId])

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

  const sendEmote = (emote: EmoteId) => {
    const sentAt = Date.now()
    const event: EmoteEvent = { playerId: viewerId, emote, ts: sentAt }
    if (onSendEmote) pendingSelfEmote.current = { emote, sentAt }
    setDisplayedEmote(event)
    onSendEmote?.(emote)
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
      if (!viewerActive) {
        if (interruptIds.has(c.id)) {
          states.set(c.id, 'joinable')
          hints.set(c.id, 'can burn in now')
        } else {
          states.set(c.id, 'rest')
        }
        continue
      }
      if (selection.includes(c.id)) { states.set(c.id, 'selected'); hints.set(c.id, 'selected'); continue }
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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') setSelection([])
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

  return (
    <div className="app-viewport game-screen bg-felt text-cream flex flex-col table-select-none">
      <CardDefs />
      <Announcer polite={announcer.polite} assertive={announcer.assertive} />
      <EmoteFeedback event={displayedEmote} playerName={emotePlayer} />

      <div className="game-shell">
      <header className="game-header">
        <div className="game-topbar">
          <div className="game-connection">{connectionBadge}</div>
          <div className="game-turn-label" aria-live="polite">
            <span>{isViewerTurn && viewerActive ? 'Your turn' : `${current?.name ?? 'Table'}'s turn`}</span>
          </div>
          <div className="game-tools">
            <EmoteButton onSend={sendEmote} />
            <QuietMenu
              onOpenRules={onOpenRules}
              soundOn={soundOn}
              onToggleSound={onToggleSound}
              onLeave={onLeave}
              matchRunning
            />
          </div>
        </div>
        <OpponentStrip seats={seats} activeSeatId={current?.id ?? null} />
      </header>

      <main
        className="game-center"
        onClick={() => { setSelection([]); setPickupArmed(false) }}
      >
        <PileArea
          stockCount={state.stock.length}
          top={top}
          pileCount={ps}
          effectiveRank={topRank}
          burning={burning}
          teachHint={ps === 0 && viewerActive}
        />
        <div className="game-feed">
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
      <footer className="app-bottom-zone game-footer">
        <div onClick={e => e.stopPropagation()}>
          {(viewerActive || canBurnIn) && (
            <ActionBar
              selectionCount={selection.length}
              canPickUp={viewerActive && ps > 0}
              pickupArmed={pickupArmed}
              onPlay={commitPlay}
              onPickUp={commitPickup}
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
    </div>
  )
}
