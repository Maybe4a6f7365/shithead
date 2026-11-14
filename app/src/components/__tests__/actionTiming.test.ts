// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Card, GameEvent } from '../../engine'
import { aiTickDelay } from '../GameTable'
import { blindRevealMs } from '../BlindReveal'
import { burnCleanupMs } from '../BurnFx'
import { actionSettleMs, playArrivalMs, useGameOverReady } from '../actionTiming'
import { latestAnimatedEvents } from '../feedText'

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

  it('waits for an ordinary burn: the card lands, then the pile burns', () => {
    const log: GameEvent[] = [play, { type: 'CLEAR_PILE', reason: 'joker' }]
    expect(aiTickDelay(log, false)).toBeGreaterThan(playArrivalMs(1) + burnCleanupMs('joker'))
  })

  it('does not slow down when motion is reduced (no reveal plays)', () => {
    expect(aiTickDelay([blind(true), play], true)).toBe(900)
  })
})

describe('latestAnimatedEvents', () => {
  const out: GameEvent = { type: 'PLAYER_OUT', playerId: 'ai' }
  const over: GameEvent = { type: 'GAME_OVER', loserId: 'me' }

  it('keeps the play that ended the round together with its GAME_OVER', () => {
    const older: GameEvent = { type: 'PICK_UP_PILE', playerId: 'me' }
    expect(latestAnimatedEvents([older, blind(true), play, out, over])).toEqual([blind(true), play, out, over])
  })

  it('does not replay the previous action for a bare GAME_OVER (stalemate cap)', () => {
    expect(latestAnimatedEvents([play, over])).toEqual([over])
  })

  it('gives the round-over card something to wait for', () => {
    expect(actionSettleMs([blind(true), play, out, over], false)).toBe(blindRevealMs(true))
    expect(actionSettleMs([play, over], false)).toBe(0)
    expect(actionSettleMs([blind(true), play, out, over], true)).toBe(0)
  })
})

describe('useGameOverReady', () => {
  const out: GameEvent = { type: 'PLAYER_OUT', playerId: 'ai' }
  const over: GameEvent = { type: 'GAME_OVER', loserId: 'me' }
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('is ready at once when the table opens on a finished round', () => {
    const { result } = renderHook(() => useGameOverReady({ phase: 'gameOver', log: [blind(true), play, out, over] }, false))
    expect(result.current).toBe(true)
  })

  it('waits for the deciding flip before showing the round-over card', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ phase, log }: { phase: 'endgame' | 'gameOver'; log: GameEvent[] }) => useGameOverReady({ phase, log }, false),
      { initialProps: { phase: 'endgame', log: [play] } },
    )
    expect(result.current).toBe(false)
    rerender({ phase: 'gameOver', log: [blind(true), play, out, over] })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(blindRevealMs(true) - 50) })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current).toBe(true)
  })

  it('does not wait under reduced motion', () => {
    const { result, rerender } = renderHook(
      ({ phase, log }: { phase: 'endgame' | 'gameOver'; log: GameEvent[] }) => useGameOverReady({ phase, log }, true),
      { initialProps: { phase: 'endgame', log: [play] } },
    )
    rerender({ phase: 'gameOver', log: [blind(true), play, out, over] })
    expect(result.current).toBe(true)
  })
})
