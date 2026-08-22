import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const css = readFileSync(new URL('../src/styles/performance.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')

void root

describe('animation performance contracts', () => {
  it('keeps frequent motion on compositor-friendly properties', () => {
    expect(css).toContain('transform: scaleX(0)')
    expect(css).toContain('box-shadow: none !important')
    expect(css).toContain('will-change: opacity')
    expect(css).not.toMatch(/animation:[^;]*(width|height|top|left|right|bottom)/)
  })

  it('coalesces visual viewport resize work to animation frames', () => {
    expect(main).toContain('requestAnimationFrame')
    expect(main).toContain('scheduleAppViewportHeightSync')
  })
})
