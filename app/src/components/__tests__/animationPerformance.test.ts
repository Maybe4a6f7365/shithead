import { describe, expect, it } from 'vitest'
import css from '../../styles/performance.css?raw'
import main from '../../main.tsx?raw'

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
