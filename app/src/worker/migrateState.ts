import {
  DEFAULT_GAME_RULES,
  MAX_LOG_ENTRIES,
  getPhysicalTopRun,
  type GameEvent,
  type GameRules,
  type GameState,
  type PendingQuickFollowUp,
  type PendingTribute,
  type Player,
} from '../engine'

type LegacyState = Omit<GameState, 'rules' | 'winnerId' | 'pendingTribute' | 'pendingQuickFollowUp'> & {
  rules?: Partial<GameRules>
  winnerId?: string | null
  pendingTribute?: PendingTribute | null
  pendingQuickFollowUp?: PendingQuickFollowUp | null
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

  // Preserve a live replacement-draw entitlement across a harmless worker
  // restart only when every security-relevant invariant still holds. Old or
  // malformed snapshots default to null instead of granting by rank alone.
  const quick = state.pendingQuickFollowUp
  const quickActor = quick && state.players.find(player => player.id === quick.playerId)
  const eligibleIds = quick && Array.isArray(quick.eligibleCardIds) ? quick.eligibleCardIds : []
  const uniqueEligible = new Set(eligibleIds)
  const handById = new Map(quickActor?.hand.map(card => [card.id, card] as const) ?? [])
  const topRun = getPhysicalTopRun(state as GameState)
  const pendingQuickFollowUp = quick &&
    (state.phase === 'play' || state.phase === 'endgame') &&
    quickActor && !quickActor.isOut &&
    Number.isSafeInteger(quick.sourceSeq) && quick.sourceSeq === (state.seq ?? 0) &&
    eligibleIds.length > 0 && uniqueEligible.size === eligibleIds.length &&
    eligibleIds.every(id => typeof id === 'string' && handById.get(id)?.rank === quick.rank) &&
    topRun?.rank === quick.rank
      ? { ...quick, eligibleCardIds: [...eligibleIds] }
      : null

  return {
    ...state,
    rules,
    winnerId,
    loserId: validPlayerId(state.loserId, state.players) ? state.loserId : null,
    pendingTribute,
    pendingQuickFollowUp,
  }
}
