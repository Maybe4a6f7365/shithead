import type { GameState, PlayerRoundStats } from '../engine'
import type { GameOverLeaderboardRow, GameOverStatsNote } from './GameOverOverlay'

export interface GameOverResultsView {
  leaderboard: GameOverLeaderboardRow[]
  statsNote?: GameOverStatsNote
}

const emptyStats = (player: GameState['players'][number]): PlayerRoundStats => ({
  playerId: player.id,
  playerName: player.name,
  cardsPlayed: 0,
  tensPlayed: 0,
  burns: 0,
  pickups: 0,
  largestPickup: 0,
})

/**
 * Convert authoritative round counters into presentation order without
 * inventing placements. Normal finishers keep their exact order and the
 * recorded Shithead is last; stalemate/forfeit survivors remain unplaced.
 */
export function gameOverResults(state: GameState): GameOverResultsView {
  const stats = state.roundStats
  const snapshots = stats?.players.length
    ? stats.players
    : state.players.map(emptyStats)
  const byId = new Map(snapshots.map(player => [player.playerId, player] as const))
  const orderedIds: string[] = []
  const add = (playerId: string | null | undefined) => {
    if (playerId && byId.has(playerId) && !orderedIds.includes(playerId)) orderedIds.push(playerId)
  }

  for (const playerId of stats?.finishOrder ?? []) add(playerId)
  // A migrated round may know its first winner even when the old bounded log
  // no longer contains the PLAYER_OUT event.
  if (state.winnerId && !orderedIds.includes(state.winnerId)) {
    orderedIds.unshift(state.winnerId)
  }

  for (const player of snapshots) {
    if (player.playerId !== state.loserId) add(player.playerId)
  }
  add(state.loserId)

  const exactFinishOrder = stats?.finishOrder ?? []
  const completeOrderIsCoherent = (
    !state.winnerId || exactFinishOrder.length === 0 || exactFinishOrder[0] === state.winnerId
  )
  const exactPlacesAvailable = stats?.complete === true && completeOrderIsCoherent
  const participantCount = snapshots.length
  const leaderboard = orderedIds.map(playerId => {
    const player = byId.get(playerId)!
    const exactIndex = exactFinishOrder.indexOf(playerId)
    const place = playerId === state.loserId && participantCount > 0
      ? participantCount
      : playerId === state.winnerId
        ? 1
        : exactPlacesAvailable && exactIndex >= 0
          ? exactIndex + 1
          : null
    return {
      playerId,
      name: player.playerName,
      place,
      isLoser: playerId === state.loserId,
      cardsPlayed: player.cardsPlayed,
      tensPlayed: player.tensPlayed,
      burns: player.burns,
      pickups: player.pickups,
      largestPickup: player.largestPickup,
    }
  })

  return {
    leaderboard,
    statsNote: !stats ? 'legacy' : stats.complete && completeOrderIsCoherent ? undefined : 'partial',
  }
}
