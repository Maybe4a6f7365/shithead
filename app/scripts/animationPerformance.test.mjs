import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const css = await readFile(new URL('../src/styles/performance.css', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')

assert.match(css, /transform:\s*scaleX\(0\)/)
assert.match(css, /box-shadow:\s*none !important/)
assert.match(css, /will-change:\s*opacity/)
assert.doesNotMatch(css, /animation:[^;]*(width|height|top|left|right|bottom)/)
assert.match(main, /requestAnimationFrame/)
assert.match(main, /scheduleAppViewportHeightSync/)

console.log(`Animation performance contracts passed (${fileURLToPath(root)})`)
