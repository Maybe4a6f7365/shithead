import { describe, expect, it } from 'vitest'
import { applyInterruptBurnRequest, canonicalCards } from '../../worker/gameActions'
import { c, mkState } from './helpers'

describe('worker BURN_IN boundary', () => {
  it('canonicalizes ids, ignores forged rank fields, burns cumulatively, and gives the interrupter the lead', () => {
    const tableFour = c('4', '♠', 'table-4')
    const fours = [
      c('4', '♥', 'b-4-1'),
      c('4', '♦', 'b-4-2'),
      c('4', '♣', 'b-4-3'),
    ]
    const state = mkState({
      players: [
        { id: 'a', hand: [c('6')] },
        { id: 'b', hand: [...fours, c('9', '♠', 'b-stays')] },
        { id: 'c', hand: [c('7')] },
      ],
      pile: [[tableFour]],
      currentPlayerIdx: 0,
    })
    const forged = fours.map(card => ({ ...card, rank: 'A' as const, suit: '♠' as const }))

    expect(canonicalCards(state, 'b', forged)).toEqual(fours)
    const result = applyInterruptBurnRequest(state, 'b', forged)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('b')
    expect(result.state.players.find(player => player.id === 'b')?.hand.map(card => card.id)).toEqual(['b-stays'])
    expect(result.state.seq).toBe((state.seq ?? 0) + 1)
  })

  it('allows a public face-up interrupt and a cumulative run beyond four across decks', () => {
    const faceUp = [c('Q', '♠', 'q-copy-a'), c('Q', '♥', 'q-copy-b')]
    const state = mkState({
      players: [
        { id: 'a', hand: [c('K')] },
        { id: 'b', hand: [], faceUp: [...faceUp, c('7', '♦', 'b-stays-up')] },
        { id: 'c', hand: [c('A')] },
      ],
      pile: [[c('Q', '♣', 'q-table-1')], [c('Q', '♦', 'q-table-2')], [c('Q', '♠', 'q-table-3')]],
      currentPlayerIdx: 0,
    })
    const result = applyInterruptBurnRequest(state, 'b', faceUp)
    expect(result.error).toBeUndefined()
    expect(result.state.pile).toEqual([])
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('b')
  })

  it.each([
    ['unknown/unauthenticated player', () => ({
      actor: 'missing',
      state: mkState({ players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: [c('4')] }], pile: [[c('4')]] }),
      cards: [c('4', '♠', 'not-owned')],
    })],
    ['insufficient matching cards', () => {
      const cards = [c('4'), c('4')]
      return {
        actor: 'b',
        state: mkState({ players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: [...cards, c('9')] }], pile: [[c('4')]] }),
        cards,
      }
    }],
    ['nonmatching cards', () => {
      const cards = [c('5'), c('5'), c('5')]
      return {
        actor: 'b',
        state: mkState({ players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: cards }], pile: [[c('4')]] }),
        cards,
      }
    }],
    ['the current player', () => {
      const cards = [c('4'), c('4'), c('4')]
      return {
        actor: 'b',
        state: mkState({
          players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: cards }], pile: [[c('4')]], currentPlayerIdx: 1,
        }),
        cards,
      }
    }],
    ['a hidden face-down alias', () => {
      const down = [c('4'), c('4'), c('4')]
      return {
        actor: 'b',
        state: mkState({ players: [{ id: 'a', hand: [c('6')] }, { id: 'b', faceDown: down }], pile: [[c('4')]] }),
        cards: [{ ...down[0], id: 'blind:down:0' }, { ...down[1], id: 'blind:down:1' }, { ...down[2], id: 'blind:down:2' }],
      }
    }],
    ['only part of the matching active-zone set', () => {
      const cards = [c('4'), c('4'), c('4'), c('4')]
      return {
        actor: 'b',
        state: mkState({ players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: cards }], pile: [[c('4')]] }),
        cards: cards.slice(0, 3),
      }
    }],
  ])('rejects %s without mutating state', (_label, build) => {
    const { actor, state, cards } = build()
    const result = applyInterruptBurnRequest(state, actor, cards)
    expect(result.error).toBeTruthy()
    expect(result.state).toBe(state)
    expect(result.state.seq).toBe(state.seq)
  })

  it('rejects duplicate identifiers at the worker boundary', () => {
    const card = c('4', '♠', 'same-id')
    const state = mkState({
      players: [{ id: 'a', hand: [c('6')] }, { id: 'b', hand: [card, c('4'), c('4')] }],
      pile: [[c('4')]],
    })
    expect(applyInterruptBurnRequest(state, 'b', [card, card, card]).error).toMatch(/not owned/i)
  })
})
