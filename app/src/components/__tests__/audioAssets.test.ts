// @ts-ignore Vitest executes this asset contract in Node; the browser-only
// tsconfig intentionally does not include the full Node type surface.
import { createHash } from 'node:crypto'
// @ts-ignore See note above.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const audioRoot = new URL('../../../public/audio/', import.meta.url)

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(new URL(file, audioRoot))).digest('hex')
}

describe('turn alert audio assets', () => {
  it('ships the exact project-owner-supplied Pixabay files', () => {
    expect(sha256('turn-notification.mp3')).toBe(
      'adf8d86bc6e18b80a166e84de3b2ce03f5874f7d302a34eb157e9e735f3752d4',
    )
    expect(sha256('attention-alert.mp3')).toBe(
      '4a0376b6d9ce29c0202a1db3bd2107c7a85ff53066e1f92e42716b45befaed70',
    )
    expect(sha256('attention-blast.mp3')).toBe(
      'adf8d86bc6e18b80a166e84de3b2ce03f5874f7d302a34eb157e9e735f3752d4',
    )
  })

  it('keeps the asset-specific license and provenance beside the files', () => {
    const notice = readFileSync(new URL('LICENSE.txt', audioRoot), 'utf8')
    expect(notice).toContain('Pixabay Content License')
    expect(notice).toContain('musical-explosion-sfx-43814')
    expect(notice).toContain('musical-gabber-82562')
    expect(notice).toContain('Abacagi (Freesound)')
    expect(notice).toContain('excluded from the repository\'s Apache-2.0')
  })
})
