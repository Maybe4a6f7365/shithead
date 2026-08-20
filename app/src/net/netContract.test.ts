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
  shouldAcceptGameState, loadSession, loadRestoredRoomIntent, saveSession, clearSession, useMultiplayerRoom,
} from './useMultiplayerRoom'

function gs(seq: number, turnCount = seq, phase: GameState['phase'] = 'play'): GameState {
  return {
    phase, rules: { ...DEFAULT_GAME_RULES }, players: [], stock: [], pile: [],
    currentPlayerIdx: 0, playDirection: 1, turnCount,
    winnerId: null, loserId: null, pendingTribute: null, pendingQuickFollowUp: null, log: [], seq,
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

  it('only restores a room when a complete secure resume credential exists', () => {
    saveSession({ roomCode: 'ABC123', playerId: 'p1', playerName: 'Greta' })
    expect(loadRestoredRoomIntent()).toBeNull()

    saveSession({ roomCode: 'ABC123', playerId: 'p1', playerName: 'Greta', resumeToken: 'secret' })
    expect(loadRestoredRoomIntent()).toEqual({ roomId: 'ABC123', playerName: 'Greta', intent: 'join' })
  })

  it('rejects malformed persisted room credentials instead of routing into them', () => {
    localStorage.setItem('shithead:session', JSON.stringify({
      roomCode: '../BAD', playerId: 'p1', playerName: 'Greta', resumeToken: 'secret',
    }))
    expect(loadSession()).toBeNull()
    expect(loadRestoredRoomIntent()).toBeNull()
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
  easterEggEnabled: true,
  players: [],
  createdAt: 1,
  rules: { ...DEFAULT_GAME_RULES },
})

describe('RoomClient authentication ordering', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    clearSession()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends reconnect authentication before flushing a queued PLAY and stamps the current protocol', () => {
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

  it('hard-refresh lifecycle resumes with the rotated token and never JOINs or CREATEs a duplicate seat', () => {
    saveSession({ roomCode: 'ABC123', playerId: 'p1', playerName: 'Greta', resumeToken: 'token-before-refresh' })

    const first = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Greta', intent: 'join',
    }))
    const firstSocket = FakeWebSocket.instances[0]
    act(() => firstSocket.open())
    expect(firstSocket.sent).toEqual([{
      type: 'RESUME_ROOM', roomCode: 'ABC123', playerId: 'p1',
      resumeToken: 'token-before-refresh', version: PROTOCOL_VERSION,
    }])
    act(() => firstSocket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1',
      resumeToken: 'token-after-refresh', room: roomSummary('play'),
    }))
    expect(loadSession()?.resumeToken).toBe('token-after-refresh')
    first.unmount()

    const second = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Greta', intent: 'create',
    }))
    const secondSocket = FakeWebSocket.instances[1]
    act(() => secondSocket.open())
    expect(secondSocket.sent.map(message => message.type)).toEqual(['RESUME_ROOM'])
    expect(secondSocket.sent[0]).toMatchObject({
      roomCode: 'ABC123', playerId: 'p1', resumeToken: 'token-after-refresh',
    })
    second.unmount()
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

  it('drops stale chat, reactions, broadcasts, and rematch votes instead of replaying them', () => {
    let client!: RoomClient
    client = new RoomClient({
      url: 'ws://example.test/api/room/ABC123/ws',
      onMessage: () => {},
      onOpen: () => client.send({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'Ada' }),
    })
    const socket = FakeWebSocket.instances[0]
    expect(client.send({ type: 'CHAT', text: 'stale while offline' })).toBe(false)
    client.send({ type: 'EMOTE', emote: 'laugh' })
    client.send({ type: 'BROADCAST', broadcast: 'shrug' })
    expect(client.send({ type: 'REMATCH_VOTE', vote: true })).toBe(false)
    socket.open()
    expect(client.send({ type: 'CHAT', text: 'stale before auth' })).toBe(false)
    client.send({ type: 'BROADCAST', broadcast: 'womp-womp' })
    expect(client.send({ type: 'REMATCH_VOTE', vote: false })).toBe(false)
    client.markAuthenticated()
    expect(socket.sent.map(message => message.type)).toEqual(['JOIN_ROOM'])

    client.send({ type: 'EMOTE', emote: 'laugh' })
    expect(socket.sent.at(-1)).toEqual({ type: 'EMOTE', emote: 'laugh', version: PROTOCOL_VERSION })
    client.send({ type: 'BROADCAST', broadcast: 'shrug' })
    expect(socket.sent.at(-1)).toEqual({ type: 'BROADCAST', broadcast: 'shrug', version: PROTOCOL_VERSION })
    expect(client.send({ type: 'CHAT', text: 'fresh' })).toBe(true)
    expect(socket.sent.at(-1)).toEqual({ type: 'CHAT', text: 'fresh', version: PROTOCOL_VERSION })
    client.close()
  })

  it('never queues a race-bound quick follow-up while offline or unauthenticated', () => {
    let client!: RoomClient
    client = new RoomClient({
      url: 'ws://example.test/api/room/ABC123/ws',
      onMessage: () => {},
      onOpen: () => client.send({ type: 'JOIN_ROOM', code: 'ABC123', playerName: 'Ada' }),
    })
    const socket = FakeWebSocket.instances[0]

    client.send({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-five', expectedSeq: 8 })
    socket.open()
    client.send({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-five', expectedSeq: 8 })
    client.markAuthenticated()
    expect(socket.sent.map(message => message.type)).toEqual(['JOIN_ROOM'])

    client.send({ type: 'QUICK_FOLLOW_UP', cardId: 'drawn-five', expectedSeq: 8 })
    expect(socket.sent.at(-1)).toEqual({
      type: 'QUICK_FOLLOW_UP', cardId: 'drawn-five', expectedSeq: 8, version: PROTOCOL_VERSION,
    })
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

  it('treats SESSION_EXPIRED and RESUME_FAILED as terminal without retaining invalid sockets', () => {
    const first = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    act(() => socket.receive({
      type: 'ERROR', code: 'SESSION_EXPIRED', message: 'You chose not to join this rematch.',
    }))

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(loadSession()).toBeNull()
    expect(first.result.current.error).toEqual({
      kind: 'session-expired', message: 'You chose not to join this rematch.',
    })
    first.unmount()

    saveSession({ roomCode: 'ABC123', playerId: 'p1', playerName: 'Ada', resumeToken: 'stale-token' })
    const second = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const resumeSocket = FakeWebSocket.instances[1]
    act(() => resumeSocket.open())
    act(() => resumeSocket.receive({
      type: 'RESUME_FAILED', version: PROTOCOL_VERSION, reason: 'invalid_token',
    }))

    expect(resumeSocket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(loadSession()).toBeNull()
    expect(second.result.current.error).toEqual({
      kind: 'session-expired', message: 'invalid_token',
    })
    second.unmount()
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

    act(() => result.current.sendEmote('cry'))
    expect(socket.sent.at(-1)).toEqual({ type: 'EMOTE', emote: 'cry', version: PROTOCOL_VERSION })

    act(() => socket.receive({ type: 'EMOTE', version: PROTOCOL_VERSION, playerId: 'p2', emote: 'sad', ts: 1234 }))
    expect(result.current.latestEmote).toEqual({ playerId: 'p2', emote: 'sad', ts: 1234 })

    act(() => vi.advanceTimersByTime(2501))
    expect(result.current.latestEmote).toBeNull()
    unmount()
  })

  it('sends custom chat and keeps only the newest transient relay', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    let sent = false
    act(() => { sent = result.current.sendChat('Hello table 👋') })
    expect(sent).toBe(true)
    expect(socket.sent.at(-1)).toEqual({
      type: 'CHAT', text: 'Hello table 👋', version: PROTOCOL_VERSION,
    })

    act(() => socket.receive({ type: 'CHAT', playerId: 'p2', text: 'First', ts: 100 }))
    expect(result.current.latestChat).toEqual({ playerId: 'p2', text: 'First', ts: 100 })
    act(() => vi.advanceTimersByTime(3000))
    act(() => socket.receive({ type: 'CHAT', playerId: 'p3', text: 'Newest', ts: 200 }))
    act(() => vi.advanceTimersByTime(501))
    expect(result.current.latestChat).toEqual({ playerId: 'p3', text: 'Newest', ts: 200 })
    act(() => vi.advanceTimersByTime(2999))
    expect(result.current.latestChat).toBeNull()
    unmount()
  })

  it('retains only authoritative self chat as room-scoped recent messages', () => {
    const { result, rerender, unmount } = renderHook(
      ({ roomId }) => useMultiplayerRoom({ roomId, playerName: 'Ada', intent: 'join' }),
      { initialProps: { roomId: 'ABC123' } },
    )
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    // An attempted send and a peer relay are not this player's accepted echo.
    act(() => { result.current.sendChat('Attempted only') })
    act(() => socket.receive({ type: 'CHAT', playerId: 'p2', text: 'Peer message', ts: 100 }))
    expect(result.current.recentCustomMessages).toEqual([])

    act(() => socket.receive({ type: 'CHAT', playerId: 'p1', text: ' First   accepted ', ts: 101 }))
    act(() => socket.receive({ type: 'CHAT', playerId: 'p1', text: 'Second accepted', ts: 102 }))
    act(() => socket.receive({ type: 'CHAT', playerId: 'p1', text: 'First accepted', ts: 103 }))
    expect(result.current.recentCustomMessages).toEqual(['First accepted', 'Second accepted'])

    // A transport reconnect does not start a new room session.
    act(() => socket.close())
    expect(result.current.recentCustomMessages).toEqual(['First accepted', 'Second accepted'])

    // A replacement authenticated identity must never inherit the prior
    // player's private MRU list, and expiry clears the current identity too.
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p9', resumeToken: 'replacement-token', room: roomSummary(),
    }))
    expect(result.current.recentCustomMessages).toEqual([])
    act(() => socket.receive({ type: 'CHAT', playerId: 'p9', text: 'Replacement message', ts: 104 }))
    expect(result.current.recentCustomMessages).toEqual(['Replacement message'])
    act(() => socket.receive({ type: 'ERROR', code: 'SESSION_EXPIRED', message: 'Expired' }))
    expect(result.current.recentCustomMessages).toEqual([])

    // A different room is a different message-history boundary.
    rerender({ roomId: 'XYZ789' })
    expect(result.current.recentCustomMessages).toEqual([])
    unmount()
  })

  it('sends preset broadcasts and expires broadcast/system events independently', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    act(() => result.current.sendBroadcast('womp-womp'))
    expect(socket.sent.at(-1)).toEqual({
      type: 'BROADCAST', broadcast: 'womp-womp', version: PROTOCOL_VERSION,
    })

    act(() => socket.receive({
      type: 'BROADCAST', version: PROTOCOL_VERSION,
      playerId: 'p2', broadcast: 'double-middle-finger', ts: 100,
    }))
    expect(result.current.latestBroadcast).toEqual({
      playerId: 'p2', broadcast: 'double-middle-finger', ts: 100,
    })
    act(() => vi.advanceTimersByTime(3499))
    expect(result.current.latestBroadcast).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.latestBroadcast).toBeNull()

    const systemEvent = {
      kind: 'ondra-mode' as const,
      playerId: 'p3',
      playerName: 'Ondra',
      message: 'ondra-farts-cutely' as const,
      ts: 200,
    }
    act(() => socket.receive({ type: 'SYSTEM_EVENT', version: PROTOCOL_VERSION, event: systemEvent }))
    expect(result.current.latestSystemEvent).toEqual(systemEvent)
    act(() => vi.advanceTimersByTime(4499))
    expect(result.current.latestSystemEvent).toEqual(systemEvent)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.latestSystemEvent).toBeNull()
    unmount()
  })

  it('does not let an older expiry clear a newer relayed broadcast', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))
    act(() => socket.receive({ type: 'BROADCAST', playerId: 'p2', broadcast: 'shrug', ts: 1 }))
    act(() => vi.advanceTimersByTime(3000))
    act(() => socket.receive({ type: 'BROADCAST', playerId: 'p3', broadcast: 'karma', ts: 2 }))
    act(() => vi.advanceTimersByTime(501))
    expect(result.current.latestBroadcast).toEqual({ playerId: 'p3', broadcast: 'karma', ts: 2 })
    act(() => vi.advanceTimersByTime(2999))
    expect(result.current.latestBroadcast).toBeNull()
    unmount()
  })

  it('binds quick follow-up intent to the latest accepted authoritative sequence', () => {
    const { result, unmount } = renderHook(() => useMultiplayerRoom({
      roomId: 'ABC123', playerName: 'Ada', intent: 'join',
    }))
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.receive({
      type: 'WELCOME', version: PROTOCOL_VERSION, playerId: 'p1', resumeToken: 'new-token', room: roomSummary(),
    }))

    expect(result.current.quickFollowUp('drawn-five')).toBe(false)
    act(() => socket.receive({ type: 'GAME_STATE', state: gs(8) }))
    act(() => expect(result.current.quickFollowUp('drawn-five')).toBe(true))
    expect(socket.sent.at(-1)).toEqual({
      type: 'QUICK_FOLLOW_UP', cardId: 'drawn-five', expectedSeq: 8, version: PROTOCOL_VERSION,
    })
    unmount()
  })
})
