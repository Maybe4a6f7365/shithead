// ============================================================================
// Moves during a round. Every move is validated by the shared engine against
// the authoritative state; a rejected move only answers its sender. The
// private Ondra table event is rolled at the play-phase boundary and released
// after a later move (see ../tableMessages).
// ============================================================================
import type { Card, Phase, PlayResult } from '../../engine'
import { exchangeFaceUpCards, pickUpPile, playCards, rearrange, skipTribute, startPlay } from '../../engine'
import { applyInterruptBurnRequest, applyQuickFollowUpRequest, canonicalCards } from '../gameActions'
import { resolvePendingOndraEvent, scheduleOndraEventForPlayTransition } from '../tableMessages'
import type { OutMsg, RoomContext, Session } from './context'
import type { RoomData } from './roomData'

export async function swapCards(room: RoomContext, session: Session, handIdx: number, upIdx: number): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId || data.state.phase !== 'rearrange') return

  data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== session.playerId)
  data.state = rearrange(data.state, session.playerId, handIdx, upIdx)
  await room.save()
  room.broadcastGame()
}

export async function markReady(room: RoomContext, session: Session): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId || data.state.phase !== 'rearrange') return
  const previousPhase = data.state.phase

  if (!data.readyPlayerIds.includes(session.playerId)) data.readyPlayerIds.push(session.playerId)
  const everyoneReady = data.players.every(player => data.readyPlayerIds.includes(player.id))
  if (everyoneReady) data.state = startPlay(data.state)

  scheduleOndraModeForPlayTransition(room, previousPhase, data.state.phase)
  await room.save()
  room.broadcastGame()
}

export async function exchangeTribute(room: RoomContext, session: Session, winnerCardId: string, loserCardId: string): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return
  const previousPhase = data.state.phase
  await commitTribute(room, data, session, previousPhase,
    exchangeFaceUpCards(data.state, session.playerId, winnerCardId, loserCardId))
}

export async function declineTribute(room: RoomContext, session: Session): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return
  const previousPhase = data.state.phase
  await commitTribute(room, data, session, previousPhase, skipTribute(data.state, session.playerId))
}

async function commitTribute(
  room: RoomContext,
  data: RoomData,
  session: Session,
  previousPhase: Phase,
  result: PlayResult,
): Promise<void> {
  if (result.error) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
    return
  }
  data.state = result.state
  scheduleOndraModeForPlayTransition(room, previousPhase, data.state.phase)
  await room.save()
  room.broadcastRoom()
  room.broadcastGame()
}

export async function play(room: RoomContext, session: Session, requestedCards: Card[]): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return

  // Cards are re-derived from server state by id: forged suits/ranks are
  // discarded, and a replayed PLAY fails ownership because the cards have
  // already moved to the pile. Combined with the turn check in playCards,
  // retried/duplicated PLAYs cannot double-apply (replay defense via
  // server-side idempotency; state.seq lets clients dedupe broadcasts).
  const cards = canonicalCards(data.state, session.playerId, requestedCards)
  if (!cards) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Card is not owned by this player' })
    return
  }

  await commitTurn(room, data, session, playCards(data.state, session.playerId, cards))
}

/**
 * Apply one exact same-rank quick match before a competing action closes
 * the window. Durable Object messages are serialized through the room's
 * operation queue; expectedSeq therefore gives a deterministic winner and
 * prevents stale clicks/reconnect replays from mutating a later state.
 */
export async function quickFollowUp(room: RoomContext, session: Session, cardId: string, expectedSeq: number): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return
  await commitTurn(room, data, session, applyQuickFollowUpRequest(data.state, session.playerId, cardId, expectedSeq))
}

/**
 * Apply an out-of-turn four-of-a-kind completion. Ownership and card
 * identities are derived from authoritative server state; the engine then
 * enforces the visible active zone, matching rank, complete matching set,
 * non-current actor, and cumulative top-run threshold.
 */
export async function burnIn(room: RoomContext, session: Session, requestedCards: Card[]): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return
  await commitTurn(room, data, session, applyInterruptBurnRequest(data.state, session.playerId, requestedCards))
}

export async function pickUp(room: RoomContext, session: Session): Promise<void> {
  const data = room.data
  if (!data?.state || !session.playerId) return
  await commitTurn(room, data, session, pickUpPile(data.state, session.playerId))
}

/** Persist an accepted move, then send the new state, then any table event it released. */
async function commitTurn(room: RoomContext, data: RoomData, session: Session, result: PlayResult): Promise<void> {
  if (result.error) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: result.error })
    return
  }

  data.state = result.state
  const tableEvent = takePendingTableEvent(room)
  await room.save()
  room.broadcastGame()
  if (tableEvent) room.broadcast(tableEvent)
}

/**
 * Roll once at the authoritative phase boundary and persist the private
 * result. The event is deliberately not broadcast until a later due action.
 */
function scheduleOndraModeForPlayTransition(room: RoomContext, previousPhase: Phase, nextPhase: Phase): void {
  const data = room.data
  if (!data?.state) return
  if (!data.easterEggEnabled) {
    data.pendingTableEvent = null
    return
  }
  data.pendingTableEvent = scheduleOndraEventForPlayTransition(
    previousPhase,
    nextPhase,
    data.state.turnCount,
    data.players,
  )
}

/**
 * Consume a due private event before persistence. Callers then broadcast the
 * authoritative GAME_STATE first and this returned frame second.
 */
function takePendingTableEvent(room: RoomContext): OutMsg | null {
  const data = room.data
  if (!data?.state) return null
  if (!data.easterEggEnabled) {
    data.pendingTableEvent = null
    return null
  }
  const resolution = resolvePendingOndraEvent(
    data.pendingTableEvent,
    data.state.phase,
    data.state.turnCount,
    data.players,
  )
  data.pendingTableEvent = resolution.pending
  return resolution.frame
}
