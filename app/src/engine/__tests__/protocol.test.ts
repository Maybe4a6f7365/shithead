// ============================================================================
// Protocol tests — wire format + serialization (security-critical)
// ============================================================================
import { describe, it, expect } from 'vitest'
import { initGame, seededRng, MAX_LOG_ENTRIES } from '../index'
import {
  BROADCAST_IDS,
  EMOTE_IDS,
  ONDRA_MESSAGE_IDS,
  PLAYER_LEFT_MESSAGE_IDS,
  isBroadcastId,
  isClientMsg,
  serializeGameState,
  toPlayerSummary,
  PROTOCOL_VERSION,
  type ServerMsg,
} from '../protocol'
import { mkState, c } from './helpers'

describe('isClientMsg', () => {
  it('accepts valid message types and resume payloads', () => {
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'X' })).toBe(true)
    expect(isClientMsg({ type: 'RESUME_ROOM', roomCode: 'ABC123', playerId: 'player-id', resumeToken: 'secret' })).toBe(true)
    expect(isClientMsg({ type: 'PING' })).toBe(true)
    expect(isClientMsg({ type: 'BURN_IN', cards: [{ id: 'four-a' }, { id: 'four-b' }, { id: 'four-c' }] })).toBe(true)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card', expectedSeq: 7 })).toBe(true)
    expect(isClientMsg({ type: 'CHAT', text: 'hi' })).toBe(true)
    for (const emote of EMOTE_IDS) expect(isClientMsg({ type: 'EMOTE', emote })).toBe(true)
    for (const broadcast of BROADCAST_IDS) {
      expect(isClientMsg({ type: 'BROADCAST', broadcast })).toBe(true)
      expect(isBroadcastId(broadcast)).toBe(true)
    }
    expect(isClientMsg({ type: 'SET_RULES', rules: { includeJokers: false } })).toBe(true)
    expect(isClientMsg({ type: 'SET_RULES', rules: { deckCount: 3 } })).toBe(true)
    expect(isClientMsg({ type: 'SET_RULES', rules: { includeJokers: true, deckCount: 2 } })).toBe(true)
    expect(isClientMsg({ type: 'SET_EASTER_EGG', enabled: true })).toBe(true)
    expect(isClientMsg({ type: 'SET_EASTER_EGG', enabled: false, version: PROTOCOL_VERSION })).toBe(true)
    expect(isClientMsg({ type: 'TRIBUTE_SWAP', winnerCardId: 'a', loserCardId: 'b' })).toBe(true)
    expect(isClientMsg({ type: 'TRIBUTE_SKIP' })).toBe(true)
  })

  it('rejects malformed or oversized payloads', () => {
    expect(isClientMsg({ type: 'CREATE_ROOM' })).toBe(false)
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: 'X', maxPlayers: 99 })).toBe(false)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'bad', playerName: 'X' })).toBe(false)
    expect(isClientMsg({ type: 'RESUME_ROOM', roomCode: 'ABC123', playerId: '', resumeToken: 'secret' })).toBe(false)
    expect(isClientMsg({ type: 'RESUME_ROOM', playerId: 'p', resumeToken: 'secret' })).toBe(false)
    expect(isClientMsg({ type: 'PLAY', cards: [] })).toBe(false)
    expect(isClientMsg({ type: 'PLAY', cards: Array.from({ length: 13 }, (_, i) => ({ id: `card-${i}` })) })).toBe(false)
    expect(isClientMsg({ type: 'BURN_IN', cards: [] })).toBe(false)
    expect(isClientMsg({ type: 'BURN_IN', cards: Array.from({ length: 13 }, (_, i) => ({ id: `card-${i}` })) })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card' })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: '', expectedSeq: 1 })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: '   ', expectedSeq: 1 })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card', expectedSeq: -1 })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card', expectedSeq: 1.5 })).toBe(false)
    expect(isClientMsg({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card', expectedSeq: 1, cards: [] })).toBe(false)
    expect(isClientMsg({ type: 'CHAT', text: 'x'.repeat(201) })).toBe(false)
    expect(isClientMsg({ type: 'EMOTE', emote: '👍' })).toBe(false)
    expect(isClientMsg({ type: 'EMOTE', emote: 'thumbs-up<script>' })).toBe(false)
    expect(isClientMsg({ type: 'EMOTE' })).toBe(false)
    expect(isClientMsg({ type: 'EMOTE', emote: 'laugh', text: 'injected' })).toBe(false)
    expect(isClientMsg({ type: 'EMOTE', emote: 'laugh', payload: {} })).toBe(false)
    expect(isClientMsg({ type: 'BROADCAST', broadcast: 'arbitrary-user-text' })).toBe(false)
    expect(isClientMsg({ type: 'BROADCAST' })).toBe(false)
    expect(isClientMsg({ type: 'BROADCAST', broadcast: 'shrug', text: 'injected' })).toBe(false)
    expect(isClientMsg({ type: 'BROADCAST', broadcast: 'shrug', payload: {} })).toBe(false)
    expect(isClientMsg({
      type: 'BROADCAST', broadcast: 'shrug', version: PROTOCOL_VERSION + 1,
    })).toBe(false)
    expect(isBroadcastId(null)).toBe(false)
    expect(isClientMsg({ type: 'CREATE_ROOM', playerName: '   ' })).toBe(false)
    expect(isClientMsg({ type: 'JOIN_ROOM', code: 'ABC123', playerName: '\t' })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: {} })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { includeJokers: 'no' } })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { deckCount: 0 } })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { deckCount: 4 } })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { deckCount: 1.5 } })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { deckCount: '2' } })).toBe(false)
    expect(isClientMsg({ type: 'SET_RULES', rules: { includeJokers: true, surprise: true } })).toBe(false)
    expect(isClientMsg({ type: 'SET_EASTER_EGG' })).toBe(false)
    expect(isClientMsg({ type: 'SET_EASTER_EGG', enabled: 'false' })).toBe(false)
    expect(isClientMsg({ type: 'SET_EASTER_EGG', enabled: false, surprise: true })).toBe(false)
    expect(isClientMsg({ type: 'TRIBUTE_SWAP', winnerCardId: 'same', loserCardId: 'same' })).toBe(false)
    expect(isClientMsg({ type: 'NOPE' })).toBe(false)
    expect(isClientMsg({})).toBe(false)
    expect(isClientMsg(null)).toBe(false)
    expect(isClientMsg('string')).toBe(false)
    expect(isClientMsg(42)).toBe(false)
  })

  it('pins protocol v6 reaction, broadcast, and system-event wire ids', () => {
    expect(PROTOCOL_VERSION).toBe(6)
    expect(EMOTE_IDS).toEqual([
      'thumbs-up', 'laugh', 'wow', 'fire', 'sad', 'cry', 'heart', 'clap',
      'angry', 'rage', 'middle-finger', 'clown', 'skull', 'poop', 'eyes', 'peach',
      'foot', 'melting', 'exploding-head', 'pleading', 'unamused', 'raised-eyebrow',
      'thinking', 'shushing', 'zipper-mouth', 'partying', 'smiling-devil', 'salute',
    ])
    expect(new Set(EMOTE_IDS).size).toBe(28)
    expect(BROADCAST_IDS).toEqual([
      'double-middle-finger', 'kiss-my-ass', 'upside-down-fuck', 'lenny',
      'karma', 'shrug', 'womp-womp', 'kill-me', 'take-it',
    ])
    expect(new Set(BROADCAST_IDS).size).toBe(9)
    expect(PLAYER_LEFT_MESSAGE_IDS).toEqual(['bye-little-shits'])
    expect(ONDRA_MESSAGE_IDS).toEqual([
      'ondra-faster', 'ondra-love-toes', 'ondra-fuck-me',
      'ondra-farts-cutely', 'ondra-alpha', 'ondra-spank-me',
    ])

    const frames = [
      {
        type: 'SYSTEM_EVENT',
        event: {
          kind: 'player-left', playerId: 'p1', playerName: 'Ada',
          message: 'bye-little-shits', ts: 1,
        },
      },
      {
        type: 'SYSTEM_EVENT',
        event: {
          kind: 'ondra-mode', playerId: 'p2', playerName: 'Ondra',
          message: 'ondra-faster', ts: 2,
        },
      },
      { type: 'BROADCAST', playerId: 'p1', broadcast: 'shrug', ts: 3 },
    ] satisfies ServerMsg[]
    expect(frames.map(frame => frame.type)).toEqual(['SYSTEM_EVENT', 'SYSTEM_EVENT', 'BROADCAST'])
  })

  it('rejects duplicate card ids in PLAY (duplication exploit)', () => {
    expect(isClientMsg({ type: 'PLAY', cards: [{ id: 'x' }, { id: 'x' }] })).toBe(false)
    expect(isClientMsg({ type: 'PLAY', cards: [{ id: 'x' }, { id: 'y' }] })).toBe(true)
    expect(isClientMsg({ type: 'BURN_IN', cards: [{ id: 'x' }, { id: 'x' }] })).toBe(false)
  })

  it('enforces protocol version when present (backwards-compatible when absent)', () => {
    expect(isClientMsg({ type: 'PING', version: PROTOCOL_VERSION })).toBe(true)
    expect(isClientMsg({ type: 'PING', version: PROTOCOL_VERSION + 1 })).toBe(false)
    expect(isClientMsg({ type: 'PING', version: 1 })).toBe(false)
    expect(isClientMsg({ type: 'PLAY', cards: [{ id: 'x' }], version: PROTOCOL_VERSION })).toBe(true)
    expect(isClientMsg({
      type: 'QUICK_FOLLOW_UP', cardId: 'drawn-card', expectedSeq: 2, version: PROTOCOL_VERSION,
    })).toBe(true)
  })
})

describe('serializeGameState (security)', () => {
  const deal = () => initGame({
    players: [{ id: 'viewer', name: 'Viewer' }, { id: 'opponent', name: 'Opponent' }],
    rng: seededRng(21),
  })

  it('hides opponent hands: placeholder ids, no rank/suit, no real id leakage', () => {
    const state = deal()
    const original = state.players.find(p => p.id === 'opponent')!
    const serialized = serializeGameState(state, 'viewer')
    const opponent = serialized.players.find(p => p.id === 'opponent')!

    expect(opponent.hand).toHaveLength(original.hand.length)
    for (let i = 0; i < opponent.hand.length; i++) {
      const masked = opponent.hand[i]
      expect(masked.suit).toBe(null)
      // id must NOT be the real card id and must not encode anything
      expect(original.hand.some(cd => cd.id === masked.id)).toBe(false)
      expect(masked.id).not.toMatch(/[♠♥♦♣]|JOKER|\b(?:A|K|Q|J|10)\b/)
    }
    // no real opponent card id appears anywhere in the serialized payload
    const payload = JSON.stringify(serialized)
    for (const cd of [...original.hand, ...original.faceDown]) {
      expect(payload).not.toContain(cd.id)
    }
  })

  it('never sends stock identities: same length, placeholder cards only', () => {
    const state = deal()
    const serialized = serializeGameState(state, 'viewer')
    expect(serialized.stock).toHaveLength(state.stock.length)
    const payload = JSON.stringify(serialized.stock)
    for (const cd of state.stock) {
      expect(payload).not.toContain(cd.id)
    }
    expect(serialized.stock.every(cd => cd.suit === null)).toBe(true)
    // draw order is unknowable: every placeholder looks identical except index
    expect(new Set(serialized.stock.map(cd => cd.rank)).size).toBe(1)
  })

  it('hides every face-down card, including the viewers own blind cards', () => {
    const state = deal()
    const serialized = serializeGameState(state, 'viewer')
    for (const player of serialized.players) {
      expect(player.faceDown).toHaveLength(3)
      expect(player.faceDown.every(cd => cd.suit === null)).toBe(true)
    }
    const originalViewer = state.players.find(player => player.id === 'viewer')!
    const viewer = serialized.players.find(player => player.id === 'viewer')!
    expect(viewer.faceDown.map(card => card.id)).toEqual(['blind:down:0', 'blind:down:1', 'blind:down:2'])
    for (const card of originalViewer.faceDown) expect(JSON.stringify(serialized)).not.toContain(card.id)
  })

  it('shows the viewers hand and every public face-up card', () => {
    const state = deal()
    const serialized = serializeGameState(state, 'viewer')
    const viewer = serialized.players.find(p => p.id === 'viewer')!
    const opponent = serialized.players.find(p => p.id === 'opponent')!
    expect(viewer.hand).toEqual(state.players.find(p => p.id === 'viewer')!.hand)
    expect(opponent.faceUp).toEqual(state.players.find(p => p.id === 'opponent')!.faceUp)
  })

  it('keeps a replacement-draw follow-up entitlement owner-only', () => {
    const eligible = c('6', '♥', 'secret-drawn-six')
    const state = {
      ...mkState({
        players: [
          { id: 'owner', hand: [eligible] },
          { id: 'other', hand: [c('9')] },
        ],
        pendingQuickFollowUp: {
          playerId: 'owner', rank: '6', eligibleCardIds: [eligible.id], sourceSeq: 7,
        },
      }),
      seq: 7,
    }

    expect(serializeGameState(state, 'owner').pendingQuickFollowUp).toEqual(state.pendingQuickFollowUp)
    const otherView = serializeGameState(state, 'other')
    expect(otherView.pendingQuickFollowUp).toBeNull()
    expect(JSON.stringify(otherView)).not.toContain(eligible.id)
  })

  it('reveals everything once the game is over (harmless, helps end screens)', () => {
    const state = deal()
    const over = { ...state, phase: 'gameOver' as const }
    const serialized = serializeGameState(over, 'viewer')
    expect(serialized.players.find(p => p.id === 'opponent')!.hand)
      .toEqual(state.players.find(p => p.id === 'opponent')!.hand)
  })

  it('caps the log and preserves seq for replay detection', () => {
    const big = Array.from({ length: MAX_LOG_ENTRIES + 10 }, () => ({ type: 'PICK_UP_PILE' as const, playerId: 'a' }))
    const state = { ...mkState({ players: [{ id: 'a' }, { id: 'b' }], log: big }), seq: 17 }
    const serialized = serializeGameState(state, 'a')
    expect(serialized.log.length).toBe(MAX_LOG_ENTRIES)
    expect(serialized.seq).toBe(17)
  })

  it('log never leaks hidden cards: crafted hidden card ids stay out of the payload', () => {
    const secret = c('A', '♠', 'super-secret-stock-card')
    const state = mkState({
      players: [
        { id: 'a', hand: [c('5')] },
        { id: 'b', hand: [c('6')], faceDown: [c('Q', '♦', 'b-hidden-down')] },
      ],
      stock: [secret],
    })
    const payload = JSON.stringify(serializeGameState(state, 'a'))
    expect(payload).not.toContain('super-secret-stock-card')
    expect(payload).not.toContain('b-hidden-down')
  })
})

describe('toPlayerSummary', () => {
  it('produces lobby-safe summary (no card details)', () => {
    const state = initGame({
      players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
      rng: seededRng(4),
    })
    const p = state.players[0]
    const summary = toPlayerSummary(p, true)
    expect(summary.id).toBe('a')
    expect(summary.name).toBe('Alice')
    expect(summary.connected).toBe(true)
    expect(summary.cardCount.hand).toBe(3)
    expect(summary.cardCount.faceUp).toBe(3)
    expect(summary.cardCount.faceDown).toBe(3)
    expect((summary as any).hand).toBeUndefined()
  })
})
