// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GameState } from '../../engine'
import { setSoundHandler, useSoundFromLog } from '../soundManager'

function state(seq: number, log: GameState['log']): GameState {
  return {
    phase: 'play',
    rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [], stock: [], pile: [], currentPlayerIdx: 0, playDirection: 1,
    turnCount: seq, winnerId: null, loserId: null, pendingTribute: null, log, seq,
  }
}

function Harness({ value, enabled }: { value: GameState; enabled: boolean }) {
  useSoundFromLog(value, enabled)
  return null
}

afterEach(() => {
  cleanup()
  setSoundHandler(() => {})
  vi.useRealTimers()
})

describe('sound log cursor', () => {
  it('does not replay retained history on mount or re-enable', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const sounds = vi.fn()
    setSoundHandler(sounds)
    const played = { type: 'PLAY_CARDS' as const, playerId: 'p', cards: [{ id: 'c', rank: '5' as const, suit: '♣' as const }] }
    const { rerender } = render(<Harness value={state(10, [played])} enabled />)
    expect(sounds).not.toHaveBeenCalled()

    vi.setSystemTime(2000)
    rerender(<Harness value={state(11, [played, { type: 'PICK_UP_PILE', playerId: 'p' }])} enabled />)
    expect(sounds).toHaveBeenCalledWith('pickup')
    sounds.mockClear()

    rerender(<Harness value={state(11, [played, { type: 'PICK_UP_PILE', playerId: 'p' }])} enabled={false} />)
    rerender(<Harness value={state(11, [played, { type: 'PICK_UP_PILE', playerId: 'p' }])} enabled />)
    expect(sounds).not.toHaveBeenCalled()
  })

  it('advances by seq even when the capped log length stays unchanged', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const sounds = vi.fn()
    setSoundHandler(sounds)
    const oldLog: GameState['log'] = Array.from({ length: 50 }, () => ({ type: 'REARRANGE', playerId: 'p', fromIdx: 0, toIdx: 0 }))
    const { rerender } = render(<Harness value={state(50, oldLog)} enabled />)
    const nextLog: GameState['log'] = [...oldLog.slice(1), {
      type: 'PLAY_CARDS', playerId: 'p', cards: [{ id: 'new', rank: '8', suit: '♣' }],
    }]
    vi.setSystemTime(6000)
    rerender(<Harness value={state(51, nextLog)} enabled />)
    expect(sounds).toHaveBeenCalledWith('play')
  })
})
