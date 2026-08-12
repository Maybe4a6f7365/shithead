import type { Phase } from '../engine'
import type { OndraMessageId, ServerMsg } from '../engine/protocol'
import { ONDRA_MESSAGE_IDS } from '../engine/protocol'

export type RandomSource = () => number

/** Shared gate for all visual reactions, independent of the socket flood cap. */
export const REACTION_COOLDOWN_MS = 700

const ONDRA_NAMES = ['ondra', 'ondre', 'ondrej', 'ondrey'] as const

const isTablePhase = (phase: Phase): boolean => phase === 'play' || phase === 'endgame'

/**
 * Reduce a display name to the small, stable alphabet used by the easter egg.
 * NFKD handles names such as Ondřej, while the intentionally narrow leet
 * mapping accepts the common 0ndr3j spelling without broad fuzzy matching.
 */
export function normalizeTableName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/[^a-z]/g, '')
}

function isOneEditAway(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false

  let first = left
  let second = right
  if (first.length > second.length) [first, second] = [second, first]

  let firstIndex = 0
  let secondIndex = 0
  let edits = 0
  while (firstIndex < first.length && secondIndex < second.length) {
    if (first[firstIndex] === second[secondIndex]) {
      firstIndex++
      secondIndex++
      continue
    }

    edits++
    if (edits > 1) return false
    if (first.length === second.length) firstIndex++
    secondIndex++
  }

  return edits + Number(secondIndex < second.length) <= 1
}

/** Conservative fuzzy match: near spellings must retain the `ondr` stem. */
export function isOndraLikeName(name: string): boolean {
  const normalized = normalizeTableName(name)
  if (!normalized.startsWith('ondr') || normalized.length < 4 || normalized.length > 7) return false
  return ONDRA_NAMES.some(candidate => isOneEditAway(normalized, candidate))
}

/** Deterministic pseudo-random source for unit tests and reproducible previews. */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

export function selectOndraMessageId(random: RandomSource = Math.random): OndraMessageId {
  const draw = random()
  const index = Number.isFinite(draw)
    ? Math.min(ONDRA_MESSAGE_IDS.length - 1, Math.max(0, Math.floor(draw * ONDRA_MESSAGE_IDS.length)))
    : 0
  return ONDRA_MESSAGE_IDS[index]
}

export interface TablePlayerIdentity {
  id: string
  name: string
}

export interface PendingOndraEvent {
  playerId: string
  playerName: string
  message: OndraMessageId
  triggerTurnCount: number
}

/**
 * Make the single round-scoped decision at an authoritative transition into
 * play. An eligible player gets one private event due 3–7 accepted actions
 * later. No wire frame is created here, so the easter egg cannot appear
 * immediately.
 */
export function scheduleOndraEventForPlayTransition(
  previousPhase: Phase,
  nextPhase: Phase,
  turnCount: number,
  players: readonly TablePlayerIdentity[],
  random: RandomSource = Math.random,
): PendingOndraEvent | null {
  if ((previousPhase !== 'rearrange' && previousPhase !== 'tribute') || nextPhase !== 'play') return null
  const player = players.find(candidate => isOndraLikeName(candidate.name))
  if (!player) return null

  const delayDraw = random()
  const delayIndex = Number.isFinite(delayDraw)
    ? Math.min(4, Math.max(0, Math.floor(delayDraw * 5)))
    : 0
  return {
    playerId: player.id,
    playerName: player.name,
    message: selectOndraMessageId(random),
    triggerTurnCount: turnCount + 3 + delayIndex,
  }
}

export type OndraSystemFrame = Extract<ServerMsg, { type: 'SYSTEM_EVENT' }>

export interface PendingOndraResolution {
  pending: PendingOndraEvent | null
  frame: OndraSystemFrame | null
}

/**
 * Atomically resolve the private event after an accepted gameplay mutation.
 * Leaving play or losing the named roster member clears it without emitting.
 */
export function resolvePendingOndraEvent(
  pending: PendingOndraEvent | null,
  phase: Phase,
  turnCount: number,
  players: readonly TablePlayerIdentity[],
  now: () => number = Date.now,
): PendingOndraResolution {
  if (!pending) return { pending: null, frame: null }
  const player = players.find(candidate => candidate.id === pending.playerId)
  if (!isTablePhase(phase) || !player || !isOndraLikeName(player.name)) {
    return { pending: null, frame: null }
  }
  if (turnCount < pending.triggerTurnCount) return { pending, frame: null }

  return {
    pending: null,
    frame: {
      type: 'SYSTEM_EVENT',
      event: {
        kind: 'ondra-mode',
        playerId: pending.playerId,
        playerName: player.name,
        message: pending.message,
        ts: now(),
      },
    },
  }
}

/** Preserve an unrelated player's event while the round remains on-table. */
export function pendingOndraEventAfterLeave(
  pending: PendingOndraEvent | null,
  leavingPlayerId: string,
  nextPhase: Phase | null,
): PendingOndraEvent | null {
  if (!pending || pending.playerId === leavingPlayerId || !nextPhase || !isTablePhase(nextPhase)) return null
  return pending
}

/** Validate a private persisted event before restoring a Durable Object. */
export function normalizeStoredPendingOndraEvent(
  value: unknown,
  players: unknown,
  currentTurnCount: number,
): PendingOndraEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  if (!Array.isArray(players)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.playerId !== 'string' || typeof candidate.playerName !== 'string') return null
  if (!isOndraLikeName(candidate.playerName)) return null
  if (typeof candidate.message !== 'string' || !(ONDRA_MESSAGE_IDS as readonly string[]).includes(candidate.message)) {
    return null
  }
  if (!Number.isSafeInteger(candidate.triggerTurnCount) || Number(candidate.triggerTurnCount) < 0) return null
  if (!Number.isSafeInteger(currentTurnCount) || currentTurnCount < 0) return null
  const triggerTurnCount = Number(candidate.triggerTurnCount)
  if (triggerTurnCount <= currentTurnCount || triggerTurnCount > currentTurnCount + 7) return null
  const rosterPlayer = players.find(player =>
    typeof player === 'object' && player !== null &&
    (player as Record<string, unknown>).id === candidate.playerId &&
    (player as Record<string, unknown>).name === candidate.playerName
  ) as Record<string, unknown> | undefined
  if (!rosterPlayer) return null
  return {
    playerId: candidate.playerId,
    playerName: String(rosterPlayer.name),
    message: candidate.message as OndraMessageId,
    triggerTurnCount,
  }
}

/**
 * Return the accepted server timestamp, or null while the combined
 * EMOTE/BROADCAST cooldown is closed. Suppressed attempts do not extend it.
 */
export function acceptedReactionAt(lastReactionAt: number | null, now: number): number | null {
  if (lastReactionAt !== null && now - lastReactionAt < REACTION_COOLDOWN_MS) return null
  return now
}
