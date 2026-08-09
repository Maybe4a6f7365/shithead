import {
  DEFAULT_GAME_RULES,
  MAX_LOG_ENTRIES,
  type GameEvent,
  type GameRules,
  type GameState,
  type PendingTribute,
  type Player,
} from '../engine'

type LegacyState = Omit<GameState, 'rules' | 'winnerId' | 'pendingTribute'> & {
  rules?: Partial<GameRules>
  winnerId?: string | null
  pendingTribute?: PendingTribute | null
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

  const rules: GameRules = {
    ...DEFAULT_GAME_RULES,
    ...(state.rules ?? {}),
    ...(roomRules ?? {}),
  }
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

  return {
    ...state,
    rules,
    winnerId,
    loserId: validPlayerId(state.loserId, state.players) ? state.loserId : null,
    pendingTribute,
  }
}
