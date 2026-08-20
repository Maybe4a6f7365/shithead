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
    rules: { includeJokers: true, winnerSwapsFaceUp: true, deckCount: 1 },
    players,
    stock: [],
    pile: [],
    currentPlayerIdx: 0,
    playDirection: 1,
    turnCount: 0,
    winnerId: null,
    loserId: null,
    pendingTribute: null,
    pendingQuickFollowUp: null,
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
    ], { includeJokers: false, winnerSwapsFaceUp: true, deckCount: 1 })
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

describe('single-player burn in', () => {
  it('lets the pinned human interrupt an AI turn and take the empty-pile lead', () => {
    const ai = player('ai', true, [], [card('ai-6', '6')])
    const matching = [card('my-4a', '4'), card('my-4b', '4'), card('my-4c', '4')]
    const human = player('human', false, [], [...matching, card('my-a', 'A')])
    const initial = state([ai, human], {
      phase: 'play',
      currentPlayerIdx: 0,
      pile: [{ cards: [card('pile-4', '4')], cleared: false }],
      rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      turnCount: 4,
      seq: 4,
    })
    useSPGame.setState({ state: initial, meId: 'human' })

    useSPGame.getState().interruptBurn('human', matching)

    const next = useSPGame.getState()
    expect(next.lastError).toBeNull()
    expect(next.state.pile).toEqual([])
    expect(next.state.players[next.state.currentPlayerIdx].id).toBe('human')
    expect(next.state.players[1].hand.map(item => item.id)).toEqual(['my-a'])
  })
})

describe('single-player quick matching follow-up', () => {
  it('lets a human add only the entitled replacement card while preserving the next turn', () => {
    const drawn = card('fresh-5', '5')
    const human = player('human', false, [], [drawn, card('old-5', '5')])
    const next = player('next', false, [], [card('next-6', '6')])
    const initial = state([human, next], {
      phase: 'play',
      currentPlayerIdx: 1,
      pile: [{ cards: [card('pile-5', '5')], cleared: false }],
      pendingQuickFollowUp: {
        playerId: 'human', rank: '5', eligibleCardIds: [drawn.id], sourceSeq: 7,
      },
      turnCount: 7,
      seq: 7,
    })
    useSPGame.setState({ state: initial, meId: 'human' })

    useSPGame.getState().quickFollowUp('human', drawn)

    const result = useSPGame.getState()
    expect(result.lastError).toBeNull()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('next')
    expect(result.state.pile.flatMap(entry => entry.cards).map(item => item.id)).toContain(drawn.id)
    expect(result.state.players[0].hand.map(item => item.id)).toEqual(['old-5'])
  })

  it('lets a human immediately play a matching face-up card exposed by their last hand card', () => {
    const handAce = card('last-hand-ace', 'A')
    const faceAce = card('face-up-ace', 'A')
    const faceKing = card('face-up-king', 'K')
    const human = player('human', false, [faceAce, faceKing], [handAce])
    const next = player('next', false, [], [card('next-6', '6')])
    const initial = state([human, next], {
      phase: 'endgame',
      currentPlayerIdx: 0,
      pile: [{ cards: [card('pile-king', 'K')], cleared: false }],
      rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      turnCount: 3,
      seq: 3,
    })
    useSPGame.setState({ state: initial, meId: 'human' })

    useSPGame.getState().playCards('human', [handAce])
    const offered = useSPGame.getState().state
    expect(offered.pendingQuickFollowUp).toEqual({
      playerId: 'human', rank: 'A', eligibleCardIds: [faceAce.id], sourceSeq: 4,
    })
    expect(offered.players[offered.currentPlayerIdx].id).toBe('next')

    useSPGame.getState().quickFollowUp('human', faceAce)
    const result = useSPGame.getState()
    expect(result.lastError).toBeNull()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('next')
    expect(result.state.players[0].faceUp).toEqual([faceKing])
    expect(result.state.pendingQuickFollowUp).toBeNull()
  })

  it('automatically uses an AI replacement match before the human takes the next turn', () => {
    const drawn = card('ai-fresh-6', '6')
    const ai = player('ai', true, [], [drawn, card('ai-9', '9')])
    const human = player('human', false, [], [card('human-7', '7')])
    const initial = state([ai, human], {
      phase: 'play',
      currentPlayerIdx: 1,
      pile: [{ cards: [card('pile-6', '6')], cleared: false }],
      pendingQuickFollowUp: {
        playerId: 'ai', rank: '6', eligibleCardIds: [drawn.id], sourceSeq: 12,
      },
      turnCount: 12,
      seq: 12,
    })
    useSPGame.setState({ state: initial, meId: 'human' })

    useSPGame.getState().tickAI()

    const result = useSPGame.getState()
    expect(result.lastError).toBeNull()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('human')
    expect(result.state.pile.flatMap(entry => entry.cards).map(item => item.id)).toContain(drawn.id)
  })
})
