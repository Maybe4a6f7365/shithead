import { describe, expect, it } from 'vitest'
import { applyQuickFollowUpRequest } from '../../worker/gameActions'
import { c, mkState } from './helpers'

function pendingState() {
  const eligible = c('6', '♥', 'fresh-drawn-six')
  const preExisting = c('6', '♠', 'old-hand-six')
  const chainedDraw = c('6', '♦', 'next-fresh-six')
  const state = {
    ...mkState({
      players: [
        { id: 'a', hand: [eligible, preExisting] },
        { id: 'b', hand: [c('9', '♣', 'b-nine')] },
      ],
      stock: [chainedDraw],
      pile: [[c('6', '♣', 'table-six')]],
      currentPlayerIdx: 1,
      pendingQuickFollowUp: {
        playerId: 'a', rank: '6', eligibleCardIds: [eligible.id], sourceSeq: 11,
      },
    }),
    seq: 11,
  }
  return { state, eligible, preExisting, chainedDraw }
}

describe('worker QUICK_FOLLOW_UP boundary', () => {
  it('resolves only an entitled replacement id and preserves the opponent turn', () => {
    const { state, eligible, preExisting, chainedDraw } = pendingState()
    const result = applyQuickFollowUpRequest(state, 'a', eligible.id, 11)

    expect(result.error).toBeUndefined()
    expect(result.state.seq).toBe(12)
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('b')
    expect(result.state.players[0].hand.map(card => card.id)).toEqual([
      preExisting.id,
      chainedDraw.id,
    ])
    expect(result.state.pendingQuickFollowUp).toEqual({
      playerId: 'a', rank: '6', eligibleCardIds: [chainedDraw.id], sourceSeq: 12,
    })
  })

  it('supports a same-rank replacement chain one exact sequence at a time', () => {
    const { state, eligible, chainedDraw } = pendingState()
    const first = applyQuickFollowUpRequest(state, 'a', eligible.id, 11)
    const second = applyQuickFollowUpRequest(first.state, 'a', chainedDraw.id, 12)

    expect(second.error).toBeUndefined()
    expect(second.state.seq).toBe(13)
    expect(second.state.pendingQuickFollowUp).toBeNull()
    expect(second.state.pile.flatMap(entry => entry.cards).map(card => card.id)).toContain(chainedDraw.id)
  })

  it('rejects an owned, matching card that was already in hand before the draw', () => {
    const { state, preExisting } = pendingState()
    const result = applyQuickFollowUpRequest(state, 'a', preExisting.id, 11)
    expect(result.error).toMatch(/not available/i)
    expect(result.state).toBe(state)
  })

  it.each([
    ['stale sequence', 'a', 'fresh-drawn-six', 10],
    ['future sequence', 'a', 'fresh-drawn-six', 12],
    ['forged id', 'a', 'not-a-card', 11],
    ['another player', 'b', 'fresh-drawn-six', 11],
    ['blind alias', 'a', 'blind:down:0', 11],
  ])('rejects %s without mutating state', (_label, playerId, cardId, expectedSeq) => {
    const { state } = pendingState()
    const result = applyQuickFollowUpRequest(state, playerId, cardId, expectedSeq)
    // One generic response prevents the boundary becoming an oracle for an
    // opponent's hidden replacement draw or its exact eligible id.
    expect(result.error).toBe('Quick follow-up is not available')
    expect(result.state).toBe(state)
    expect(result.state.seq).toBe(11)
  })

  it('rejects a duplicate replay after the first action advances the sequence', () => {
    const { state, eligible } = pendingState()
    const first = applyQuickFollowUpRequest(state, 'a', eligible.id, 11)
    const replay = applyQuickFollowUpRequest(first.state, 'a', eligible.id, 11)
    expect(replay.error).toMatch(/not available/i)
    expect(replay.state).toBe(first.state)
  })
})
