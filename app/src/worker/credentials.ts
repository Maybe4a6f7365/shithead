// ============================================================================
// Identities, room codes and the secret that proves an identity. A playerId is
// broadcast to the whole table and proves nothing; the resume token handed to
// one socket in WELCOME does. Only its SHA-256 hash is ever stored.
// ============================================================================
import type { Player } from '../engine'

/** 256 random bits as unpadded base64url (43 characters). */
export function generateResumeToken(): string {
  const bytes = new Uint8Array(32) // 256 bits of entropy
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashResumeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Compare two token hashes without stopping at the first differing character. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A fresh identity with an empty seat. */
export function makePlayer(name: string): Player {
  return {
    id: crypto.randomUUID(),
    name,
    isAI: false,
    hand: [],
    faceUp: [],
    faceDown: [],
    isOut: false,
  }
}

/** Six characters from 32 symbols with no 0/O or 1/I to misread or mistype. */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('')
}
