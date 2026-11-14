// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { getMirroredCard, type Card, type GameState, type PileEntry, type Player } from '../../engine'
import { TableScreen } from '../TableScreen'

const c = (id: string, rank: Card['rank'], suit: Card['suit'] = '♠'): Card => ({ id, rank, suit })
const entry = (...cards: Card[]): PileEntry => ({ cards, cleared: false })

function stateWith(pile: PileEntry[], seq = 5): GameState {
  const mine: Player = { id: 'me', name: 'Me', hand: [c('h1', '4')], faceUp: [], faceDown: [], isOut: false }
  const other: Player = { id: 'other', name: 'Other', hand: [c('o1', '4', '♣')], faceUp: [], faceDown: [], isOut: false }
  return {
    phase: 'play', rules: { includeJokers: true, winnerSwapsFaceUp: false, deckCount: 1 },
    players: [other, mine], stock: [c('s1', '6')], pile, currentPlayerIdx: 1, playDirection: 1, turnCount: seq,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq,
  } as GameState
}

describe('getMirroredCard', () => {
  it('returns the card a 3 copies', () => {
    expect(getMirroredCard(stateWith([entry(c('k', 'K')), entry(c('t', '3'))]))?.id).toBe('k')
  })
  it('looks through stacked 3s', () => {
    expect(getMirroredCard(stateWith([entry(c('k', 'K')), entry(c('t1', '3')), entry(c('t2', '3', '♥'))]))?.id).toBe('k')
  })
  it('is null when the pile is open beneath, or a 2 resets it', () => {
    expect(getMirroredCard(stateWith([entry(c('t', '3'))]))).toBeNull()
    expect(getMirroredCard(stateWith([entry(c('two', '2')), entry(c('t', '3'))]))).toBeNull()
  })
  it('is null when the top card is not a 3, or the pile is empty', () => {
    expect(getMirroredCard(stateWith([entry(c('k', 'K')), entry(c('n', '9'))]))).toBeNull()
    expect(getMirroredCard(stateWith([]))).toBeNull()
  })
  it('ignores cleared entries', () => {
    const cleared: PileEntry = { cards: [c('old', 'A')], cleared: true }
    expect(getMirroredCard(stateWith([cleared, entry(c('t', '3'))]))).toBeNull()
  })
})

beforeAll(() => {
  class ResizeObserverMock { observe() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})
afterEach(cleanup)

const props = {
  viewerId: 'me', viewerActive: false, onPlay: vi.fn(), onPickUp: vi.fn(), onLeave: vi.fn(),
  onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
}

describe('mirror ghost on the table', () => {
  it('ghosts the copied card through a freshly landed 3, then goes away', async () => {
    const view = render(<TableScreen state={stateWith([entry(c('k', 'K', '♥'))], 4)} {...props} />)
    expect(view.container.querySelector('.mirror-ghost')).toBeNull()
    view.rerender(<TableScreen state={stateWith([entry(c('k', 'K', '♥')), entry(c('t', '3'))], 5)} {...props} />)
    const ghost = view.container.querySelector('.mirror-ghost')
    expect(ghost?.getAttribute('data-mirror-of')).toBe('k')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    await waitFor(() => expect(view.container.querySelector('.mirror-ghost')).toBeNull(), { timeout: 3000 })
  })

  it('does not ghost on an open pile or over a 2', () => {
    const open = render(<TableScreen state={stateWith([], 4)} {...props} />)
    open.rerender(<TableScreen state={stateWith([entry(c('t', '3'))], 5)} {...props} />)
    expect(open.container.querySelector('.mirror-ghost')).toBeNull()
    open.unmount()
    const reset = render(<TableScreen state={stateWith([entry(c('two', '2'))], 4)} {...props} />)
    reset.rerender(<TableScreen state={stateWith([entry(c('two', '2')), entry(c('t', '3'))], 5)} {...props} />)
    expect(reset.container.querySelector('.mirror-ghost')).toBeNull()
  })

  it('does not replay for a 3 already on top when the table mounts', () => {
    const view = render(<TableScreen state={stateWith([entry(c('k', 'K')), entry(c('t', '3'))], 5)} {...props} />)
    expect(view.container.querySelector('.mirror-ghost')).toBeNull()
  })

  it('does not ghost for a normal card', () => {
    const view = render(<TableScreen state={stateWith([entry(c('k', 'K'))], 4)} {...props} />)
    view.rerender(<TableScreen state={stateWith([entry(c('k', 'K')), entry(c('n', '9'))], 5)} {...props} />)
    expect(view.container.querySelector('.mirror-ghost')).toBeNull()
  })
})
