import {
  DEFAULT_GAME_RULES,
  MAX_GAME_TURNS,
  MAX_LOG_ENTRIES,
  MAX_PLAYERS,
  createRoundStats,
  getPhysicalTopRun,
  type GameEvent,
  type GameRules,
  type GameState,
  type PendingQuickFollowUp,
  type PendingTribute,
  type Phase,
  type Player,
  type PlayerRoundStats,
  type RoundStats,
} from '../engine'
import {
  MAX_SPECTATORS_PER_ROOM,
  type SpectatorIdentity,
} from '../engine/protocol'

type LegacyState = Omit<GameState, 'rules' | 'winnerId' | 'pendingTribute' | 'pendingQuickFollowUp' | 'roundStats'> & {
  rules?: Partial<GameRules>
  winnerId?: string | null
  pendingTribute?: PendingTribute | null
  pendingQuickFollowUp?: PendingQuickFollowUp | null
  roundStats?: unknown
}

/**
 * Normalize rules at the persistence boundary. This both supplies new-rule
 * defaults for old rooms and prevents a corrupted snapshot from smuggling an
 * unsupported deck count into a future deal.
 */
export function normalizeGameRules(
  ...sources: Array<Partial<GameRules> | null | undefined>
): GameRules {
  const normalized: GameRules = { ...DEFAULT_GAME_RULES }
  for (const source of sources) {
    if (!source) continue
    if (typeof source.includeJokers === 'boolean') normalized.includeJokers = source.includeJokers
    if (typeof source.winnerSwapsFaceUp === 'boolean') normalized.winnerSwapsFaceUp = source.winnerSwapsFaceUp
    if (source.deckCount === 1 || source.deckCount === 2 || source.deckCount === 3) {
      normalized.deckCount = source.deckCount
    }
  }
  return normalized
}

/** Old or malformed room snapshots keep the historically enabled behavior. */
export function normalizeEasterEggEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}

function validPlayerId(value: unknown, players: Player[]): value is string {
  return typeof value === 'string' && players.some(player => player.id === value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Restore only bounded, unique watcher identities that do not collide with a
 * current player seat. Array order is the authoritative FIFO order; joinedAt
 * is validated for display/auditing but never trusted to reorder the queue.
 */
export function normalizeSpectators(
  value: unknown,
  players: readonly Player[],
  now = Date.now(),
  resumeTokens?: Readonly<Record<string, unknown>>,
): SpectatorIdentity[] {
  if (!Array.isArray(value)) return []
  const used = new Set(players.map(player => player.id))
  const out: SpectatorIdentity[] = []
  for (const candidate of value) {
    if (out.length >= MAX_SPECTATORS_PER_ROOM) break
    if (!isRecord(candidate) ||
      typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128 ||
      typeof candidate.name !== 'string' || candidate.name.trim().length === 0 || candidate.name.length > 32 ||
      !Number.isSafeInteger(candidate.joinedAt) || Number(candidate.joinedAt) < 0 || Number(candidate.joinedAt) > now ||
      (candidate.disconnectedAt !== undefined &&
        (!Number.isSafeInteger(candidate.disconnectedAt) || Number(candidate.disconnectedAt) <= 0 ||
          Number(candidate.disconnectedAt) > now)) ||
      (resumeTokens !== undefined &&
        (typeof resumeTokens[candidate.id] !== 'string' || !/^[0-9a-f]{64}$/.test(resumeTokens[candidate.id] as string))) ||
      used.has(candidate.id)) continue
    used.add(candidate.id)
    out.push({
      id: candidate.id,
      name: candidate.name.trim(),
      joinedAt: Number(candidate.joinedAt),
      ...(candidate.disconnectedAt === undefined ? {} : { disconnectedAt: Number(candidate.disconnectedAt) }),
    })
  }
  return out
}

/** Keep only plausible server timestamps belonging to current player seats. */
export function normalizeOfflineSince(
  value: unknown,
  players: readonly Player[],
  now = Date.now(),
): Record<string, number> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(players.flatMap(player => {
    const timestamp = value[player.id]
    return Number.isSafeInteger(timestamp) && Number(timestamp) > 0 && Number(timestamp) <= now
      ? [[player.id, Number(timestamp)]]
      : []
  }))
}

/** Votes never survive into a live/new round and never retain unknown IDs. */
export function normalizeRematchVotes(
  value: unknown,
  players: readonly Player[],
  phase: Phase | null,
): Record<string, boolean> {
  if (phase !== 'gameOver' || !isRecord(value)) return {}
  return Object.fromEntries(players.flatMap(player =>
    typeof value[player.id] === 'boolean' ? [[player.id, value[player.id] as boolean]] : []
  ))
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_GAME_TURNS * 12

function validRoundPlayerStats(value: unknown): value is PlayerRoundStats {
  if (!isRecord(value)) return false
  return typeof value.playerId === 'string' && value.playerId.length > 0 && value.playerId.length <= 128 &&
    typeof value.playerName === 'string' && value.playerName.length > 0 && value.playerName.length <= 32 &&
    isCount(value.cardsPlayed) && isCount(value.tensPlayed) && isCount(value.burns) &&
    isCount(value.pickups) && isCount(value.largestPickup) &&
    value.tensPlayed <= value.cardsPlayed && value.burns <= value.cardsPlayed &&
    value.pickups <= MAX_GAME_TURNS
}

/**
 * Preserve counters only when the whole stored snapshot is internally
 * coherent. Missing/legacy data starts at zero with `complete=false`; event
 * logs are deliberately never replayed because they are capped and contain
 * display duplicates for quick follow-ups.
 */
export function normalizeRoundStats(value: unknown, players: Player[]): RoundStats {
  const fallback = () => createRoundStats(players, false)
  if (!isRecord(value) || typeof value.complete !== 'boolean' ||
    !Array.isArray(value.players) || !Array.isArray(value.finishOrder) ||
    value.players.length > MAX_PLAYERS) return fallback()

  if (!value.players.every(validRoundPlayerStats)) return fallback()
  const storedPlayers = value.players.map(stats => ({ ...stats }))
  if (storedPlayers.reduce((sum, stats) => sum + stats.cardsPlayed, 0) > MAX_GAME_TURNS * 12 ||
    storedPlayers.reduce((sum, stats) => sum + stats.burns, 0) > MAX_GAME_TURNS ||
    storedPlayers.reduce((sum, stats) => sum + stats.pickups, 0) > MAX_GAME_TURNS) return fallback()
  const ids = new Set(storedPlayers.map(stats => stats.playerId))
  if (ids.size !== storedPlayers.length) return fallback()
  if (value.finishOrder.length > storedPlayers.length ||
    !value.finishOrder.every(id => typeof id === 'string' && ids.has(id)) ||
    new Set(value.finishOrder).size !== value.finishOrder.length) return fallback()

  let complete = value.complete
  for (const player of players) {
    if (ids.has(player.id)) continue
    storedPlayers.push(createRoundStats([player], false).players[0])
    ids.add(player.id)
    complete = false
  }
  if (storedPlayers.length > MAX_PLAYERS) return fallback()

  return {
    players: storedPlayers,
    finishOrder: [...value.finishOrder] as string[],
    complete,
  }
}

/**
 * Old snapshots did not store the first player out. A sole out player is
 * unambiguous. With several out players we may use the earliest PLAYER_OUT
 * only when the ring buffer is demonstrably not full; a full ring could have
 * discarded the real first event, so guessing would award tribute wrongly.
 */
export function deriveLegacyWinnerId(state: Pick<LegacyState, 'players' | 'log'>): string | null {
  const outIds = new Set(state.players.filter(player => player.isOut).map(player => player.id))
  if (outIds.size === 1) return [...outIds][0]
  if (outIds.size < 2 || state.log.length >= MAX_LOG_ENTRIES) return null

  const firstOut = state.log.find(
    (event): event is Extract<GameEvent, { type: 'PLAYER_OUT' }> =>
      event.type === 'PLAYER_OUT' && outIds.has(event.playerId),
  )
  return firstOut?.playerId ?? null
}

export function normalizePersistedGameState(
  state: LegacyState | null | undefined,
  roomRules?: Partial<GameRules>,
): GameState | null {
  if (!state) return null

  const rules = normalizeGameRules(state.rules, roomRules)
  // A v2 snapshot may legitimately reference a winner who explicitly left
  // after going out and was therefore removed from `players`. Preserve that
  // authoritative historical result. Only legacy snapshots with no recorded
  // winner need the conservative derivation below.
  const winnerId = typeof state.winnerId === 'string' && state.winnerId.length > 0
    ? state.winnerId
    : deriveLegacyWinnerId(state)
  const pending = state.pendingTribute
  const pendingTribute = pending && rules.winnerSwapsFaceUp &&
    validPlayerId(pending.winnerId, state.players) &&
    validPlayerId(pending.loserId, state.players) &&
    pending.winnerId !== pending.loserId
      ? { winnerId: pending.winnerId, loserId: pending.loserId }
      : null

  // Preserve a live quick-match entitlement across a harmless worker
  // restart only when every security-relevant invariant still holds. Old or
  // malformed snapshots default to null instead of granting by rank alone.
  const quick = state.pendingQuickFollowUp
  const quickActor = quick && state.players.find(player => player.id === quick.playerId)
  const eligibleIds = quick && Array.isArray(quick.eligibleCardIds) ? quick.eligibleCardIds : []
  const uniqueEligible = new Set(eligibleIds)
  const activeVisibleCards = quickActor
    ? quickActor.hand.length > 0
      ? quickActor.hand
      : quickActor.faceUp.length > 0
        ? quickActor.faceUp
        : []
    : []
  const activeVisibleById = new Map(activeVisibleCards.map(card => [card.id, card] as const))
  const topRun = getPhysicalTopRun(state as GameState)
  const pendingQuickFollowUp = quick &&
    (state.phase === 'play' || state.phase === 'endgame') &&
    quickActor && !quickActor.isOut &&
    Number.isSafeInteger(quick.sourceSeq) && quick.sourceSeq === (state.seq ?? 0) &&
    eligibleIds.length > 0 && uniqueEligible.size === eligibleIds.length &&
    eligibleIds.every(id => typeof id === 'string' && activeVisibleById.get(id)?.rank === quick.rank) &&
    topRun?.rank === quick.rank && topRun.count < 4
      ? { ...quick, eligibleCardIds: [...eligibleIds] }
      : null

  return {
    ...state,
    rules,
    winnerId,
    loserId: validPlayerId(state.loserId, state.players) ? state.loserId : null,
    pendingTribute,
    pendingQuickFollowUp,
    roundStats: normalizeRoundStats(state.roundStats, state.players),
  }
}
