import { describe, expect, it } from 'vitest'
import type { Card } from '../../engine'
import { canPlay } from '../../engine'
import { viewerCardStates, type CardStatesInput } from '../table/cardStates'

const card = (id: string, rank: Card['rank']): Card => ({ id, rank, suit: '♠' })
const four = card('h4', '4')
const nine = card('h9', '9')
const nineB = card('h9b', '9')
const king = card('hK', 'K')
const upQueen = card('uQ', 'Q')
const down = card('d1', '5')

/** The viewer's turn with an 8 on the pile: 9 and K fit, 4 does not. */
function input(overrides: Partial<CardStatesInput> = {}): CardStatesInput {
  const hand = [four, nine, nineB, king]
  return {
    viewer: { hand, faceUp: [upQueen], faceDown: [down] },
    zone: 'hand',
    zoneCards: hand,
    viewerActive: true,
    selection: [],
    selectedRank: null,
    invalidId: null,
    canBurnIn: false,
    interruptIds: new Set(),
    quickFollowUpIds: new Set(),
    quickActionVisible: false,
    canPreselect: false,
    playable: c => canPlay(c, '8'),
    ...overrides,
  }
}

describe('viewerCardStates', () => {
  it('marks what fits the pile on the viewer\'s turn and rests the rows that are not in play', () => {
    const { states, hints, downStates } = viewerCardStates(input())
    expect(states.get(four.id)).toBe('disabled')
    expect(hints.get(four.id)).toBe('not playable')
    expect(states.get(nine.id)).toBe('playable')
    expect(states.get(king.id)).toBe('playable')
    // Face-up cards wait until the hand is empty.
    expect(states.get(upQueen.id)).toBe('rest')
    expect(hints.has(upQueen.id)).toBe(false)
    expect(downStates.size).toBe(0)
  })

  it('offers the same rank to join a selection and another rank to replace it', () => {
    const { states, hints } = viewerCardStates(input({ selection: [nine.id], selectedRank: '9' }))
    expect(states.get(nine.id)).toBe('selected')
    expect(states.get(nineB.id)).toBe('joinable')
    expect(states.get(king.id)).toBe('playable')
    expect(hints.get(king.id)).toBe('playable, replaces selection')
  })

  it('shows a remembered invalid tap only on a card that is not selected', () => {
    expect(viewerCardStates(input({ invalidId: four.id })).states.get(four.id)).toBe('invalid')
    const both = viewerCardStates(input({ invalidId: nine.id, selection: [nine.id], selectedRank: '9' }))
    expect(both.states.get(nine.id)).toBe('selected')
  })

  it('puts an offered quick follow-up or burn-in above a selection', () => {
    const quick = viewerCardStates(input({
      selection: [nine.id], selectedRank: '9', quickFollowUpIds: new Set([nine.id]), quickActionVisible: true,
    }))
    expect(quick.states.get(nine.id)).toBe('joinable')
    expect(quick.hints.get(nine.id)).toBe('matching card, quick follow-up available')

    const burnIn = viewerCardStates(input({
      viewerActive: false, selection: [nine.id], selectedRank: '9', canBurnIn: true, interruptIds: new Set([nine.id, nineB.id]),
    }))
    expect(burnIn.states.get(nine.id)).toBe('joinable')
    expect(burnIn.hints.get(nineB.id)).toBe('can burn in now')
  })

  it('keeps a selection visible when the quick follow-up is not the action on offer', () => {
    const { states } = viewerCardStates(input({
      selection: [nine.id], selectedRank: '9', quickFollowUpIds: new Set([nine.id, nineB.id]), quickActionVisible: false,
    }))
    expect(states.get(nine.id)).toBe('selected')
    expect(states.get(nineB.id)).toBe('joinable')
  })

  it('off turn, rests every card and says which ones can be prepared', () => {
    const idle = viewerCardStates(input({ viewerActive: false }))
    expect([...idle.states.values()].every(state => state === 'rest')).toBe(true)
    expect(idle.hints.size).toBe(0)

    const preparing = viewerCardStates(input({ viewerActive: false, canPreselect: true, selection: [king.id], selectedRank: 'K' }))
    expect(preparing.states.get(king.id)).toBe('selected')
    expect(preparing.hints.get(king.id)).toBe('selected for your next turn')
    expect(preparing.hints.get(nine.id)).toBe('available to select for your next turn')
    expect(preparing.hints.get(four.id)).toBe('not playable on the current pile')
    expect(preparing.hints.has(upQueen.id)).toBe(false)
  })

  it('makes face-down cards live only on the viewer\'s turn in the blind zone', () => {
    const blind = { viewer: { hand: [], faceUp: [], faceDown: [down] }, zone: 'faceDown' as const, zoneCards: [down] }
    const live = viewerCardStates(input({ ...blind, selection: [down.id] }))
    expect(live.downStates.get(down.id)).toBe('selected')
    expect(viewerCardStates(input(blind)).downHints.get(down.id)).toBe('blind play')
    expect(viewerCardStates(input({ ...blind, viewerActive: false })).downStates.size).toBe(0)
  })
})
