// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// framer-motion caches the media query on first use, so the hook is mocked to
// make "reduced motion" switchable per test.
const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('framer-motion', async importOriginal => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduced,
}))
import { cleanup, render } from '@testing-library/react'
import type { Card, GameState, Player } from '../../engine'
import { TableScreen } from '../TableScreen'
import { releaseFlips } from '../cardFlight'
import { RIPPLE_MAX_DELAY_MS, RIPPLE_STEP_MS, rippleCards, rippleDelay, rippleTargets } from '../yourTurnRipple'

describe('rippleDelay', () => {
  it('steps 30ms per card and caps', () => {
    expect(rippleDelay(0)).toBe(0)
    expect(rippleDelay(1)).toBe(RIPPLE_STEP_MS)
    expect(rippleDelay(4)).toBe(4 * RIPPLE_STEP_MS)
    expect(rippleDelay(500)).toBe(RIPPLE_MAX_DELAY_MS)
    expect(rippleDelay(-3)).toBe(0)
  })
})

describe('rippleTargets', () => {
  const cardEl = (state: string, left: number, top = 600) => {
    const el = document.createElement('button')
    el.className = 'card'
    el.dataset.state = state
    el.getBoundingClientRect = () => ({ left, top, width: 80, height: 128 } as DOMRect)
    return el
  }

  it('visits playable and joinable cards only, left to right', () => {
    const root = document.createElement('div')
    const [c, a, b, rest, invalid] = [cardEl('playable', 90), cardEl('playable', 10), cardEl('joinable', 50), cardEl('rest', 20), cardEl('invalid', 30)]
    root.append(c, a, rest, b, invalid)
    expect(rippleTargets(root)).toEqual([a, b, c])
  })

  it('keeps separate rows as separate waves (upper row first)', () => {
    const root = document.createElement('div')
    const tableauRight = cardEl('playable', 200, 300)
    const tableauLeft = cardEl('playable', 20, 300)
    const handLeft = cardEl('playable', 5, 600)
    root.append(handLeft, tableauRight, tableauLeft)
    expect(rippleTargets(root)).toEqual([tableauLeft, tableauRight, handLeft])
  })

  it('is not thrown by a few px of vertical jitter between cards in one row', () => {
    const root = document.createElement('div')
    // Lifted/in-transition cards: tops straddle any fixed bucket boundary.
    const right = cardEl('playable', 90, 597)
    const left = cardEl('playable', 10, 604)
    const middle = cardEl('playable', 50, 600)
    root.append(right, left, middle)
    expect(rippleTargets(root)).toEqual([left, middle, right])
  })

  it('animates the translate property with rising delays', () => {
    const root = document.createElement('div')
    const els = [cardEl('playable', 10), cardEl('playable', 50), cardEl('playable', 90)]
    const seen: Array<{ k: Keyframe[]; o: KeyframeAnimationOptions }> = []
    els.forEach(el => { ;(el as unknown as { animate: unknown }).animate = (k: Keyframe[], o: KeyframeAnimationOptions) => { seen.push({ k, o }); return {} } })
    root.append(...els)
    expect(rippleCards(root)).toBe(3)
    expect(seen.map(s => s.o.delay)).toEqual([0, 30, 60])
    expect(seen[0].k[0]).toEqual({ translate: '0px 0px' })
    expect(seen[0].k[1]).toMatchObject({ translate: '0px -9px' })
    expect(seen.every(s => !('transform' in s.k[0]))).toBe(true)
  })
})

const card = (id: string, rank: Card['rank'], suit: Card['suit'] = '♠'): Card => ({ id, rank, suit })

function stateFor(turn: 'me' | 'other', turnCount: number): GameState {
  const mine: Player = { id: 'me', name: 'Me', hand: [card('h1', '4'), card('h2', '6', '♥'), card('h3', '9', '♦')], faceUp: [], faceDown: [], isOut: false }
  const other: Player = { id: 'other', name: 'Other', hand: [card('o1', '4', '♣')], faceUp: [], faceDown: [], isOut: false }
  return {
    phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [card('s1', '5')], pile: [], currentPlayerIdx: turn === 'me' ? 1 : 0, playDirection: 1,
    turnCount, winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: turnCount,
  } as GameState
}

describe('your-turn ripple on the table', () => {
  const calls: Array<{ id: string | undefined; delay: unknown; keyframes: Keyframe[] }> = []
  const props = (active: boolean) => ({
    viewerId: 'me', viewerActive: active, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
    onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
  })

  beforeEach(() => {
    calls.length = 0
    motion.reduced = false
    releaseFlips()
    class ResizeObserverMock { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    // Hand cards sit left to right by id; everything else has a plain box.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const n = Number(this.closest('[data-card-id]')?.getAttribute('data-card-id')?.replace(/\D/g, '') || 0)
      return { left: 20 + n * 28, top: 600, width: 80, height: 128, right: 100, bottom: 728, x: 0, y: 0, toJSON() {} } as DOMRect
    })
    ;(HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      if (this.classList.contains('card')) calls.push({ id: this.closest('[data-card-id]')?.getAttribute('data-card-id') ?? undefined, delay: options.delay, keyframes })
      return { cancel() {} }
    }
  })
  afterEach(() => {
    cleanup()
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const ripples = () => calls.filter(c => 'translate' in c.keyframes[0] && String(c.keyframes[1]?.translate ?? '').includes('-9px'))

  it('ripples the playable cards left to right when the turn reaches you', () => {
    const view = render(<TableScreen state={stateFor('other', 4)} {...props(false)} />)
    expect(ripples()).toHaveLength(0)
    view.rerender(<TableScreen state={stateFor('me', 5)} {...props(true)} />)
    const wave = ripples()
    expect(wave.map(c => c.id)).toEqual(['h1', 'h2', 'h3'])
    expect(wave.map(c => c.delay)).toEqual([0, 30, 60])
  })

  it('does not ripple for a table that mounts mid-turn, or on re-renders within the same turn', () => {
    const view = render(<TableScreen state={stateFor('me', 5)} {...props(true)} />)
    expect(ripples()).toHaveLength(0)
    view.rerender(<TableScreen state={stateFor('me', 5)} {...props(true)} />)
    expect(ripples()).toHaveLength(0)
  })

  it('ripples again on a new turn of yours, but not when the turn passes away', () => {
    const view = render(<TableScreen state={stateFor('other', 4)} {...props(false)} />)
    view.rerender(<TableScreen state={stateFor('me', 5)} {...props(true)} />)
    expect(ripples()).toHaveLength(3)
    view.rerender(<TableScreen state={stateFor('other', 6)} {...props(false)} />)
    expect(ripples()).toHaveLength(3)
    view.rerender(<TableScreen state={stateFor('me', 7)} {...props(true)} />)
    expect(ripples()).toHaveLength(6)
  })

  it('stays still under reduced motion', () => {
    motion.reduced = true
    const view = render(<TableScreen state={stateFor('other', 4)} {...props(false)} />)
    view.rerender(<TableScreen state={stateFor('me', 5)} {...props(true)} />)
    expect(ripples()).toHaveLength(0)
  })
})
