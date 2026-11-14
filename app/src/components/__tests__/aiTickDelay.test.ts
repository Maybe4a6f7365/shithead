import { describe, expect, it } from 'vitest'
import type { Card, GameEvent } from '../../engine'
import { aiTickDelay } from '../GameTable'
import { blindRevealMs } from '../BlindReveal'
import { burnCleanupMs } from '../BurnFx'

const card: Card = { id: 'c1', rank: '10', suit: '♠' }
const blind = (success: boolean): GameEvent => ({ type: 'BLIND_REVEAL', playerId: 'ai', card, success })
const play: GameEvent = { type: 'PLAY_CARDS', playerId: 'ai', cards: [card] }

describe('aiTickDelay', () => {
  it('keeps the base pace after an ordinary play', () => {
    expect(aiTickDelay([play], false)).toBe(900)
  })

  it('waits for a blind flip to finish before the next AI action', () => {
    expect(aiTickDelay([blind(true), play], false)).toBeGreaterThan(blindRevealMs(true))
    const failed: GameEvent[] = [blind(false), { type: 'PICK_UP_PILE', playerId: 'ai' }]
    expect(aiTickDelay(failed, false)).toBeGreaterThan(blindRevealMs(false))
  })

  it('also waits for the burn a blind flip caused', () => {
    const log: GameEvent[] = [blind(true), play, { type: 'CLEAR_PILE', reason: 'ten' }]
    expect(aiTickDelay(log, false)).toBeGreaterThan(blindRevealMs(true) + burnCleanupMs('ten'))
  })

  it('does not slow down when motion is reduced (no reveal plays)', () => {
    expect(aiTickDelay([blind(true), play], true)).toBe(900)
  })
})
