import { describe, expect, it } from 'vitest'
import { initGame, pickUpPile, playCards, quickFollowUp, seededRng } from '../index'
import { c, mkState } from './helpers'

function statsFor(state: ReturnType<typeof mkState>, playerId: string) {
  return state.roundStats?.players.find(stats => stats.playerId === playerId)
}

describe('authoritative round statistics', () => {
  it('starts a new deal with complete zeroed name snapshots', () => {
    const state = initGame({
      players: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bert' }],
      rng: seededRng(4),
    })
    expect(state.roundStats).toEqual({
      complete: true,
      finishOrder: [],
      players: [
        expect.objectContaining({ playerId: 'a', playerName: 'Ada', cardsPlayed: 0 }),
        expect.objectContaining({ playerId: 'b', playerName: 'Bert', cardsPlayed: 0 }),
      ],
    })
  })

  it('counts physical cards and tens once at an accepted burning play', () => {
    const tens = [c('10'), c('10')]
    const state = mkState({
      players: [
        { id: 'a', name: 'Ada', hand: [...tens, c('5')] },
        { id: 'b', hand: [c('6')] },
      ],
      pile: [[c('9')]],
    })
    const result = playCards(state, 'a', tens)
    expect(result.error).toBeUndefined()
    expect(statsFor(result.state, 'a')).toMatchObject({
      playerName: 'Ada', cardsPlayed: 2, tensPlayed: 2, burns: 1,
    })
  })

  it('counts a quick follow-up once despite its two display log events', () => {
    const eligible = c('6', '♥', 'eligible-six')
    const state = mkState({
      players: [
        { id: 'a', hand: [eligible, c('9')] },
        { id: 'b', hand: [c('7')] },
      ],
      currentPlayerIdx: 1,
      pile: [[c('6')]],
      pendingQuickFollowUp: {
        playerId: 'a', rank: '6', eligibleCardIds: [eligible.id], sourceSeq: 0,
      },
    })
    const result = quickFollowUp(state, 'a', [eligible])
    expect(result.error).toBeUndefined()
    expect(statsFor(result.state, 'a')).toMatchObject({ cardsPlayed: 1, tensPlayed: 0, burns: 0 })
    expect(result.state.log.filter(event =>
      event.type === 'PLAY_CARDS' || event.type === 'QUICK_FOLLOW_UP'
    )).toHaveLength(2)
  })

  it('records voluntary and failed-blind pickup sizes at the mutation boundary', () => {
    const voluntary = mkState({
      players: [{ id: 'a', hand: [c('4')] }, { id: 'b', hand: [c('5')] }],
      pile: [[c('6'), c('6')], [c('7'), c('7'), c('7')]],
    })
    const picked = pickUpPile(voluntary, 'a').state
    expect(statsFor(picked, 'a')).toMatchObject({ pickups: 1, largestPickup: 5 })

    const blind = c('4', '♣', 'blind-four')
    const failedBlind = mkState({
      players: [
        { id: 'a', hand: [], faceUp: [], faceDown: [blind] },
        { id: 'b', hand: [c('5')] },
      ],
      pile: [[c('A')]],
    })
    const failed = playCards(failedBlind, 'a', [blind]).state
    expect(statsFor(failed, 'a')).toMatchObject({ pickups: 1, largestPickup: 2 })
  })

  it('retains the exact order in which players empty every card zone', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('K')] },
        { id: 'b', hand: [c('A')] },
        { id: 'c', hand: [c('A')] },
      ],
      pile: [[c('9')]],
    })
    const first = playCards(state, 'a', [state.players[0].hand[0]]).state
    const finished = playCards(first, 'b', [first.players[1].hand[0]]).state
    expect(finished.phase).toBe('gameOver')
    expect(finished.roundStats?.finishOrder).toEqual(['a', 'b'])
    expect(finished.loserId).toBe('c')
  })
})
