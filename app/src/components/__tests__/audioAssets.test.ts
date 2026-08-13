// @ts-ignore Vitest executes this asset contract in Node; the browser-only
// tsconfig intentionally does not include the full Node type surface.
import { createHash } from 'node:crypto'
// @ts-ignore See note above.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const audioRoot = new URL('../../../public/audio/', import.meta.url)

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(new URL(file, audioRoot))).digest('hex')
}

function audioBytes(file: string) {
  return readFileSync(new URL(file, audioRoot))
}

describe('turn alert audio assets', () => {
  it('ships the expected gabber and metadata-stripped chime recordings', () => {
    expect(readdirSync(audioRoot).filter((file) => file.endsWith('.mp3')).sort()).toEqual([
      'adhd-beat.mp3',
      'turn-notification.mp3',
    ])
    expect(sha256('turn-notification.mp3')).toBe(
      '8415fa3399513ad8563102e83d18386782359904b5646b605da38320a0a6dece',
    )
    expect(sha256('adhd-beat.mp3')).toBe(
      '4a0376b6d9ce29c0202a1db3bd2107c7a85ff53066e1f92e42716b45befaed70',
    )
  })

  it('ships the chime without the supplied source and encoder metadata', () => {
    const bytes = audioBytes('turn-notification.mp3')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(Array.from(bytes.subarray(0, 3))).not.toEqual([0x49, 0x44, 0x33])
    expect(Array.from(bytes.subarray(-128, -125))).not.toEqual([0x54, 0x41, 0x47])
    for (const marker of ['PRIV', 'UFID', 'Lavc58.35', '2020-03-07']) {
      expect(text).not.toContain(marker)
    }
  })

  it('keeps the asset-specific license and provenance beside the files', () => {
    const notice = readFileSync(new URL('LICENSE.txt', audioRoot), 'utf8')
    expect(notice).toContain('Pixabay Content License')
    expect(notice).toContain('musical-gabber-82562')
    expect(notice).toContain('project owner states')
    expect(notice).toContain('original is free to use')
    expect(notice).toContain('metadata were removed without')
    expect(notice).toContain('excluded from the repository\'s Apache-2.0')
  })
})
