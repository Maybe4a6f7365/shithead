import { readFileSync } from 'node:fs'

/**
 * The app's stylesheet as one text, in cascade order: styles/index.css with
 * each local `@import "./x.css"` replaced by that file. Tests that check where
 * a rule sits relative to another rely on this order. Paths are resolved from
 * the working directory (the app root under Vitest), because under jsdom
 * import.meta.url is not a file URL.
 */
export function readStylesheet(file = 'index.css'): string {
  const css = readFileSync(`${process.cwd()}/src/styles/${file}`, 'utf8')
  return css.replace(/@import "\.\/([a-z0-9-]+\.css)";/g, (_match: string, name: string) => readStylesheet(name))
}
