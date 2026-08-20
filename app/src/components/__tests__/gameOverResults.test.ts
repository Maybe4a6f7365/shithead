import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES, type GameState, type Player } from '../../engine'
import { gameOverResults } from '../gameOverResults'

const player = (id: string): Player => ({
  id,
  name: id.toUpperCase(),
  hand: [],
  faceUp: [],
  faceDown: [],
  isOut: id !== 'last',
})

function gameState(): GameState {
  return {
    phase: 'gameOver',
    rules: { ...DEFAULT_GAME_RULES },
    players: [player('first'), player('middle'), player('last')],
    stock: [],
    pile: [],
    currentPlayerIdx: 2,
    playDirection: 1,
    turnCount: 20,
    winnerId: 'first',
    loserId: 'last',
    pendingTribute: null,
    pendingQuickFollowUp: null,
    roundStats: {
      complete: true,
      finishOrder: ['first', 'middle'],
      players: [
        { playerId: 'first', playerName: 'FIRST', cardsPlayed: 12, tensPlayed: 2, burns: 2, pickups: 0, largestPickup: 0 },
        { playerId: 'middle', playerName: 'MIDDLE', cardsPlayed: 9, tensPlayed: 0, burns: 1, pickups: 1, largestPickup: 4 },
        { playerId: 'last', playerName: 'LAST', cardsPlayed: 7, tensPlayed: 1, burns: 0, pickups: 2, largestPickup: 8 },
      ],
    },
    log: [],
    seq: 20,
  }
}

describe('gameOverResults', () => {
  it('keeps exact finishers ordered and places the recorded loser last', () => {
    const view = gameOverResults(gameState())
    expect(view.statsNote).toBeUndefined()
    expect(view.leaderboard.map(row => [row.playerId, row.place])).toEqual([
      ['first', 1],
      ['middle', 2],
      ['last', 3],
    ])
    expect(view.leaderboard[2]).toMatchObject({ isLoser: true, largestPickup: 8 })
  })

  it('marks unresolved middle placements and never promotes a forfeit survivor', () => {
    const state = gameState()
    // A partial snapshot may begin recording only after the known winner left.
    // Its first retained finisher is not necessarily first place.
    state.roundStats = { ...state.roundStats!, complete: false, finishOrder: ['middle'] }
    const view = gameOverResults(state)
    expect(view.statsNote).toBe('partial')
    expect(view.leaderboard.map(row => [row.playerId, row.place])).toEqual([
      ['first', 1],
      ['middle', null],
      ['last', 3],
    ])

    state.roundStats = { ...state.roundStats!, complete: true }
    const incoherent = gameOverResults(state)
    expect(incoherent.statsNote).toBe('partial')
    expect(incoherent.leaderboard.map(row => [row.playerId, row.place])).toEqual([
      ['first', 1],
      ['middle', null],
      ['last', 3],
    ])
  })

  it('labels states without authoritative counters as legacy', () => {
    const state = gameState()
    delete state.roundStats
    expect(gameOverResults(state)).toMatchObject({
      statsNote: 'legacy',
      leaderboard: [
        { playerId: 'first', cardsPlayed: 0 },
        { playerId: 'middle', place: null },
        { playerId: 'last', place: 3, isLoser: true },
      ],
    })
  })
})
