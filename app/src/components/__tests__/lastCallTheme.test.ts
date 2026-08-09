// @ts-ignore Vitest executes this source contract in Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8')
const tailwind = readFileSync(new URL('../../../tailwind.config.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')
const icon = readFileSync(new URL('../../../public/icons/icon.svg', import.meta.url), 'utf8')

describe('Last Call visual system contract', () => {
  it('uses the card-table palette from browser chrome through the PWA', () => {
    expect(css).toContain('--color-felt: #173d2f')
    expect(css).toContain('--color-cream: #f1e5c7')
    expect(css).toContain('--color-burgundy: #b43c32')
    expect(tailwind).toContain("felt: '#173d2f'")
    expect(html).toContain('<meta name="theme-color" content="#173d2f"')
    expect(vite).toContain("theme_color: '#173d2f'")
    expect(vite).toContain("background_color: '#0c2b21'")
  })

  it('keeps state indicators truthful after the global cascade', () => {
    expect(css).toContain('.opponent-seat[data-active="true"] .opponent-seat__turn-marker')
    expect(css).not.toMatch(/^\.opponent-seat__turn-marker\s*\{[^}]*background:\s*var\(--color-cream\)\s*!important/m)
    expect(css).toContain('.final-mini-card--empty.final-mini-card--down')
    expect(css).toContain('.state-panel .phase-action--quiet')
  })

  it('ships a flat physical-card icon rather than the retired cyber mark', () => {
    expect(icon).toContain('#173d2f')
    expect(icon).toContain('#b43c32')
    expect(icon).toContain('#f1e5c7')
    expect(icon).not.toMatch(/linearGradient|radialGradient|#4de0c4|#0b1120/i)
  })
})
