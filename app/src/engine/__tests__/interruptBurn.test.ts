import { describe, expect, it } from 'vitest'
import {
  getInterruptBurnCards,
  getPhysicalTopRun,
  interruptBurn,
  playCards,
} from '../index'
import { c, mkState } from './helpers'

describe('cumulative physical four-or-more burns', () => {
  it('counts only the uninterrupted printed-rank run at the top', () => {
    const state = mkState({
      players: [{ id: 'a' }, { id: 'b' }],
      pile: [
        [c('4'), c('4')],
        [c('5')],
        [c('4')],
        [c('4', '♥')],
      ],
    })
    expect(getPhysicalTopRun(state)).toEqual({ rank: '4', count: 2 })
  })

  it('burns when a normal play completes a run across actions', () => {
    const threes = [c('6'), c('6', '♥'), c('6', '♦')]
    const state = mkState({
      players: [
        { id: 'a', hand: [...threes, c('9')] },
        { id: 'b', hand: [c('K')] },
      ],
      pile: [[c('4')], [c('6', '♣')]],
    })
    const result = playCards(state, 'a', threes)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
    expect(result.state.currentPlayerIdx).toBe(0)
    expect(result.state.log.at(-1)).toEqual({ type: 'CLEAR_PILE', reason: 'quartet' })
  })

  it('does not count an older same rank through an intervening rank', () => {
    const pair = [c('6'), c('6', '♥')]
    const state = mkState({
      players: [{ id: 'a', hand: [...pair, c('9')] }, { id: 'b', hand: [c('K')] }],
      pile: [[c('6'), c('6', '♦')], [c('5')], [c('6', '♣')]],
    })
    const result = playCards(state, 'a', pair)
    expect(result.error).toBeUndefined()
    expect(getPhysicalTopRun(result.state)).toEqual({ rank: '6', count: 3 })
    expect(result.state.pile).not.toEqual([])
  })

  it.each(['2', '3'] as const)('counts physical %s cards despite their effective-rank effect', rank => {
    const completing = [c(rank), c(rank, '♥'), c(rank, '♦')]
    const state = mkState({
      players: [{ id: 'a', hand: [...completing, c('9')] }, { id: 'b', hand: [c('K')] }],
      pile: [[c('7')], [c(rank, '♣')]],
    })
    const result = playCards(state, 'a', completing)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
  })

  it('allows and burns more than four equal cards from multiple decks', () => {
    const sixes = Array.from({ length: 7 }, (_, index) => c('6', '♠', `six-${index}`))
    const state = mkState({
      players: [{ id: 'a', hand: [...sixes, c('9')] }, { id: 'b', hand: [c('K')] }],
    })
    const result = playCards(state, 'a', sixes)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
    expect(result.state.players[0].hand).toHaveLength(1)
  })
})

describe('out-of-turn interrupt burn', () => {
  it('plays all matching hand cards, refills, burns, and transfers the lead', () => {
    const fours = [c('4'), c('4', '♥'), c('4', '♦')]
    const state = mkState({
      players: [
        { id: 'a', hand: [c('8')] },
        { id: 'b', hand: [...fours, c('9')] },
        { id: 'c', hand: [c('J')] },
      ],
      pile: [[c('4', '♣')]],
      stock: [c('Q'), c('K')],
      currentPlayerIdx: 0,
    })

    expect(getInterruptBurnCards(state, 'b')).toEqual(fours)
    const result = interruptBurn(state, 'b', fours)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
    expect(result.state.currentPlayerIdx).toBe(1)
    expect(result.state.players[1].hand.map(card => card.rank)).toEqual(['9', 'Q', 'K'])
    expect(result.state.stock).toEqual([])
    expect(result.state.turnCount).toBe(1)
    expect(result.state.seq).toBe(1)
    expect(result.state.log.map(event => event.type)).toEqual([
      'PLAY_CARDS', 'CLEAR_PILE', 'DRAW',
    ])
  })

  it('supports an active face-up row but never blind face-down cards', () => {
    const faceUp = [c('7'), c('7', '♥'), c('7', '♦'), c('9')]
    const visible = mkState({
      phase: 'endgame',
      players: [
        { id: 'a', hand: [c('8')] },
        { id: 'b', faceUp, faceDown: [c('K')] },
      ],
      pile: [[c('7', '♣')]],
    })
    const cards = getInterruptBurnCards(visible, 'b')
    expect(cards).toEqual(faceUp.slice(0, 3))
    const result = interruptBurn(visible, 'b', cards)
    expect(result.error).toBeUndefined()
    expect(result.state.players[1].faceUp).toEqual([faceUp[3]])
    expect(result.state.currentPlayerIdx).toBe(1)

    const blind = mkState({
      phase: 'endgame',
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', faceDown: [c('5'), c('5'), c('5')] }],
      pile: [[c('5')]],
    })
    expect(getInterruptBurnCards(blind, 'b')).toEqual([])
    expect(interruptBurn(blind, 'b', blind.players[1].faceDown).error).toMatch(/face-down/i)
  })

  it('canonicalizes submitted cards and rejects non-matching or unowned cards', () => {
    const fours = [c('4', '♠', 'real-1'), c('4', '♥', 'real-2'), c('4', '♦', 'real-3')]
    const state = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: [...fours, c('9')] }],
      pile: [[c('4')]],
    })
    const forged = fours.map(card => ({ ...card, rank: 'A' as const }))
    expect(interruptBurn(state, 'b', forged).error).toBeUndefined()
    expect(interruptBurn(state, 'b', [...fours.slice(0, 2), state.players[1].hand[3]]).error)
      .toMatch(/match/i)
    expect(interruptBurn(state, 'b', [...fours.slice(0, 2), c('4')]).error)
      .toMatch(/possession/i)
  })

  it('requires every matching active-zone card, even when a subset reaches four', () => {
    const fours = Array.from({ length: 4 }, (_, index) => c('4', '♠', `four-${index}`))
    const state = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: [...fours, c('9')] }],
      pile: [[c('4')]],
    })
    expect(interruptBurn(state, 'b', fours.slice(0, 3)).error).toMatch(/all matching/i)
    expect(interruptBurn(state, 'b', fours).error).toBeUndefined()
  })

  it('rejects an insufficient set, duplicate submission, current player, and bad phase', () => {
    const pair = [c('4'), c('4', '♥')]
    const state = mkState({
      players: [{ id: 'a', hand: [c('4'), c('4', '♥'), c('4', '♦')] }, { id: 'b', hand: pair }],
      pile: [[c('4')]],
    })
    expect(getInterruptBurnCards(state, 'b')).toEqual([])
    expect(interruptBurn(state, 'b', pair).error).toMatch(/at least four/i)
    expect(interruptBurn(state, 'b', [pair[0], pair[0]]).error).toMatch(/duplicate/i)
    expect(interruptBurn(state, 'a', state.players[0].hand).error).toMatch(/normal play/i)
    expect(interruptBurn({ ...state, phase: 'rearrange' }, 'b', pair).error).toMatch(/phase/i)
  })

  it('does not allow face-up matches while hand is the active zone', () => {
    const faceUp = [c('4'), c('4', '♥'), c('4', '♦')]
    const state = mkState({
      players: [
        { id: 'a', hand: [c('8')] },
        { id: 'b', hand: [c('9')], faceUp },
      ],
      pile: [[c('4')]],
    })
    expect(getInterruptBurnCards(state, 'b')).toEqual([])
    expect(interruptBurn(state, 'b', faceUp).error).toMatch(/hand right now/i)
  })

  it('rejects an empty pile and a legacy run that already reached four', () => {
    const fours = [c('4'), c('4', '♥'), c('4', '♦')]
    const empty = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: fours }],
    })
    expect(interruptBurn(empty, 'b', fours).error).toMatch(/empty/i)

    const alreadyFour = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: fours }],
      pile: [[c('4'), c('4', '♥'), c('4', '♦'), c('4', '♣')]],
    })
    expect(interruptBurn(alreadyFour, 'b', fours).error).toMatch(/already/i)
  })

  it('passes the lead when the interrupter goes out and preserves winner/loser semantics', () => {
    const fours = [c('4'), c('4', '♥'), c('4', '♦')]
    const threePlayer = mkState({
      players: [
        { id: 'a', hand: [c('8')] },
        { id: 'b', hand: fours },
        { id: 'c', hand: [c('9')] },
      ],
      pile: [[c('4')]],
    })
    const result = interruptBurn(threePlayer, 'b', fours)
    expect(result.error).toBeUndefined()
    expect(result.state.players[1].isOut).toBe(true)
    expect(result.state.winnerId).toBe('b')
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('c')
    expect(result.state.phase).not.toBe('gameOver')

    const twoPlayer = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: fours }],
      pile: [[c('4')]],
    })
    const gameOver = interruptBurn(twoPlayer, 'b', fours).state
    expect(gameOver.phase).toBe('gameOver')
    expect(gameOver.winnerId).toBe('b')
    expect(gameOver.loserId).toBe('a')
  })
})
