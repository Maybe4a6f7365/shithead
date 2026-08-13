// @ts-ignore Vitest executes this CSS contract test in Node; the browser-only
// app tsconfig intentionally does not include the full Node type surface.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8')
const cueStart = css.indexOf('/* ADHD turn cue:')
const cueEnd = css.indexOf('@media (max-width: 340px)', cueStart)
const cueCss = css.slice(cueStart, cueEnd)

describe('ADHD attention perimeter', () => {
  it('uses layered travelling perimeter light while keeping the label stable', () => {
    expect(cueCss).toContain('@property --turn-attention-angle')
    expect(cueCss).toContain('.turn-attention-beacon::before')
    expect(cueCss).toContain('.turn-attention-beacon::after')
    expect(cueCss).toContain('turn-attention-rail-orbit 5.8s')
    expect(cueCss).toContain('turn-attention-rail-orbit 8.6s')
    expect(cueCss).toContain('@keyframes turn-attention-rail-orbit')
    expect(cueCss).toContain('@keyframes turn-attention-rail-chroma')
    expect(cueCss).toContain('@keyframes turn-attention-glow-chroma')
    expect(cueCss).toContain('background: conic-gradient(')
    expect(cueCss).toContain('mask-composite: exclude')
    expect(cueCss).toContain('display: none')
    expect(cueCss).toContain('@supports ((-webkit-mask-composite: xor) or (mask-composite: exclude))')
    expect(cueCss).toContain('display: block')
    expect(cueCss).toContain('radial-gradient(ellipse 240px 170px at 0 0')
    expect(cueCss).not.toContain('turn-attention-line-wiggle')
    expect(cueCss).not.toContain('opacity:')

    const labelRule = cueCss.match(/\.game-screen \.turn-attention-beacon__label\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(labelRule).toContain('transform: translateX(-50%)')
    expect(labelRule).not.toContain('animation:')
  })

  it('never captures input and becomes completely static for reduced motion', () => {
    const beaconRule = cueCss.match(/\.game-screen \.turn-attention-beacon\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(beaconRule).toContain('pointer-events: none')

    const decorationRule = cueCss.match(/\.game-screen \.turn-attention-beacon::before,([\s\S]*?)\}/)?.[1] ?? ''
    expect(decorationRule).toContain('pointer-events: none')

    const reducedMotion = cueCss.slice(cueCss.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducedMotion).toContain('.turn-attention-beacon::before')
    expect(reducedMotion).toContain('.turn-attention-beacon::after')
    expect(reducedMotion).toContain('animation: none !important')
    expect(reducedMotion).toContain('--turn-attention-angle: 34deg')
    expect(reducedMotion).toContain('--turn-attention-angle: 214deg')
  })

  it('stays below the three-flashes threshold and never flashes the viewport', () => {
    const durations = [...cueCss.matchAll(/(?:orbit|chroma) ([0-9.]+)s/g)]
      .map(match => Number(match[1]))
    expect(durations.length).toBeGreaterThan(0)
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(3)
    expect(cueCss).not.toMatch(/background(?:-color)?:\s*(?:white|#fff|rgb\(255)/i)
    expect(cueCss).not.toContain('steps(')
  })
})
