// @ts-ignore Vitest executes this contract test in Node; the browser-only app
// tsconfig intentionally does not include the full Node type surface.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
const handFan = readFileSync(new URL('../HandFan.tsx', import.meta.url), 'utf8')

describe('Android visual viewport regression', () => {
  it('sizes the clipped game screen from the live visual viewport', () => {
    // Some Android browsers report vh/svh/dvh against the area behind their
    // address/navigation chrome. Because .app-viewport clips overflow, that
    // placed a large pickup hand below the actually visible, tappable area.
    // Keep the runtime measurement and its CSS consumer coupled so neither
    // half of the fix can be removed unnoticed.
    expect(main).toContain('window.visualViewport')
    expect(main).toContain('--app-viewport-height')

    const appViewportRule = css.match(/\.app-viewport\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(appViewportRule).toContain('var(--app-viewport-height')
    expect(appViewportRule).toContain('min(100dvh')

    // A pickup must not switch to a second geometry at 13 cards. The same
    // hand-fan row remains in place and only its horizontal width grows.
    expect(handFan).not.toContain('const large')
    expect(handFan).not.toContain('large-hand')
    expect(css).not.toContain('.large-hand')

    const handRule = css.match(/\.hand-fan\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(handRule).toContain('overscroll-behavior-x: contain')
    expect(handRule).toContain('touch-action: pan-x')
    expect(handRule).toContain('--hand-card-height')
    expect(handRule).toContain('height: calc(var(--hand-card-height)')
    expect(handRule).toContain('overflow-x: auto')
    expect(handRule).toContain('overflow-y: hidden')
    expect(handFan).not.toContain('overflow-y-visible')
  })
})
