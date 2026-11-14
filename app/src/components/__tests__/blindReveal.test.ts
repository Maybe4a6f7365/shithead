import { describe, expect, it } from 'vitest'
import { blindTimeline } from '../BlindReveal'

describe('blindTimeline', () => {
  const start = { x: -40, y: 300, scale: 0.6 }

  it('holds as a card back, flips between 430ms and 700ms, then settles on success', () => {
    const t = blindTimeline(true, start, null)
    expect(t.total).toBe(900)
    expect(t.times[0]).toBe(0)
    expect(t.times.at(-1)).toBe(1)
    expect(t.flip).toEqual([0, 0, 0, 180, 180])
    expect([t.x[0], t.y[0], t.scale[0]]).toEqual([-40, 300, 0.6])
    expect(t.opacity.every(o => o === 1)).toBe(true)
    expect(t.scale.at(-1)).toBe(1)
  })

  it('shakes and sweeps toward the taker, fading out, on failure', () => {
    const t = blindTimeline(false, start, { x: 10, y: 400 })
    expect(t.total).toBe(1280)
    expect(t.x.slice(4, 8)).toEqual([7, -7, 4, 0])
    expect(t.x.at(-1)).toBe(10)
    expect(t.y.at(-1)).toBe(400)
    expect(t.opacity.at(-1)).toBe(0)
    expect(t.flip.at(-1)).toBe(180)
    expect(t.times).toEqual([...t.times].sort((a, b) => a - b))
  })
})
