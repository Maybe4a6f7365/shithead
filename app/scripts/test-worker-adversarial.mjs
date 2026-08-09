// Adversarial integration tests for the hardened worker.
// Dev-only: requires `wrangler dev --local --port 8787` (Node 22) running.
// Usage: BASE_URL=http://localhost:8787 node scripts/test-worker-adversarial.mjs
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const baseUrl = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '')
const wsBase = baseUrl.replace(/^http/, 'ws')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const PROTOCOL_VERSION = 5

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
  const guest = await new Peer('guest', wsUrl).connect()

  host.send({ type: 'CREATE_ROOM', playerName: 'Host', version: PROTOCOL_VERSION })
  const hostWelcome = await host.waitType('WELCOME')
  assert.equal(hostWelcome.version, PROTOCOL_VERSION, 'WELCOME must echo protocol version')
  assert.match(hostWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/, 'WELCOME must carry a high-entropy resumeToken')
  const hostId = hostWelcome.playerId
  const hostToken1 = hostWelcome.resumeToken

  guest.send({ type: 'JOIN_ROOM', code: roomId, playerName: 'Guest', version: PROTOCOL_VERSION })
  const guestWelcome = await guest.waitType('WELCOME')
  assert.match(guestWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(guestWelcome.resumeToken, hostToken1, 'tokens must be per-player unique')
  const guestId = guestWelcome.playerId
  ok(`T1 create/join: WELCOME carries version=${PROTOCOL_VERSION} and unique per-player resumeToken`)

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
  assert.equal(host.closeCode, null, 'victim socket must not be closed by a failed hijack')
  host.send({ type: 'PING' })
  await host.waitType('PONG')
  ok('T3 stolen playerId + wrong token -> RESUME_FAILED, victim seat intact')

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
  assert.notEqual(resumed.resumeToken, hostToken1, 'resume must rotate the token')
  const hostToken2 = resumed.resumeToken
  const stale = await new Peer('stale-token', wsUrl).connect()
  stale.send({
    type: 'RESUME_ROOM', roomCode: roomId, playerId: hostId,
    resumeToken: hostToken1, version: PROTOCOL_VERSION,
  })
  await stale.waitType('RESUME_FAILED')
  ok('T4 resume rotates token; old (rotated-out) token is rejected')

  // ---- T5: unknown room -> RESUME_FAILED room_not_found
  const stranger = await new Peer('stranger', `${wsBase}/api/room/ZZZZZ9/ws`).connect()
  stranger.send({
    type: 'RESUME_ROOM', roomCode: 'ZZZZZ9', playerId: hostId,
    resumeToken: hostToken2, version: PROTOCOL_VERSION,
  })
  const fail3 = await stranger.waitType('RESUME_FAILED')
  assert.equal(fail3.reason, 'room_not_found')
  await stranger.close()
  ok('T5 RESUME in a nonexistent room -> RESUME_FAILED room_not_found')

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

  // Rejected/unauthenticated sockets remain physically connected, but must
  // never become passive spectators of room, chat, or game broadcasts.
  const unauthenticated = [noToken, attacker, stale]
  const unauthLogStarts = new Map(unauthenticated.map(peer => [peer, peer.rawLog.length]))
  host.send({ type: 'CHAT', text: 'authenticated-only' })
  await guest.waitType('CHAT', message => message.text === 'authenticated-only')

  host.send({ type: 'EMOTE', emote: '<script>' })
  await host.waitType('ERROR', message => /invalid message/i.test(message.message))
  attacker.send({ type: 'EMOTE', emote: 'fire' })
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
  ok('T7a EMOTE is strict, server-timestamped, authenticated, and contains no state')

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
      .filter(type => ['ROOM_STATE', 'CHAT', 'EMOTE', 'GAME_STATE'].includes(type))
    assert.deepEqual(broadcastTypes, [], `${peer.label} received authenticated room traffic`)
  }
  ok('T8a rejected and unauthenticated sockets receive no room/chat/emote/game broadcasts')

  host.send({ type: 'SET_RULES', rules: { includeJokers: true } })
  await host.waitType('ERROR', isError('GAME_IN_PROGRESS'))
  host.send({ type: 'START_GAME' })
  await host.waitType('ERROR', isError('GAME_IN_PROGRESS'))
  host.send({ type: 'PING' })
  await host.waitType('PONG')
  ok('T8b active-round rules and duplicate START are nonfatal GAME_IN_PROGRESS errors')

  // The preceding security checks intentionally send close to the production
  // 20 msg/s cap. Let that rolling window expire so T8c observes BURN_IN
  // validation rather than an unrelated RATE_LIMITED response.
  await sleep(1_050)
  host.send({ type: 'READY' })
  guest.send({ type: 'READY' })
  const hostPlay = await host.waitType('GAME_STATE', m => m.state.phase === 'play')
  await guest.waitType('GAME_STATE', m => m.state.phase === 'play')
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
  attacker.send({ type: 'BURN_IN', cards: [{ id: idleHandForBurn[0].id }] })
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
  attacker.send({
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
  ok('T11b authoritative autoplay reaches a terminal round and records the Shithead')

  // A natural first-out winner enables the optional next-round tribute. A
  // legitimate stalemate records only the loser; it must not invent a winner
  // merely so this integration test can enter the tribute branch. The engine
  // suite covers both one-shot outcomes (swap and skip) deterministically.
  if (round1.winnerId && round1.winnerId !== round1.loserId) {
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
    ok('T11c tribute is winner-only; an authorized face-up swap recomputes the opener')
  } else {
    assert.equal(round1.winnerId, null)
    ok('T11c a stalemate records the Shithead without inventing a winner')
  }

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

  // ---- T12b: offline seats block a fresh start
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
  await offlineHost.waitType('ROOM_STATE', m => m.room.players.some(p => p.id === offlineGuestWelcome.playerId && !p.connected))
  offlineHost.send({ type: 'START_GAME' })
  const offlineStartError = await offlineHost.waitType('ERROR', isError('INVALID_MOVE'))
  assert.match(offlineStartError.message, /online/i)
  await offlineHost.close()
  ok('T12b an offline roster seat blocks start/rematch')

  // ---- T12c: active join refusal, 2P forfeit, then late-join host rollover
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
  await activeJoin.waitType('ERROR', isError('GAME_IN_PROGRESS'))
  await activeJoin.close()

  surrender.send({ type: 'LEAVE_ROOM' })
  const forfeitOver = await oldHost.waitType('GAME_STATE', m => m.state.phase === 'gameOver')
  assert.equal(forfeitOver.state.winnerId, oldHostWelcome.playerId)
  assert.equal(forfeitOver.state.loserId, surrenderWelcome.playerId)

  const lateHost = await new Peer('late-host', lateUrl).connect()
  lateHost.send({ type: 'JOIN_ROOM', code: lateRoom, playerName: 'New host' })
  const lateHostWelcome = await lateHost.waitType('WELCOME')
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
  lateHost.send({ type: 'START_GAME' })
  const lateFreshGame = await lateHost.waitType('GAME_STATE', m => m.state.phase === 'rearrange')
  assert.deepEqual(
    new Set(lateFreshGame.state.players.map(player => player.id)),
    new Set([lateHostWelcome.playerId, lateGuestWelcome.playerId]),
  )
  assert.equal(lateFreshGame.state.pendingTribute, null)
  await Promise.all([oldHost.close(), surrender.close(), lateHost.close(), lateGuest.close()])
  ok('T12c join is gameOver-only; late joiners inherit host and start with the current roster')

  // ---- T12d: 3P surrender before anyone is out must not invent a winner
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
  ok('T12d a 3P pre-winner surrender records the loser without fabricating first place')

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
