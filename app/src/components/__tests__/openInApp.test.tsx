// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { androidIntentUrl, canHandOffToAndroidApp } from '../openInApp'
import { JoinCreateScreen } from '../JoinCreateScreen'
import { inviteUrl } from '../WaitingRoom'

afterEach(cleanup)

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'

describe('android app hand-off', () => {
  it('keeps the invite intact and carries it as the browser fallback', () => {
    const url = androidIntentUrl('https://shead.online/?room=ABC123')
    expect(url.startsWith('intent://shead.online/?room=ABC123#Intent;')).toBe(true)
    expect(url).toContain(';scheme=https;')
    expect(url).toContain(';action=android.intent.action.VIEW;')
    expect(url).toContain(`;S.browser_fallback_url=${encodeURIComponent('https://shead.online/?room=ABC123')};`)
    expect(url.endsWith(';end')).toBe(true)
  })

  it('offers the hand-off only in an Android browser tab', () => {
    expect(canHandOffToAndroidApp(ANDROID, false)).toBe(true)
    // Already inside the installed app, or on a platform that cannot hand off.
    expect(canHandOffToAndroidApp(ANDROID, true)).toBe(false)
    expect(canHandOffToAndroidApp(IPHONE, false)).toBe(false)
    expect(canHandOffToAndroidApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false)).toBe(false)
  })
})

describe('invite link hand-off button', () => {
  const renderJoin = () => render(<JoinCreateScreen onBack={vi.fn()} onEnterRoom={vi.fn()} />)

  const stubPlatform = (userAgent: string) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  }

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('points an Android invite at the installed app', () => {
    window.history.replaceState({}, '', '/?room=abc123')
    stubPlatform(ANDROID)
    renderJoin()
    const link = screen.getByRole('link', { name: /open in app/i })
    expect(link.getAttribute('href')).toBe(androidIntentUrl(inviteUrl('ABC123')))
  })

  it('leaves iOS and code-typing players untouched', () => {
    window.history.replaceState({}, '', '/?room=abc123')
    stubPlatform(IPHONE)
    const ios = renderJoin()
    expect(ios.queryByRole('link', { name: /open in app/i })).toBeNull()
    cleanup()

    // Android, but no invite link — nothing to hand off.
    window.history.replaceState({}, '', '/')
    stubPlatform(ANDROID)
    const typed = renderJoin()
    expect(typed.queryByRole('link', { name: /open in app/i })).toBeNull()
  })
})
