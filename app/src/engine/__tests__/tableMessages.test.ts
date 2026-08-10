import { describe, expect, it } from 'vitest'
import { ONDRA_MESSAGE_IDS } from '../protocol'
import {
  acceptedReactionAt,
  createSeededRandom,
  isOndraLikeName,
  normalizeStoredPendingOndraEvent,
  normalizeTableName,
  pendingOndraEventAfterLeave,
  REACTION_COOLDOWN_MS,
  resolvePendingOndraEvent,
  scheduleOndraEventForPlayTransition,
  selectOndraMessageId,
} from '../../worker/tableMessages'

describe('table message easter eggs', () => {
  it('normalizes accents, case, punctuation, and the narrow leet mapping', () => {
    expect(normalizeTableName(' Ondřej!! ')).toBe('ondrej')
    expect(normalizeTableName('0NDR3Y_42')).toBe('ondrey')
  })

  it.each([
    'Ondra',
    'ONDRE',
    'Ondřej',
    'Ondrey',
    '0ndr3j',
    'Ondraa',
    'Ondri',
  ])('matches the conservative Ondra-family spelling %s', name => {
    expect(isOndraLikeName(name)).toBe(true)
  })

  it.each([
    'Sandra',
    'Andrea',
    'Andrew',
    'Andra',
    'Ondulation',
    'Omar',
    '',
  ])('does not turn unrelated name %s into Ondra mode', name => {
    expect(isOndraLikeName(name)).toBe(false)
  })

  it('maps injected boundary draws to fixed message ids', () => {
    expect(selectOndraMessageId(() => 0)).toBe(ONDRA_MESSAGE_IDS[0])
    expect(selectOndraMessageId(() => 0.999999)).toBe(ONDRA_MESSAGE_IDS.at(-1))
    expect(selectOndraMessageId(() => Number.NaN)).toBe(ONDRA_MESSAGE_IDS[0])
  })

  it('provides reproducible seeded selection', () => {
    const first = createSeededRandom(42)
    const second = createSeededRandom(42)
    expect(Array.from({ length: 12 }, first)).toEqual(Array.from({ length: 12 }, second))
  })

  it('does not roll when no Ondra-like player exists', () => {
    expect(scheduleOndraEventForPlayTransition(
      'rearrange',
      'play',
      0,
      [{ id: 'p1', name: 'Ada' }],
      () => { throw new Error('no random draw expected') },
    )).toBeNull()
  })

  it('makes a deterministic 50% miss without scheduling anything', () => {
    const players = [{ id: 'ondra-id', name: 'Ondřej' }]
    expect(scheduleOndraEventForPlayTransition('rearrange', 'play', 0, players, () => 0.5)).toBeNull()
  })

  it('schedules deterministic lower and upper action-delay boundaries', () => {
    const players = [{ id: 'ondra-id', name: 'Ondřej' }]
    const lowerDraws = [0.49, 0, 0]
    expect(scheduleOndraEventForPlayTransition(
      'rearrange', 'play', 12, players, () => lowerDraws.shift()!,
    )).toEqual({
      playerId: 'ondra-id',
      playerName: 'Ondřej',
      message: ONDRA_MESSAGE_IDS[0],
      triggerTurnCount: 15,
    })

    const upperDraws = [0.49, 0.999999, 0.999999]
    expect(scheduleOndraEventForPlayTransition(
      'tribute', 'play', 20, players, () => upperDraws.shift()!,
    )).toEqual({
      playerId: 'ondra-id',
      playerName: 'Ondřej',
      message: ONDRA_MESSAGE_IDS.at(-1),
      triggerTurnCount: 27,
    })
  })

  it('does not schedule on reconnect, repeated state, or invalid phase edges', () => {
    const players = [{ id: 'ondra-id', name: 'Ondra' }]
    const random = () => { throw new Error('no reroll expected') }
    expect(scheduleOndraEventForPlayTransition('rearrange', 'rearrange', 0, players, random)).toBeNull()
    expect(scheduleOndraEventForPlayTransition('play', 'play', 0, players, random)).toBeNull()
    expect(scheduleOndraEventForPlayTransition('endgame', 'play', 0, players, random)).toBeNull()
    expect(scheduleOndraEventForPlayTransition('gameOver', 'play', 0, players, random)).toBeNull()
  })

  it('emits only when due and atomically clears so it cannot duplicate', () => {
    const pending = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[2],
      triggerTurnCount: 6,
    } as const
    const players = [{ id: 'ondra-id', name: 'Ondra' }]

    expect(resolvePendingOndraEvent(pending, 'play', 5, players, () => 12_000)).toEqual({
      pending,
      frame: null,
    })
    const due = resolvePendingOndraEvent(pending, 'play', 6, players, () => 12_345)
    expect(due).toEqual({
      pending: null,
      frame: {
        type: 'SYSTEM_EVENT',
        event: {
          kind: 'ondra-mode',
          playerId: 'ondra-id',
          playerName: 'Ondra',
          message: ONDRA_MESSAGE_IDS[2],
          ts: 12_345,
        },
      },
    })
    expect(resolvePendingOndraEvent(due.pending, 'play', 7, players)).toEqual({ pending: null, frame: null })
  })

  it('remains eligible after play transitions into endgame', () => {
    const pending = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[0],
      triggerTurnCount: 3,
    } as const
    expect(resolvePendingOndraEvent(pending, 'endgame', 3, [{ id: 'ondra-id', name: 'Ondra' }], () => 99)).toEqual({
      pending: null,
      frame: {
        type: 'SYSTEM_EVENT',
        event: {
          kind: 'ondra-mode',
          playerId: 'ondra-id',
          playerName: 'Ondra',
          message: ONDRA_MESSAGE_IDS[0],
          ts: 99,
        },
      },
    })
  })

  it.each(['roundEnd', 'gameOver'] as const)('clears without emitting in terminal phase %s', phase => {
    const pending = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[0],
      triggerTurnCount: 3,
    } as const
    expect(resolvePendingOndraEvent(pending, phase, 3, [{ id: 'ondra-id', name: 'Ondra' }])).toEqual({
      pending: null,
      frame: null,
    })
  })

  it('clears without emitting when the named player has left', () => {
    const pending = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[0],
      triggerTurnCount: 3,
    } as const
    expect(resolvePendingOndraEvent(pending, 'play', 3, [{ id: 'p2', name: 'Ada' }])).toEqual({
      pending: null,
      frame: null,
    })
  })

  it('preserves an unrelated leaver schedule on-table and clears the scheduled leaver or terminal round', () => {
    const pending = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[0],
      triggerTurnCount: 5,
    } as const
    expect(pendingOndraEventAfterLeave(pending, 'other-id', 'play')).toBe(pending)
    expect(pendingOndraEventAfterLeave(pending, 'other-id', 'endgame')).toBe(pending)
    expect(pendingOndraEventAfterLeave(pending, 'ondra-id', 'play')).toBeNull()
    expect(pendingOndraEventAfterLeave(pending, 'other-id', 'gameOver')).toBeNull()
  })

  it('validates restored private events against ids, copy, target, and the current roster', () => {
    const players = [{ id: 'ondra-id', name: 'Ondra' }]
    const valid = {
      playerId: 'ondra-id',
      playerName: 'Ondra',
      message: ONDRA_MESSAGE_IDS[1],
      triggerTurnCount: 7,
    }
    expect(normalizeStoredPendingOndraEvent(valid, players, 2)).toEqual(valid)
    expect(normalizeStoredPendingOndraEvent({ ...valid, playerId: 'missing' }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, playerName: 'Impostor' }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, message: '<script>' }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, triggerTurnCount: -1 }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, triggerTurnCount: 1.5 }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, triggerTurnCount: Number.POSITIVE_INFINITY }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, triggerTurnCount: 2 }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent({ ...valid, triggerTurnCount: 10 }, players, 2)).toBeNull()
    expect(normalizeStoredPendingOndraEvent(null, players, 2)).toBeNull()
  })

  it('pins the shared reaction cooldown boundary without extending on a drop', () => {
    const first = acceptedReactionAt(null, 1_000)
    expect(first).toBe(1_000)
    expect(acceptedReactionAt(first, 1_000 + REACTION_COOLDOWN_MS - 1)).toBeNull()
    expect(acceptedReactionAt(first, 1_000 + REACTION_COOLDOWN_MS)).toBe(1_700)
  })
})
