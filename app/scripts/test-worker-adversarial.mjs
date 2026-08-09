// Adversarial integration tests for the hardened worker.
// Dev-only: requires `wrangler dev --local --port 8787` (Node 22) running.
// Usage: BASE_URL=http://localhost:8787 node scripts/test-worker-adversarial.mjs
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const baseUrl = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/$/, '')
const wsBase = baseUrl.replace(/^http/, 'ws')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

async function main() {
  // ---- T1: create/join happy path, WELCOME carries version + secret token
  const roomId = await newRoom()
  const wsUrl = `${wsBase}/api/room/${roomId}/ws`
  let host = await new Peer('host', wsUrl).connect()
  const guest = await new Peer('guest', wsUrl).connect()

  host.send({ type: 'CREATE_ROOM', playerName: 'Host', version: 2 })
  const hostWelcome = await host.waitType('WELCOME')
  assert.equal(hostWelcome.version, 2, 'WELCOME must echo protocol version')
  assert.match(hostWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/, 'WELCOME must carry a high-entropy resumeToken')
  const hostId = hostWelcome.playerId
  const hostToken1 = hostWelcome.resumeToken

  guest.send({ type: 'JOIN_ROOM', code: roomId, playerName: 'Guest', version: 2 })
  const guestWelcome = await guest.waitType('WELCOME')
  assert.match(guestWelcome.resumeToken, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(guestWelcome.resumeToken, hostToken1, 'tokens must be per-player unique')
  const guestId = guestWelcome.playerId
  ok('T1 create/join: WELCOME carries version=2 and unique per-player resumeToken')

  // Token must never leak into broadcasts seen by the other player.
  await host.waitType('ROOM_STATE', m => m.room.players.length === 2)
  await sleep(200)
  assert(!guest.rawLog.some(raw => raw.includes(hostToken1)), 'host token leaked to guest')
  assert(!host.rawLog.some(raw => raw.includes(guestWelcome.resumeToken)), 'guest token leaked to host')
  ok('T1b resumeToken never appears in other players\' messages')

  // ---- T2: RESUME without a token -> RESUME_FAILED, seat untouched
  const noToken = await new Peer('no-token', wsUrl).connect()
  noToken.send({ type: 'RESUME_ROOM', playerId: hostId, version: 2 })
  const fail1 = await noToken.waitType('RESUME_FAILED')
  assert.equal(fail1.reason, 'invalid_token')
  ok('T2 RESUME with playerId but NO token -> RESUME_FAILED')

  // ---- T3: stolen playerId + wrong token -> RESUME_FAILED, victim not kicked
  const attacker = await new Peer('attacker', wsUrl).connect()
  attacker.send({ type: 'RESUME_ROOM', playerId: hostId, resumeToken: 'A'.repeat(43), version: 2 })
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
  host.send({ type: 'RESUME_ROOM', playerId: hostId, resumeToken: hostToken1, version: 2 })
  const resumed = await host.waitType('WELCOME')
  assert.equal(resumed.playerId, hostId)
  assert.equal(resumed.version, 2)
  assert.notEqual(resumed.resumeToken, hostToken1, 'resume must rotate the token')
  const hostToken2 = resumed.resumeToken
  const stale = await new Peer('stale-token', wsUrl).connect()
  stale.send({ type: 'RESUME_ROOM', playerId: hostId, resumeToken: hostToken1, version: 2 })
  await stale.waitType('RESUME_FAILED')
  ok('T4 resume rotates token; old (rotated-out) token is rejected')

  // ---- T5: unknown room -> RESUME_FAILED room_not_found
  const stranger = await new Peer('stranger', `${wsBase}/api/room/ZZZZZ9/ws`).connect()
  stranger.send({ type: 'RESUME_ROOM', playerId: hostId, resumeToken: hostToken2, version: 2 })
  const fail3 = await stranger.waitType('RESUME_FAILED')
  assert.equal(fail3.reason, 'room_not_found')
  await stranger.close()
  ok('T5 RESUME in a nonexistent room -> RESUME_FAILED room_not_found')

  // ---- T6: protocol version mismatch gets a clean error
  host.send({ type: 'PING', version: 1 })
  const versionError = await host.waitType('ERROR', m => /protocol version/i.test(m.message))
  assert(versionError, 'expected protocol-version error')
  host.send({ type: 'PING', version: 2 })
  await host.waitType('PONG')
  ok('T6 client message with version != 2 rejected with clean error')

  // ---- T7: malformed message rejected
  host.send('this is not json{')
  await host.waitType('ERROR', m => /invalid message/i.test(m.message))
  ok('T7 malformed payload -> ERROR, connection stays open')

  // ---- T8: start game; per-viewer masking in GAME_STATE
  host.send({ type: 'START_GAME' })
  await host.waitType('GAME_STATE', m => m.state.phase === 'rearrange')
  const guestRearrange = await guest.waitType('GAME_STATE', m => m.state.phase === 'rearrange')
  assert.equal(guestRearrange.version, 2, 'GAME_STATE must echo protocol version')
  assert.equal(typeof guestRearrange.state.seq, 'number', 'GAME_STATE must carry seq')
  const guestViewOfHost = guestRearrange.state.players.find(p => p.id === hostId)
  assert(guestViewOfHost.hand.every(c => c.rank === '3' && c.suit === null && c.id.startsWith('hidden:')), 'opponent hand must be masked')
  assert(guestRearrange.state.stock.every(c => c.suit === null && c.id.startsWith('hidden:stock:')), 'stock must be masked')
  const guestOwn = guestRearrange.state.players.find(p => p.id === guestId)
  // NB: Jokers legitimately have suit null — only the id distinguishes masked cards.
  assert(guestOwn.hand.every(c => !c.id.startsWith('hidden:')), 'own hand must be real')
  ok('T8 GAME_STATE is per-viewer: stock + opponent hand masked, own hand real')

  host.send({ type: 'READY' })
  guest.send({ type: 'READY' })
  const hostPlay = await host.waitType('GAME_STATE', m => m.state.phase === 'play')
  await guest.waitType('GAME_STATE', m => m.state.phase === 'play')
  const playState = hostPlay.state
  const currentId = playState.players[playState.currentPlayerIdx].id
  const [current, idle] = currentId === hostId ? [host, guest] : [guest, host]
  const currentPeerId = currentId === hostId ? hostId : guestId

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

  // ---- T12: LEAVE destroys the resume token
  const room2 = await newRoom()
  const ws2 = `${wsBase}/api/room/${room2}/ws`
  const leaver = await new Peer('leaver', ws2).connect()
  leaver.send({ type: 'CREATE_ROOM', playerName: 'Leaver' })
  const leaverWelcome = await leaver.waitType('WELCOME')
  leaver.send({ type: 'LEAVE_ROOM' })
  await sleep(300)
  const reResume = await new Peer('re-resume', ws2).connect()
  reResume.send({ type: 'RESUME_ROOM', playerId: leaverWelcome.playerId, resumeToken: leaverWelcome.resumeToken })
  const leaveFail = await reResume.waitType('RESUME_FAILED')
  assert(['invalid_token', 'not_a_member', 'room_not_found'].includes(leaveFail.reason))
  await leaver.close()
  await reResume.close()
  ok('T12 explicit LEAVE_ROOM destroys the resume token')

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
  process.exitCode = 1
})
