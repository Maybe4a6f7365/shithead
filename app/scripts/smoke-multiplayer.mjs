import assert from 'node:assert/strict'
import WebSocket from 'ws'

const baseUrl = (process.env.BASE_URL || 'https://shithead.not4a6f7365.workers.dev').replace(/\/$/, '')
const expectedCommit = process.env.EXPECTED_COMMIT || ''
const deploymentTimeoutMs = Number(process.env.DEPLOYMENT_TIMEOUT_MS || 10 * 60 * 1000)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => console.log(`[multiplayer-smoke] ${message}`)

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  })
  return response
}

async function waitForDeployment() {
  const deadline = Date.now() + deploymentTimeoutMs
  let last = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await request(`/api/version?cache=${Date.now()}`, { cache: 'no-store' })
      const text = await response.text()
      last = `${response.status} ${text.slice(0, 200)}`
      if (response.ok) {
        const version = JSON.parse(text)
        if (!expectedCommit || version.commit === expectedCommit) {
          assert.equal(version.service, 'shithead-multiplayer')
          assert.equal(version.protocol, 2)
          log(`deployed commit ${version.commit}`)
          return version
        }
        last = `waiting for ${expectedCommit}; active commit is ${version.commit}`
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }

    log(last)
    await sleep(5_000)
  }

  throw new Error(`Production deployment did not become ready: ${last}`)
}

class Peer {
  constructor(label, url) {
    this.label = label
    this.url = url
    this.socket = null
    this.messages = []
    this.waiters = []
    this.latestGameState = null
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url, {
        origin: baseUrl,
        handshakeTimeout: 15_000,
      })
      this.socket = socket

      const timer = setTimeout(() => reject(new Error(`${this.label} WebSocket open timed out`)), 20_000)
      socket.once('open', () => {
        clearTimeout(timer)
        log(`${this.label} connected`)
        resolve()
      })
      socket.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      socket.on('message', raw => this.onMessage(raw))
      socket.on('close', (code, reason) => {
        log(`${this.label} closed (${code}${reason.length ? `: ${reason.toString()}` : ''})`)
      })
    })
    return this
  }

  onMessage(raw) {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

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
    assert(this.socket && this.socket.readyState === WebSocket.OPEN, `${this.label} is not connected`)
    this.socket.send(JSON.stringify(message))
  }

  waitFor(predicate, description, timeoutMs = 20_000) {
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
    return this.waitFor(
      message => message.type === type && predicate(message),
      `${type}`,
      timeoutMs,
    )
  }

  async close() {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2_000)
      this.socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      this.socket.close(1000, 'smoke test')
    })
  }
}

function connected(room, playerId) {
  return room.players.find(player => player.id === playerId)?.connected
}

// Static-asset / UI-freshness assertions. This is the blind spot that let a
// frozen (stale) UI bundle and a missing service worker ship while the
// protocol tests below stayed green.
async function verifyStaticAssets() {
  const htmlResponse = await request('/', {
    cache: 'no-store',
    headers: { Accept: 'text/html' },
  })
  assert.equal(htmlResponse.status, 200, 'GET / did not return 200')
  const html = await htmlResponse.text()

  // 1. UI freshness: the deployed HTML must carry the build commit stamped by
  //    scripts/write-build-meta.mjs, and it must match the commit under test.
  const commitMeta = html.match(/<meta name="build-commit" content="([^"]+)"/)
  assert(commitMeta, 'index.html is missing the build-commit meta tag (stale artifact?)')
  if (expectedCommit) {
    assert.equal(
      commitMeta[1],
      expectedCommit,
      `deployed UI is stale: HTML was built from ${commitMeta[1]}, expected ${expectedCommit}`,
    )
  }

  // 2. The HTML must reference a freshly built hashed bundle that serves 200
  //    and contains a marker string from the current client source.
  const scriptMatch = html.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)
  assert(scriptMatch, 'index.html does not reference a hashed /assets/index-*.js bundle')
  const bundleResponse = await request(scriptMatch[1], { headers: { Accept: '*/*' } })
  assert.equal(bundleResponse.status, 200, `${scriptMatch[1]} did not return 200`)
  const bundle = await bundleResponse.text()
  assert(
    bundle.includes('CREATE_ROOM'),
    'deployed bundle is missing the CREATE_ROOM source marker — the UI is stale',
  )
  log(`UI bundle ${scriptMatch[1]} is fresh (build commit ${commitMeta[1]})`)

  // 3. The service worker must serve as JavaScript (not the HTML fallback).
  const swResponse = await request('/sw.js', { headers: { Accept: '*/*' } })
  assert.equal(swResponse.status, 200, '/sw.js did not return 200')
  assert.match(
    swResponse.headers.get('content-type') || '',
    /javascript/,
    '/sw.js is not served with a JavaScript content-type',
  )
  log('service worker /sw.js is served')

  // 4. Every icon referenced by the web app manifest must exist.
  const manifestResponse = await request('/manifest.webmanifest', { cache: 'no-store' })
  assert.equal(manifestResponse.status, 200, '/manifest.webmanifest did not return 200')
  const manifest = await manifestResponse.json()
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest has no icons')
  for (const icon of manifest.icons) {
    const iconPath = `/${String(icon.src).replace(/^\//, '')}`
    const iconResponse = await request(iconPath, { headers: { Accept: 'image/*' } })
    assert.equal(iconResponse.status, 200, `manifest icon ${iconPath} did not return 200`)
    assert.match(
      iconResponse.headers.get('content-type') || '',
      /^image\//,
      `manifest icon ${iconPath} is not served as an image`,
    )
  }
  log(`all ${manifest.icons.length} manifest icons are served`)
}

async function run() {
  await waitForDeployment()
  await verifyStaticAssets()

  const health = await request('/api/health', { cache: 'no-store' })
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'OK')

  const createResponse = await request('/api/room/new', { method: 'POST' })
  assert.equal(createResponse.status, 200)
  const { roomId } = await createResponse.json()
  assert.match(roomId, /^[A-Z0-9]{6}$/)
  log(`allocated room ${roomId}`)

  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/api/room/${roomId}/ws`
  let host = await new Peer('host', wsUrl).connect()
  const guest = await new Peer('guest', wsUrl).connect()

  host.send({ type: 'CREATE_ROOM', playerName: 'Smoke Host' })
  const hostWelcome = await host.waitType('WELCOME')
  assert.equal(hostWelcome.room.code, roomId)
  assert.equal(hostWelcome.room.hostId, hostWelcome.playerId)
  const hostId = hostWelcome.playerId

  guest.send({ type: 'JOIN_ROOM', code: roomId, playerName: 'Smoke Guest' })
  const guestWelcome = await guest.waitType('WELCOME')
  const guestId = guestWelcome.playerId
  assert.notEqual(guestId, hostId)

  const twoPlayers = await host.waitType('ROOM_STATE', message => message.room.players.length === 2)
  assert.equal(connected(twoPlayers.room, hostId), true)
  assert.equal(connected(twoPlayers.room, guestId), true)
  log('create and join synchronized')

  await host.close()
  const hostOffline = await guest.waitType('ROOM_STATE', message => connected(message.room, hostId) === false)
  assert.equal(connected(hostOffline.room, guestId), true)

  host = await new Peer('host-resumed', wsUrl).connect()
  assert(hostWelcome.resumeToken, 'WELCOME is missing the secret resumeToken')
  host.send({ type: 'RESUME_ROOM', playerId: hostId, resumeToken: hostWelcome.resumeToken })
  const resumedWelcome = await host.waitType('WELCOME')
  assert.equal(resumedWelcome.playerId, hostId)
  assert(resumedWelcome.resumeToken, 'resume did not rotate the resumeToken')
  const hostOnline = await guest.waitType('ROOM_STATE', message => connected(message.room, hostId) === true)
  assert.equal(hostOnline.room.hostId, hostId)
  log('host session resumed without duplicating the player')

  host.send({ type: 'START_GAME' })
  const hostRearrange = await host.waitType('GAME_STATE', message => message.state.phase === 'rearrange')
  const guestRearrange = await guest.waitType('GAME_STATE', message => message.state.phase === 'rearrange')
  assert.equal(hostRearrange.state.players.length, 2)
  assert.equal(guestRearrange.state.players.length, 2)

  const guestViewOfHost = guestRearrange.state.players.find(player => player.id === hostId)
  assert(guestViewOfHost)
  assert(guestViewOfHost.hand.every(card => card.rank === '3' && card.suit === null), 'opponent hand leaked')
  assert(guestRearrange.state.players.every(player => player.faceDown.every(card => card.rank === '3' && card.suit === null)), 'face-down card leaked')

  host.send({ type: 'READY' })
  guest.send({ type: 'READY' })
  const hostPlay = await host.waitType('GAME_STATE', message => message.state.phase === 'play')
  const guestPlay = await guest.waitType('GAME_STATE', message => message.state.phase === 'play')
  assert.equal(hostPlay.state.turnCount, 0)
  assert.equal(guestPlay.state.turnCount, 0)
  log('both players entered synchronized play state')

  guest.send({ type: 'CHAT', text: 'multiplayer smoke' })
  const chat = await host.waitType('CHAT', message => message.playerId === guestId)
  assert.equal(chat.text, 'multiplayer smoke')

  host.send({ type: 'PING' })
  const pong = await host.waitType('PONG')
  assert.equal(typeof pong.ts, 'number')

  const currentState = host.latestGameState
  assert(currentState)
  const currentId = currentState.players[currentState.currentPlayerIdx].id
  const currentPeer = currentId === hostId ? host : guest
  const previousTurn = currentPeer.latestGameState.turnCount
  const myId = currentId
  const myState = currentPeer.latestGameState
  const me = myState.players.find(player => player.id === myId)
  assert(me && me.hand.length > 0, 'current player has no hand cards to play')
  // avoid a 10: burning keeps the lead with the same player and would break the turn-advance assertion below
  const candidate = me.hand.find(card => card.rank !== '10') ?? me.hand[0]
  currentPeer.send({ type: 'PLAY', cards: [candidate] })

  const hostAdvanced = await host.waitType('GAME_STATE', message => message.state.turnCount > previousTurn)
  const guestAdvanced = await guest.waitType('GAME_STATE', message => message.state.turnCount > previousTurn)
  assert.equal(hostAdvanced.state.turnCount, guestAdvanced.state.turnCount)
  assert.notEqual(hostAdvanced.state.currentPlayerIdx, currentState.currentPlayerIdx)
  log('game mutation propagated to both players')

  await Promise.all([host.close(), guest.close()])
  log('PASS: production multiplayer create/join/resume/start/chat/move flow works')
}

run().catch(error => {
  console.error('[multiplayer-smoke] FAIL', error)
  process.exitCode = 1
})
