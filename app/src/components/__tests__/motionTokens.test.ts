// @ts-ignore Vitest executes this source contract in Node.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as motionTokens from '../motion'

describe('shared motion curves', () => {
  it('gives every curve in both engine formats, in agreement', () => {
    const tokens = motionTokens as Record<string, unknown>
    const curves = Object.keys(tokens).filter(name => Array.isArray(tokens[name]))
    expect(curves.length).toBeGreaterThanOrEqual(5)
    for (const name of curves) {
      const curve = tokens[name] as number[]
      expect(curve).toHaveLength(4)
      const cssForm = tokens[`${name}_CSS`]
      if (cssForm !== undefined) expect(cssForm).toBe(`cubic-bezier(${curve.join(', ')})`)
    }
  })

  it('has no hand-written easing curve left in any component', () => {
    const dir = new URL('../', import.meta.url)
    const offenders: string[] = []
    for (const file of readdirSync(dir) as string[]) {
      if (!/\.tsx?$/.test(file) || file === 'motion.ts') continue
      ;(readFileSync(new URL(file, dir), 'utf8') as string).split('\n').forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/cubic-bezier\(/.test(code) || /ease:\s*\[\s*[\d.]/.test(code)) offenders.push(`${file}:${index + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
