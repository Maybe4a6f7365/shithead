// @vitest-environment jsdom
// ============================================================================
// net/ contract tests: GAME_STATE seq guard (protocol: ignore seq <= last
// seen) and resume-token session persistence.
// ============================================================================
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GAME_RULES, type Card, type GameState } from '../engine'
import { PROTOCOL_VERSION, type RoomSummary } from '../engine/protocol'
import { RoomClient } from './RoomClient'
import {
  shouldAcceptGameState, loadSession, saveSession, clearSession, useMultiplayerRoom,
} from './useMultiplayerRoom'

function gs(seq: number, turnCount = seq, phase: GameState['phase'] = 'play'): GameState {
  return {
    phase, rules: { ...DEFAULT_GAME_RULES }, players: [], stock: [], pile: [],
    currentPlayerIdx: 0, playDirection: 1, turnCount,
    winnerId: null, loserId: null, pendingTribute: null, log: [], seq,
  }
}

describe('shouldAcceptGameState', () => {
  it('accepts the first state and forward movement', () => {
    expect(shouldAcceptGameState(gs(3), null)).toBe(true)
    expect(shouldAcceptGameState(gs(4), 3)).toBe(true)
  })

  it('ignores duplicates and out-of-order deliveries', () => {
    expect(shouldAcceptGameState(gs(3), 3)).toBe(false)
    expect(shouldAcceptGameState(gs(2), 3)).toBe(false)
  })

  it('accepts a rematch fresh deal (seq 0, turnCount 0, rearrange)', () => {
    expect(shouldAcceptGameState(gs(0, 0, 'rearrange'), 87)).toBe(true)
  })

  it('does not treat arbitrary low seqs as a new game', () => {
    expect(shouldAcceptGameState(gs(0, 0, 'play'), 87)).toBe(false)
    expect(shouldAcceptGameState(gs(1, 1, 'rearrange'), 87)).toBe(false)
  })

  it('accepts legacy states without seq', () => {
    const legacy = gs(0)
    delete legacy.seq
    expect(shouldAcceptGameState(legacy, 42)).toBe(true)
  })
})

describe('resume session storage', () => {
  beforeEach(() => clearSession())

  it('round-trips { roomCode, playerId, resumeToken, playerName }', () => {
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
    expect(loadSession()).toEqual({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
  })

  it('rotation: saving the new token replaces the old one', () => {
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-a', playerName: 'Greta' })
    saveSession({ roomCode: 'LPHGPC', playerId: 'p1', resumeToken: 'tok-b', playerName: 'Greta' })
    expect(loadSession()?.resumeToken).toBe('tok-b')
  })

  it('can read a legacy tokenless record and clears it on demand', () => {
    saveSession({ roomCode: 'ABCDEF', playerId: 'p9', playerName: 'Hans' })
    expect(loadSession()?.resumeToken).toBeUndefined()
    clearSession()
    expect(loadSession()).toBeNull()
  })

  it('returns null on corrupted storage', () => {
    localStorage.setItem('shithead:session', '{not json')
    expect(loadSession()).toBeNull()
    localStorage.setItem('shithead:session', '{"playerId":"x"}')
    expect(loadSession()).toBeNull()
  })
})

type SocketHandler = (event: any) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  sent: Array<Record<string, unknown>> = []
  private handlers = new Map<string, SocketHandler[]>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: SocketHandler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  receive(message: Record<string, unknown>) {
    this.emit('message', { data: JSON.stringify(message) })
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw))
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code: 1000 })
  }

  private emit(type: string, event: unknown) {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }
}

const roomSummary = (phase: RoomSummary['phase'] = 'waiting'): RoomSummary => ({
  code: 'ABC123',
  phase,
  hostId: 'p1',
  maxPlayers: 5,
  players: [],
  createdAt: 1,
  rules: { ...DEFAULT_GAME_RULES },
})

describe('RoomClient authentication ordering', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends reconnect authentication before flushing a queued PLAY and stamps both v3', () => {
    let client!: RoomClient
    client = new RoomClient({
      url: 'ws://example.test/api/room/ABC123/ws',
      onMessage: () => {},
      onOpen: () => client.send({
        type: 'RESUME_ROOM', roomCode: 'ABC123', playerId: 'p1', resumeToken: 'token',
      }),
    })
    const socket = FakeWebSocket.instances[0]
    const card: Card = { id: 'real-card', rank: '5', suit: '♠' }
    client.send({ type: 'RESUME_ROOM', roomCode: 'ABC123', playerId: 'p1', resumeToken: 'stale-token' })
    client.send({ type: 'PLAY', cards: [card] })

    socket.open()
    expect(socket.sent.map(message => message.type)).toEqual(['RESUME_ROOM'])
    expect(socket.sent[0].version).toBe(PROTOCOL_VERSION)

    client.markAuthenticated()
    expect(socket.sent.map(message => message.type)).toEqual(['RESUME_ROOM', 'PLAY'])
    expect(socket.sent[1].version).toBe(PROTOCOL_VERSION)
    client.close()
  })

  it('keeps connecting cancel ordered JOIN then LEAVE', () => {
    let client!: RoomClient
    client = new RoomClient({
      url: 'ws://example.test/api/room/ABC123/ws',
      onMessage: () => {},
      onOpen: () => client.send({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'Ada' }),
    })
    const socket = FakeWebSocket.instances[0]
    socket.open()
    client.send({ type: 'LEAVE_ROOM' })
    expect(socket.sent.map(message => message.type)).toEqual(['JOIN_ROOM', 'LEAVE_ROOM'])
    expect(socket.sent.every(message => message.version === PROTOCOL_VERSION)).toBe(true)
    client.close()
  })

  it('drops stale emotes instead of replaying them after authentication', () => {
    let client!: RoomClient
    client = new RoomClient({
      url: 'ws://example.test/api/room/ABC123/ws',
      onMessage: () => {},
      onOpen: () => client.send({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'Ada' }),
    })
    const socket = FakeWebSocket.instances[0]
    client.send({ type: 'EMOTE', emote: 'laugh' })
    socket.open()
    client.markAuthenticated()
    expect(socket.sent.map(message => message.type)).toEqual(['JOIN_ROOM'])

    client.send({ type: 'EMOTE', emote: 'laugh' })
    expect(socket.sent.at(-1)).toEqual({ type: 'EMOTE', emote: 'laugh', version: PROTOCOL_VERSION })
    client.close()
  })

  it('does not delete a resumable credential when explicit leave is offline', () => {
    saveSession({ roomCode: 'ABC123', playerId: 'p1', playerName: 'Ada', resumeToken: 'token' })
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    expect(result.current.leave()).toBe(false)
    expect(loadSession()?.resumeToken).toBe('token')
    unmount()
  })

  it('keeps an accepted GAME_STATE authoritative over a later stale ROOM_STATE', () => {
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))
    act(() => socket.receive({ type: 'GAME_STATE', version: PROTOCOL_VERSION, state: gs(1, 1, 'play') }))
    act(() => socket.receive({ type: 'ROOM_STATE', room: roomSummary('waiting') }))
    expect(result.current.room?.phase).toBe('play')
    unmount()
  })

  it('surfaces duplicate START as a temporary notice once authoritative game state exists', () => {
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))
    act(() => socket.receive({ type: 'GAME_STATE', state: gs(1, 1, 'rearrange') }))
    act(() => socket.receive({ type: 'ERROR', code: 'GAME_IN_PROGRESS', message: 'Game already in progress' }))
    expect(result.current.error).toBeNull()
    expect(result.current.notice).toBe('Game already in progress')
    unmount()
  })

  it('sends typed emotes after authentication and exposes relayed emote events', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    act(() => result.current.sendEmote('fire'))
    expect(socket.sent.at(-1)).toEqual({ type: 'EMOTE', emote: 'fire', version: PROTOCOL_VERSION })

    act(() => socket.receive({ type: 'EMOTE', version: PROTOCOL_VERSION, playerId: 'p2', emote: 'wow', ts: 1234 }))
    expect(result.current.latestEmote).toEqual({ playerId: 'p2', emote: 'wow', ts: 1234 })

    act(() => vi.advanceTimersByTime(2501))
    expect(result.current.latestEmote).toBeNull()
    unmount()
  })
})
