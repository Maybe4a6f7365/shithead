// Adversarial integration tests for the hardened worker.
// Dev-only: requires `wrangler dev --local --port 8787` (Node 22) running.
// Usage: BASE_URL=http://localhost:8787 node scripts/test-worker-adversarial.mjs
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const baseUrl = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '')
const wsBase = baseUrl.replace(/^http/, 'ws')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const PROTOCOL_VERSION = 8

const CARD_BEARING_LOG_EVENTS = new Set(['PLAY_CARDS', 'QUICK_FOLLOW_UP', 'BLIND_REVEAL'])

let passed = 0
function ok(name) {
  passed++
  console.log(`PASS ${name}`)
}

class Peer {
  constructor(label, url, origin = baseUrl) {
    this.label = label
    this.url = url
    this.origin = origin
    this.socket = null
    this.messages = []
    this.rawLog = []
    this.waiters = []
    this.latestGameState = null
    this.closeCode = null
  }

  connect(expectFail = false) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url, { origin: this.origin, handshakeTimeout: 10_000 })
      this.socket = socket
      const timer = setTimeout(() => reject(new Error(`${this.label} open timed out`)), 15_000)
      socket.once('open', () => {
        clearTimeout(timer)
        if (expectFail) reject(new Error(`${this.label} unexpectedly connected`))
        else resolve(this)
      })
      socket.once('error', error => {
        clearTimeout(timer)
        if (expectFail) resolve(error)
        else reject(error)
      })
      socket.on('message', raw => this.onMessage(raw))
      socket.on('close', code => { this.closeCode = code })
    })
  }

  onMessage(raw) {
    this.rawLog.push(raw.toString())
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    if (message.type === 'GAME_STATE') this.latestGameState = message.state
    const waiterIndex = this.waiters.findIndex(waiter => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.messages.push(message)
  }

  send(message) {
    assert(this.socket && this.socket.readyState === WebSocket.OPEN, `${this.label} not connected`)
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message))
  }

  waitFor(predicate, description, timeoutMs = 10_000) {
    const queuedIndex = this.messages.findIndex(predicate)
    if (queuedIndex >= 0) return Promise.resolve(this.messages.splice(queuedIndex, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter(candidate => candidate !== waiter)
          reject(new Error(`${this.label} timed out waiting for ${description}`))
        }, timeoutMs),
      }
      this.waiters.push(waiter)
    })
  }

  waitType(type, predicate = () => true, timeoutMs) {
    return this.waitFor(message => message.type === type && predicate(message), type, timeoutMs)
  }

  async close() {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return
    this.socket.close(1000)
    await sleep(150)
  }
}

async function newRoom() {
  const response = await fetch(`${baseUrl}/api/room/new`, { method: 'POST' })
  assert.equal(response.status, 200, 'room allocation failed')
  const { roomId } = await response.json()
  assert.match(roomId, /^[A-Z0-9]{6}$/)
  return roomId
}

const isError = code => message => message.type === 'ERROR' && (code ? message.code === code : true)

const rankOrder = new Map([
  ['JOKER', -2], ['2', -1], ['3', 0], ['4', 1], ['5', 2], ['6', 3], ['7', 4],
  ['8', 5], ['9', 6], ['10', 7], ['J', 8], ['Q', 9], ['K', 10], ['A', 11],
])
const openingRanks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER']

function expectedOpenerId(state) {
  for (const rank of openingRanks) {
    const player = state.players.find(candidate => !candidate.isOut && candidate.faceUp.some(card => card.rank === rank))
    if (player) return player.id
  }
  return state.players.find(player => !player.isOut)?.id
}

// A rematch resets seq to zero, so an old queued GAME_STATE can otherwise
// satisfy a broad `phase === play/tribute` predicate. Public face-up ids are
// stable for one deal and give each rematch an unambiguous fingerprint.
function faceUpSignature(state) {
  return state.players
    .map(player => `${player.id}:${player.faceUp.map(card => card.id).sort().join(',')}`)
    .sort()
    .join('|')
}

function assertHiddenSpectatorCard(card, label) {
  assert.match(card.id, /^hidden:spectator:/, `${label} exposed a stable card id`)
  assert.equal(card.rank, '3', `${label} exposed a card rank`)
  assert.equal(card.suit, null, `${label} exposed a card suit`)
}

function assertSpectatorState(view, publicState, label) {
  assert.equal(view.phase, publicState.phase, `${label} has the wrong phase`)
  assert.equal(view.seq, publicState.seq, `${label} has the wrong sequence`)
  assert.deepEqual(view.pile, publicState.pile, `${label} did not retain the public pile`)
  assert.equal(view.pendingQuickFollowUp, null, `${label} leaked a quick-follow-up entitlement`)
  assert.equal(view.stock.length, publicState.stock.length, `${label} has the wrong stock count`)
  view.stock.forEach((card, index) => assertHiddenSpectatorCard(card, `${label} stock[${index}]`))

  assert.equal(view.players.length, publicState.players.length, `${label} has the wrong player count`)
  for (const publicPlayer of publicState.players) {
    const maskedPlayer = view.players.find(player => player.id === publicPlayer.id)
    assert(maskedPlayer, `${label} omitted player ${publicPlayer.id}`)
    for (const zone of ['hand', 'faceUp', 'faceDown']) {
      assert.equal(
        maskedPlayer[zone].length,
        publicPlayer[zone].length,
        `${label} has the wrong ${zone} count for ${publicPlayer.id}`,
      )
      maskedPlayer[zone].forEach((card, index) =>
        assertHiddenSpectatorCard(card, `${label} ${publicPlayer.id}.${zone}[${index}]`))
    }
  }

  assert(
    view.log.every(event => !CARD_BEARING_LOG_EVENTS.has(event.type)),
    `${label} retained a card-bearing historical event`,
  )
}

function effectiveTopRank(state) {
  for (let i = state.pile.length - 1; i >= 0; i--) {
    const entry = state.pile[i]
    if (entry.cleared) continue
    for (let cardIndex = entry.cards.length - 1; cardIndex >= 0; cardIndex--) {
      const rank = entry.cards[cardIndex].rank
      if (rank === '2') return null // reset barrier: nothing below constrains play
      if (rank === '3') continue // transparent: copy the next effective card below
      return rank
    }
  }
  return null
}

function canPlayRank(rank, top) {
  if (top === null || ['2', '3', 'JOKER'].includes(rank)) return true
  if (top === '7') return rankOrder.get(rank) <= rankOrder.get('7')
  if (rank === '10') return true
  return rankOrder.get(rank) >= rankOrder.get(top)
}

async function finishRound(peersById, initialState) {
  const peers = [...peersById.values()]
  let state = initialState
  let blindPlays = 0
  for (let step = 0; step < 1100; step++) {
    if (state.phase === 'gameOver') return { state, blindPlays }
    assert(['play', 'endgame'].includes(state.phase), `auto-play encountered phase ${state.phase}`)
    const currentId = state.players[state.currentPlayerIdx].id
    const peer = peersById.get(currentId)
    assert(peer, `missing peer for current player ${currentId}`)
    if (!peer.latestGameState || peer.latestGameState.seq < state.seq) {
      await peer.waitType('GAME_STATE', message => message.state.seq >= state.seq)
    }
    const view = peer.latestGameState
    const player = view.players.find(candidate => candidate.id === currentId)
    const zone = player.hand.length ? player.hand : player.faceUp.length ? player.faceUp : player.faceDown
    const top = effectiveTopRank(view)
    let play = []
    if (player.hand.length === 0 && player.faceUp.length === 0) {
      play = zone.slice(0, 1) // blind alias; worker resolves it server-side
      blindPlays++
    } else {
      const legal = zone.filter(card => canPlayRank(card.rank, top))
        .sort((a, b) => rankOrder.get(a.rank) - rankOrder.get(b.rank))
      if (legal.length) play = legal.filter(card => card.rank === legal[0].rank).slice(0, 4)
    }

    const before = state.seq
    peer.send(play.length ? { type: 'PLAY', cards: play } : { type: 'PICK_UP' })
    const updates = await Promise.all(peers.map(candidate => candidate.waitType(
      'GAME_STATE', message => message.state.seq > before,
    )))
    state = updates[0].state
    await sleep(65) // remain below the per-socket 20 msg/s limit on repeated burns
  }
  throw new Error('auto-play did not finish before the engine turn cap')
}

async function main() {
  assert.equal(canPlayRank('10', '7'), false, '10 must respect the 7-or-lower restriction')
  assert.equal(canPlayRank('10', '6'), true, '10 remains a clear card above ordinary ranks')

  // ---- T1: create/join happy path, WELCOME carries version + secret token
  const roomId = await newRoom()
  const wsUrl = `${wsBase}/api/room/${roomId}/ws`
  let host = await new Peer('host', wsUrl).connect()
  let guest = await new Peer('guest', wsUrl).connect()

  host.send({ type: 'CREATE_ROOM', playerName: 'Ondřej', version: PROTOCOL_VERSION })
  const hostWelcome = await host.waitType('WELCOME')
  assert.equal(hostWelcome.version, PROTOCOL_VERSION, 'WELCOME must echo protocol version')
  assert.equal(hostWelcome.role, 'player', 'room creator must be welcomed as a player')
  assert.match(hostWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/, 'WELCOME must carry a high-entropy resumeToken')
  const hostId = hostWelcome.playerId
  const hostToken1 = hostWelcome.resumeToken

  guest.send({ type: 'JOIN_ROOM', code: roomId, playerName: 'Guest', version: PROTOCOL_VERSION })
  const guestWelcome = await guest.waitType('WELCOME')
  assert.equal(guestWelcome.role, 'player', 'lobby join must be welcomed as a player')
  assert.match(guestWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(guestWelcome.resumeToken, hostToken1, 'tokens must be per-player unique')
  const guestId = guestWelcome.playerId
  ok(`T1 create/join: WELCOME carries version=${PROTOCOL_VERSION} and unique per-player resumeToken`)

  await sleep(150)
  for (const peer of [host, guest]) {
    const lobbyOndraEvents = peer.rawLog.map(raw => JSON.parse(raw))
      .filter(message => message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode')
    assert.deepEqual(lobbyOndraEvents, [], 'Ondra mode fired before the round entered play')
  }
  ok('T1a Ondra mode does not fire during CREATE/JOIN lobby setup')

  // Token must never leak into broadcasts seen by the other player.
  await host.waitType('ROOM_STATE', m => m.room.players.length === 2)
  await sleep(200)
  assert(!guest.rawLog.some(raw => raw.includes(hostToken1)), 'host token leaked to guest')
  assert(!host.rawLog.some(raw => raw.includes(guestWelcome.resumeToken)), 'guest token leaked to host')
  ok('T1b resumeToken never appears in other players\' messages')

  // ---- T2: RESUME without a token -> RESUME_FAILED, seat untouched
  const noToken = await new Peer('no-token', wsUrl).connect()
  noToken.send({ type: 'RESUME_ROOM', roomCode: roomId, playerId: hostId, resumeToken: '', version: PROTOCOL_VERSION })
  await noToken.waitType('ERROR', m => /invalid message/i.test(m.message))
  ok('T2 malformed typed RESUME without a token is rejected')

  // ---- T3: stolen playerId + wrong token -> RESUME_FAILED, victim not kicked
  const attacker = await new Peer('attacker', wsUrl).connect()
  attacker.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: hostId,
    resumeToken: 'A'.repeat(43), version: PROTOCOL_VERSION,
  })
  const fail2 = await attacker.waitType('RESUME_FAILED')
  assert.equal(fail2.reason, 'invalid_token')
  await sleep(300)
  assert.equal(attacker.closeCode, 4003, 'failed resume socket must be closed')
  assert.equal(host.closeCode, null, 'victim socket must not be closed by a failed hijack')
  host.send({ type: 'PING' })
  await host.waitType('PONG')
  ok('T3 stolen playerId + wrong token -> terminal RESUME_FAILED, victim seat intact')

  // ---- T4: resume happy path rotates the token; old token is single-use
  await host.close()
  await guest.waitType('ROOM_STATE', m => m.room.players.find(p => p.id === hostId)?.connected === false)
  host = await new Peer('host-resumed', wsUrl).connect()
  host.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: hostId,
    resumeToken: hostToken1, version: PROTOCOL_VERSION,
  })
  const resumed = await host.waitType('WELCOME')
  assert.equal(resumed.playerId, hostId)
  assert.equal(resumed.version, PROTOCOL_VERSION)
  assert.equal(resumed.role, 'player', 'resuming a seat must preserve the player role')
  assert.notEqual(resumed.resumeToken, hostToken1, 'resume must rotate the token')
  const hostToken2 = resumed.resumeToken
  await sleep(100)
  assert(
    !host.rawLog.some(raw => {
      const message = JSON.parse(raw)
      return message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode'
    }),
    'RESUME rerolled Ondra mode before play',
  )
  const stale = await new Peer('stale-token', wsUrl).connect()
  stale.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: hostId,
    resumeToken: hostToken1, version: PROTOCOL_VERSION,
  })
  await stale.waitType('RESUME_FAILED')
  await sleep(150)
  assert.equal(stale.closeCode, 4003, 'stale-token resume socket must be closed')
  ok('T4 resume rotates token; old token gets a terminal rejection')

  // ---- T4a: authentication is one-shot on a live socket. A bad RESUME
  // submitted by an already attached player must be nonterminal and must not
  // detach or downgrade the connection.
  host.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: guestId,
    resumeToken: 'B'.repeat(43), version: PROTOCOL_VERSION,
  })
  const attachedResumeError = await host.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(attachedResumeError.message, /already authenticated/i)
  assert.equal(host.closeCode, null, 'authenticated socket was closed by a second RESUME')
  host.send({ type: 'SET_RULES', rules: { deckCount: 2 }, version: PROTOCOL_VERSION })
  await Promise.all([
    host.waitType('ROOM_STATE', message => message.room.rules.deckCount === 2),
    guest.waitType('ROOM_STATE', message => message.room.rules.deckCount === 2),
  ])
  host.send({ type: 'SET_RULES', rules: { deckCount: 1 }, version: PROTOCOL_VERSION })
  await Promise.all([
    host.waitType('ROOM_STATE', message => message.room.rules.deckCount === 1),
    guest.waitType('ROOM_STATE', message => message.room.rules.deckCount === 1),
  ])
  ok('T4a bad RESUME on an authenticated socket is nonterminal and leaves host authority attached')

  // ---- T5: unknown room -> RESUME_FAILED room_not_found
  const stranger = await new Peer('stranger', `${wsBase}/api/room/ZZZZZ9/ws`).connect()
  stranger.send({
    type: 'RESUME_ROOM', roomCode: 'ZZZZZ9', playerId: hostId,
    resumeToken: hostToken2, version: PROTOCOL_VERSION,
  })
  const fail3 = await stranger.waitType('RESUME_FAILED')
  assert.equal(fail3.reason, 'room_not_found')
  await sleep(150)
  assert.equal(stranger.closeCode, 4003, 'unknown-room resume socket must be closed')
  ok('T5 RESUME in a nonexistent room -> terminal RESUME_FAILED room_not_found')

  // ---- T6: protocol version mismatch gets a clean error
  host.send({ type: 'PING', version: 1 })
  const versionError = await host.waitType('ERROR', m => /protocol version/i.test(m.message))
  assert(versionError, 'expected protocol-version error')
  host.send({ type: 'PING', version: PROTOCOL_VERSION })
  await host.waitType('PONG')
  ok(`T6 client message with version != ${PROTOCOL_VERSION} rejected with clean error`)

  // ---- T7: malformed message rejected
  host.send('this is not json{')
  await host.waitType('ERROR', m => /invalid message/i.test(m.message))
  ok('T7 malformed payload -> ERROR, connection stays open')

  // A malformed non-resume socket remains connected but unauthenticated; it
  // must never become a passive spectator of room, chat, or game broadcasts.
  const unauthenticated = [noToken]
  const unauthLogStarts = new Map(unauthenticated.map(peer => [peer, peer.rawLog.length]))
  host.send({ type: 'CHAT', text: 'extra field', payload: {} })
  await host.waitType('ERROR', message => /invalid message/i.test(message.message))
  host.send({ type: 'CHAT', text: '   ' })
  await host.waitType('ERROR', message => /invalid message/i.test(message.message))
  host.send({ type: 'CHAT', text: 'not during a game' })
  await host.waitType('ERROR', isError('INVALID_MOVE'))
  const hostLogBeforeUnauthChat = host.rawLog.length
  noToken.send({ type: 'CHAT', text: 'unauthenticated' })
  await sleep(100)
  assert(
    !host.rawLog.slice(hostLogBeforeUnauthChat).some(raw => JSON.parse(raw).type === 'CHAT'),
    'unauthenticated CHAT was relayed',
  )
  ok('T7a CHAT is strict, authenticated, and restricted to active games')

  host.send({ type: 'EMOTE', emote: '<script>' })
  await host.waitType('ERROR', message => /invalid message/i.test(message.message))
  noToken.send({ type: 'EMOTE', emote: 'fire' })
  host.send({ type: 'EMOTE', emote: 'thumbs-up' })
  const [hostEmote, guestEmote] = await Promise.all([
    host.waitType('EMOTE', message => message.emote === 'thumbs-up'),
    guest.waitType('EMOTE', message => message.emote === 'thumbs-up'),
  ])
  for (const message of [hostEmote, guestEmote]) {
    assert.equal(message.playerId, hostId)
    assert.equal(message.version, PROTOCOL_VERSION)
    assert.equal(typeof message.ts, 'number')
    assert(!('state' in message), 'ephemeral EMOTE must not include room/game state')
  }
  ok('T7aa EMOTE is strict, server-timestamped, authenticated, and contains no state')

  const cooldownLogStarts = new Map([host, guest].map(peer => [peer, peer.rawLog.length]))
  host.send({ type: 'BROADCAST', broadcast: 'shrug' })
  await sleep(100)
  for (const peer of [host, guest]) {
    assert(
      !peer.rawLog.slice(cooldownLogStarts.get(peer)).some(raw => JSON.parse(raw).type === 'BROADCAST'),
      'alternating EMOTE/BROADCAST bypassed the shared reaction cooldown',
    )
  }

  host.send({ type: 'BROADCAST', broadcast: '<script>' })
  await host.waitType('ERROR', message => /invalid message/i.test(message.message))
  const hostLogBeforeUnauthBroadcast = host.rawLog.length
  noToken.send({ type: 'BROADCAST', broadcast: 'shrug' })
  await sleep(100)
  assert(
    !host.rawLog.slice(hostLogBeforeUnauthBroadcast).some(raw => JSON.parse(raw).type === 'BROADCAST'),
    'unauthenticated BROADCAST was relayed',
  )
  await sleep(650)
  host.send({ type: 'BROADCAST', broadcast: 'shrug' })
  const [hostBroadcast, guestBroadcast] = await Promise.all([
    host.waitType('BROADCAST', message => message.broadcast === 'shrug'),
    guest.waitType('BROADCAST', message => message.broadcast === 'shrug'),
  ])
  for (const message of [hostBroadcast, guestBroadcast]) {
    assert.equal(message.playerId, hostId)
    assert.equal(message.version, PROTOCOL_VERSION)
    assert.equal(typeof message.ts, 'number')
    assert(!('state' in message), 'ephemeral BROADCAST must not include room/game state')
  }
  ok('T7ab BROADCAST is strict/authenticated/ephemeral and shares the EMOTE cooldown')

  // ---- T7b: strict partial rules, host authority, rapid merge
  guest.send({ type: 'SET_RULES', rules: { includeJokers: false } })
  await guest.waitType('ERROR', isError('NOT_HOST'))
  guest.send({ type: 'SET_RULES', rules: { deckCount: 2 } })
  await guest.waitType('ERROR', isError('NOT_HOST'))
  host.send({ type: 'SET_RULES', rules: {} })
  await host.waitType('ERROR', m => /invalid message/i.test(m.message))
  host.send({ type: 'SET_RULES', rules: { deckCount: 4 } })
  await host.waitType('ERROR', m => /invalid message/i.test(m.message))
  host.send({ type: 'SET_RULES', rules: { includeJokers: false } })
  host.send({ type: 'SET_RULES', rules: { winnerSwapsFaceUp: true } })
  host.send({ type: 'SET_RULES', rules: { deckCount: 3 } })
  const mergedRules = await host.waitType(
    'ROOM_STATE',
    m => m.room.rules.includeJokers === false && m.room.rules.winnerSwapsFaceUp === true && m.room.rules.deckCount === 3,
  )
  assert.deepEqual(mergedRules.room.rules, { includeJokers: false, winnerSwapsFaceUp: true, deckCount: 3 })
  host.send({ type: 'SET_RULES', rules: { deckCount: 1, includeJokers: true } })
  await host.waitType('ROOM_STATE', m => m.room.rules.deckCount === 1
    && m.room.rules.includeJokers === true && m.room.rules.winnerSwapsFaceUp === true)
  ok('T7b SET_RULES is strict, host-only, validates 1–3 decks, and rapid partial updates merge authoritatively')

  // ---- T7c: the room easter egg is server-authoritative and host-controlled
  guest.send({ type: 'SET_EASTER_EGG', enabled: false })
  await guest.waitType('ERROR', isError('NOT_HOST'))

  host.send({ type: 'SET_EASTER_EGG', enabled: false })
  const [hostEasterOff, guestEasterOff] = await Promise.all([
    host.waitType('ROOM_STATE', m => m.room.easterEggEnabled === false),
    guest.waitType('ROOM_STATE', m => m.room.easterEggEnabled === false),
  ])
  assert.equal(hostEasterOff.room.easterEggEnabled, false)
  assert.equal(guestEasterOff.room.easterEggEnabled, false)

  // Restore the default before the first play transition so the existing
  // delayed Ondra-event assertion still exercises an eligible round.
  host.send({ type: 'SET_EASTER_EGG', enabled: true })
  const [hostEasterOn, guestEasterOn] = await Promise.all([
    host.waitType('ROOM_STATE', m => m.room.easterEggEnabled === true),
    guest.waitType('ROOM_STATE', m => m.room.easterEggEnabled === true),
  ])
  assert.equal(hostEasterOn.room.easterEggEnabled, true)
  assert.equal(guestEasterOn.room.easterEggEnabled, true)
  ok('T7c SET_EASTER_EGG is host-only and broadcasts off/on room state')

  // ---- T8: start game; per-viewer masking in GAME_STATE
  host.send({ type: 'START_GAME' })
  await host.waitType('GAME_STATE', m => m.state.phase === 'rearrange')
  const guestRearrange = await guest.waitType('GAME_STATE', m => m.state.phase === 'rearrange')
  assert.equal(guestRearrange.version, PROTOCOL_VERSION, 'GAME_STATE must echo protocol version')
  assert.equal(typeof guestRearrange.state.seq, 'number', 'GAME_STATE must carry seq')
  const guestViewOfHost = guestRearrange.state.players.find(p => p.id === hostId)
  assert(guestViewOfHost.hand.every(c => c.rank === '3' && c.suit === null && c.id.startsWith('hidden:')), 'opponent hand must be masked')
  assert(guestRearrange.state.stock.every(c => c.suit === null && c.id.startsWith('hidden:stock:')), 'stock must be masked')
  const guestOwn = guestRearrange.state.players.find(p => p.id === guestId)
  // NB: Jokers legitimately have suit null — only the id distinguishes masked cards.
  assert(guestOwn.hand.every(c => !c.id.startsWith('hidden:')), 'own hand must be real')
  ok('T8 GAME_STATE is per-viewer: stock + opponent hand masked, own hand real')

  await sleep(200)
  for (const peer of unauthenticated) {
    const broadcastTypes = peer.rawLog.slice(unauthLogStarts.get(peer)).map(raw => JSON.parse(raw).type)
      .filter(type => ['ROOM_STATE', 'CHAT', 'EMOTE', 'BROADCAST', 'SYSTEM_EVENT', 'GAME_STATE'].includes(type))
    assert.deepEqual(broadcastTypes, [], `${peer.label} received authenticated room traffic`)
  }
  ok('T8a rejected and unauthenticated sockets receive no room/chat/emote/game broadcasts')

  host.send({ type: 'SET_RULES', rules: { includeJokers: true } })
  await host.waitType('ERROR', isError('GAME_IN_PROGRESS'))
  host.send({ type: 'START_GAME' })
  await host.waitType('ERROR', isError('GAME_IN_PROGRESS'))
  host.send({ type: 'REMATCH_VOTE', vote: true })
  await host.waitType('ERROR', isError('INVALID_MOVE'))
  host.send({ type: 'PING' })
  await host.waitType('PONG')
  ok('T8b active-round rules, duplicate START, and early rematch votes are rejected nonfatally')

  // The preceding security checks intentionally send close to the production
  // 20 msg/s cap. Let that rolling window expire so T8c observes BURN_IN
  // validation rather than an unrelated RATE_LIMITED response.
  await sleep(1_050)
  const playTransitionLogStarts = new Map([host, guest].map(peer => [peer, peer.rawLog.length]))
  host.send({ type: 'READY' })
  guest.send({ type: 'READY' })
  const hostPlay = await host.waitType('GAME_STATE', m => m.state.phase === 'play')
  await guest.waitType('GAME_STATE', m => m.state.phase === 'play')
  await sleep(100)
  for (const peer of [host, guest]) {
    const frames = peer.rawLog.slice(playTransitionLogStarts.get(peer)).map(raw => JSON.parse(raw))
    const playIndex = frames.findIndex(message => message.type === 'GAME_STATE' && message.state?.phase === 'play')
    const ondraIndexes = frames
      .map((message, index) => message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode' ? index : -1)
      .filter(index => index >= 0)
    assert(playIndex >= 0, `${peer.label} did not receive the play GAME_STATE`)
    assert.deepEqual(ondraIndexes, [], 'Ondra event must be delayed beyond the play transition')
  }

  const seqBeforeChat = host.latestGameState.seq
  host.send({ type: 'CHAT', text: '  Héllo\t<b>table</b> 👋  ' })
  const [hostChat, guestChat] = await Promise.all([
    host.waitType('CHAT', message => message.text === 'Héllo <b>table</b> 👋'),
    guest.waitType('CHAT', message => message.text === 'Héllo <b>table</b> 👋'),
  ])
  for (const message of [hostChat, guestChat]) {
    assert.equal(message.playerId, hostId)
    assert.equal(message.version, PROTOCOL_VERSION)
    assert.equal(typeof message.ts, 'number')
    assert(!('state' in message), 'ephemeral CHAT must not include room/game state')
  }
  assert.equal(host.latestGameState.seq, seqBeforeChat, 'ephemeral CHAT mutated game sequence')

  const chatCooldownLogStarts = new Map([host, guest].map(peer => [peer, peer.rawLog.length]))
  host.send({ type: 'EMOTE', emote: 'fire' })
  await sleep(100)
  for (const peer of [host, guest]) {
    assert(
      !peer.rawLog.slice(chatCooldownLogStarts.get(peer)).some(raw => JSON.parse(raw).type === 'EMOTE'),
      'alternating CHAT/EMOTE bypassed the shared reaction cooldown',
    )
  }

  const hostLogBeforeActiveUnauthChat = host.rawLog.length
  noToken.send({ type: 'CHAT', text: 'unauthenticated during play' })
  await sleep(100)
  assert(
    !host.rawLog.slice(hostLogBeforeActiveUnauthChat).some(raw => JSON.parse(raw).type === 'CHAT'),
    'unauthenticated active-game CHAT was relayed',
  )

  guest.send({ type: 'CHAT', text: 'guest burst 1' })
  const firstGuestBurst = await host.waitType(
    'CHAT', message => message.playerId === guestId && message.text === 'guest burst 1',
  )
  await guest.close()
  await host.waitType('ROOM_STATE', message =>
    message.room.players.find(player => player.id === guestId)?.connected === false
  )
  guest = await new Peer('guest-resumed-after-chat-burst', wsUrl).connect()
  guest.send({
    type: 'RESUME_ROOM',
    roomCode: roomId,
    playerId: guestId,
    resumeToken: guestWelcome.resumeToken,
  })
  const guestAfterBurstResume = await guest.waitType('WELCOME')
  assert.equal(guestAfterBurstResume.playerId, guestId)

  // A new socket must not reset the shared custom/emoji/preset cooldown.
  const hostLogBeforeResumedEmote = host.rawLog.length
  guest.send({ type: 'EMOTE', emote: 'salute' })
  await sleep(100)
  assert(
    !host.rawLog.slice(hostLogBeforeResumedEmote).some(raw => {
      const message = JSON.parse(raw)
      return message.type === 'EMOTE' && message.playerId === guestId && message.emote === 'salute'
    }),
    'socket resume reset the stable-player reaction cooldown',
  )
  await sleep(Math.max(0, firstGuestBurst.ts + 750 - Date.now()))
  for (let index = 2; index <= 3; index++) {
    guest.send({ type: 'CHAT', text: `guest burst ${index}` })
    await host.waitType('CHAT', message => message.playerId === guestId && message.text === `guest burst ${index}`)
    await sleep(750)
  }

  const hostLogBeforeFourthChat = host.rawLog.length
  guest.send({ type: 'CHAT', text: 'guest burst 4' })
  const chatRateLimit = await guest.waitType('ERROR', isError('RATE_LIMITED'))
  assert.match(chatRateLimit.message, /limited to 3 every 10 seconds/i)
  await sleep(100)
  assert(
    !host.rawLog.slice(hostLogBeforeFourthChat).some(raw => {
      const message = JSON.parse(raw)
      return message.type === 'CHAT' && message.text === 'guest burst 4'
    }),
    'fourth custom message in the rolling window was relayed',
  )
  guest.send({ type: 'EMOTE', emote: 'salute' })
  await host.waitType('EMOTE', message => message.playerId === guestId && message.emote === 'salute')
  host.send({ type: 'CHAT', text: 'other player still allowed' })
  await guest.waitType('CHAT', message => message.playerId === hostId && message.text === 'other player still allowed')
  assert.equal(host.latestGameState.seq, seqBeforeChat, 'custom messages or reactions mutated game state')
  ok('T8-chat active-game CHAT is canonical/ephemeral, reconnect-safe, per-player, and limited to 3 per 10 seconds')

  const playState = hostPlay.state
  const currentId = playState.players[playState.currentPlayerIdx].id
  const [current, idle] = currentId === hostId ? [host, guest] : [guest, host]
  const currentPeerId = currentId === hostId ? hostId : guestId

  // ---- T8c: BURN_IN is authenticated, out-of-turn, visible-zone only
  const currentHandForBurn = current.latestGameState.players.find(p => p.id === currentPeerId).hand
  current.send({ type: 'BURN_IN', cards: [currentHandForBurn[0]] })
  await current.waitType('ERROR', isError('INVALID_MOVE'))
  const idleIdForBurn = idle === host ? hostId : guestId
  const idleHandForBurn = idle.latestGameState.players.find(p => p.id === idleIdForBurn).hand
  idle.send({ type: 'BURN_IN', cards: [idleHandForBurn[0]] })
  await idle.waitType('ERROR', isError('INVALID_MOVE'))
  idle.send({ type: 'BURN_IN', cards: [{ id: 'blind:down:0', rank: '3', suit: null }] })
  await idle.waitType('ERROR', isError('INVALID_MOVE'))
  const seqBeforeUnauthBurn = host.latestGameState.seq
  noToken.send({ type: 'BURN_IN', cards: [{ id: idleHandForBurn[0].id }] })
  await sleep(150)
  assert.equal(host.latestGameState.seq, seqBeforeUnauthBurn, 'unauthenticated BURN_IN mutated the room')
  ok('T8c BURN_IN rejects current, insufficient, hidden, and unauthenticated attempts without mutation')

  // ---- T8d: QUICK_FOLLOW_UP is exact-sequence, authenticated, and
  // entitlement-bound. There is no pending replacement draw at round start,
  // so every otherwise well-shaped attempt must leave state untouched.
  current.send({ type: 'QUICK_FOLLOW_UP', cardId: currentHandForBurn[0].id })
  await current.waitType('ERROR', message => /invalid message/i.test(message.message))
  const seqBeforeQuickForgery = current.latestGameState.seq
  current.send({
    type: 'QUICK_FOLLOW_UP', cardId: currentHandForBurn[0].id,
    expectedSeq: seqBeforeQuickForgery + 1,
  })
  await current.waitType('ERROR', isError('INVALID_MOVE'))
  current.send({
    type: 'QUICK_FOLLOW_UP', cardId: 'forged-drawn-card-id',
    expectedSeq: seqBeforeQuickForgery,
  })
  await current.waitType('ERROR', isError('INVALID_MOVE'))
  noToken.send({
    type: 'QUICK_FOLLOW_UP', cardId: currentHandForBurn[0].id,
    expectedSeq: seqBeforeQuickForgery,
  })
  await sleep(150)
  assert.equal(current.latestGameState.seq, seqBeforeQuickForgery, 'forged QUICK_FOLLOW_UP mutated the room')
  ok('T8d QUICK_FOLLOW_UP rejects malformed, stale, forged, and unauthenticated attempts without mutation')

  // ---- T9: forged out-of-turn PLAY rejected, no state change
  const idleState = idle.latestGameState
  const idleHand = idleState.players.find(p => p.id === (idle === host ? hostId : guestId)).hand
  const seqBefore = idle.latestGameState.seq
  idle.send({ type: 'PLAY', cards: [{ id: idleHand[0].id, suit: idleHand[0].suit, rank: idleHand[0].rank }] })
  await idle.waitType('ERROR', isError('INVALID_MOVE'))
  await sleep(300)
  assert.equal(idle.latestGameState.seq, seqBefore, 'out-of-turn PLAY must not advance seq')
  ok('T9 forged out-of-turn PLAY rejected (INVALID_MOVE, seq unchanged)')

  // ---- T10: PLAY with cards not owned rejected
  current.send({ type: 'PLAY', cards: [{ id: 'bogus-card-id', suit: '♠', rank: 'A' }] })
  const notOwned = await current.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(notOwned.message, /not owned/i)
  ok('T10 PLAY with foreign card id rejected')

  // ---- T11: duplicate PLAY cannot double-apply
  const myState = current.latestGameState
  const myHand = myState.players.find(p => p.id === currentPeerId).hand
  const card = myHand[0]
  const playMsg = { type: 'PLAY', cards: [{ id: card.id, suit: card.suit, rank: card.rank }] }
  const seqBeforePlay = myState.seq
  current.send(playMsg)
  const applied = await current.waitType('GAME_STATE', m => m.state.seq > seqBeforePlay)
  current.send(playMsg) // exact duplicate
  await current.waitType('ERROR', isError('INVALID_MOVE'))
  await sleep(300)
  assert.equal(current.latestGameState.seq, applied.state.seq, 'duplicate PLAY must not apply twice')
  ok('T11 duplicate identical PLAY does not double-apply (ownership re-check)')

  // ---- T11a: an authenticated mid-round join becomes a resumable,
  // read-only spectator. The live pile/turn are public, but every card owned
  // by a player stays masked -- including face-up cards and at game over.
  assert(
    applied.state.log.some(event => event.type === 'PLAY_CARDS'),
    'spectator log-redaction test requires a real card-bearing history event',
  )
  let spectator = await new Peer('spectator', wsUrl).connect()
  spectator.send({
    type: 'JOIN_ROOM', code: roomId, playerName: 'Watcher', version: PROTOCOL_VERSION,
  })
  const spectatorWelcome = await spectator.waitType('WELCOME')
  assert.equal(spectatorWelcome.role, 'spectator')
  assert.equal(spectatorWelcome.version, PROTOCOL_VERSION)
  assert.match(spectatorWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/)
  const spectatorId = spectatorWelcome.playerId
  const spectatorToken1 = spectatorWelcome.resumeToken
  const [hostEyeOn, guestEyeOn, spectatorInitial] = await Promise.all([
    host.waitType('ROOM_STATE', message => message.room.spectatorCount === 1),
    guest.waitType('ROOM_STATE', message => message.room.spectatorCount === 1),
    spectator.waitType('GAME_STATE', message => message.state.seq === applied.state.seq),
  ])
  for (const message of [hostEyeOn, guestEyeOn]) {
    assert.equal(message.room.spectatorCount, 1)
    assert.equal(message.room.spectatorQueueSize, 1)
    assert(!('spectators' in message.room), 'room summary exposed spectator identities')
    assert(!message.room.players.some(player => player.id === spectatorId), 'spectator leaked into the seated roster')
  }
  assertSpectatorState(spectatorInitial.state, applied.state, 'initial spectator view')

  const spectatorActionSeq = host.latestGameState.seq
  const hostLogBeforeSpectatorActions = host.rawLog.length
  const guestLogBeforeSpectatorActions = guest.rawLog.length
  const rejectedSpectatorActions = [
    { type: 'PLAY', cards: [{ id: 'spectator-forgery', rank: 'A', suit: '♠' }] },
    { type: 'CHAT', text: 'spectator chat must not relay' },
    { type: 'EMOTE', emote: 'fire' },
    { type: 'BROADCAST', broadcast: 'shrug' },
    { type: 'REMATCH_VOTE', vote: true },
    { type: 'KICK_OFFLINE_PLAYER', playerId: guestId },
  ]
  for (const action of rejectedSpectatorActions) {
    spectator.send({ ...action, version: PROTOCOL_VERSION })
    const rejection = await spectator.waitType('ERROR', isError('INVALID_MOVE'))
    assert.match(rejection.message, /spectator/i)
  }
  await sleep(150)
  assert.equal(host.latestGameState.seq, spectatorActionSeq, 'spectator action mutated the game')
  for (const [peer, logStart] of [
    [host, hostLogBeforeSpectatorActions],
    [guest, guestLogBeforeSpectatorActions],
  ]) {
    const relayed = peer.rawLog.slice(logStart).map(raw => JSON.parse(raw)).filter(message =>
      (message.type === 'CHAT' && message.text === 'spectator chat must not relay') ||
      (message.type === 'EMOTE' && message.playerId === spectatorId) ||
      (message.type === 'BROADCAST' && message.playerId === spectatorId)
    )
    assert.deepEqual(relayed, [], `${peer.label} received a spectator reaction`)
  }

  await spectator.close()
  const spectatorOffline = await host.waitType(
    'ROOM_STATE', message => message.room.spectatorCount === 0 && message.room.spectatorQueueSize === 1,
  )
  assert(!spectatorOffline.room.players.some(player => player.id === spectatorId))
  spectator = await new Peer('spectator-resumed', wsUrl).connect()
  spectator.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: spectatorId,
    resumeToken: spectatorToken1, version: PROTOCOL_VERSION,
  })
  const spectatorResumed = await spectator.waitType('WELCOME')
  assert.equal(spectatorResumed.playerId, spectatorId)
  assert.equal(spectatorResumed.role, 'spectator')
  assert.notEqual(spectatorResumed.resumeToken, spectatorToken1, 'spectator resume must rotate its token')
  const [eyeRestored, spectatorResumedState] = await Promise.all([
    host.waitType('ROOM_STATE', message => message.room.spectatorCount === 1),
    spectator.waitType('GAME_STATE', message => message.state.seq === applied.state.seq),
  ])
  assert.equal(eyeRestored.room.spectatorQueueSize, 1)
  assertSpectatorState(spectatorResumedState.state, applied.state, 'resumed spectator view')

  const staleSpectator = await new Peer('stale-spectator-token', wsUrl).connect()
  staleSpectator.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: spectatorId,
    resumeToken: spectatorToken1, version: PROTOCOL_VERSION,
  })
  const staleSpectatorFailure = await staleSpectator.waitType('RESUME_FAILED')
  assert.equal(staleSpectatorFailure.reason, 'invalid_token')
  await sleep(150)
  assert.equal(staleSpectator.closeCode, 4003)
  ok('T11a spectators see the live table with all player-owned cards masked and all actions rejected')

  // ---- T11b-c: finish a real round, then exercise the optional tribute
  // Opaque blind-id canonicalization is covered deterministically at the
  // worker boundary. Whether this random deal reaches a blind play before the
  // engine's stalemate cap is intentionally not a CI requirement.
  const peersById = new Map([[hostId, host], [guestId, guest]])
  const initialDealSignature = faceUpSignature(applied.state)
  const firstFinished = await finishRound(peersById, applied.state)
  const round1 = firstFinished.state
  assert.equal(round1.phase, 'gameOver')
  assert(round1.loserId, 'every terminal round must record the Shithead')
  assert.equal(round1.roundStats?.complete, true, 'new rounds must accumulate complete stats')
  assert.equal(round1.roundStats?.players.length, 2)
  assert(round1.roundStats.players.some(stats => stats.cardsPlayed > 0), 'accepted plays were not counted')
  const spectatorGameOver = await spectator.waitType('GAME_STATE', message => message.state.phase === 'gameOver')
  assertSpectatorState(spectatorGameOver.state, round1, 'game-over spectator view')
  const realOwnedCardIds = round1.players.flatMap(player =>
    [...player.hand, ...player.faceUp, ...player.faceDown].map(card => card.id)
  ).filter(cardId => !cardId.startsWith('hidden:'))
  const spectatorGameOverJson = JSON.stringify(spectatorGameOver.state)
  for (const cardId of realOwnedCardIds) {
    assert(!spectatorGameOverJson.includes(cardId), `game-over spectator view leaked owned card ${cardId}`)
  }
  spectator.send({ type: 'LEAVE_ROOM', version: PROTOCOL_VERSION })
  const spectatorGone = await host.waitType(
    'ROOM_STATE', message => message.room.spectatorCount === 0 && message.room.spectatorQueueSize === 0,
  )
  assert(!spectatorGone.room.players.some(player => player.id === spectatorId))
  await Promise.all([spectator.close(), staleSpectator.close()])
  ok('T11aa spectator card masking survives gameOver and explicit leave clears the queue')
  await sleep(100)
  for (const peer of [host, guest]) {
    const frames = peer.rawLog.slice(playTransitionLogStarts.get(peer)).map(raw => JSON.parse(raw))
    const ondraIndexes = frames
      .map((message, index) => message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode' ? index : -1)
      .filter(index => index >= 0)
    assert.equal(ondraIndexes.length, 1, `${peer.label} did not receive exactly one delayed Ondra event`)
    const eventIndex = ondraIndexes[0]
    const event = frames[eventIndex].event
    const preceding = frames[eventIndex - 1]
    assert.equal(preceding?.type, 'GAME_STATE', 'delayed Ondra event must follow authoritative GAME_STATE')
    assert(['play', 'endgame'].includes(preceding.state.phase), 'delayed Ondra event fired off-table')
    assert(preceding.state.turnCount >= 3 && preceding.state.turnCount <= 7, 'delay was outside 3–7 actions')
    assert.equal(event.playerId, hostId)
    assert.equal(event.playerName, 'Ondřej')
    assert.match(event.message, /^ondra-/)
    assert.equal(typeof event.ts, 'number')
  }
  ok('T11b authoritative autoplay reaches a terminal round and records the Shithead')

  // A natural first-out winner enables the optional next-round tribute. A
  // legitimate stalemate records only the loser; it must not invent a winner
  // merely so this integration test can enter the tribute branch. The engine
  // suite covers both one-shot outcomes (swap and skip) deterministically.
  if (round1.winnerId && round1.winnerId !== round1.loserId) {
    host.send({ type: 'REMATCH_VOTE', vote: true })
    const hostVote = await host.waitType('ROOM_STATE', m =>
      m.room.rematchVotes?.find(vote => vote.playerId === hostId)?.vote === 'yes')
    assert.equal(hostVote.room.rematchVotes.find(vote => vote.playerId === guestId)?.vote, 'pending')
    const duplicateVoteLogStart = host.rawLog.length
    host.send({ type: 'REMATCH_VOTE', vote: true })
    await sleep(100)
    assert(
      !host.rawLog.slice(duplicateVoteLogStart).some(raw => JSON.parse(raw).type === 'ROOM_STATE'),
      'an unchanged rematch vote caused another room broadcast',
    )
    guest.send({ type: 'REMATCH_VOTE', vote: true })
    const [hostVotesReady, guestVotesReady] = await Promise.all([
      host.waitType('ROOM_STATE', m => m.room.rematchVotes?.every(vote => vote.vote === 'yes')),
      guest.waitType('ROOM_STATE', m => m.room.rematchVotes?.every(vote => vote.vote === 'yes')),
    ])
    assert.equal(hostVotesReady.room.rematchVotes.length, 2)
    assert.equal(guestVotesReady.room.rematchVotes.length, 2)
    host.send({ type: 'START_GAME' })
    const [hostRematch] = await Promise.all([
      host.waitType('GAME_STATE', m => m.state.phase === 'rearrange'
        && m.state.seq === 0
        && faceUpSignature(m.state) !== initialDealSignature),
      guest.waitType('GAME_STATE', m => m.state.phase === 'rearrange'
        && m.state.seq === 0
        && faceUpSignature(m.state) !== initialDealSignature),
    ])
    assert.equal(hostRematch.state.rules.winnerSwapsFaceUp, true)
    assert.equal(hostRematch.state.roundStats.complete, true)
    assert(hostRematch.state.roundStats.players.every(stats => stats.cardsPlayed === 0))
    const rematchSignature = faceUpSignature(hostRematch.state)
    host.send({ type: 'READY' })
    guest.send({ type: 'READY' })
    const [hostTribute] = await Promise.all([
      host.waitType('GAME_STATE', m => m.state.phase === 'tribute' && faceUpSignature(m.state) === rematchSignature),
      guest.waitType('GAME_STATE', m => m.state.phase === 'tribute' && faceUpSignature(m.state) === rematchSignature),
    ])
    const pending = hostTribute.state.pendingTribute
    assert.deepEqual(pending, { winnerId: round1.winnerId, loserId: round1.loserId })

    const winnerPeer = peersById.get(pending.winnerId)
    const loserPeer = peersById.get(pending.loserId)
    loserPeer.send({ type: 'TRIBUTE_SKIP' })
    await loserPeer.waitType('ERROR', isError('INVALID_MOVE'))
    const winnerFaceUp = hostTribute.state.players.find(p => p.id === pending.winnerId).faceUp[0]
    const loserFaceUp = hostTribute.state.players.find(p => p.id === pending.loserId).faceUp[0]
    const tributeTransitionLogStarts = new Map([host, guest].map(peer => [peer, peer.rawLog.length]))
    winnerPeer.send({
      type: 'TRIBUTE_SWAP', winnerCardId: winnerFaceUp.id, loserCardId: loserFaceUp.id,
    })
    const [afterSwap] = await Promise.all([
      host.waitType('GAME_STATE', m => m.state.phase === 'play'
        && m.state.players.find(p => p.id === pending.winnerId)?.faceUp.some(c => c.id === loserFaceUp.id)
        && m.state.players.find(p => p.id === pending.loserId)?.faceUp.some(c => c.id === winnerFaceUp.id)),
      guest.waitType('GAME_STATE', m => m.state.phase === 'play'
        && m.state.players.find(p => p.id === pending.winnerId)?.faceUp.some(c => c.id === loserFaceUp.id)
        && m.state.players.find(p => p.id === pending.loserId)?.faceUp.some(c => c.id === winnerFaceUp.id)),
    ])
    assert.equal(afterSwap.state.players[afterSwap.state.currentPlayerIdx].id, expectedOpenerId(afterSwap.state))
    await sleep(100)
    for (const peer of [host, guest]) {
      const immediateEvents = peer.rawLog.slice(tributeTransitionLogStarts.get(peer))
        .map(raw => JSON.parse(raw))
        .filter(message => message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode')
      assert.deepEqual(immediateEvents, [], 'tribute-entry Ondra event must also be delayed')
    }
    ok('T11c tribute is winner-only; an authorized face-up swap recomputes the opener')
  } else {
    assert.equal(round1.winnerId, null)
    ok('T11c a stalemate records the Shithead without inventing a winner')
  }

  // ---- T11d: disabling after play was scheduled cancels the private event
  // Re-enabling in the same round must not silently roll a replacement.
  const cancelRoom = await newRoom()
  const cancelUrl = `${wsBase}/api/room/${cancelRoom}/ws`
  const cancelHost = await new Peer('cancel-host', cancelUrl).connect()
  const cancelGuest = await new Peer('cancel-guest', cancelUrl).connect()
  cancelHost.send({ type: 'CREATE_ROOM', playerName: 'Ondrej' })
  const cancelHostWelcome = await cancelHost.waitType('WELCOME')
  cancelGuest.send({ type: 'JOIN_ROOM', code: cancelRoom, playerName: 'Guest' })
  const cancelGuestWelcome = await cancelGuest.waitType('WELCOME')
  await cancelHost.waitType('ROOM_STATE', m => m.room.players.length === 2)
  cancelHost.send({ type: 'START_GAME' })
  await Promise.all([
    cancelHost.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
    cancelGuest.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
  ])
  const cancelLogStarts = new Map([cancelHost, cancelGuest].map(peer => [peer, peer.rawLog.length]))
  cancelHost.send({ type: 'READY' })
  cancelGuest.send({ type: 'READY' })
  const [cancelPlay] = await Promise.all([
    cancelHost.waitType('GAME_STATE', m => m.state.phase === 'play'),
    cancelGuest.waitType('GAME_STATE', m => m.state.phase === 'play'),
  ])

  cancelHost.send({ type: 'SET_EASTER_EGG', enabled: false })
  await Promise.all([
    cancelHost.waitType('ROOM_STATE', m => m.room.easterEggEnabled === false),
    cancelGuest.waitType('ROOM_STATE', m => m.room.easterEggEnabled === false),
  ])
  cancelHost.send({ type: 'SET_EASTER_EGG', enabled: true })
  await Promise.all([
    cancelHost.waitType('ROOM_STATE', m => m.room.easterEggEnabled === true),
    cancelGuest.waitType('ROOM_STATE', m => m.room.easterEggEnabled === true),
  ])

  await finishRound(new Map([
    [cancelHostWelcome.playerId, cancelHost],
    [cancelGuestWelcome.playerId, cancelGuest],
  ]), cancelPlay.state)
  await sleep(100)
  for (const peer of [cancelHost, cancelGuest]) {
    const ondraEvents = peer.rawLog.slice(cancelLogStarts.get(peer))
      .map(raw => JSON.parse(raw))
      .filter(message => message.type === 'SYSTEM_EVENT' && message.event?.kind === 'ondra-mode')
    assert.deepEqual(ondraEvents, [], 'disabled schedule was not cancelled or re-enable rerolled it')
  }
  await Promise.all([cancelHost.close(), cancelGuest.close()])
  ok('T11d disabling cancels a scheduled Ondra event; same-round re-enable does not reroll it')

  // ---- T12: LEAVE destroys the resume token
  const room2 = await newRoom()
  const ws2 = `${wsBase}/api/room/${room2}/ws`
  const leaver = await new Peer('leaver', ws2).connect()
  leaver.send({ type: 'CREATE_ROOM', playerName: 'Leaver' })
  const leaverWelcome = await leaver.waitType('WELCOME')
  leaver.send({ type: 'LEAVE_ROOM' })
  await sleep(300)
  const reResume = await new Peer('re-resume', ws2).connect()
  reResume.send({ type: 'RESUME_ROOM', roomCode: room2, playerId: leaverWelcome.playerId, resumeToken: leaverWelcome.resumeToken })
  const leaveFail = await reResume.waitType('RESUME_FAILED')
  assert(['invalid_token', 'not_a_member', 'room_not_found'].includes(leaveFail.reason))
  await leaver.close()
  await reResume.close()
  ok('T12 explicit LEAVE_ROOM destroys the resume token')

  // ---- T12b: offline seats block a fresh start, and only become kickable
  // after one continuous server-measured 20-second offline spell.
  const offlineRoom = await newRoom()
  const offlineUrl = `${wsBase}/api/room/${offlineRoom}/ws`
  const offlineHost = await new Peer('offline-host', offlineUrl).connect()
  const offlineGuest = await new Peer('offline-guest', offlineUrl).connect()
  offlineHost.send({ type: 'CREATE_ROOM', playerName: 'Online host' })
  await offlineHost.waitType('WELCOME')
  offlineGuest.send({ type: 'JOIN_ROOM', code: offlineRoom, playerName: 'Drops' })
  const offlineGuestWelcome = await offlineGuest.waitType('WELCOME')
  await offlineHost.waitType('ROOM_STATE', m => m.room.players.length === 2)
  await offlineGuest.close()
  const offlineState = await offlineHost.waitType('ROOM_STATE', m =>
    m.room.players.some(p => p.id === offlineGuestWelcome.playerId && !p.connected))
  const offlineSummary = offlineState.room.players.find(player => player.id === offlineGuestWelcome.playerId)
  assert.equal(typeof offlineSummary.offlineSince, 'number', 'offline seat is missing its authoritative timestamp')
  offlineHost.send({ type: 'START_GAME' })
  const offlineStartError = await offlineHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(offlineStartError.message, /online/i)
  offlineHost.send({ type: 'KICK_OFFLINE_PLAYER', playerId: offlineGuestWelcome.playerId })
  const earlyKick = await offlineHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(earlyKick.message, /kicked in|offline for 20 seconds/i)
  await sleep(Math.max(0, offlineSummary.offlineSince + 20_100 - Date.now()))
  // CREATE_ROOM left an older one-seat ROOM_STATE in the generic queue. Drop
  // old snapshots so only the post-kick roster can satisfy this assertion.
  offlineHost.messages = offlineHost.messages.filter(message =>
    message.type !== 'ROOM_STATE' && message.type !== 'SYSTEM_EVENT')
  const kickEventPromise = offlineHost.waitType('SYSTEM_EVENT', message =>
    message.event?.kind === 'player-left' && message.event.playerId === offlineGuestWelcome.playerId)
  const kickedRosterPromise = offlineHost.waitType('ROOM_STATE', message =>
    !message.room.players.some(player => player.id === offlineGuestWelcome.playerId))
  offlineHost.send({ type: 'KICK_OFFLINE_PLAYER', playerId: offlineGuestWelcome.playerId })
  const [, kickedRoster] = await Promise.all([kickEventPromise, kickedRosterPromise])
  assert.equal(kickedRoster.room.players.length, 1)

  const kickedResume = await new Peer('kicked-resume', offlineUrl).connect()
  kickedResume.send({
    type: 'RESUME_ROOM', roomCode: offlineRoom, playerId: offlineGuestWelcome.playerId,
    resumeToken: offlineGuestWelcome.resumeToken, version: PROTOCOL_VERSION,
  })
  const kickedResumeFailure = await kickedResume.waitType('RESUME_FAILED')
  assert(['not_a_member', 'invalid_token'].includes(kickedResumeFailure.reason))
  await kickedResume.close()
  await offlineHost.close()
  ok('T12b host kick is rejected before 20s, succeeds after 20s, and revokes resume')

  // ---- T12c: connected spectators are promoted FIFO into seats that open
  // for a rematch. The host plus one watcher satisfies the two-player floor;
  // excess watchers remain in the masked queue.
  const promotionRoom = await newRoom()
  const promotionUrl = `${wsBase}/api/room/${promotionRoom}/ws`
  const promotionHost = await new Peer('promotion-host', promotionUrl).connect()
  const promotionVictim = await new Peer('promotion-old-seat', promotionUrl).connect()
  promotionHost.send({
    type: 'CREATE_ROOM', playerName: 'Promotion host', maxPlayers: 2, version: PROTOCOL_VERSION,
  })
  const promotionHostWelcome = await promotionHost.waitType('WELCOME')
  assert.equal(promotionHostWelcome.role, 'player')
  promotionVictim.send({
    type: 'JOIN_ROOM', code: promotionRoom, playerName: 'Old seat', version: PROTOCOL_VERSION,
  })
  const promotionVictimWelcome = await promotionVictim.waitType('WELCOME')
  assert.equal(promotionVictimWelcome.role, 'player')
  await promotionHost.waitType('ROOM_STATE', message => message.room.players.length === 2)
  promotionHost.send({ type: 'START_GAME', version: PROTOCOL_VERSION })
  const [promotionRearrange] = await Promise.all([
    promotionHost.waitType('GAME_STATE', message => message.state.phase === 'rearrange'),
    promotionVictim.waitType('GAME_STATE', message => message.state.phase === 'rearrange'),
  ])

  const firstWatcher = await new Peer('first-watcher', promotionUrl).connect()
  firstWatcher.send({
    type: 'JOIN_ROOM', code: promotionRoom, playerName: 'First watcher', version: PROTOCOL_VERSION,
  })
  const firstWatcherWelcome = await firstWatcher.waitType('WELCOME')
  assert.equal(firstWatcherWelcome.role, 'spectator')
  const firstWatcherInitial = await firstWatcher.waitType('GAME_STATE', message => message.state.phase === 'rearrange')
  assertSpectatorState(firstWatcherInitial.state, promotionRearrange.state, 'first queued watcher')

  const secondWatcher = await new Peer('second-watcher', promotionUrl).connect()
  secondWatcher.send({
    type: 'JOIN_ROOM', code: promotionRoom, playerName: 'Second watcher', version: PROTOCOL_VERSION,
  })
  const secondWatcherWelcome = await secondWatcher.waitType('WELCOME')
  assert.equal(secondWatcherWelcome.role, 'spectator')
  await secondWatcher.waitType('GAME_STATE', message => message.state.phase === 'rearrange')
  const twoWatchers = await promotionHost.waitType(
    'ROOM_STATE', message => message.room.spectatorCount === 2 && message.room.spectatorQueueSize === 2,
  )
  assert.equal(twoWatchers.room.maxPlayers, 2)

  promotionVictim.send({ type: 'LEAVE_ROOM', version: PROTOCOL_VERSION })
  const [promotionOver, firstWatcherOver, secondWatcherOver] = await Promise.all([
    promotionHost.waitType('GAME_STATE', message => message.state.phase === 'gameOver'),
    firstWatcher.waitType('GAME_STATE', message => message.state.phase === 'gameOver'),
    secondWatcher.waitType('GAME_STATE', message => message.state.phase === 'gameOver'),
  ])
  assertSpectatorState(firstWatcherOver.state, promotionOver.state, 'first watcher at game over')
  assertSpectatorState(secondWatcherOver.state, promotionOver.state, 'second watcher at game over')

  // A seat is open now, but the existing queue owns it. A new game-over join
  // must append as another watcher instead of bypassing the FIFO.
  const lateGameOverWatcher = await new Peer('late-game-over-watcher', promotionUrl).connect()
  lateGameOverWatcher.send({
    type: 'JOIN_ROOM', code: promotionRoom, playerName: 'Late watcher', version: PROTOCOL_VERSION,
  })
  const lateGameOverWelcome = await lateGameOverWatcher.waitType('WELCOME')
  assert.equal(lateGameOverWelcome.role, 'spectator')
  const lateGameOverView = await lateGameOverWatcher.waitType(
    'GAME_STATE', message => message.state.phase === 'gameOver')
  assertSpectatorState(lateGameOverView.state, promotionOver.state, 'late game-over watcher')
  await promotionHost.waitType(
    'ROOM_STATE', message => message.room.spectatorCount === 3 && message.room.spectatorQueueSize === 3,
  )

  promotionHost.send({ type: 'REMATCH_VOTE', vote: true, version: PROTOCOL_VERSION })
  await promotionHost.waitType('ROOM_STATE', message =>
    message.room.rematchVotes?.find(vote => vote.playerId === promotionHostWelcome.playerId)?.vote === 'yes')
  promotionHost.send({ type: 'START_GAME', version: PROTOCOL_VERSION })
  const [
    promotedRoom, queuedRoom, lateQueuedRoom,
    promotedDeal, queuedDeal, lateQueuedDeal, hostPromotionDeal,
  ] = await Promise.all([
    firstWatcher.waitType('ROOM_STATE', message =>
      message.room.players.some(player => player.id === firstWatcherWelcome.playerId) &&
      message.room.spectatorQueueSize === 2),
    secondWatcher.waitType('ROOM_STATE', message =>
      message.room.players.some(player => player.id === firstWatcherWelcome.playerId) &&
      !message.room.players.some(player => player.id === secondWatcherWelcome.playerId) &&
      message.room.spectatorCount === 2 && message.room.spectatorQueueSize === 2),
    lateGameOverWatcher.waitType('ROOM_STATE', message =>
      message.room.players.some(player => player.id === firstWatcherWelcome.playerId) &&
      !message.room.players.some(player => player.id === lateGameOverWelcome.playerId) &&
      message.room.spectatorCount === 2 && message.room.spectatorQueueSize === 2),
    firstWatcher.waitType('GAME_STATE', message =>
      message.state.phase === 'rearrange' &&
      message.state.players.some(player => player.id === firstWatcherWelcome.playerId)),
    secondWatcher.waitType('GAME_STATE', message =>
      message.state.phase === 'rearrange' &&
      message.state.players.some(player => player.id === firstWatcherWelcome.playerId)),
    lateGameOverWatcher.waitType('GAME_STATE', message =>
      message.state.phase === 'rearrange' &&
      message.state.players.some(player => player.id === firstWatcherWelcome.playerId)),
    promotionHost.waitType('GAME_STATE', message =>
      message.state.phase === 'rearrange' &&
      message.state.players.some(player => player.id === firstWatcherWelcome.playerId)),
  ])
  assert(promotedRoom.room.players.some(player => player.id === firstWatcherWelcome.playerId))
  assert(!queuedRoom.room.players.some(player => player.id === secondWatcherWelcome.playerId))
  assert(!lateQueuedRoom.room.players.some(player => player.id === lateGameOverWelcome.playerId))
  const promotedSelf = promotedDeal.state.players.find(player => player.id === firstWatcherWelcome.playerId)
  assert(promotedSelf.hand.every(card => !card.id.startsWith('hidden:')), 'promoted watcher did not receive their own hand')
  assertSpectatorState(queuedDeal.state, hostPromotionDeal.state, 'excess queued watcher')
  assertSpectatorState(lateQueuedDeal.state, hostPromotionDeal.state, 'late queued watcher')
  await Promise.all([
    promotionHost.close(), promotionVictim.close(), firstWatcher.close(), secondWatcher.close(),
    lateGameOverWatcher.close(),
  ])
  ok('T12c rematch promotion is FIFO; late game-over joins stay queued and masked')

  // ---- T12d: active join queues a spectator, then a 2P forfeit and
  // late-join host rollover preserve the existing rematch subset behavior.
  const lateRoom = await newRoom()
  const lateUrl = `${wsBase}/api/room/${lateRoom}/ws`
  const oldHost = await new Peer('old-host', lateUrl).connect()
  const surrender = await new Peer('surrender', lateUrl).connect()
  oldHost.send({ type: 'CREATE_ROOM', playerName: 'Old host' })
  const oldHostWelcome = await oldHost.waitType('WELCOME')
  surrender.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'Surrender' })
  const surrenderWelcome = await surrender.waitType('WELCOME')
  await oldHost.waitType('ROOM_STATE', m => m.room.players.length === 2)
  oldHost.send({ type: 'START_GAME' })
  await Promise.all([
    oldHost.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
    surrender.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
  ])

  const activeJoin = await new Peer('active-join', lateUrl).connect()
  activeJoin.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'Too soon' })
  const activeJoinWelcome = await activeJoin.waitType('WELCOME')
  assert.equal(activeJoinWelcome.role, 'spectator')
  const activeJoinView = await activeJoin.waitType('GAME_STATE', message => message.state.phase === 'rearrange')
  assert(activeJoinView.state.players.every(player =>
    [...player.hand, ...player.faceUp, ...player.faceDown]
      .every(card => card.id.startsWith('hidden:spectator:'))
  ))
  activeJoin.send({ type: 'LEAVE_ROOM', version: PROTOCOL_VERSION })
  await oldHost.waitType(
    'ROOM_STATE', message => message.room.spectatorCount === 0 && message.room.spectatorQueueSize === 0,
  )
  await activeJoin.close()

  surrender.send({ type: 'LEAVE_ROOM' })
  const forfeitOver = await oldHost.waitType('GAME_STATE', m => m.state.phase === 'gameOver')
  assert.equal(forfeitOver.state.winnerId, oldHostWelcome.playerId)
  assert.equal(forfeitOver.state.loserId, surrenderWelcome.playerId)

  const lateHost = await new Peer('late-host', lateUrl).connect()
  lateHost.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'New host' })
  const lateHostWelcome = await lateHost.waitType('WELCOME')
  assert.equal(lateHostWelcome.role, 'player', 'open game-over seat must be assigned as a player')
  assert(
    !forfeitOver.state.players.some(player => player.id === lateHostWelcome.playerId),
    'direct game-over seat unexpectedly participated in the finished round',
  )
  const lateHostFinishedView = await lateHost.waitType(
    'GAME_STATE', message => message.state.phase === 'gameOver')
  assertSpectatorState(
    lateHostFinishedView.state,
    forfeitOver.state,
    'direct game-over player before their first deal',
  )
  ok('T12da direct game-over seats receive a spectator-masked finished round despite player role')
  const lateGuest = await new Peer('late-guest', lateUrl).connect()
  lateGuest.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'New guest' })
  const lateGuestWelcome = await lateGuest.waitType('WELCOME')
  await lateHost.waitType('ROOM_STATE', m => m.room.players.length === 3)
  oldHost.send({ type: 'LEAVE_ROOM' })
  const rolled = await lateHost.waitType('ROOM_STATE', m => m.room.hostId === lateHostWelcome.playerId)
  assert.deepEqual(
    new Set(rolled.room.players.map(player => player.id)),
    new Set([lateHostWelcome.playerId, lateGuestWelcome.playerId]),
  )

  const sitter = await new Peer('rematch-no', lateUrl).connect()
  sitter.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'Sits out' })
  const sitterWelcome = await sitter.waitType('WELCOME')
  await lateHost.waitType('ROOM_STATE', m => m.room.players.length === 3)

  const absent = await new Peer('rematch-offline-pending', lateUrl).connect()
  absent.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'Went offline' })
  const absentWelcome = await absent.waitType('WELCOME')
  await lateHost.waitType('ROOM_STATE', m => m.room.players.length === 4)
  await absent.close()
  await lateHost.waitType('ROOM_STATE', m =>
    m.room.players.find(player => player.id === absentWelcome.playerId)?.connected === false)

  lateHost.send({ type: 'START_GAME' })
  const pendingVoteError = await lateHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(pendingVoteError.message, /every online player.*vote/i)

  lateHost.send({ type: 'REMATCH_VOTE', vote: true })
  await lateHost.waitType('ROOM_STATE', m =>
    m.room.rematchVotes?.find(vote => vote.playerId === lateHostWelcome.playerId)?.vote === 'yes')
  lateHost.send({ type: 'REMATCH_VOTE', vote: false })
  const voteThrottle = await lateHost.waitType('ERROR', isError('RATE_LIMITED'))
  assert.match(voteThrottle.message, /wait a moment.*vote/i)
  lateGuest.send({ type: 'REMATCH_VOTE', vote: false })
  sitter.send({ type: 'REMATCH_VOTE', vote: false })
  await lateHost.waitType('ROOM_STATE', m =>
    m.room.rematchVotes?.filter(vote => vote.playerId !== absentWelcome.playerId)
      .every(vote => vote.vote !== 'pending'))
  lateHost.send({ type: 'START_GAME' })
  const tooFewVotes = await lateHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(tooFewVotes.message, /two yes votes|at least two online players or waiting spectators/i)

  await sleep(800)
  lateHost.send({ type: 'REMATCH_VOTE', vote: false })
  lateGuest.send({ type: 'REMATCH_VOTE', vote: true })
  await lateHost.waitType('ROOM_STATE', m =>
    m.room.rematchVotes?.find(vote => vote.playerId === lateHostWelcome.playerId)?.vote === 'no' &&
    m.room.rematchVotes?.find(vote => vote.playerId === lateGuestWelcome.playerId)?.vote === 'yes')
  lateHost.send({ type: 'START_GAME' })
  const hostNoError = await lateHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(hostNoError.message, /host must vote yes/i)

  await sleep(800)
  lateHost.send({ type: 'REMATCH_VOTE', vote: true })
  await lateHost.waitType('ROOM_STATE', m =>
    m.room.rematchVotes?.filter(vote => vote.vote === 'yes').length === 2)
  const sitterLogAtStart = sitter.rawLog.length
  lateHost.send({ type: 'START_GAME' })
  const [lateFreshGame, released, resetVotes] = await Promise.all([
    lateHost.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
    sitter.waitType('ERROR', isError('SESSION_EXPIRED')),
    lateGuest.waitType('ROOM_STATE', m => m.room.players.length === 2 &&
      m.room.rematchVotes?.every(vote => vote.vote === 'pending')),
  ])
  assert.match(released.message, /not to join this rematch/i)
  assert.deepEqual(
    new Set(lateFreshGame.state.players.map(player => player.id)),
    new Set([lateHostWelcome.playerId, lateGuestWelcome.playerId]),
  )
  assert.deepEqual(
    new Set(resetVotes.room.players.map(player => player.id)),
    new Set([lateHostWelcome.playerId, lateGuestWelcome.playerId]),
  )
  assert.equal(lateFreshGame.state.pendingTribute, null)
  await sleep(150)
  assert.equal(sitter.closeCode, 4003, 'released No voter socket was not closed')
  assert(
    !sitter.rawLog.slice(sitterLogAtStart).some(raw => {
      const message = JSON.parse(raw)
      return message.type === 'GAME_STATE' && message.state?.phase === 'rearrange'
    }),
    'a released No voter observed the next deal',
  )

  const releasedResume = await new Peer('released-resume', lateUrl).connect()
  releasedResume.send({
    type: 'RESUME_ROOM', roomCode: lateRoom,
    playerId: sitterWelcome.playerId, resumeToken: sitterWelcome.resumeToken,
  })
  await releasedResume.waitType('RESUME_FAILED', message =>
    message.reason === 'not_a_member' || message.reason === 'invalid_token')
  const absentResume = await new Peer('offline-pending-resume', lateUrl).connect()
  absentResume.send({
    type: 'RESUME_ROOM', roomCode: lateRoom,
    playerId: absentWelcome.playerId, resumeToken: absentWelcome.resumeToken,
  })
  await absentResume.waitType('RESUME_FAILED', message =>
    message.reason === 'not_a_member' || message.reason === 'invalid_token')
  await Promise.all([
    oldHost.close(), surrender.close(), lateHost.close(), lateGuest.close(),
    sitter.close(), releasedResume.close(), absentResume.close(),
  ])
  ok('T12d rematch votes are throttled; No/offline-pending seats are closed and released before a subset deal')

  // ---- T12e: 3P surrender before anyone is out must not invent a winner
  const threeRoom = await newRoom()
  const threeUrl = `${wsBase}/api/room/${threeRoom}/ws`
  const threeHost = await new Peer('three-host', threeUrl).connect()
  const threeB = await new Peer('three-b', threeUrl).connect()
  const threeC = await new Peer('three-c', threeUrl).connect()
  threeHost.send({ type: 'CREATE_ROOM', playerName: 'Three host' })
  await threeHost.waitType('WELCOME')
  threeB.send({ type: 'JOIN_ROOM', code: threeRoom, playerName: 'Three B' })
  await threeB.waitType('WELCOME')
  threeC.send({ type: 'JOIN_ROOM', code: threeRoom, playerName: 'Three C' })
  const threeCWelcome = await threeC.waitType('WELCOME')
  await threeHost.waitType('ROOM_STATE', m => m.room.players.length === 3)
  threeHost.send({ type: 'START_GAME' })
  await Promise.all([
    threeHost.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
    threeB.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
    threeC.waitType('GAME_STATE', m => m.state.phase === 'rearrange'),
  ])
  threeC.send({ type: 'LEAVE_ROOM' })
  const noWinner = await threeHost.waitType('GAME_STATE', m => m.state.phase === 'gameOver')
  assert.equal(noWinner.state.loserId, threeCWelcome.playerId)
  assert.equal(noWinner.state.winnerId, null)
  await Promise.all([threeHost.close(), threeB.close(), threeC.close()])
  ok('T12e a 3P pre-winner surrender records the loser without fabricating first place')

  // ---- T13: per-room socket cap (13th connection rejected)
  const capUrl = `${wsBase}/api/room/CAPCAP/ws`
  const sockets = []
  for (let i = 0; i < 12; i++) sockets.push(await new Peer(`cap-${i}`, capUrl).connect())
  const thirteenth = await new Peer('cap-13', capUrl).connect(true)
  assert.match(String(thirteenth.message), /429/, '13th socket must get HTTP 429')
  await Promise.all(sockets.map(peer => peer.close()))
  ok('T13 per-room socket cap: 12 allowed, 13th rejected with 429')

  // ---- T14: oversize message closes the socket (1009)
  const big = await new Peer('big', wsUrl).connect()
  big.send(JSON.stringify({ type: 'CHAT', text: 'x'.repeat(20 * 1024) }))
  await sleep(500)
  assert.equal(big.closeCode, 1009, 'oversize message must close with 1009')
  ok('T14 message > 16 KiB closes socket with 1009')

  // ---- T15: per-session 20 msg/s rate limit still enforced
  const rapid = await new Peer('rapid', wsUrl).connect()
  for (let i = 0; i < 25; i++) rapid.send({ type: 'PING' })
  const limited = await rapid.waitType('ERROR', isError('RATE_LIMITED'))
  assert(limited)
  await rapid.close()
  ok('T15 per-session 20 msg/s rate limit enforced (RATE_LIMITED)')

  // ---- T16: cross-origin WebSocket upgrade rejected
  const crossOrigin = await new Peer('evil', wsUrl, 'https://evil.example.com').connect(true)
  assert.match(String(crossOrigin.message), /403/, 'cross-origin upgrade must get 403')
  ok('T16 cross-origin WS upgrade rejected with 403')

  // ---- T17: security headers on / and /assets/*; no ACAO *
  const htmlResponse = await fetch(`${baseUrl}/`)
  const expectedHeaders = {
    'content-security-policy': /default-src 'self'.*frame-ancestors 'none'/,
    'x-content-type-options': /nosniff/,
    'referrer-policy': /no-referrer/,
    'permissions-policy': /camera=\(\)/,
    'cross-origin-opener-policy': /same-origin/,
  }
  const checkHeaders = (response, label) => {
    for (const [name, pattern] of Object.entries(expectedHeaders)) {
      assert.match(response.headers.get(name) || '', pattern, `${label} missing ${name}`)
    }
    assert.equal(response.headers.get('x-powered-by'), null, `${label} must not send X-Powered-By`)
  }
  checkHeaders(htmlResponse, 'GET /')
  const html = await htmlResponse.text()
  const assetPath = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]
  const assetResponse = await fetch(`${baseUrl}${assetPath}`)
  assert.equal(assetResponse.status, 200)
  checkHeaders(assetResponse, `GET ${assetPath}`)
  const apiResponse = await fetch(`${baseUrl}/api/version`)
  checkHeaders(apiResponse, 'GET /api/version')
  const evilApi = await fetch(`${baseUrl}/api/version`, { headers: { Origin: 'https://evil.example.com' } })
  assert.equal(evilApi.status, 403, 'API with disallowed Origin must be 403')
  const preflight = await fetch(`${baseUrl}/api/room/new`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } })
  assert.equal(preflight.status, 403, 'preflight with disallowed Origin must be 403')
  const goodPreflight = await fetch(`${baseUrl}/api/room/new`, { method: 'OPTIONS', headers: { Origin: baseUrl } })
  assert.equal(goodPreflight.headers.get('access-control-allow-origin'), baseUrl)
  assert.equal((await fetch(`${baseUrl}/api`)).status, 404, 'exact /api must not receive the SPA shell')
  assert.equal((await fetch(`${baseUrl}/assets`)).status, 404, 'exact /assets must not receive the SPA shell')
  assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404, 'missing assets must not receive the SPA shell')
  ok('T17 security headers on /, /assets/*, /api/*; no ACAO *, bad Origin -> 403')

  // ---- T18: direct CREATE_ROOM without a prior /api/room/new claim is refused
  const noClaim = await new Peer('no-claim', `${wsBase}/api/room/NOCLAM/ws`).connect()
  noClaim.send({ type: 'CREATE_ROOM', playerName: 'Sneaky' })
  await noClaim.waitType('ERROR', m => /not allocated/i.test(m.message))
  await noClaim.close()
  ok('T18 CREATE_ROOM without rate-limited allocation is refused')

  // ---- T19: per-IP room-creation rate limit (10/min)
  let successes = 0
  let rateLimited = false
  for (let i = 0; i < 15 && !rateLimited; i++) {
    const response = await fetch(`${baseUrl}/api/room/new`, { method: 'POST' })
    if (response.status === 200) successes++
    else if (response.status === 429) rateLimited = true
  }
  assert(rateLimited, 'expected 429 after exceeding 10 room creations per minute')
  assert(successes <= 10, `too many rooms allowed: ${successes}`)
  ok(`T19 per-IP room-creation rate limit: ${successes} allowed then 429`)

  await Promise.all([host.close(), guest.close(), noToken.close(), attacker.close(), stale.close()])
  console.log(`\nALL ${passed} ADVERSARIAL CHECKS PASSED`)
}

main().catch(error => {
  console.error('FAIL', error)
  // Open WebSockets would otherwise keep Node alive and hide the actual
  // assertion failure behind a permanently running CI step.
  process.exit(1)
})
