// ============================================================================
// Who is in the room: reserving a code, creating the room, joining as a player
// or a queued watcher, resuming with a token, leaving, and what a dropped
// socket means for the seat it held.
// ============================================================================
import { DEFAULT_GAME_RULES } from '../../engine'
import { MAX_SPECTATORS_PER_ROOM, PLAYER_LEFT_MESSAGE_IDS, PROTOCOL_VERSION } from '../../engine/protocol'
import { constantTimeEqual, generateResumeToken, hashResumeToken, makePlayer } from '../credentials'
import { applyPlayerForfeit } from '../forfeit'
import { logEvent } from '../log'
import { pendingOndraEventAfterLeave } from '../tableMessages'
import type { RoomContext, Session } from './context'

/** How long a code reserved by POST /api/room/new stays valid for its CREATE_ROOM. */
const CLAIM_TTL_MS = 2 * 60 * 1000

/**
 * Atomically reserve this room code for one creator (fixes the
 * check-then-act race in /api/room/new and makes the per-IP creation
 * limit un-bypassable: CREATE_ROOM requires a fresh claim).
 */
export async function claimRoomCode(room: RoomContext): Promise<boolean> {
  return room.storage.transaction(async () => {
    if (room.data) return false
    const now = Date.now()
    const claim = await room.storage.get<{ at: number }>('claim')
    if (claim && now - claim.at < CLAIM_TTL_MS) return false
    await room.storage.put('claim', { at: now })
    return true
  })
}

export async function createRoom(
  room: RoomContext,
  sessionId: string,
  session: Session,
  rawName: string,
  requestedMaxPlayers = 5,
): Promise<void> {
  if (session.playerId) {
    room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already connected to a room' })
    return
  }
  if (room.data) {
    room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Room already exists; resume the existing session' })
    return
  }

  const name = rawName.trim()
  if (!name || name.length > 32) {
    room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid player name' })
    return
  }

  // The code must have been reserved via POST /api/room/new (which is
  // per-IP rate limited). This closes the direct-WS room-creation bypass.
  const claimOk = await room.storage.transaction(async () => {
    const now = Date.now()
    const claim = await room.storage.get<{ at: number }>('claim')
    if (!claim || now - claim.at >= CLAIM_TTL_MS) return false
    await room.storage.delete('claim')
    return true
  })
  // The claim transaction yields to storage. Do not create an unreachable
  // one-player room if the unauthenticated socket closed in the meantime.
  if (room.sessions.get(sessionId) !== session) return
  if (!claimOk) {
    room.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room code not allocated; request a new room first' })
    return
  }

  const player = makePlayer(name)
  const resumeToken = generateResumeToken()
  session.playerId = player.id
  room.data = {
    version: 7,
    code: room.code,
    hostId: player.id,
    maxPlayers: Math.max(2, Math.min(5, requestedMaxPlayers)),
    easterEggEnabled: true,
    players: [player],
    spectators: [],
    state: null,
    rules: { ...DEFAULT_GAME_RULES },
    readyPlayerIds: [],
    rematchVotes: {},
    offlineSince: {},
    resumeTokens: { [player.id]: await hashResumeToken(resumeToken) },
    pendingTableEvent: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  await room.save()
  logEvent('room_created', { code: room.code })
  room.welcomeAndState(session, resumeToken)
  room.broadcastRoom()
}

export async function joinRoom(
  room: RoomContext,
  sessionId: string,
  session: Session,
  code: string,
  rawName: string,
): Promise<void> {
  if (session.playerId) {
    room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Already connected to a room' })
    return
  }

  const data = room.data
  const name = rawName.trim()
  if (!data || data.code !== code.toUpperCase()) {
    room.send(session, { type: 'ERROR', code: 'INVALID_CODE', message: 'Room not found' })
    return
  }
  if (!name || name.length > 32) {
    room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'Invalid player name' })
    return
  }
  if (room.pruneExpiredSpectators()) {
    await room.save()
    // A close while pruning must not leave an identity with neither a live
    // socket nor an offline/expiry timestamp.
    if (room.sessions.get(sessionId) !== session) return
  }
  const activeRound = data.state !== null && data.state.phase !== 'gameOver'
  // Once a watcher queue exists, later game-over joins cannot jump ahead of
  // it merely because a seat opened. With no queue, a finished-round join
  // may claim an open next-round seat directly.
  const shouldSpectate = activeRound || data.spectators.length > 0 ||
    (data.state?.phase === 'gameOver' && data.players.length >= data.maxPlayers)
  if (!shouldSpectate && data.players.length >= data.maxPlayers) {
    room.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'Room is full' })
    return
  }
  if (shouldSpectate && data.spectators.length >= MAX_SPECTATORS_PER_ROOM) {
    room.send(session, { type: 'ERROR', code: 'ROOM_FULL', message: 'The spectator queue is full' })
    return
  }

  const identity = makePlayer(name)
  const resumeToken = generateResumeToken()
  session.playerId = identity.id
  if (shouldSpectate) {
    data.spectators.push({ id: identity.id, name, joinedAt: Date.now() })
  } else {
    data.players.push(identity)
    delete data.offlineSince[identity.id]
  }
  data.resumeTokens[identity.id] = await hashResumeToken(resumeToken)

  await room.save()
  room.welcomeAndState(session, resumeToken)
  room.broadcastRoom()
}

/**
 * Resume requires the per-player secret token issued in WELCOME (and
 * rotated on every successful resume). The broadcast playerId alone is
 * NOT a credential. Failures send RESUME_FAILED and never attach.
 */
export async function resumeRoom(
  room: RoomContext,
  sessionId: string,
  session: Session,
  roomCode: string,
  playerId: string,
  resumeToken: string,
): Promise<void> {
  if (session.playerId) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'This connection is already authenticated' })
    return
  }
  const fail = (reason: string) => {
    logEvent('resume_failed', { code: room.code, reason })
    // Authentication failures are terminal for this transport. Keeping an
    // anonymous failed-resume socket around would let stale clients consume
    // the room's connection allowance indefinitely.
    room.endSession(sessionId, session, { type: 'RESUME_FAILED', reason, version: PROTOCOL_VERSION }, 4003, 'Resume failed')
  }

  const data = room.data
  if (!data || roomCode !== data.code) {
    fail('room_not_found')
    return
  }
  if (room.pruneExpiredSpectators()) {
    await room.save()
    if (room.sessions.get(sessionId) !== session) return
  }
  if (!room.isMember(playerId)) {
    fail('not_a_member')
    return
  }
  const storedHash = data.resumeTokens[playerId]
  if (typeof resumeToken !== 'string' || !storedHash) {
    fail('invalid_token')
    return
  }
  const presentedHash = await hashResumeToken(resumeToken)
  if (room.sessions.get(sessionId) !== session) return
  if (!constantTimeEqual(presentedHash, storedHash)) {
    fail('invalid_token')
    return
  }

  // Rotate: the presented token is single-use; the new one goes only to
  // this socket in WELCOME. Hash before mutating the stored credential, and
  // abandon the resume with the old token intact if the socket disappeared
  // while either digest was pending.
  const nextToken = generateResumeToken()
  const nextHash = await hashResumeToken(nextToken)
  if (room.sessions.get(sessionId) !== session) return
  data.resumeTokens[playerId] = nextHash

  for (const [otherId, other] of room.sessions) {
    if (otherId === sessionId || other.playerId !== playerId) continue
    room.endSession(otherId, other, null, 4001, 'Session resumed elsewhere')
  }

  session.playerId = playerId
  if (room.roleOf(playerId) === 'player') delete data.offlineSince[playerId]
  const resumedSpectator = data.spectators.find(spectator => spectator.id === playerId)
  if (resumedSpectator) delete resumedSpectator.disconnectedAt
  await room.save()
  room.welcomeAndState(session, nextToken)
  room.broadcastRoom()
}

export async function leaveRoom(room: RoomContext, session: Session): Promise<void> {
  const data = room.data
  if (!data || !session.playerId) return

  const leavingId = session.playerId
  const leavingRole = room.roleOf(leavingId)
  room.forgetMember(leavingId)
  const leavingPlayer = data.players.find(player => player.id === leavingId)
  delete data.resumeTokens[leavingId]
  delete data.rematchVotes[leavingId]
  delete data.offlineSince[leavingId]
  data.spectators = data.spectators.filter(spectator => spectator.id !== leavingId)
  data.players = data.players.filter(player => player.id !== leavingId)
  data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== leavingId)
  session.playerId = null

  if (leavingRole === 'player' && data.state && data.state.phase !== 'gameOver') {
    data.state = applyPlayerForfeit(data.state, leavingId)
  }
  if (leavingRole === 'player') {
    data.pendingTableEvent = pendingOndraEventAfterLeave(
      data.pendingTableEvent,
      leavingId,
      data.state?.phase ?? null,
    )
  }

  if (data.players.length === 0) {
    // Spectators cannot inherit ownership of a room. Expire their sessions
    // before deleting the final authoritative snapshot.
    for (const [sessionId, watcher] of [...room.sessions]) {
      if (!watcher.playerId || !data.spectators.some(item => item.id === watcher.playerId)) continue
      room.endSession(sessionId, watcher, {
        type: 'ERROR', code: 'SESSION_EXPIRED', message: 'The table has closed.',
      }, 4003, 'Room closed')
    }
    room.data = null
  } else if (data.hostId === leavingId) {
    data.hostId = data.players[0].id
  }

  await room.save()
  if (leavingPlayer) {
    room.broadcast({
      type: 'SYSTEM_EVENT',
      event: {
        kind: 'player-left',
        playerId: leavingPlayer.id,
        playerName: leavingPlayer.name,
        message: PLAYER_LEFT_MESSAGE_IDS[0],
        ts: Date.now(),
      },
    })
  }
  room.broadcastRoom()
  room.broadcastGame()
}

/**
 * A socket that belonged to `memberId` has closed. If the member has no other
 * live socket, their continuous offline spell starts now (a seat can be kicked
 * after OFFLINE_KICK_DELAY_MS, a watcher expires after the reconnect grace).
 */
export async function recordDeparture(room: RoomContext, memberId: string | null): Promise<void> {
  const data = room.data
  if (data && memberId) {
    if (data.players.some(player => player.id === memberId)) {
      if (room.isConnected(memberId)) delete data.offlineSince[memberId]
      else if (data.offlineSince[memberId] === undefined) data.offlineSince[memberId] = Date.now()
      await room.save()
    } else {
      const spectator = data.spectators.find(item => item.id === memberId)
      if (spectator) {
        if (room.isConnected(memberId)) delete spectator.disconnectedAt
        else if (spectator.disconnectedAt === undefined) spectator.disconnectedAt = Date.now()
        await room.save()
      }
    }
  }
  room.broadcastRoom()
}
