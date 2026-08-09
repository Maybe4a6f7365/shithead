import { MAX_LOG_ENTRIES, type GameEvent, type GameState } from '../engine'

/** Apply an authenticated explicit leave to an active round. */
export function applyPlayerForfeit(state: GameState, leavingId: string): GameState {
  const leaving = state.players.find(player => player.id === leavingId)
  if (!leaving) return state

  // Somebody who already placed cannot become the loser by leaving. Remove
  // their inactive turn slot and let the remaining players finish the round.
  if (leaving.isOut) {
    const currentId = state.players[state.currentPlayerIdx]?.id
    const players = state.players.filter(player => player.id !== leavingId)
    let currentPlayerIdx = players.findIndex(player => player.id === currentId)
    if (currentPlayerIdx < 0) currentPlayerIdx = Math.max(0, players.findIndex(player => !player.isOut))
    return { ...state, players, currentPlayerIdx, seq: (state.seq ?? 0) + 1 }
  }

  const remaining = state.players.filter(player => player.id !== leavingId && !player.isOut)
  // A 2P forfeit has one unambiguous winner. With 3+ survivors and nobody
  // previously out, first place is unknowable and intentionally stays null.
  const winnerId = state.winnerId ?? (remaining.length === 1 ? remaining[0].id : null)
  const event: GameEvent = { type: 'GAME_OVER', loserId: leavingId }
  const log = [...state.log, event]
  return {
    ...state,
    phase: 'gameOver',
    winnerId,
    loserId: leavingId,
    pendingTribute: null,
    log: log.length > MAX_LOG_ENTRIES ? log.slice(-MAX_LOG_ENTRIES) : log,
    seq: (state.seq ?? 0) + 1,
  }
}
