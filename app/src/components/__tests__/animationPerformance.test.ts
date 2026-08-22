import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/performance.css'), 'utf8')
const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')

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
