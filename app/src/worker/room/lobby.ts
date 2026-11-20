// ============================================================================
// Running the table between rounds: dealing (first deal or rematch), rematch
// votes, removing a seat that has been offline too long, and the host's
// round rules and easter egg switch.
// ============================================================================
import type { GameRules, PreviousRoundResult } from '../../engine'
import { initGame } from '../../engine'
import { OFFLINE_KICK_DELAY_MS, PLAYER_LEFT_MESSAGE_IDS } from '../../engine/protocol'
import { makePlayer } from '../credentials'
import { applyPlayerForfeit } from '../forfeit'
import { normalizeGameRules } from '../migrateState'
import { pendingOndraEventAfterLeave } from '../tableMessages'
import type { RoomContext, Session } from './context'

const REMATCH_VOTE_COOLDOWN_MS = 750

export async function startGame(room: RoomContext, session: Session): Promise<void> {
  const data = room.data
  if (!data || session.playerId !== data.hostId) {
    room.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can start' })
    return
  }
  if (data.state && data.state.phase !== 'gameOver') {
    room.send(session, { type: 'ERROR', code: 'GAME_IN_PROGRESS', message: 'Game already in progress' })
    return
  }
  if (room.pruneExpiredSpectators()) await room.save()
  const prior = data.state
  let participants = [...data.players]
  const releasedIds = new Set<string>()
  const promotedSpectatorIds = new Set<string>()

  if (prior?.phase === 'gameOver') {
    const everyOnlinePlayerVoted = data.players.every(player =>
      !room.isConnected(player.id) || Object.prototype.hasOwnProperty.call(data.rematchVotes, player.id)
    )
    if (!everyOnlinePlayerVoted) {
      room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Waiting for every online player to vote' })
      return
    }
    if (data.rematchVotes[data.hostId] !== true) {
      room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'The host must vote yes or leave the room' })
      return
    }
    participants = data.players.filter(player => data.rematchVotes[player.id] === true)
    if (participants.some(player => !room.isConnected(player.id))) {
      room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Every yes voter must be online before starting' })
      return
    }

    // Joining an active/full finished table expresses intent to play the
    // next deal. Fill remaining seats from the connected FIFO queue; an
    // offline or excess watcher remains queued for a later round.
    const openSeats = Math.max(0, data.maxPlayers - participants.length)
    const promoted = data.spectators
      .filter(spectator => room.isConnected(spectator.id))
      .slice(0, openSeats)
    for (const spectator of promoted) {
      promotedSpectatorIds.add(spectator.id)
      participants.push({
        ...makePlayer(spectator.name),
        id: spectator.id,
      })
    }
    if (participants.length < 2) {
      room.send(session, {
        type: 'ERROR',
        code: 'INVALID_MOVE',
        message: 'At least two online players or waiting spectators are required',
      })
      return
    }
    for (const player of data.players) {
      // Explicit No voters and offline non-voters sit out. An offline Yes
      // remains a deliberate reservation and is rejected by the online gate.
      if (data.rematchVotes[player.id] !== true) releasedIds.add(player.id)
    }
  } else {
    if (participants.length < 2) {
      room.send(session, { type: 'ERROR', code: 'INTERNAL', message: 'At least two players are required' })
      return
    }
    if (participants.some(player => !room.isConnected(player.id))) {
      room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'All players must be online before starting' })
      return
    }
  }

  const rosterIds = new Set(participants.map(player => player.id))
  const previousRound: PreviousRoundResult | null =
    prior?.phase === 'gameOver' && prior.winnerId && prior.loserId &&
    prior.winnerId !== prior.loserId &&
    rosterIds.has(prior.winnerId) && rosterIds.has(prior.loserId)
      ? { winnerId: prior.winnerId, loserId: prior.loserId }
      : null

  for (const playerId of releasedIds) {
    delete data.resumeTokens[playerId]
    delete data.offlineSince[playerId]
    room.forgetMember(playerId)
  }
  data.players = participants
  data.spectators = data.spectators.filter(spectator => !promotedSpectatorIds.has(spectator.id))
  for (const player of participants) delete data.offlineSince[player.id]
  data.state = initGame({
    players: participants.map(player => ({ id: player.id, name: player.name, isAI: false })),
    rules: data.rules,
    previousRound,
  })
  data.readyPlayerIds = []
  data.rematchVotes = {}
  room.lastRematchVoteAtByPlayer.clear()
  data.pendingTableEvent = null

  await room.save()

  // A No vote is an explicit next-round seat release; offline non-voters are
  // also omitted so an abandoned tab cannot block the table indefinitely.
  // Notify any still-connected released clients, then remove and close their
  // sessions before a room/game broadcast can expose the fresh deal.
  for (const [sessionId, released] of [...room.sessions]) {
    if (!released.playerId || !releasedIds.has(released.playerId)) continue
    room.endSession(sessionId, released, {
      type: 'ERROR',
      code: 'SESSION_EXPIRED',
      message: 'You chose not to join this rematch.',
    }, 4003, 'Rematch seat released')
  }
  room.broadcastRoom()
  room.broadcastGame()
}

export async function voteRematch(room: RoomContext, session: Session, vote: boolean): Promise<void> {
  const data = room.data
  const playerId = session.playerId
  if (!data || !playerId || !data.players.some(player => player.id === playerId)) {
    room.send(session, { type: 'ERROR', code: 'SESSION_EXPIRED', message: 'Join the room before voting' })
    return
  }
  if (data.state?.phase !== 'gameOver') {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'Rematch voting opens after the round' })
    return
  }
  if (Object.prototype.hasOwnProperty.call(data.rematchVotes, playerId) &&
    data.rematchVotes[playerId] === vote) return

  const now = Date.now()
  const previousVoteAt = room.lastRematchVoteAtByPlayer.get(playerId)
  if (previousVoteAt !== undefined && now - previousVoteAt < REMATCH_VOTE_COOLDOWN_MS) {
    room.send(session, {
      type: 'ERROR',
      code: 'RATE_LIMITED',
      message: 'Please wait a moment before changing your rematch vote',
    })
    return
  }

  room.lastRematchVoteAtByPlayer.set(playerId, now)
  data.rematchVotes = { ...data.rematchVotes, [playerId]: vote }
  await room.save()
  room.broadcastRoom()
}

/** Host-only removal after one continuous, server-measured offline spell. */
export async function kickOfflinePlayer(room: RoomContext, session: Session, targetId: string): Promise<void> {
  const data = room.data
  if (!data || session.playerId !== data.hostId) {
    room.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can kick an offline player' })
    return
  }
  if (targetId === data.hostId) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'The host cannot kick their own seat' })
    return
  }
  const target = data.players.find(player => player.id === targetId)
  if (!target) {
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'That player is no longer at the table' })
    return
  }
  if (room.isConnected(targetId)) {
    delete data.offlineSince[targetId]
    room.send(session, { type: 'ERROR', code: 'INVALID_MOVE', message: 'That player is online' })
    return
  }

  const now = Date.now()
  const since = data.offlineSince[targetId]
  if (!Number.isSafeInteger(since) || Number(since) <= 0 || Number(since) > now) {
    // Conservative recovery for a legacy/corrupt presence snapshot: begin a
    // fresh server-side grace period rather than allowing an immediate kick.
    data.offlineSince[targetId] = now
    await room.save()
    room.broadcastRoom()
    room.send(session, {
      type: 'ERROR', code: 'INVALID_MOVE', message: 'That player must be offline for 20 seconds first',
    })
    return
  }
  const offlineFor = now - since
  if (offlineFor < OFFLINE_KICK_DELAY_MS) {
    const remainingSeconds = Math.max(1, Math.ceil((OFFLINE_KICK_DELAY_MS - offlineFor) / 1000))
    room.send(session, {
      type: 'ERROR',
      code: 'INVALID_MOVE',
      message: `That player can be kicked in ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`,
    })
    return
  }

  delete data.resumeTokens[targetId]
  delete data.rematchVotes[targetId]
  delete data.offlineSince[targetId]
  data.players = data.players.filter(player => player.id !== targetId)
  data.readyPlayerIds = data.readyPlayerIds.filter(id => id !== targetId)
  room.forgetMember(targetId)

  if (data.state && data.state.phase !== 'gameOver') {
    data.state = applyPlayerForfeit(data.state, targetId)
  }
  data.pendingTableEvent = pendingOndraEventAfterLeave(
    data.pendingTableEvent,
    targetId,
    data.state?.phase ?? null,
  )

  await room.save()

  // Re-check and terminate any anomalous/racing attachment before a fresh
  // room or game view is broadcast. The serialized operation queue makes a
  // concurrent RESUME deterministic: it either won earlier (and blocked the
  // kick) or will fail later because the token/member record is gone.
  for (const [sessionId, kicked] of [...room.sessions]) {
    if (kicked.playerId !== targetId) continue
    room.endSession(sessionId, kicked, {
      type: 'ERROR', code: 'SESSION_EXPIRED', message: 'The host removed your offline seat.',
    }, 4003, 'Offline seat removed')
  }

  room.broadcast({
    type: 'SYSTEM_EVENT',
    event: {
      kind: 'player-left',
      playerId: target.id,
      playerName: target.name,
      message: PLAYER_LEFT_MESSAGE_IDS[0],
      ts: Date.now(),
    },
  })
  room.broadcastRoom()
  room.broadcastGame()
}

export async function setRules(room: RoomContext, session: Session, patch: Partial<GameRules>): Promise<void> {
  const data = room.data
  if (!data || session.playerId !== data.hostId) {
    room.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can change rules' })
    return
  }
  if (data.state && data.state.phase !== 'gameOver') {
    room.send(session, { type: 'ERROR', code: 'GAME_IN_PROGRESS', message: 'Rules are locked during a round' })
    return
  }

  // Merge against the current authoritative value so two rapid toggles do
  // not overwrite one another with stale whole-object snapshots.
  data.rules = normalizeGameRules(data.rules, patch)
  await room.save()
  room.broadcastRoom()
}

export async function setEasterEgg(room: RoomContext, session: Session, enabled: boolean): Promise<void> {
  const data = room.data
  if (!data || session.playerId !== data.hostId) {
    room.send(session, { type: 'ERROR', code: 'NOT_HOST', message: 'Only the host can change the easter egg' })
    return
  }

  data.easterEggEnabled = enabled
  if (!enabled) data.pendingTableEvent = null
  await room.save()
  room.broadcastRoom()
}
