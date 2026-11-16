// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Card } from '../../engine'
import { usePlayDraft, type PlayDraftArgs } from '../table/usePlayDraft'

const card = (id: string, rank: Card['rank']): Card => ({ id, rank, suit: '♠' })
const nine = card('h9', '9')
const nineB = card('h9b', '9')
const king = card('hK', 'K')
const hand = [nine, nineB, king]

function draft(overrides: Partial<PlayDraftArgs> = {}) {
  const onDraftDropped = vi.fn()
  const initialProps: PlayDraftArgs = {
    phase: 'play', actionSeq: 1, viewerId: 'me', viewerActive: false,
    zone: 'hand', zoneCards: hand, topRank: '8', onDraftDropped, ...overrides,
  }
  const hook = renderHook((props: PlayDraftArgs) => usePlayDraft(props), { initialProps })
  const update = (next: Partial<PlayDraftArgs>) => hook.rerender({ ...initialProps, ...next })
  return { ...hook, update, onDraftDropped, initialProps }
}

afterEach(cleanup)

describe('usePlayDraft', () => {
  it('keeps a prepared play across table updates it still fits', () => {
    const { result, update, onDraftDropped } = draft()
    act(() => result.current.setSelection([nine.id, nineB.id]))
    update({ actionSeq: 2, topRank: '6' })
    expect(result.current.selection).toEqual([nine.id, nineB.id])
    expect(result.current.selectedCards).toEqual([nine, nineB])
    expect(onDraftDropped).not.toHaveBeenCalled()
  })

  it('drops the whole draft, and says so once, when it stops fitting the pile', () => {
    const { result, update, onDraftDropped } = draft()
    act(() => result.current.setSelection([nine.id, nineB.id]))
    // A King lands: the 9s no longer fit. Nothing stale is shown, even on the
    // render before the stored draft catches up.
    update({ actionSeq: 2, topRank: 'K' })
    expect(result.current.selection).toEqual([])
    expect(result.current.selectedCards).toEqual([])
    expect(onDraftDropped).toHaveBeenCalledTimes(1)
    expect(onDraftDropped).toHaveBeenCalledWith('Prepared cards no longer fit the pile — choose again')
    // Later renders of the same table do not repeat it, and the draft does not
    // come back when the pile opens up again.
    update({ actionSeq: 3, topRank: '4' })
    expect(result.current.selection).toEqual([])
    expect(onDraftDropped).toHaveBeenCalledTimes(1)
  })

  it('drops the whole draft when one of its cards has left the row', () => {
    const { result, update } = draft()
    act(() => result.current.setSelection([nine.id, nineB.id]))
    update({ actionSeq: 2, zoneCards: [nine, king] })
    expect(result.current.selection).toEqual([])
  })

  it('never carries a draft or an armed pick-up over to the next pass-and-play viewer', () => {
    const { result, update, onDraftDropped } = draft({ viewerActive: true })
    act(() => {
      result.current.setSelection([king.id])
      result.current.setPickupArmed(true)
    })
    update({ viewerId: 'next', viewerActive: true })
    expect(result.current.selection).toEqual([])
    expect(result.current.pickupArmed).toBe(false)
    // Handing the device back does not bring the old draft back either.
    update({ viewerId: 'me', viewerActive: true })
    expect(result.current.selection).toEqual([])
    expect(onDraftDropped).not.toHaveBeenCalled()
  })

  it('disarms the pick-up guard whenever the table moves on', () => {
    const { result, update } = draft({ viewerActive: true })
    act(() => result.current.setPickupArmed(true))
    update({ actionSeq: 2, viewerActive: true, topRank: 'Q' })
    expect(result.current.pickupArmed).toBe(false)
  })

  it('holds a blind choice only on the viewer\'s own turn, one card at a time', () => {
    const down = [card('d1', '5'), card('d2', 'J')]
    const blind = { zone: 'faceDown' as const, zoneCards: down, viewerActive: true }
    const { result, update, onDraftDropped } = draft(blind)
    act(() => result.current.setSelection(['d1']))
    expect(result.current.selection).toEqual(['d1'])
    update({ ...blind, viewerActive: false })
    expect(result.current.selection).toEqual([])
    // A blind choice is not a prepared play: losing it needs no explanation.
    expect(onDraftDropped).not.toHaveBeenCalled()
  })

  it('has no draft outside play', () => {
    const { result, update } = draft()
    act(() => result.current.setSelection([king.id]))
    update({ phase: 'gameOver' })
    expect(result.current.selection).toEqual([])
  })
})
