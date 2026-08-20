// ============================================================================
// Multiplayer protocol — wire format between client and Durable Object
// Both client and worker import from this file (zero runtime deps).
//
// MESSAGE CATALOG
//  Client → Server:
//    CREATE_ROOM {playerName, maxPlayers?}   create a room, become host
//    JOIN_ROOM {code, playerName}            join an open room
//    RESUME_ROOM {roomCode, playerId, resumeToken} reclaim a seat securely
//    LEAVE_ROOM {}                           leave (seat kept during a game)
//    START_GAME {}                           host only; deals and enters rearrange
//    READY {}                                mark rearrange done; game starts when all ready
//    REARRANGE {handIdx, upIdx}              swap one hand card with one face-up card
//    PLAY {cards: Card[]}                    play matching cards (unique ids, one rank)
//    QUICK_FOLLOW_UP {cardId, expectedSeq}   immediately add an exact eligible quick match
//    BURN_IN {cards: Card[]}                 out-of-turn four-of-a-kind completion
//    PICK_UP {}                              pick up the pile (play/endgame only)
//    SET_RULES {rules}                       host updates waiting/next-round rules
//    SET_EASTER_EGG {enabled}                host toggles the room easter egg
//    TRIBUTE_SWAP {winnerCardId, loserCardId} optional public-row exchange
//    TRIBUTE_SKIP {}                         previous winner declines the exchange
//    CHAT {text}                             ephemeral custom table message (<=200 chars)
//    EMOTE {emote}                           authenticated ephemeral reaction
//    BROADCAST {broadcast}                   authenticated preset text reaction
//    PING {}                                 keepalive
//  Server → Client:
//    WELCOME {playerId, room, resumeToken}   seat assigned; token is secret
//    RESUME_FAILED {reason}                  resume credential rejected
//    ROOM_STATE {room}                       lobby state broadcast
//    GAME_STATE {state, version?}            per-viewer game state broadcast
//    ERROR {code, message}                   action rejected
//    PLAYER_JOINED / PLAYER_LEFT             lobby deltas
//    CHAT {playerId, text, ts}               ephemeral custom-message relay
//    EMOTE {playerId, emote, ts}             ephemeral reaction relay
//    BROADCAST {playerId, broadcast, ts}     ephemeral preset text relay
//    SYSTEM_EVENT {event}                    typed ephemeral room event
//    PONG {ts}                               keepalive reply
//
// VERSIONING & SEQUENCING
//  - PROTOCOL_VERSION is the wire-format version. Clients SHOULD include
//    `version` on every client message; if present it MUST equal
//    PROTOCOL_VERSION or the message is rejected by isClientMsg.
//  - Every GameState carries a monotonic `seq` assigned by the engine
//    (0 at init, +1 per accepted action). GAME_STATE broadcasts inherit it.
//    Clients MUST ignore a GAME_STATE whose state.seq is <= the last seq
//    they applied: duplicates/replays and out-of-order deliveries are
//    thereby detectable without extra round-trips.
//  - Hidden information: serializeGameState masks the stock, opponent hands
//    and all face-down cards per viewer. Masked cards keep array length and
//    position but get synthetic per-viewer ids that cannot be correlated
//    with real card ids, and a constant placeholder rank/suit.
// ============================================================================

import type { Card, GameRules, GameState, Phase } from './index'
import { MAX_LOG_ENTRIES } from './index'

/** Wire protocol version. Bump on any breaking message change. */
export const PROTOCOL_VERSION = 6

/** Maximum UTF-16 length accepted for one ephemeral player chat message. */
export const MAX_CHAT_MESSAGE_LENGTH = 200
export const CUSTOM_MESSAGE_BURST_LIMIT = 3
export const CUSTOM_MESSAGE_BURST_WINDOW_MS = 10_000

/** Three decks contain at most twelve physical cards of one normal rank. */
const MAX_CARDS_PER_ACTION = 12

/**
 * Canonicalize player-authored chat without restricting language or emoji.
 * React renders the result as text, so punctuation and markup-like characters
 * remain literal; only terminal/control formatting is removed here.
 */
export function normalizeChatText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u00AD\u180E\u200B\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]/gu, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

const CHAT_VISIBLE_CHARACTER = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}]/u

export function isValidChatText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CHAT_MESSAGE_LENGTH) return false
  const text = normalizeChatText(value)
  return text.length > 0 &&
    text.length <= MAX_CHAT_MESSAGE_LENGTH &&
    CHAT_VISIBLE_CHARACTER.test(text)
}

export interface CustomMessageBurstResult {
  accepted: boolean
  timestamps: number[]
}

/** Shared client/Worker policy: three custom messages per rolling window. */
export function acceptedCustomMessageBurst(
  timestamps: readonly number[],
  now: number,
): CustomMessageBurstResult {
  const recent = timestamps.filter(timestamp =>
    Number.isFinite(timestamp) && timestamp <= now && now - timestamp < CUSTOM_MESSAGE_BURST_WINDOW_MS
  )
  if (recent.length >= CUSTOM_MESSAGE_BURST_LIMIT) return { accepted: false, timestamps: recent }
  return { accepted: true, timestamps: [...recent, now] }
}

/** Stable wire ids keep presentation (emoji/art/animation) out of the protocol. */
export const EMOTE_IDS = [
  'thumbs-up',
  'laugh',
  'wow',
  'fire',
  'sad',
  'cry',
  'heart',
  'clap',
  'angry',
  'rage',
  'middle-finger',
  'clown',
  'skull',
  'poop',
  'eyes',
  'peach',
  'foot',
  'melting',
  'exploding-head',
  'pleading',
  'unamused',
  'raised-eyebrow',
  'thinking',
  'shushing',
  'zipper-mouth',
  'partying',
  'smiling-devil',
  'salute',
] as const
export type EmoteId = typeof EMOTE_IDS[number]

/** Stable ids for the deliberately finite, server-validated text presets. */
export const BROADCAST_IDS = [
  'double-middle-finger',
  'kiss-my-ass',
  'upside-down-fuck',
  'lenny',
  'karma',
  'shrug',
  'womp-womp',
  'kill-me',
  'take-it',
] as const
export type BroadcastId = typeof BROADCAST_IDS[number]

/** System copy is resolved by the client; system events never accept client-authored text. */
export const PLAYER_LEFT_MESSAGE_IDS = ['bye-little-shits'] as const
export type PlayerLeftMessageId = typeof PLAYER_LEFT_MESSAGE_IDS[number]

export const ONDRA_MESSAGE_IDS = [
  'ondra-faster',
  'ondra-love-toes',
  'ondra-fuck-me',
  'ondra-farts-cutely',
  'ondra-alpha',
  'ondra-spank-me',
] as const
export type OndraMessageId = typeof ONDRA_MESSAGE_IDS[number]

export interface EmoteEvent {
  playerId: string
  emote: EmoteId
  /** Server timestamp; emotes are deliberately not persisted in room state. */
  ts: number
}

export interface BroadcastEvent {
  playerId: string
  broadcast: BroadcastId
  /** Server timestamp; broadcasts are deliberately not persisted in room state. */
  ts: number
}

export interface ChatEvent {
  playerId: string
  text: string
  /** Server timestamp; chat is deliberately not persisted in room state. */
  ts: number
}

export type SystemEvent =
  | {
      kind: 'player-left'
      playerId: string
      playerName: string
      message: PlayerLeftMessageId
      ts: number
    }
  | {
      kind: 'ondra-mode'
      playerId: string
      playerName: string
      message: OndraMessageId
      ts: number
    }

// ---------- Client → Server ----------

export type ClientMsg =
  | { type: 'CREATE_ROOM'; playerName: string; maxPlayers?: number; version?: number }
  | { type: 'JOIN_ROOM'; code: string; playerName: string; version?: number }
  | { type: 'RESUME_ROOM'; roomCode: string; playerId: string; resumeToken: string; version?: number }
  | { type: 'LEAVE_ROOM'; version?: number }
  | { type: 'START_GAME'; version?: number }
  | { type: 'READY'; version?: number }
  | { type: 'REARRANGE'; handIdx: number; upIdx: number; version?: number }
  | { type: 'PLAY'; cards: Card[]; version?: number }
  | { type: 'QUICK_FOLLOW_UP'; cardId: string; expectedSeq: number; version?: number }
  | { type: 'BURN_IN'; cards: Card[]; version?: number }
  | { type: 'PICK_UP'; version?: number }
  | { type: 'SET_RULES'; rules: Partial<GameRules>; version?: number }
  | { type: 'SET_EASTER_EGG'; enabled: boolean; version?: number }
  | { type: 'TRIBUTE_SWAP'; winnerCardId: string; loserCardId: string; version?: number }
  | { type: 'TRIBUTE_SKIP'; version?: number }
  | { type: 'CHAT'; text: string; version?: number }
  | { type: 'EMOTE'; emote: EmoteId; version?: number }
  | { type: 'BROADCAST'; broadcast: BroadcastId; version?: number }
  | { type: 'PING'; version?: number }

// ---------- Server → Client ----------

export type ServerMsg =
  | { type: 'WELCOME'; playerId: string; room: RoomSummary; resumeToken: string; version: number }
  | { type: 'RESUME_FAILED'; reason: string; version: number }
  | { type: 'ROOM_STATE'; room: RoomSummary; version?: number }
  | { type: 'GAME_STATE'; state: GameState; version?: number }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PLAYER_JOINED'; player: PlayerSummary }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | ({ type: 'CHAT' } & ChatEvent)
  | ({ type: 'EMOTE' } & EmoteEvent)
  | ({ type: 'BROADCAST' } & BroadcastEvent)
  | { type: 'SYSTEM_EVENT'; event: SystemEvent }
  | { type: 'PONG'; ts: number }

// ---------- Types ----------

export interface PlayerSummary {
  id: string
  name: string
  isAI: boolean
  connected: boolean
  isOut: boolean
  cardCount: { hand: number; faceUp: number; faceDown: number }
}

export interface RoomSummary {
  code: string
  phase: Phase | 'waiting'
  hostId: string
  maxPlayers: number
  easterEggEnabled: boolean
  players: PlayerSummary[]
  createdAt: number
  rules: GameRules
}

export type ErrorCode =
  | 'INVALID_CODE'
  | 'ROOM_FULL'
  | 'SESSION_EXPIRED'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'INVALID_MOVE'
  | 'GAME_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'INTERNAL'

// ---------- Protocol validation ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isShortString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const isNonBlankShortString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0

const isRulesPatch = (value: unknown): value is Partial<GameRules> => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  const allowed = new Set(['includeJokers', 'winnerSwapsFaceUp', 'deckCount'])
  return keys.every(key => {
    if (!allowed.has(key)) return false
    if (key === 'deckCount') {
      return Number.isInteger(value[key]) && Number(value[key]) >= 1 && Number(value[key]) <= 3
    }
    return typeof value[key] === 'boolean'
  })
}

export const isEmoteId = (value: unknown): value is EmoteId =>
  typeof value === 'string' && (EMOTE_IDS as readonly string[]).includes(value)

export const isBroadcastId = (value: unknown): value is BroadcastId =>
  typeof value === 'string' && (BROADCAST_IDS as readonly string[]).includes(value)

/** Optional version field: when present it must match PROTOCOL_VERSION. */
const versionOk = (data: Record<string, unknown>) =>
  data.version === undefined || data.version === PROTOCOL_VERSION

const hasOnlyKeys = (data: Record<string, unknown>, allowed: readonly string[]) => {
  const keys = new Set(allowed)
  return Object.keys(data).every(key => keys.has(key))
}

export function isClientMsg(data: unknown): data is ClientMsg {
  if (!isRecord(data) || typeof data.type !== 'string') return false
  if (!versionOk(data)) return false

  switch (data.type) {
    case 'CREATE_ROOM':
      return isNonBlankShortString(data.playerName, 32) &&
        (data.maxPlayers === undefined ||
          (Number.isInteger(data.maxPlayers) && Number(data.maxPlayers) >= 2 && Number(data.maxPlayers) <= 5))
    case 'JOIN_ROOM':
      return typeof data.code === 'string' && /^[A-Z0-9]{6}$/.test(data.code) && isNonBlankShortString(data.playerName, 32)
    case 'RESUME_ROOM':
      return typeof data.roomCode === 'string' && /^[A-Z0-9]{6}$/.test(data.roomCode) &&
        isShortString(data.playerId, 128) && isShortString(data.resumeToken, 256)
    case 'REARRANGE':
      return Number.isInteger(data.handIdx) && Number.isInteger(data.upIdx)
    case 'PLAY':
    case 'BURN_IN': {
      if (!Array.isArray(data.cards) || data.cards.length === 0 || data.cards.length > MAX_CARDS_PER_ACTION) return false
      if (!data.cards.every(card => isRecord(card) && isShortString(card.id, 128))) return false
      // Reject duplicate ids at the wire level (card duplication exploit).
      const ids = data.cards.map(card => (card as { id: string }).id)
      return new Set(ids).size === ids.length
    }
    case 'QUICK_FOLLOW_UP':
      return hasOnlyKeys(data, ['type', 'cardId', 'expectedSeq', 'version']) &&
        isNonBlankShortString(data.cardId, 128) &&
        Number.isSafeInteger(data.expectedSeq) && Number(data.expectedSeq) >= 0
    case 'CHAT':
      return hasOnlyKeys(data, ['type', 'text', 'version']) && isValidChatText(data.text)
    case 'EMOTE':
      return hasOnlyKeys(data, ['type', 'emote', 'version']) && isEmoteId(data.emote)
    case 'BROADCAST':
      return hasOnlyKeys(data, ['type', 'broadcast', 'version']) && isBroadcastId(data.broadcast)
    case 'SET_RULES':
      return isRulesPatch(data.rules)
    case 'SET_EASTER_EGG':
      return hasOnlyKeys(data, ['type', 'enabled', 'version']) && typeof data.enabled === 'boolean'
    case 'TRIBUTE_SWAP':
      return isShortString(data.winnerCardId, 128) && isShortString(data.loserCardId, 128) &&
        data.winnerCardId !== data.loserCardId
    case 'LEAVE_ROOM':
    case 'START_GAME':
    case 'READY':
    case 'PICK_UP':
    case 'TRIBUTE_SKIP':
    case 'PING':
      return true
    default:
      return false
  }
}

// ---------- Encoding helpers ----------

/**
 * Placeholder for hidden cards: constant rank/suit plus a synthetic
 * per-viewer, per-position id that leaks nothing and cannot be correlated
 * with the real card id (so knowing stock order or hand positions yields no
 * card identities).
 */
const hiddenCard = (id: string): Card => ({ id, suit: null, rank: '3' })

/**
 * Serialize a GameState for one viewer (unchanged signature).
 *
 *  - stock: replaced by same-length placeholder cards (count is public and
 *    used by clients; order and identities are secret).
 *  - opponent hands: same-length placeholders (real ids are never sent).
 *  - face-down cards: always placeholders, even for the owner (blind is
 *    blind), except in phase 'gameOver' where everything is revealed.
 *  - pendingQuickFollowUp: owner-only because its presence and eligible ids
 *    reveal an exact quick-match entitlement; every other live viewer receives null.
 *  - log: capped to the most recent MAX_LOG_ENTRIES entries.
 *  - state.seq passes through unchanged for duplicate/replay detection.
 */
export function serializeGameState(state: GameState, viewerId: string): GameState {
  const revealAll = state.phase === 'gameOver'
  // Even the existence of an opponent's follow-up entitlement can reveal
  // that an exact newly available card matched the public play. Keep the complete
  // pending record owner-only; the worker still holds the authoritative ids.
  const pendingQuickFollowUp = revealAll || state.pendingQuickFollowUp?.playerId === viewerId
    ? state.pendingQuickFollowUp
    : null
  return {
    ...state,
    pendingQuickFollowUp,
    stock: state.stock.map((_, i) => hiddenCard(`hidden:stock:${i}`)),
    players: state.players.map(player => ({
      ...player,
      hand: revealAll || player.id === viewerId
        ? player.hand
        : player.hand.map((_, i) => hiddenCard(`hidden:${player.id}:hand:${i}`)),
      faceDown: revealAll
        ? player.faceDown
        : player.faceDown.map((_, i) => hiddenCard(
          player.id === viewerId ? `blind:down:${i}` : `hidden:${player.id}:down:${i}`,
        )),
    })),
    log: state.log.length > MAX_LOG_ENTRIES
      ? state.log.slice(state.log.length - MAX_LOG_ENTRIES)
      : state.log,
  }
}

/** Build a lobby-safe player summary with no card details. */
export function toPlayerSummary(p: import('./index').Player, connected = true): PlayerSummary {
  return {
    id: p.id,
    name: p.name,
    isAI: !!p.isAI,
    connected,
    isOut: p.isOut,
    cardCount: { hand: p.hand.length, faceUp: p.faceUp.length, faceDown: p.faceDown.length },
  }
}
