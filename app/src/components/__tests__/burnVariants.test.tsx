// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Card, GameEvent, GameState, Player } from '../../engine'
import { TableScreen, burnCleanupDelay } from '../TableScreen'
import { burnCleanupMs, burnStackMotion } from '../BurnFx'

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 100, top: 300, width: 80, height: 128, right: 180, bottom: 428, x: 100, y: 300, toJSON() {} } as DOMRect,
  )
})
afterEach(cleanup)

describe('burn variant timing', () => {
  it('keeps the ten at 560ms and gives the longer variants more room', () => {
    expect(burnCleanupMs('ten')).toBe(560)
    expect(burnCleanupMs('quartet')).toBe(720)
    expect(burnCleanupMs('joker')).toBe(760)
    expect(burnCleanupMs(null)).toBe(560)
    expect(burnCleanupDelay(true, 'joker')).toBe(140)
    expect(burnCleanupDelay(false, 'quartet')).toBe(720)
  })

  it('gives each reason its own stack motion, with the key times ascending', () => {
    for (const reason of ['ten', 'quartet', 'joker'] as const) {
      const motion = burnStackMotion(reason)!
      const times = motion.transition.times
      expect(times[0]).toBe(0)
      expect(times.at(-1)).toBe(1)
      expect(times).toEqual([...times].sort((a, b) => a - b))
      expect(motion.transition.duration).toBeCloseTo(burnCleanupMs(reason) / 1000, 1)
    }
    expect(burnStackMotion(null)).toBeNull()
  })
})

const props = {
  viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
  onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
}
const pileFive: Card = { id: 'pile-five', rank: '5', suit: '♦' }

function burnState(opts: { reason?: 'ten' | 'quartet' | 'joker'; blind?: boolean; seq: number }): GameState {
  const burner: Card = opts.reason === 'joker'
    ? { id: 'burner', rank: 'JOKER', suit: null as never }
    : { id: 'burner', rank: opts.reason === 'quartet' ? '5' : '10', suit: '♣' }
  const log: GameEvent[] = opts.reason ? [
    ...(opts.blind ? [{ type: 'BLIND_REVEAL', playerId: 'me', card: burner, success: true } as GameEvent] : []),
    { type: 'PLAY_CARDS', playerId: 'me', cards: [burner] },
    { type: 'CLEAR_PILE', reason: opts.reason },
  ] : []
  const mine: Player = {
    id: 'me', name: 'Me', hand: opts.blind ? [] : [{ id: 'keep', rank: '4', suit: '♠' }],
    faceUp: [], faceDown: opts.blind && !opts.reason ? [{ id: 'blind', rank: '10', suit: '♣' }] : [], isOut: false,
  }
  const other: Player = { id: 'other', name: 'Other', hand: [{ id: 'o1', rank: '4', suit: '♣' }], faceUp: [], faceDown: [], isOut: false }
  return {
    phase: opts.blind ? 'endgame' : 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [], pile: opts.reason ? [] : [{ cards: [pileFive], cleared: false }],
    currentPlayerIdx: 1, playDirection: 1, turnCount: opts.seq, winnerId: null, loserId: null,
    pendingTribute: null, pendingQuickFollowUp: null, log, seq: opts.seq,
  } as GameState
}

const stage = (c: HTMLElement) => c.querySelector('.table-pile-stage')

describe('burn variants on the table', () => {
  for (const [reason, layers] of [['ten', 0], ['quartet', 4], ['joker', 0]] as const) {
    it(`lands the card, then renders the ${reason} effect for its reason`, async () => {
      const view = render(<TableScreen state={burnState({ seq: 4 })} {...props} />)
      view.rerender(<TableScreen state={burnState({ reason, seq: 5 })} {...props} />)
      // The burning card is on the pile from the first commit, never an empty slot.
      expect(view.container.querySelector('.pile-slot--waste')).toBeNull()
      expect(view.container.querySelector('.waste-pile__entry')).not.toBeNull()
      expect(stage(view.container)?.getAttribute('data-burning')).toBe('false')
      await waitFor(() => expect(stage(view.container)?.getAttribute('data-burning')).toBe('true'), { timeout: 2000 })
      const fx = view.container.querySelector('.burn-fx')
      expect(fx?.getAttribute('data-burn-fx')).toBe(reason)
      expect(fx!.querySelectorAll('[data-fx="slam"]').length).toBe(layers)
      expect(stage(view.container)?.getAttribute('data-burn-key')).toContain(`:${reason}:`)
    })
  }

  it('waits for a blind flip to finish before burning, then burns', async () => {
    const view = render(<TableScreen state={burnState({ blind: true, seq: 4 })} {...props} />)
    view.rerender(<TableScreen state={burnState({ blind: true, reason: 'ten', seq: 5 })} {...props} />)
    // The flip is playing; the burn has not started and the pile is not yet cleared.
    expect(view.container.querySelector('.blind-reveal')).not.toBeNull()
    expect(stage(view.container)?.getAttribute('data-burning')).toBe('false')
    expect(view.container.querySelector('.burn-fx')).toBeNull()

    await waitFor(() => expect(stage(view.container)?.getAttribute('data-burning')).toBe('true'), { timeout: 3000 })
    expect(view.container.querySelector('.blind-reveal')).toBeNull()
    expect(view.container.querySelector('.burn-fx')?.getAttribute('data-burn-fx')).toBe('ten')
    await waitFor(() => expect(stage(view.container)?.getAttribute('data-burning')).toBe('false'), { timeout: 3000 })
  })
})
