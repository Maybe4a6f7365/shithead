import { describe, expect, it } from 'vitest'
import {
  getQuickFollowUpCards,
  interruptBurn,
  pickUpPile,
  playCards,
  quickFollowUp,
} from '../index'
import { c, mkState } from './helpers'

describe('drawn-card quick follow-up entitlement', () => {
  it('opens only for matching cards actually drawn by a normal visible play', () => {
    const played = c('5')
    const oldFive = c('5', '♥')
    const drawnFive = c('5', '♦')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, oldFive, c('9')] },
        { id: 'b', hand: [c('6'), c('Q')] },
      ],
      pile: [[c('4')]],
      stock: [drawnFive],
    })

    const result = playCards(state, 'a', [played])
    expect(result.error).toBeUndefined()
    expect(result.state.pendingQuickFollowUp).toEqual({
      playerId: 'a',
      rank: '5',
      eligibleCardIds: [drawnFive.id],
      sourceSeq: 1,
    })
    expect(getQuickFollowUpCards(result.state, 'a')).toEqual([drawnFive])
    expect(getQuickFollowUpCards(result.state, 'b')).toEqual([])
    expect(quickFollowUp(result.state, 'a', [oldFive]).error).toMatch(/not drawn/i)
  })

  it('does not open when the replacement rank differs', () => {
    const played = c('5')
    const state = mkState({
      players: [{ id: 'a', hand: [played, c('8'), c('9')] }, { id: 'b', hand: [c('6')] }],
      stock: [c('Q')],
    })
    const result = playCards(state, 'a', [played])
    expect(result.state.pendingQuickFollowUp).toBeNull()
    expect(getQuickFollowUpCards(result.state, 'a')).toEqual([])
  })

  it('supports multi-card plays and every matching card in a multi-card refill', () => {
    const pair = [c('6'), c('6', '♥')]
    const oldSix = c('6', '♦')
    const drawnA = c('6', '♣')
    const drawnB = c('6', '♠')
    const state = mkState({
      players: [{ id: 'a', hand: [...pair, oldSix] }, { id: 'b', hand: [c('7')] }],
      stock: [drawnA, drawnB],
    })
    const result = playCards(state, 'a', pair)
    expect(result.state.pendingQuickFollowUp?.eligibleCardIds).toEqual([drawnA.id, drawnB.id])
    expect(getQuickFollowUpCards(result.state, 'a')).toEqual([drawnA, drawnB])
    expect(quickFollowUp(result.state, 'a', [oldSix]).error).toMatch(/not drawn/i)
    expect(quickFollowUp(result.state, 'a', [drawnA, drawnB]).error).toBeUndefined()
  })

  it('accepts a quick card after turn advancement, preserves that next turn, and logs it explicitly', () => {
    const played = c('5')
    const drawn = c('5', '♥')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('8'), c('9')] },
        { id: 'b', hand: [c('6'), c('Q')] },
        { id: 'c', hand: [c('7'), c('K')] },
      ],
      stock: [drawn, c('A')],
    })
    const normal = playCards(state, 'a', [played]).state
    expect(normal.players[normal.currentPlayerIdx].id).toBe('b')

    const result = quickFollowUp(normal, 'a', [drawn])
    expect(result.error).toBeUndefined()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('b')
    expect(result.state.players[0].hand).toHaveLength(3)
    expect(result.state.seq).toBe(2)
    expect(result.state.turnCount).toBe(2)
    expect(result.state.log.slice(-3).map(event => event.type)).toEqual([
      'PLAY_CARDS', 'QUICK_FOLLOW_UP', 'DRAW',
    ])
  })

  it('chains: unused entitlements survive and a matching new replacement is added', () => {
    const pair = [c('4'), c('4', '♥')]
    const oldFour = c('4', '♦')
    const drawnA = c('4', '♣')
    const drawnB = c('4', '♠')
    const chained = c('4', '♥')
    const state = mkState({
      players: [{ id: 'a', hand: [...pair, oldFour] }, { id: 'b', hand: [c('6'), c('9')] }],
      stock: [drawnA, drawnB, chained],
    })
    const normal = playCards(state, 'a', pair).state
    const firstQuick = quickFollowUp(normal, 'a', [drawnA]).state

    expect(firstQuick.pendingQuickFollowUp).toEqual({
      playerId: 'a',
      rank: '4',
      eligibleCardIds: [drawnB.id, chained.id],
      sourceSeq: 2,
    })
    expect(getQuickFollowUpCards(firstQuick, 'a')).toEqual([drawnB, chained])
    expect(quickFollowUp(firstQuick, 'a', [oldFour]).error).toMatch(/not drawn/i)
  })

  it('burns a cumulative four-of-a-kind and hands the lead to the quick player', () => {
    const played = c('5')
    const drawn = c('5', '♥')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('8'), c('9')] },
        { id: 'b', hand: [c('6'), c('Q')] },
        { id: 'c', hand: [c('7'), c('K')] },
      ],
      pile: [[c('5', '♦')], [c('5', '♣')]],
      stock: [drawn],
    })
    const normal = playCards(state, 'a', [played]).state
    expect(normal.pile).toHaveLength(3)

    const quick = quickFollowUp(normal, 'a', [drawn]).state
    expect(quick.pile).toEqual([])
    expect(quick.players[quick.currentPlayerIdx].id).toBe('a')
    expect(quick.pendingQuickFollowUp).toBeNull()
    expect(quick.log.some(event => event.type === 'CLEAR_PILE' && event.reason === 'quartet')).toBe(true)
  })

  it('adds each quick 8 to the already-calculated cumulative skip', () => {
    const played = c('8')
    const drawn = c('8', '♥')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('9'), c('Q')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
        { id: 'd', hand: [c('9')] },
      ],
      stock: [drawn],
    })
    const normal = playCards(state, 'a', [played]).state
    expect(normal.players[normal.currentPlayerIdx].id).toBe('c')
    const quick = quickFollowUp(normal, 'a', [drawn]).state
    expect(quick.players[quick.currentPlayerIdx].id).toBe('d')
  })

  it('lets a still-current actor decline after a stacked 8 and take a normal turn', () => {
    const played = c('8')
    const drawn = c('8', '♥')
    const normalNextCard = c('9')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, normalNextCard, c('Q')] },
        { id: 'b', hand: [c('9'), c('K')] },
      ],
      stock: [drawn, c('A')],
    })
    const first = playCards(state, 'a', [played]).state
    // In two-player play, one 8 skips b and returns the normal turn to a.
    expect(first.players[first.currentPlayerIdx].id).toBe('a')
    expect(first.pendingQuickFollowUp?.eligibleCardIds).toEqual([drawn.id])

    const declined = playCards(first, 'a', [normalNextCard])
    expect(declined.error).toBeUndefined()
    expect(declined.state.players[declined.state.currentPlayerIdx].id).toBe('b')
    expect(declined.state.pendingQuickFollowUp).toBeNull()
    expect(quickFollowUp(declined.state, 'a', [drawn]).error).toMatch(/no quick follow-up/i)
  })

  it('lets a still-current actor decline after a stacked 8 by picking up', () => {
    const played = c('8')
    const drawn = c('8', '♥')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('9'), c('Q')] },
        { id: 'b', hand: [c('9'), c('K')] },
      ],
      stock: [drawn],
    })
    const first = playCards(state, 'a', [played]).state
    expect(first.players[first.currentPlayerIdx].id).toBe('a')
    expect(first.pendingQuickFollowUp).not.toBeNull()

    const declined = pickUpPile(first, 'a')
    expect(declined.error).toBeUndefined()
    expect(declined.state.players[declined.state.currentPlayerIdx].id).toBe('b')
    expect(declined.state.pendingQuickFollowUp).toBeNull()
  })

  it('never opens after a clearing play or a blind play', () => {
    const ten = c('10')
    const tenReplacement = c('10', '♥')
    const burnState = mkState({
      players: [{ id: 'a', hand: [ten, c('8'), c('9')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('4')]],
      stock: [tenReplacement],
    })
    expect(playCards(burnState, 'a', [ten]).state.pendingQuickFollowUp).toBeNull()

    const blind = c('5')
    const blindReplacement = c('5', '♥')
    const blindState = mkState({
      players: [{ id: 'a', faceDown: [blind] }, { id: 'b', hand: [c('6')] }],
      phase: 'endgame',
      stock: [blindReplacement],
    })
    expect(playCards(blindState, 'a', [blind]).state.pendingQuickFollowUp).toBeNull()
  })

  it('rejects duplicates, forged/unknown ids, wrong actors, and stale source sequences', () => {
    const played = c('5')
    const drawn = c('5', '♥', 'drawn-id')
    const state = mkState({
      players: [{ id: 'a', hand: [played, c('8'), c('9')] }, { id: 'b', hand: [c('6')] }],
      stock: [drawn],
    })
    const normal = playCards(state, 'a', [played]).state
    expect(quickFollowUp(normal, 'a', [drawn, drawn]).error).toMatch(/duplicate/i)
    expect(quickFollowUp(normal, 'a', [c('5', '♦', 'unknown')]).error).toMatch(/not drawn/i)
    expect(quickFollowUp(normal, 'b', [drawn]).error).toMatch(/no quick follow-up/i)

    const stale = {
      ...normal,
      pendingQuickFollowUp: { ...normal.pendingQuickFollowUp!, sourceSeq: normal.seq! - 1 },
    }
    expect(getQuickFollowUpCards(stale, 'a')).toEqual([])
    expect(quickFollowUp(stale, 'a', [drawn]).error).toMatch(/expired/i)
  })
})

describe('quick follow-up expiry races', () => {
  function pendingState() {
    const played = c('5')
    const drawn = c('5', '♥')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('8'), c('9')] },
        { id: 'b', hand: [c('4'), c('6')] },
        { id: 'c', hand: [c('7'), c('Q')] },
      ],
      pile: [[c('3')]],
      stock: [drawn],
    })
    return { drawn, state: playCards(state, 'a', [played]).state }
  }

  it('does not expire on a rejected competitor action, but does on an accepted play', () => {
    const { drawn, state } = pendingState()
    const rejected = playCards(state, 'b', [state.players[1].hand[0]])
    expect(rejected.error).toMatch(/cannot be played/i)
    expect(rejected.state.pendingQuickFollowUp).toEqual(state.pendingQuickFollowUp)
    expect(quickFollowUp(rejected.state, 'a', [drawn]).error).toBeUndefined()

    const accepted = playCards(state, 'b', [state.players[1].hand[1]])
    expect(accepted.error).toBeUndefined()
    expect(accepted.state.pendingQuickFollowUp).toBeNull()
    expect(quickFollowUp(accepted.state, 'a', [drawn]).error).toMatch(/no quick follow-up/i)
  })

  it('expires on an accepted pickup', () => {
    const { drawn, state } = pendingState()
    const pickedUp = pickUpPile(state, 'b')
    expect(pickedUp.error).toBeUndefined()
    expect(pickedUp.state.pendingQuickFollowUp).toBeNull()
    expect(quickFollowUp(pickedUp.state, 'a', [drawn]).error).toMatch(/no quick follow-up/i)
  })

  it('expires when another player wins the burn-in race', () => {
    const played = c('4')
    const drawn = c('4', '♥')
    const cutIn = c('4', '♦')
    const state = mkState({
      players: [
        { id: 'a', hand: [played, c('8'), c('9')] },
        { id: 'b', hand: [c('6'), c('Q')] },
        { id: 'c', hand: [cutIn, c('7')] },
      ],
      pile: [[c('4', '♣')], [c('4', '♠')]],
      stock: [drawn],
    })
    const normal = playCards(state, 'a', [played]).state
    expect(normal.pendingQuickFollowUp).not.toBeNull()
    const burned = interruptBurn(normal, 'c', [cutIn])
    expect(burned.error).toBeUndefined()
    expect(burned.state.pile).toEqual([])
    expect(burned.state.pendingQuickFollowUp).toBeNull()
    expect(quickFollowUp(burned.state, 'a', [drawn]).error).toMatch(/no quick follow-up/i)
  })
})
