import { describe, expect, it } from 'vitest'
import { AUTO_RELOAD_COOLDOWN_MS, shouldAutoReload } from './swUpdate'

describe('service-worker auto reload guard', () => {
  const now = 1_000_000

  it('reloads once for a real update', () => {
    expect(shouldAutoReload(true, false, null, now)).toBe(true)
  })

  it('never reloads for a first install', () => {
    expect(shouldAutoReload(false, false, null, now)).toBe(false)
  })

  it('reloads at most once per page load', () => {
    expect(shouldAutoReload(true, true, null, now)).toBe(false)
  })

  it('refuses a second automatic reload inside the cooldown', () => {
    expect(shouldAutoReload(true, false, now - 1_000, now)).toBe(false)
    expect(shouldAutoReload(true, false, now - AUTO_RELOAD_COOLDOWN_MS + 1, now)).toBe(false)
  })

  it('allows the next update after the cooldown', () => {
    expect(shouldAutoReload(true, false, now - AUTO_RELOAD_COOLDOWN_MS, now)).toBe(true)
  })

  it('does not lock updates out after a backwards clock change or bad value', () => {
    expect(shouldAutoReload(true, false, now + 5_000, now)).toBe(true)
    expect(shouldAutoReload(true, false, Number.NaN, now)).toBe(true)
  })
})
