import { describe, expect, it } from 'vitest'
import {
  constantTimeEqual,
  generateResumeToken,
  generateRoomCode,
  hashResumeToken,
  makePlayer,
} from '../credentials'

describe('room credentials', () => {
  it('issues 256-bit resume tokens as unpadded base64url', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateResumeToken()))
    expect(tokens.size).toBe(200)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('stores the SHA-256 digest of a token, never the token', async () => {
    // The standard SHA-256 test vector.
    expect(await hashResumeToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const token = generateResumeToken()
    const hash = await hashResumeToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashResumeToken(token)).toBe(hash)
  })

  it('compares digests in full', () => {
    expect(constantTimeEqual('abcd', 'abcd')).toBe(true)
    expect(constantTimeEqual('abcd', 'abce')).toBe(false)
    expect(constantTimeEqual('abcd', 'abc')).toBe(false)
  })

  it('makes six-character room codes with no 0/O or 1/I', () => {
    for (let i = 0; i < 500; i++) expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('gives every new identity its own id and an empty seat', () => {
    const first = makePlayer('Ada')
    const second = makePlayer('Ada')
    expect(first).toMatchObject({ name: 'Ada', isAI: false, hand: [], faceUp: [], faceDown: [], isOut: false })
    expect(first.id).not.toBe(second.id)
  })
})
