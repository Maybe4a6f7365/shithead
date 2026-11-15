// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Card, GameEvent, GameState, Player } from '../../engine'
import { TableScreen, topRunCards } from '../TableScreen'
import { burnCleanupMs, burnStackMotion } from '../BurnFx'
import { BURN_MS, JOKER_POP_MS, QUARTET_IMPACT_MS } from '../pileFx/burns'
import { landingFxMs } from '../pileFx/landings'
import { canvasFxSupported, qualityForPace } from '../pileFx/stage'
import { skippedSeatIds } from '../seatFx'
import { burnMaskSupported } from '../pileFx/burnMask'

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 100, top: 300, width: 80, height: 128, right: 180, bottom: 428, x: 100, y: 300, toJSON() {} } as DOMRect,
  )
})
afterEach(cleanup)

const card = (id: string, rank: Card['rank'], suit: Card['suit'] = '♠'): Card => ({ id, rank, suit })
const entry = (...cards: Card[]) => ({ cards, cleared: false })

describe('pile effects: timing', () => {
  it('stages each burn inside the time the table waits for it', () => {
    expect(QUARTET_IMPACT_MS).toBeLessThan(BURN_MS.quartet * 0.6)
    expect(JOKER_POP_MS).toBeLessThan(BURN_MS.joker * 0.5)
    for (const reason of ['ten', 'quartet', 'joker'] as const) {
      expect(burnCleanupMs(reason)).toBe(BURN_MS[reason])
      // Longer than this and a burn starts to hold up the next turn.
      expect(BURN_MS[reason]).toBeLessThanOrEqual(800)
    }
  })

  it('holds the stack opaque until the last tenth: the burn removes it, not a fade', () => {
    for (const reason of ['ten', 'quartet', 'joker'] as const) {
      const { animate, transition } = burnStackMotion(reason)!
      expect(animate.opacity.length).toBe(transition.times.length)
      expect(animate.opacity.slice(0, -1).every(value => value === 1)).toBe(true)
      expect(animate.opacity.at(-1)).toBe(0)
      expect(transition.times.at(-2)).toBeGreaterThanOrEqual(0.88)
    }
  })

  it('takes the quartet stack its hit at the moment the four cards land', () => {
    const { animate, transition } = burnStackMotion('quartet')!
    const dip = animate.scale.indexOf(Math.min(...animate.scale))
    expect(transition.times[dip - 1]).toBeCloseTo(QUARTET_IMPACT_MS / BURN_MS.quartet, 5)
  })

  it('keeps landing marks short, and a stacked skip only a little longer', () => {
    for (const kind of ['reset', 'mirror', 'low', 'skip'] as const) expect(landingFxMs(kind)).toBeLessThanOrEqual(650)
    expect(landingFxMs('skip', 3)).toBeGreaterThan(landingFxMs('skip', 1))
    expect(landingFxMs('skip', 40)).toBe(landingFxMs('skip', 4))
  })

  it('draws nothing where there is no canvas to draw on', () => {
    expect(canvasFxSupported()).toBe(false)
    expect(burnMaskSupported()).toBe(false)
  })
})

describe('topRunCards', () => {
  it('returns the same-rank cards on top of the pile, newest first', () => {
    const pile = [entry(card('k', 'K')), entry(card('a', '9', '♥')), entry(card('b', '9', '♣'), card('c', '9', '♦'))]
    expect(topRunCards({ pile }).map(c => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('skips cleared entries and stops at the first other rank', () => {
    const pile = [entry(card('a', '9')), entry(card('q', 'Q')), { cards: [card('x', '5')], cleared: true }, entry(card('b', '9', '♥'))]
    expect(topRunCards({ pile }).map(c => c.id)).toEqual(['b'])
    expect(topRunCards({ pile: [] })).toEqual([])
  })
})

describe('quartet burn', () => {
  const props = {
    viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
    onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
  }
  const onPile = [card('nine-hearts', '9', '♥'), card('nine-clubs', '9', '♣')]
  const played = [card('nine-spades', '9', '♠'), card('nine-diamonds', '9', '♦')]

  function state(burnt: boolean): GameState {
    const log: GameEvent[] = burnt
      ? [{ type: 'PLAY_CARDS', playerId: 'me', cards: played }, { type: 'CLEAR_PILE', reason: 'quartet' }]
      : []
    const mine: Player = { id: 'me', name: 'Me', hand: [card('keep', '4')], faceUp: [], faceDown: [], isOut: false }
    const other: Player = { id: 'other', name: 'Other', hand: [card('o1', '4', '♣')], faceUp: [], faceDown: [], isOut: false }
    return {
      phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [other, mine], stock: [], pile: burnt ? [] : onPile.map(c => entry(c)),
      currentPlayerIdx: 1, playDirection: 1, turnCount: burnt ? 5 : 4, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log, seq: burnt ? 5 : 4,
    } as GameState
  }

  it('fans the four real cards of the set, not four copies of the top one', async () => {
    const view = render(<TableScreen state={state(false)} {...props} />)
    view.rerender(<TableScreen state={state(true)} {...props} />)
    await waitFor(() => expect(view.container.querySelector('.burn-fx')).not.toBeNull(), { timeout: 2000 })
    const labels = Array.from(view.container.querySelectorAll('.burn-fx [data-fx="slam"] .card'))
      .map(el => el.getAttribute('aria-label'))
    expect(labels).toHaveLength(4)
    expect(new Set(labels).size).toBe(4)
    // Painted last, so on top: the card that was played last onto the pile.
    expect(labels.at(-1)).toBe('9 of spades')
    // The stack burns inside the box the mask is cut from.
    expect(view.container.querySelector('.waste-pile__burn-stack .waste-pile__burn-mask .card')).not.toBeNull()
  })
})

describe('frame-pace quality', () => {
  it('draws everything at 60 and 50 fps, thins out as frames slip, and never draws nothing', () => {
    expect(qualityForPace(1000 / 60)).toBe(1)
    expect(qualityForPace(20)).toBe(1)
    expect(qualityForPace(30)).toBeGreaterThan(qualityForPace(36))
    expect(qualityForPace(30)).toBeLessThan(1)
    expect(qualityForPace(40)).toBeCloseTo(0.45, 5)
    expect(qualityForPace(400)).toBeCloseTo(0.45, 5)
  })
})

describe('skippedSeatIds', () => {
  const seat = (id: string, isOut = false) => ({ id, name: id, hand: [], faceUp: [], faceDown: [], isOut }) as Player
  const table = (ids: Array<[string, boolean?]>, currentPlayerIdx: number) =>
    ({ players: ids.map(([id, out]) => seat(id, out)), currentPlayerIdx, playDirection: 1 as const })

  it('names the one seat a single 8 passes', () => {
    expect(skippedSeatIds(table([['a'], ['b'], ['c']], 2), 'a', 1)).toEqual(['b'])
  })

  it('names every seat stacked 8s pass, in play order, wrapping the table', () => {
    expect(skippedSeatIds(table([['a'], ['b'], ['c'], ['d']], 0), 'c', 2)).toEqual(['d'])
    expect(skippedSeatIds(table([['a'], ['b'], ['c'], ['d']], 1), 'c', 2)).toEqual(['d', 'a'])
  })

  it('skips the only opponent in a two-player game, however many 8s were played', () => {
    expect(skippedSeatIds(table([['a'], ['b']], 0), 'a', 1)).toEqual(['b'])
    expect(skippedSeatIds(table([['a'], ['b']], 0), 'a', 3)).toEqual(['b'])
  })

  it('does not count players who are already out', () => {
    expect(skippedSeatIds(table([['a'], ['b', true], ['c'], ['d']], 3), 'a', 1)).toEqual(['c'])
  })

  it('follows the direction of play and tolerates an unknown actor', () => {
    expect(skippedSeatIds({ ...table([['a'], ['b'], ['c']], 1), playDirection: -1 }, 'a', 1)).toEqual(['c'])
    expect(skippedSeatIds(table([['a'], ['b']], 0), 'nobody', 1)).toEqual([])
  })
})
