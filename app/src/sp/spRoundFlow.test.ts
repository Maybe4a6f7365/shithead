import { afterEach, describe, expect, it } from 'vitest'
import type { Card, GameState, Player } from '../engine'
import { arrangeAIPlayers, resolveAITribute, useSPGame } from './SPSinglePlayer'

function card(id: string, rank: Card['rank']): Card {
  return { id, rank, suit: rank === 'JOKER' ? null : '♠' }
}

function player(id: string, isAI: boolean, up: Card[], hand: Card[] = []): Player {
  return { id, name: id, isAI, faceUp: up, hand, faceDown: [], isOut: false }
}

function state(players: Player[], partial: Partial<GameState> = {}): GameState {
  return {
    phase: 'rearrange',
    rules: { includeJokers: true, winnerSwapsFaceUp: true },
    players,
    stock: [],
    pile: [],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 0,
    winnerId: null,
    loserId: null,
    pendingTribute: null,
    log: [],
    seq: 0,
    ...partial,
  }
}

afterEach(() => useSPGame.getState().reset())

describe('single-player round setup', () => {
  it('AI puts the best three of all six visible cards face up', () => {
    const ai = player(
      'ai', true,
      [card('u3', '3'), card('u4', '4'), card('u5', '5')],
      [card('hA', 'A'), card('h10', '10'), card('hJ', 'JOKER')],
    )
    const arranged = arrangeAIPlayers(state([ai, player('human', false, [])]))
    expect(arranged.players[0].faceUp.map(c => c.rank).sort()).toEqual(['3', '10', 'JOKER'].sort())
    expect(arranged.players[0].hand.map(c => c.rank).sort()).toEqual(['4', '5', 'A'].sort())
  })

  it('starts an all-AI deal synchronously instead of leaving a blank rearrange screen', () => {
    useSPGame.getState().initGame([
      { id: 'a', name: 'A', isAI: true },
      { id: 'b', name: 'B', isAI: true },
    ])
    expect(useSPGame.getState().state.phase).toBe('play')
  })

  it('keeps seat ids and carries the prior result into a rematch', () => {
    useSPGame.getState().initGame([
      { id: 'winner', name: 'Winner', isAI: false },
      { id: 'last', name: 'Last', isAI: false },
    ], { includeJokers: false, winnerSwapsFaceUp: true })
    const dealt = useSPGame.getState().state
    useSPGame.setState({
      state: { ...dealt, phase: 'gameOver', winnerId: 'winner', loserId: 'last' },
    })
    useSPGame.getState().rematch()
    const rematch = useSPGame.getState().state
    expect(rematch.players.map(p => p.id)).toEqual(['winner', 'last'])
    expect(rematch.pendingTribute).toEqual({ winnerId: 'winner', loserId: 'last' })
    expect(rematch.rules.includeJokers).toBe(false)
  })
})

describe('AI winner exchange', () => {
  it('takes an improvement and gives away its weakest public card', () => {
    const initial = state([
      player('winner', true, [card('w3', '3'), card('w4', '4'), card('w5', '5')]),
      player('last', false, [card('lA', 'A'), card('lK', 'K'), card('lQ', 'Q')]),
    ], {
      phase: 'tribute',
      pendingTribute: { winnerId: 'winner', loserId: 'last' },
    })
    const resolved = resolveAITribute(initial)
    expect(resolved.phase).toBe('play')
    expect(resolved.players[0].faceUp.map(c => c.id)).toContain('lA')
    expect(resolved.players[1].faceUp.map(c => c.id)).toContain('w4')
  })

  it('skips when the last-place row offers no improvement', () => {
    const initial = state([
      player('winner', true, [card('wA', 'A'), card('w10', '10'), card('wJ', 'JOKER')]),
      player('last', false, [card('l4', '4'), card('l5', '5'), card('l6', '6')]),
    ], {
      phase: 'tribute',
      pendingTribute: { winnerId: 'winner', loserId: 'last' },
    })
    const resolved = resolveAITribute(initial)
    expect(resolved.phase).toBe('play')
    expect(resolved.players[0].faceUp.map(c => c.id)).toEqual(['wA', 'w10', 'wJ'])
  })
})
