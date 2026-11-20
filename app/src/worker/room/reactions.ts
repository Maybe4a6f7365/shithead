// ============================================================================
// Table talk: custom messages, emotes and preset broadcasts. Relayed to
// authenticated room members only, never persisted, never part of the game
// state. Seated players and queued watchers share the same limits.
// ============================================================================
import type { ClientMsg } from '../../engine/protocol'
import {
  acceptedCustomMessageBurst,
  CUSTOM_MESSAGE_BURST_LIMIT,
  CUSTOM_MESSAGE_BURST_WINDOW_MS,
  normalizeChatText,
} from '../../engine/protocol'
import { acceptedReactionAt } from '../tableMessages'
import type { RoomContext, Session } from './context'

/**
 * Relay one canonical, authenticated custom message as an ephemeral reaction.
 * Allowed in any pre-game or active phase (waiting, rearrange, tribute, play,
 * endgame) so the waiting room can host table talk, and open to queued
 * watchers as well as seated players. Cooldown and burst limit apply
 * uniformly to both.
 */
export function chat(room: RoomContext, session: Session, rawText: string): void {
  const playerId = session.playerId
  const speaker = playerId ? room.speakerOf(playerId) : null
  if (!playerId || !speaker) return
  const text = normalizeChatText(rawText)
  if (!text) return
  const ts = acceptedReactionAt(room.lastReactionAtByPlayer.get(playerId) ?? null, Date.now())
  if (ts === null) return
  if (!takeCustomMessageBurstSlot(room, playerId, ts)) {
    room.send(session, {
      type: 'ERROR',
      code: 'RATE_LIMITED',
      message: `Custom messages are limited to ${CUSTOM_MESSAGE_BURST_LIMIT} ` +
        `every ${CUSTOM_MESSAGE_BURST_WINDOW_MS / 1000} seconds`,
    })
    return
  }
  room.lastReactionAtByPlayer.set(playerId, ts)
  room.broadcast({ type: 'CHAT', playerId, text, ts, ...speaker })
}

/**
 * Relay a validated reaction to authenticated room members only. Emotes do
 * not touch RoomData, storage, the game log, or sequence counters: they are
 * intentionally short-lived UI feedback. The shared reaction cooldown and
 * socket-wide limiter both apply, so alternating reaction types cannot flood
 * the table or bypass normal rate limits.
 */
export function emote(room: RoomContext, session: Session, emote: Extract<ClientMsg, { type: 'EMOTE' }>['emote']): void {
  const playerId = session.playerId
  const speaker = playerId ? room.speakerOf(playerId) : null
  if (!playerId || !speaker) return
  const ts = takeReactionSlot(room, session)
  if (ts === null) return
  room.broadcast({ type: 'EMOTE', playerId, emote, ts, ...speaker })
}

/**
 * Relay a server-validated preset id; free-form text never crosses this
 * boundary. Like emotes, broadcasts are authenticated, share one reaction
 * cooldown, remain socket-rate-limited, and are never persisted or applied
 * to state.
 */
export function broadcastPreset(
  room: RoomContext,
  session: Session,
  broadcast: Extract<ClientMsg, { type: 'BROADCAST' }>['broadcast'],
): void {
  const playerId = session.playerId
  const speaker = playerId ? room.speakerOf(playerId) : null
  if (!playerId || !speaker) return
  const ts = takeReactionSlot(room, session)
  if (ts === null) return
  room.broadcast({ type: 'BROADCAST', playerId, broadcast, ts, ...speaker })
}

/** One cooldown slot per room member, seated or queued. */
function takeReactionSlot(room: RoomContext, session: Session): number | null {
  const playerId = session.playerId
  if (!playerId || !room.isMember(playerId)) return null
  const acceptedAt = acceptedReactionAt(room.lastReactionAtByPlayer.get(playerId) ?? null, Date.now())
  if (acceptedAt !== null) room.lastReactionAtByPlayer.set(playerId, acceptedAt)
  return acceptedAt
}

function takeCustomMessageBurstSlot(room: RoomContext, playerId: string, now: number): boolean {
  for (const [id, timestamps] of room.customMessageTimestamps) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] >= CUSTOM_MESSAGE_BURST_WINDOW_MS) {
      room.customMessageTimestamps.delete(id)
    }
  }
  const result = acceptedCustomMessageBurst(room.customMessageTimestamps.get(playerId) ?? [], now)
  room.customMessageTimestamps.set(playerId, result.timestamps)
  return result.accepted
}
