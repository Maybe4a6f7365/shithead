import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  MAX_LOG_ENTRIES,
  initGame,
  playCards,
  seededRng,
  type Card,
  type GameEvent,
  type GameState,
} from '../index'
import {
  deriveLegacyWinnerId,
  normalizeEasterEggEnabled,
  normalizeGameRules,
  normalizePersistedGameState,
} from '../../worker/migrateState'
import { applyPlayerForfeit } from '../../worker/forfeit'

function stateWithOutPlayers(outIds: string[], log: GameEvent[] = []): GameState {
  const state = initGame({
    players: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    rng: seededRng(9),
  })
  return {
    ...state,
    players: state.players.map(player => ({ ...player, isOut: outIds.includes(player.id) })),
    log,
  }
}

describe('legacy worker state migration', () => {
  it('defaults old or malformed easter-egg settings on and preserves explicit booleans', () => {
    expect(normalizeEasterEggEnabled(undefined)).toBe(true)
    expect(normalizeEasterEggEnabled(null)).toBe(true)
    expect(normalizeEasterEggEnabled('false')).toBe(true)
    expect(normalizeEasterEggEnabled(false)).toBe(false)
    expect(normalizeEasterEggEnabled(true)).toBe(true)
  })

  it('fills rule defaults and the new nullable fields', () => {
    const legacy = stateWithOutPlayers([]) as unknown as Record<string, unknown>
    delete legacy.rules
    delete legacy.winnerId
    delete legacy.pendingTribute
    delete legacy.pendingQuickFollowUp

    const migrated = normalizePersistedGameState(legacy as never)
    expect(migrated?.rules).toEqual(DEFAULT_GAME_RULES)
    expect(migrated?.winnerId).toBeNull()
    expect(migrated?.pendingTribute).toBeNull()
    expect(migrated?.pendingQuickFollowUp).toBeNull()
  })

  it('derives an unambiguous sole player out', () => {
    expect(deriveLegacyWinnerId(stateWithOutPlayers(['b']))).toBe('b')
  })

  it('uses the earliest PLAYER_OUT only while the log is demonstrably untruncated', () => {
    const shortLog: GameEvent[] = [
      { type: 'PLAYER_OUT', playerId: 'c' },
      { type: 'PLAYER_OUT', playerId: 'a' },
    ]
    expect(deriveLegacyWinnerId(stateWithOutPlayers(['a', 'c'], shortLog))).toBe('c')
  })

  it('never guesses from a full ring buffer with several players out', () => {
    const fullLog: GameEvent[] = Array.from({ length: MAX_LOG_ENTRIES }, (_, index) => ({
      type: 'PLAYER_OUT' as const,
      playerId: index === 0 ? 'a' : 'c',
    }))
    expect(deriveLegacyWinnerId(stateWithOutPlayers(['a', 'c'], fullLog))).toBeNull()
    const legacy = stateWithOutPlayers(['a', 'c'], fullLog) as GameState & { winnerId?: string }
    delete legacy.winnerId
    expect(normalizePersistedGameState(legacy)?.winnerId).toBeNull()
  })

  it('preserves an explicit valid winner and lets authoritative room rules win', () => {
    const state = { ...stateWithOutPlayers(['a', 'b']), winnerId: 'b' }
    const migrated = normalizePersistedGameState(state, { includeJokers: false, winnerSwapsFaceUp: true })
    expect(migrated?.winnerId).toBe('b')
    expect(migrated?.rules).toEqual({ includeJokers: false, winnerSwapsFaceUp: true, deckCount: 1 })
  })

  it('migrates missing deck counts to one and rejects corrupt persisted counts', () => {
    expect(normalizeGameRules({ includeJokers: false })).toEqual({
      includeJokers: false,
      winnerSwapsFaceUp: false,
      deckCount: 1,
    })
    expect(normalizeGameRules({ deckCount: 3 })).toMatchObject({ deckCount: 3 })
    expect(normalizeGameRules({ deckCount: 99 } as never)).toMatchObject({ deckCount: 1 })
  })

  it('preserves only a fully valid pending replacement-draw entitlement', () => {
    const base = stateWithOutPlayers([])
    const eligible = base.players[0].hand[0]
    const live: GameState = {
      ...base,
      phase: 'play',
      seq: 4,
      pile: [{
        cards: [{ id: 'public-top', suit: eligible.suit, rank: eligible.rank }],
        cleared: false,
      }],
      pendingQuickFollowUp: {
        playerId: 'a', rank: eligible.rank, eligibleCardIds: [eligible.id], sourceSeq: 4,
      },
    }

    expect(normalizePersistedGameState(live)?.pendingQuickFollowUp).toEqual(live.pendingQuickFollowUp)
    expect(normalizePersistedGameState({
      ...live,
      pendingQuickFollowUp: { ...live.pendingQuickFollowUp!, sourceSeq: 3 },
    })?.pendingQuickFollowUp).toBeNull()
    expect(normalizePersistedGameState({
      ...live,
      pendingQuickFollowUp: { ...live.pendingQuickFollowUp!, eligibleCardIds: ['forged-id'] },
    })?.pendingQuickFollowUp).toBeNull()
  })
})

describe('worker forfeit semantics', () => {
  it('does not end a 3+ player round when an already-out player leaves', () => {
    const state = {
      ...stateWithOutPlayers(['a']),
      phase: 'play' as const,
      winnerId: 'a',
      currentPlayerIdx: 1,
      seq: 7,
    }
    const next = applyPlayerForfeit(state, 'a')
    expect(next.phase).toBe('play')
    expect(next.players.map(player => player.id)).toEqual(['b', 'c'])
    expect(next.players[next.currentPlayerIdx].id).toBe('b')
    expect(next.winnerId).toBe('a')
    expect(next.loserId).toBeNull()
    expect(next.seq).toBe(8)
  })

  it('preserves a departed first-place winner across restore without awarding later tribute', () => {
    const departed = applyPlayerForfeit({
      ...stateWithOutPlayers(['a']),
      phase: 'play',
      winnerId: 'a',
      currentPlayerIdx: 1,
    }, 'a')
    expect(departed.players.some(player => player.id === 'a')).toBe(false)

    const restored = normalizePersistedGameState(departed)!
    expect(restored.winnerId).toBe('a')

    const finishingCard: Card = { id: 'b-finish', suit: '♠', rank: '5' }
    const continued: GameState = {
      ...restored,
      phase: 'play',
      stock: [],
      pile: [],
      currentPlayerIdx: restored.players.findIndex(player => player.id === 'b'),
      players: restored.players.map(player => player.id === 'b'
        ? { ...player, hand: [finishingCard], faceUp: [], faceDown: [], isOut: false }
        : { ...player, hand: [{ id: 'c-stays', suit: '♥', rank: '6' }], faceUp: [], faceDown: [], isOut: false }),
    }
    const finished = playCards(continued, 'b', [finishingCard]).state
    expect(finished.phase).toBe('gameOver')
    expect(finished.winnerId).toBe('a')
    expect(finished.loserId).toBe('c')

    const rematch = initGame({
      players: finished.players.map(player => ({ id: player.id, name: player.name })),
      rules: { includeJokers: true, winnerSwapsFaceUp: true },
      previousRound: { winnerId: finished.winnerId!, loserId: finished.loserId! },
      rng: seededRng(12),
    })
    expect(rematch.pendingTribute).toBeNull()
  })

  it('does not fabricate a winner for a 3P surrender before anyone is out', () => {
    const next = applyPlayerForfeit({ ...stateWithOutPlayers([]), phase: 'play' }, 'c')
    expect(next.phase).toBe('gameOver')
    expect(next.winnerId).toBeNull()
    expect(next.loserId).toBe('c')
  })

  it('awards the sole remaining player a 2P forfeit win', () => {
    const two = initGame({
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      rng: seededRng(2),
    })
    const next = applyPlayerForfeit({ ...two, phase: 'play' }, 'b')
    expect(next.phase).toBe('gameOver')
    expect(next.winnerId).toBe('a')
    expect(next.loserId).toBe('b')
  })
})
