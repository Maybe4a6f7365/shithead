import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  MAX_LOG_ENTRIES,
  exchangeFaceUpCards,
  initGame,
  pickUpPile,
  playCards,
  rearrange,
  seededRng,
  skipTribute,
  startPlay,
} from '../index'
import type { Card, GameState } from '../index'
import { c, mkState } from './helpers'

const ids = (cards: Card[]) => cards.map(card => card.id).sort()

function choose<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]]
  if (values.length < count) return []
  const [first, ...rest] = values
  return [
    ...choose(rest, count - 1).map(group => [first, ...group]),
    ...choose(rest, count),
  ]
}

describe('configurable round rules and initial deal', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]

  it('defaults to jokers enabled and winner exchange disabled', () => {
    const state = initGame({ players, rng: seededRng(101) })
    expect(state.rules).toEqual(DEFAULT_GAME_RULES)
    expect(state.stock).toHaveLength(54 - 2 * 9)
    expect(state.winnerId).toBeNull()
    expect(state.pendingTribute).toBeNull()
  })

  it('builds a 52-card round when jokers are disabled', () => {
    const state = initGame({
      players,
      rules: { includeJokers: false, winnerSwapsFaceUp: false },
      rng: seededRng(102),
    })
    const allCards = [
      ...state.stock,
      ...state.players.flatMap(player => [...player.hand, ...player.faceUp, ...player.faceDown]),
    ]
    expect(allCards).toHaveLength(52)
    expect(allCards.some(card => card.rank === 'JOKER')).toBe(false)
  })

  it('keeps legacy includeJokers callers compatible while rules stay authoritative', () => {
    const legacy = initGame({ players, includeJokers: false, rng: seededRng(103) })
    expect(legacy.rules).toEqual({ includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 })
    expect(legacy.stock).toHaveLength(52 - 2 * 9)

    const modern = initGame({
      players,
      includeJokers: true,
      rules: { includeJokers: false, winnerSwapsFaceUp: true },
      rng: seededRng(103),
    })
    expect(modern.rules).toEqual({ includeJokers: false, winnerSwapsFaceUp: true, deckCount: 1 })
    expect(modern.stock).toHaveLength(52 - 2 * 9)
  })

  it('deals three blind cards plus six known cards to every player', () => {
    const state = initGame({ players, rng: seededRng(104) })
    for (const player of state.players) {
      expect(player.faceDown).toHaveLength(3)
      expect(player.faceUp).toHaveLength(3)
      expect(player.hand).toHaveLength(3)
      expect(new Set([...player.faceUp, ...player.hand].map(card => card.id)).size).toBe(6)
    }
  })

  it('allows every one of the 20 possible three-card public rows from the six known cards', () => {
    const initial = initGame({ players, rng: seededRng(105) })
    const known = [...initial.players[0].faceUp, ...initial.players[0].hand]
    const targets = choose(known, 3)
    expect(targets).toHaveLength(20)

    for (const target of targets) {
      const targetIds = new Set(target.map(card => card.id))
      let state = initial
      while (state.players[0].faceUp.some(card => !targetIds.has(card.id))) {
        const player = state.players[0]
        const upIdx = player.faceUp.findIndex(card => !targetIds.has(card.id))
        const handIdx = player.hand.findIndex(card => targetIds.has(card.id))
        expect(handIdx).toBeGreaterThanOrEqual(0)
        state = rearrange(state, player.id, handIdx, upIdx)
      }
      expect(ids(state.players[0].faceUp)).toEqual(ids(target))
      expect(state.players[0].faceDown).toEqual(initial.players[0].faceDown)
    }
  })

  it('only creates a pending tribute for an enabled, valid previous result', () => {
    const enabled = { includeJokers: true, winnerSwapsFaceUp: true }
    const valid = initGame({
      players,
      rules: enabled,
      previousRound: { winnerId: 'a', loserId: 'b' },
      rng: seededRng(106),
    })
    expect(valid.pendingTribute).toEqual({ winnerId: 'a', loserId: 'b' })

    const disabled = initGame({
      players,
      rules: { ...enabled, winnerSwapsFaceUp: false },
      previousRound: { winnerId: 'a', loserId: 'b' },
      rng: seededRng(106),
    })
    expect(disabled.pendingTribute).toBeNull()

    const missingPlayer = initGame({
      players,
      rules: enabled,
      previousRound: { winnerId: 'a', loserId: 'gone' },
      rng: seededRng(106),
    })
    expect(missingPlayer.pendingTribute).toBeNull()
  })
})

describe('opening player comes only from finalized public rows', () => {
  it('ignores a lower card in hand and selects the lowest face-up row', () => {
    const state = mkState({
      phase: 'rearrange',
      currentPlayerIdx: 0,
      players: [
        { id: 'a', hand: [c('3')], faceUp: [c('9'), c('Q'), c('K')] },
        { id: 'b', hand: [c('A')], faceUp: [c('4'), c('J'), c('A')] },
      ],
    })
    const playing = startPlay(state)
    expect(playing.phase).toBe('play')
    expect(playing.players[playing.currentPlayerIdx].id).toBe('b')
  })

  it('uses the rows after rearranging, not the initially dealt rows', () => {
    let state = mkState({
      phase: 'rearrange',
      players: [
        { id: 'a', hand: [c('3')], faceUp: [c('9'), c('Q'), c('K')] },
        { id: 'b', hand: [c('A')], faceUp: [c('4'), c('J'), c('A')] },
      ],
    })
    state = rearrange(state, 'a', 0, 0)
    state = startPlay(state)
    expect(state.players[state.currentPlayerIdx].id).toBe('a')
    expect(state.players[0].faceUp.some(card => card.rank === '3')).toBe(true)
  })
})

function pendingTributeState(): GameState {
  return startPlay(mkState({
    phase: 'rearrange',
    rules: { includeJokers: true, winnerSwapsFaceUp: true },
    pendingTribute: { winnerId: 'winner', loserId: 'loser' },
    players: [
      {
        id: 'winner',
        hand: [c('3', '♠', 'winner-hand')],
        faceUp: [c('K', '♠', 'winner-up-k'), c('Q'), c('A')],
        faceDown: [c('4', '♠', 'winner-down')],
      },
      {
        id: 'loser',
        hand: [c('5', '♠', 'loser-hand')],
        faceUp: [c('3', '♥', 'loser-up-3'), c('8'), c('9')],
        faceDown: [c('6', '♠', 'loser-down')],
      },
    ],
  }))
}

describe('optional winner face-up exchange', () => {
  it('enters tribute only after every row is finalized', () => {
    const state = pendingTributeState()
    expect(state.phase).toBe('tribute')
    expect(state.pendingTribute).toEqual({ winnerId: 'winner', loserId: 'loser' })
    expect(state.players[state.currentPlayerIdx].id).toBe('winner')
    expect(playCards(state, 'winner', [state.players[0].hand[0]]).error).toMatch(/phase/i)
  })

  it('lets only the previous winner exchange exactly one public card from each row', () => {
    const state = pendingTributeState()
    const beforeWinnerHand = state.players[0].hand
    const beforeLoserHand = state.players[1].hand
    const result = exchangeFaceUpCards(state, 'winner', 'winner-up-k', 'loser-up-3')

    expect(result.error).toBeUndefined()
    expect(result.state.phase).toBe('play')
    expect(result.state.pendingTribute).toBeNull()
    expect(result.state.players[0].faceUp.map(card => card.id)).toContain('loser-up-3')
    expect(result.state.players[0].faceUp.map(card => card.id)).not.toContain('winner-up-k')
    expect(result.state.players[1].faceUp.map(card => card.id)).toContain('winner-up-k')
    expect(result.state.players[0].faceUp).toHaveLength(3)
    expect(result.state.players[1].faceUp).toHaveLength(3)
    expect(result.state.players[0].hand).toEqual(beforeWinnerHand)
    expect(result.state.players[1].hand).toEqual(beforeLoserHand)
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('winner')
    expect(result.state.seq).toBe((state.seq ?? 0) + 1)
  })

  it('rejects the loser, other actors, hand cards and face-down cards', () => {
    const state = pendingTributeState()
    expect(exchangeFaceUpCards(state, 'loser', 'winner-up-k', 'loser-up-3').error).toMatch(/winner/i)
    expect(exchangeFaceUpCards(state, 'winner', 'winner-hand', 'loser-up-3').error).toMatch(/face-up/i)
    expect(exchangeFaceUpCards(state, 'winner', 'winner-up-k', 'loser-hand').error).toMatch(/face-up/i)
    expect(exchangeFaceUpCards(state, 'winner', 'winner-down', 'loser-up-3').error).toMatch(/face-up/i)
    expect(exchangeFaceUpCards(state, 'winner', 'winner-up-k', 'loser-down').error).toMatch(/face-up/i)
  })

  it('is a one-time action', () => {
    const first = exchangeFaceUpCards(pendingTributeState(), 'winner', 'winner-up-k', 'loser-up-3')
    const second = exchangeFaceUpCards(first.state, 'winner', 'loser-up-3', 'winner-up-k')
    expect(second.error).toMatch(/phase/i)
    expect(second.state).toBe(first.state)
  })

  it('lets the winner skip without changing either row, then recomputes the opener', () => {
    const state = pendingTributeState()
    const rowsBefore = state.players.map(player => player.faceUp)
    expect(skipTribute(state, 'loser').error).toMatch(/winner/i)

    const result = skipTribute(state, 'winner')
    expect(result.error).toBeUndefined()
    expect(result.state.phase).toBe('play')
    expect(result.state.pendingTribute).toBeNull()
    expect(result.state.players.map(player => player.faceUp)).toEqual(rowsBefore)
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('loser')
  })

  it('drops stale tribute data and starts play when the rule is disabled', () => {
    const state = mkState({
      phase: 'rearrange',
      rules: { includeJokers: true, winnerSwapsFaceUp: false },
      pendingTribute: { winnerId: 'a', loserId: 'b' },
      players: [{ id: 'a', faceUp: [c('3')] }, { id: 'b', faceUp: [c('4')] }],
    })
    const result = startPlay(state)
    expect(result.phase).toBe('play')
    expect(result.pendingTribute).toBeNull()
  })

  it('keeps the ring log cap through tribute completion', () => {
    const log = Array.from({ length: MAX_LOG_ENTRIES }, () => ({
      type: 'PICK_UP_PILE' as const,
      playerId: 'winner',
    }))
    const state = { ...pendingTributeState(), log }
    const result = skipTribute(state, 'winner')
    expect(result.state.log).toHaveLength(MAX_LOG_ENTRIES)
    expect(result.state.log.at(-1)).toEqual({ type: 'PHASE_CHANGE', phase: 'play' })
  })
})

describe('hand refill and voluntary pickup', () => {
  it('refills back to exactly three after playing multiple cards while stock remains', () => {
    const pair = [c('5', '♠'), c('5', '♥')]
    const state = mkState({
      players: [{ id: 'a', hand: [...pair, c('8')] }, { id: 'b', hand: [c('9')] }],
      stock: [c('J'), c('Q'), c('K')],
    })
    const result = playCards(state, 'a', pair)
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].hand).toHaveLength(3)
    expect(result.state.stock).toHaveLength(1)
  })

  it('permits picking up even when the player has a legal card', () => {
    const playable = c('8')
    const state = mkState({
      players: [{ id: 'a', hand: [playable] }, { id: 'b', hand: [c('9')] }],
      pile: [[c('4')], [c('6')]],
    })
    const result = pickUpPile(state, 'a')
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].hand).toHaveLength(3)
    expect(result.state.players[0].hand).toContain(playable)
    expect(result.state.pile).toHaveLength(0)
  })

  it('does not draw more cards after a large pickup leaves the hand above three', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('8')] }, { id: 'b', hand: [c('9')] }],
      pile: [[c('3'), c('3', '♥')], [c('4'), c('4', '♥')], [c('5')]],
      stock: [c('J'), c('Q')],
    })
    const pickedUp = pickUpPile(state, 'a').state
    const forcedTurn = { ...pickedUp, currentPlayerIdx: 0 }
    const result = playCards(forcedTurn, 'a', [forcedTurn.players[0].hand.find(card => card.rank === '8')!])
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].hand).toHaveLength(5)
    expect(result.state.stock).toHaveLength(2)
  })
})

describe('winner and loser tracking', () => {
  it('records the first player out as winner and the final active player as loser', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('K')] },
        { id: 'b', hand: [c('A')] },
        { id: 'c', hand: [c('A')] },
      ],
      pile: [[c('9')]],
    })
    const first = playCards(state, 'a', [state.players[0].hand[0]])
    expect(first.state.winnerId).toBe('a')
    expect(first.state.phase).not.toBe('gameOver')

    const second = playCards(first.state, 'b', [first.state.players[1].hand[0]])
    expect(second.state.winnerId).toBe('a')
    expect(second.state.loserId).toBe('c')
    expect(second.state.phase).toBe('gameOver')
  })

  it('does not let a later out player steal an unknown historical winner', () => {
    const legacy = mkState({
      winnerId: null,
      players: [
        { id: 'historical', isOut: true },
        { id: 'next', hand: [c('K')] },
        { id: 'loser', hand: [c('A')] },
      ],
      currentPlayerIdx: 1,
      pile: [[c('9')]],
      log: Array.from({ length: MAX_LOG_ENTRIES }, () => ({
        type: 'PICK_UP_PILE' as const,
        playerId: 'loser',
      })),
    })
    const result = playCards(legacy, 'next', [legacy.players[1].hand[0]])
    expect(result.error).toBeUndefined()
    expect(result.state.phase).toBe('gameOver')
    expect(result.state.winnerId).toBeNull()
    expect(result.state.loserId).toBe('loser')
  })
})
