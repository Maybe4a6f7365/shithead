import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tailwind from '../../../tailwind.config.js'
import { readStylesheet } from './stylesheet'

const css = readStylesheet()
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')
const icon = readFileSync(new URL('../../../public/icons/icon.svg', import.meta.url), 'utf8')

describe('Last Call visual system contract', () => {
  it('uses the card-table palette from browser chrome through the PWA', () => {
    expect(css).toContain('--color-felt: #173d2f')
    expect(css).toContain('--color-cream: #f1e5c7')
    expect(css).toContain('--color-burgundy: #b43c32')
    expect(tailwind.theme.extend.colors.felt).toBe('#173d2f')
    expect(html).toContain('<meta name="theme-color" content="#173d2f"')
    expect(vite).toContain("theme_color: '#173d2f'")
    expect(vite).toContain("background_color: '#0c2b21'")
  })

  it('keeps every Tailwind name on the value of its CSS token', () => {
    // The first definition is the token; later ones are media-query overrides.
    const tokens = new Map<string, string>()
    for (const [, name, value] of readStylesheet('tokens.css').matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
      if (!tokens.has(name)) tokens.set(name, value)
    }
    // `0.20` and `0.2`, with or without spaces, are the same value.
    const canonical = (value: string) => value.replace(/\s+/g, '').replace(/(\.\d*?)0+(?=\D|$)/g, '$1')
    const { colors, spacing, borderRadius, zIndex, fontFamily } = tailwind.theme.extend
    const mirrored: Array<[token: string, value: string]> = [
      ...Object.entries(colors).map(([name, value]): [string, string] => [`--color-${name}`, value]),
      ...Object.entries(spacing).map(([name, value]): [string, string] => [`--${name}`, value]),
      ...Object.entries(borderRadius).map(([name, value]): [string, string] => [`--radius-${name}`, value]),
      ...Object.entries(zIndex).map(([name, value]): [string, string] => [`--z-${name}`, value]),
      ['--font-display', fontFamily.display.join(', ')],
    ]
    expect(mirrored.length).toBeGreaterThan(25)
    for (const [token, value] of mirrored) {
      expect(tokens.has(token), `${token} is missing from tokens.css`).toBe(true)
      expect(canonical(tokens.get(token)!), token).toBe(canonical(value))
    }
  })

  it('keeps state indicators truthful after the global cascade', () => {
    expect(css).toContain('.opponent-seat[data-active="true"] .opponent-seat__turn-marker')
    expect(css).not.toMatch(/^\.opponent-seat__turn-marker\s*\{[^}]*background:\s*var\(--color-cream\)\s*!important/m)
    expect(css).toContain('.final-mini-card--slot')
    expect(css).toContain('.state-panel .phase-action--quiet')
  })

  it('ships a flat physical-card icon rather than the retired cyber mark', () => {
    expect(icon).toContain('#173d2f')
    expect(icon).toContain('#b43c32')
    expect(icon).toContain('#f1e5c7')
    expect(icon).not.toMatch(/linearGradient|radialGradient|#4de0c4|#0b1120/i)
  })
})
