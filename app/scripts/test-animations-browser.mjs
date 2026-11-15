// ============================================================================
// Browser tests for the table animations. jsdom has no layout and runs no
// animations, so these sequencing bugs are invisible to the vitest suite:
//   - a hand/tableau slide must play once, not again on every later render
//   - a burn caused by a blind flip must never play over a pile that moved on
//   - a failed blind flip must not fill the hand before the card has turned
//   - no playable highlights or turn ripple while an opponent's flip is hidden
//   - the pile must never look empty while a card is flying to it
//   - a card that burns the pile flies there first; no empty slot in between
//   - the play that ends the round is shown before the round-over card
//   - after a resize or rotation, a flight still starts from the seat
//   - the pile, final row and hand sit in the same place on and off the turn
//
// Starts a Vite dev server, drives the single-player store in headless
// Chromium and samples the DOM every frame. Needs Playwright with Chromium
// (not a project dependency):  npm run test:browser
// ============================================================================
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
let chromium
try {
  ({ chromium } = require('playwright'))
} catch {
  console.error('Playwright is not installed. Install it (npm i -D playwright && npx playwright install chromium) to run the browser tests.')
  process.exit(2)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } })
await server.listen()
const address = server.httpServer.address()
const url = `http://127.0.0.1:${address.port}/`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))

await page.goto(url)
await page.getByText(/Play Offline/i).first().click()
await page.evaluate(async () => {
  const { useSPGame } = await import('/src/sp/SPSinglePlayer.ts')
  const engine = await import('/src/engine/index.ts')
  const card = (rank, suit = '♠') => ({
    id: `t${Math.random().toString(36).slice(2)}`,
    rank,
    suit: rank === 'JOKER' ? null : suit,
  })
  const cards = ranks => (ranks ?? []).map(rank => card(rank))
  // One table stays mounted for the whole run, and it remembers which actions
  // it has already animated by sequence number: never reuse one across cases.
  let nextSeq = 1000
  window.T = {
    store: useSPGame,
    /** Deal a two-human table (no AI ticking) in the given position. */
    craft(spec) {
      useSPGame.getState().initGame([{ name: 'Me', isAI: false }, { name: 'Opp', isAI: false }])
      for (const player of useSPGame.getState().state.players) useSPGame.getState().endRearrange(player.id)
      const state = structuredClone(useSPGame.getState().state)
      const [me, opp] = state.players
      Object.assign(me, { hand: cards(spec.me.hand), faceUp: cards(spec.me.faceUp), faceDown: cards(spec.me.faceDown), isOut: false })
      Object.assign(opp, { hand: cards(spec.opp.hand), faceUp: cards(spec.opp.faceUp), faceDown: cards(spec.opp.faceDown), isOut: false })
      state.pile = (spec.pile ?? []).map(rank => ({ cards: cards([rank]), cleared: false }))
      state.stock = cards(Array.from({ length: spec.stock ?? 0 }, () => '4'))
      state.currentPlayerIdx = spec.turn === 'opp' ? 1 : 0
      state.phase = state.stock.length === 0 ? 'endgame' : 'play'
      state.pendingQuickFollowUp = null
      state.seq = (nextSeq += 100)
      useSPGame.setState({ state, meId: me.id, revealedId: null, lastError: null })
    },
    play(seat, zone, count = 1) {
      const store = useSPGame.getState()
      const player = store.state.players[seat]
      store.playCards(player.id, player[zone].slice(0, count))
    },
    /** Where the fixed parts of the table sit (top edges, px). */
    layout() {
      const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top)
      return { pile: top('.pile-card--waste'), finalRow: top('.tableau-well'), hand: top('.hand-fan'), bar: document.querySelector('.action-bar')?.dataset.mode ?? null }
    },
    /** Force a table re-render that changes no card. */
    rerender(tag) { useSPGame.setState({ lastError: `probe ${tag}` }) },
    moving(selector) {
      return document.getAnimations().filter(animation => animation.effect?.target?.matches?.(selector)).length
    },
    frame() {
      const pile = document.querySelector('.pile-card--waste')
      const hand = [...document.querySelectorAll('.hand-fan__card .card')]
      const pileRect = pile.getBoundingClientRect()
      const opacityOf = el => {
        let opacity = 1
        for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= parseFloat(getComputedStyle(node).opacity)
        return opacity
      }
      const offPile = el => {
        const rect = el.getBoundingClientRect()
        return Math.hypot(rect.left - pileRect.left, rect.top - pileRect.top)
      }
      const entry = pile.querySelector('.waste-pile__entry .card')
      return {
        // Cards a player can actually see resting on the pile slot.
        onPile: [...pile.querySelectorAll('.card')].filter(el => opacityOf(el) > 0.5 && offPile(el) < 24).length,
        slot: Boolean(pile.querySelector('.pile-slot--waste')),
        entryRank: entry?.getAttribute('aria-label')?.split(' ')[0] ?? null,
        entryDistance: entry ? Math.round(offPile(entry)) : null,
        overlay: Boolean(document.querySelector('.game-over-card')),
        entryCenter: entry ? (r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(entry.getBoundingClientRect()) : null,
        entryOpacity: entry ? opacityOf(entry) : 0,
        blind: Boolean(pile?.querySelector('.blind-reveal')),
        burning: Boolean(pile?.querySelector('.waste-pile__burn-stack')),
        realTop: engine.getTopCard(useSPGame.getState().state)?.rank ?? null,
        hand: hand.length,
        playable: hand.filter(el => el.dataset.state === 'playable' || el.dataset.state === 'joinable').length,
        ripple: document.getAnimations().filter(animation =>
          animation.effect?.target?.classList?.contains('card') &&
          animation.effect.getKeyframes()[0]?.translate).length,
      }
    },
    /** Sample frame() every animation frame for `ms`, running `act` just after the start. */
    record(ms, act) {
      return new Promise(resolve => {
        const frames = []
        const start = performance.now()
        const tick = () => {
          const t = Math.round(performance.now() - start)
          frames.push({ t, ...window.T.frame() })
          if (t < ms) requestAnimationFrame(tick)
          else resolve(frames)
        }
        requestAnimationFrame(tick)
        setTimeout(act, 50)
      })
    },
  }
})

const results = []
async function test(name, body) {
  try {
    await body()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
const settle = ms => page.waitForTimeout(ms)
const filler = { hand: ['4', '4'], faceUp: [], faceDown: [] }

console.log('Table animations (Chromium)')

await test('hand: closing a gap slides once and never replays on later renders', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['5', '6', '9', 'J', 'K'], faceUp: ['4', '4', '4'], faceDown: ['4', '4', '4'] }, opp: { hand: ['4', '4'] }, pile: ['4'] }))
  await settle(600)
  await page.evaluate(() => T.play(0, 'hand'))
  await settle(30)
  const during = await page.evaluate(() => T.moving('.hand-fan__card'))
  assert(during > 0, 'expected the remaining cards to slide when the gap closes')
  await settle(700)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(tag => T.rerender(tag), i)
    await settle(40)
    const replayed = await page.evaluate(() => T.moving('.hand-fan__card'))
    assert(replayed === 0, `re-render ${i + 1} restarted ${replayed} hand animation(s)`)
    await settle(300)
  }
})

await test('hand: a drawn card flies in once and never replays', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['9', 'J', 'K'], faceUp: ['4', '4', '4'], faceDown: ['4', '4', '4'] }, opp: { hand: ['4', '4'] }, pile: ['4'], stock: 6 }))
  await settle(600)
  await page.evaluate(() => T.play(0, 'hand'))
  await settle(1000)
  await page.evaluate(() => T.rerender('draw'))
  await settle(40)
  const replayed = await page.evaluate(() => T.moving('.hand-fan__card'))
  assert(replayed === 0, `re-render restarted ${replayed} hand animation(s) after a draw`)
})

await test('hand: a re-render in the middle of a slide does not restart it', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['5', '6', '9', 'J', 'K'], faceUp: [], faceDown: [] }, opp: { hand: ['4', '4'] }, pile: ['4'] }))
  await settle(600)
  await page.evaluate(() => T.play(0, 'hand'))
  await settle(80)
  await page.evaluate(() => T.rerender('mid'))
  await settle(400)
  await page.evaluate(() => T.rerender('after'))
  await settle(40)
  const replayed = await page.evaluate(() => T.moving('.hand-fan__card'))
  assert(replayed === 0, `${replayed} hand animation(s) running after the slide had finished`)
})

await test('tableau: closing a gap glides once and never replays on later renders', async () => {
  await page.evaluate(() => T.craft({ me: { hand: [], faceUp: ['9', 'J', 'K'], faceDown: ['4', '4', '4'] }, opp: { hand: ['4', '4'] }, pile: ['4'] }))
  await settle(600)
  await page.evaluate(() => T.play(0, 'faceUp'))
  await settle(900)
  for (let i = 0; i < 2; i++) {
    await page.evaluate(tag => T.rerender(`tableau ${tag}`), i)
    await settle(40)
    const replayed = await page.evaluate(() => T.moving('.tableau-well [data-card-id]'))
    assert(replayed === 0, `re-render ${i + 1} restarted ${replayed} tableau animation(s)`)
    await settle(350)
  }
})

await test('burn: a blind-flip burn never plays over a pile that has moved on', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['4', '4', '4'] }, opp: { faceDown: ['10', 'K', 'Q'] }, pile: ['5', '6'], turn: 'opp' }))
  await settle(300)
  // The 10 burns and the same player flips again before the first reveal ends.
  const frames = await page.evaluate(() => T.record(3200, () => {
    T.play(1, 'faceDown')
    setTimeout(() => T.play(1, 'faceDown'), 900)
  }))
  const wrong = frames.find(frame => frame.burning && frame.realTop !== null)
  assert(!wrong, `burn animation at ${wrong?.t}ms while the real pile top was ${wrong?.realTop}`)
})

await test('burn: a blind-flip burn still plays when nothing interrupts it', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['4', '4', '4'] }, opp: { faceDown: ['10', 'K', 'Q'] }, pile: ['5', '6'], turn: 'opp' }))
  await settle(300)
  const frames = await page.evaluate(() => T.record(2000, () => T.play(1, 'faceDown')))
  const firstBurn = frames.find(frame => frame.burning)
  const lastBlind = frames.filter(frame => frame.blind).pop()
  assert(firstBurn, 'the burn never played')
  assert(lastBlind && firstBurn.t >= lastBlind.t, 'the burn started before the flip had finished')
})

await test('blind flip: a failed flip does not fill the hand before the reveal ends', async () => {
  await page.evaluate(() => T.craft({ me: { hand: [], faceUp: [], faceDown: ['4', '5', '6'] }, opp: { hand: ['4', '4'] }, pile: ['9', 'Q', 'K'] }))
  await settle(300)
  const frames = await page.evaluate(() => T.record(1900, () => T.play(0, 'faceDown')))
  assert(frames.some(frame => frame.blind), 'the blind reveal never rendered')
  const spoiled = frames.find(frame => frame.blind && frame.hand > 0)
  assert(!spoiled, `hand showed ${spoiled?.hand} card(s) at ${spoiled?.t}ms, during the reveal`)
  assert(frames[frames.length - 1].hand === 4, `expected 4 cards in hand after the reveal, saw ${frames[frames.length - 1].hand}`)
})

await test('blind flip: no highlights or turn ripple until an opponent\'s flip is shown', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['A', 'A', '2'] }, opp: { faceDown: ['K', 'Q'] }, pile: ['5'], turn: 'opp' }))
  await settle(300)
  const frames = await page.evaluate(() => T.record(1700, () => T.play(1, 'faceDown')))
  const reveal = frames.filter(frame => frame.blind)
  assert(reveal.length > 0, 'the blind reveal never rendered')
  const early = reveal.find(frame => frame.playable > 0 || frame.ripple > 0)
  assert(!early, `at ${early?.t}ms, during the reveal: ${early?.playable} playable card(s), ${early?.ripple} ripple animation(s)`)
  const after = frames.filter(frame => !frame.blind && frame.t > reveal[reveal.length - 1].t)
  assert(after.some(frame => frame.playable === 3), 'playable highlights never appeared after the reveal')
  assert(after.some(frame => frame.ripple > 0), 'the turn ripple never ran after the reveal')
})

await test('pile: never looks empty while a card flies to it', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['9', 'J', 'K'], faceUp: ['4', '4', '4'], faceDown: ['4', '4', '4'] }, opp: { hand: ['4', '4'] }, pile: ['5'] }))
  await settle(600)
  const single = await page.evaluate(() => T.record(800, () => T.play(0, 'hand')))
  const bare = single.find(frame => frame.onPile === 0)
  assert(!bare, `single play: nothing on the pile at ${bare?.t}ms`)
  assert(single.some(frame => frame.entryDistance > 60), 'single play: the card never flew in from the hand')

  await page.evaluate(() => T.craft({ me: { hand: ['9', '9', '9', 'K'], faceUp: [], faceDown: [] }, opp: { hand: ['4', '4'] }, pile: ['5'] }))
  await settle(600)
  const triple = await page.evaluate(() => T.record(1000, () => T.play(0, 'hand', 3)))
  const bareTriple = triple.find(frame => frame.onPile === 0)
  assert(!bareTriple, `triple play: nothing on the pile at ${bareTriple?.t}ms`)
  assert(triple[triple.length - 1].onPile === 1, `triple play: ${triple[triple.length - 1].onPile} cards left showing on the pile`)
})

await test('burn: the 10 flies to the pile, then burns, with no empty slot in between', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['10', 'K', 'Q'], faceUp: [], faceDown: [] }, opp: { hand: ['4', '4'] }, pile: ['5', '6'] }))
  await settle(600)
  const frames = await page.evaluate(() => T.record(1500, () => T.play(0, 'hand')))
  const firstBurn = frames.find(frame => frame.burning)
  assert(firstBurn, 'the burn never played')
  const before = frames.filter(frame => frame.t < firstBurn.t)
  const slot = before.find(frame => frame.slot)
  assert(!slot, `empty pile slot shown at ${slot?.t}ms, before the burn`)
  assert(before.some(frame => frame.entryRank === '10' && frame.entryDistance > 60), 'the 10 never flew in from the hand')
  const bare = before.find(frame => frame.onPile === 0)
  assert(!bare, `nothing on the pile at ${bare?.t}ms, before the burn`)
  const last = frames[frames.length - 1]
  assert(!last.burning && last.slot && last.realTop === null, 'the pile did not end up empty after the burn')
})

await test('burn: a quartet completed by two cards lands staggered, then burns', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['9', '9', 'K'], faceUp: [], faceDown: [] }, opp: { hand: ['4', '4'] }, pile: ['9', '9'] }))
  await settle(600)
  const frames = await page.evaluate(() => T.record(1700, () => T.play(0, 'hand', 2)))
  const firstBurn = frames.find(frame => frame.burning)
  assert(firstBurn, 'the burn never played')
  const slot = frames.find(frame => frame.t < firstBurn.t && frame.slot)
  assert(!slot, `empty pile slot shown at ${slot?.t}ms, before the burn`)
  assert(frames[frames.length - 1].slot, 'the pile did not end up empty after the burn')
})

await test('game over: the deciding blind flip plays before the round-over card', async () => {
  await page.evaluate(() => T.craft({ me: { hand: [], faceUp: [], faceDown: ['A'] }, opp: { hand: ['4', '4'] }, pile: ['9'] }))
  await settle(300)
  const frames = await page.evaluate(() => T.record(2000, () => T.play(0, 'faceDown')))
  assert(frames.some(frame => frame.blind), 'the deciding flip was never revealed')
  const covered = frames.find(frame => frame.blind && frame.overlay)
  assert(!covered, `round-over card was up at ${covered?.t}ms, during the flip`)
  assert(frames[frames.length - 1].overlay, 'the round-over card never appeared')
})

await test('game over: the deciding card lands before the round-over card', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['A'], faceUp: [], faceDown: [] }, opp: { hand: ['4', '4'] }, pile: ['9'] }))
  await settle(600)
  const frames = await page.evaluate(() => T.record(1500, () => T.play(0, 'hand')))
  const firstOverlay = frames.find(frame => frame.overlay)
  assert(firstOverlay, 'the round-over card never appeared')
  const landed = frames.find(frame => frame.entryRank === 'Ace' && frame.entryDistance < 4)
  assert(landed && landed.t <= firstOverlay.t, 'the round-over card appeared before the last card had landed')
})

await test('resize: an opponent\'s card still flies from their seat after the viewport changes', async () => {
  await page.evaluate(() => T.craft({ me: { hand: ['4', '4', '4'] }, opp: { hand: ['K', 'Q'] }, pile: ['5'], turn: 'opp' }))
  await settle(500)
  const seatCenter = () => page.evaluate(() => {
    const rect = document.querySelector('[data-seat-id]').getBoundingClientRect()
    return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)]
  })
  const before = await seatCenter()
  // Nothing re-renders the table between the resize and the play.
  await page.setViewportSize({ width: 844, height: 600 })
  await settle(400)
  const seat = await seatCenter()
  assert(Math.hypot(seat[0] - before[0], seat[1] - before[1]) > 80, 'test setup: the seat did not move with the viewport')
  const frames = await page.evaluate(() => T.record(700, () => T.play(1, 'hand')))
  const first = frames.find(frame => frame.entryRank === 'King' && frame.entryOpacity > 0.5)
  assert(first, 'the played card never appeared')
  const miss = Math.round(Math.hypot(first.entryCenter[0] - seat[0], first.entryCenter[1] - seat[1]))
  assert(miss < 45, `the flight started ${miss}px away from the seat (seat ${seat}, card ${first.entryCenter})`)
  await page.setViewportSize({ width: 390, height: 844 })
  await settle(300)
})

const sameLayout = (a, b) => a.pile === b.pile && a.finalRow === b.finalRow && a.hand === b.hand
const describeLayout = layout => `pile ${layout.pile}, final row ${layout.finalRow}, hand ${layout.hand} (bar: ${layout.bar})`

await test('layout: nothing moves between an opponent\'s turn and yours', async () => {
  const table = { hand: ['8', '9', 'Q', 'Q', 'A'], faceUp: ['10', '3', 'K'], faceDown: ['4', '4', '4'] }
  const opp = { hand: ['4', '4', '4'], faceUp: ['A', '3', '8'], faceDown: ['4', '4', '4'] }
  const at = async spec => {
    await page.evaluate(spec => T.craft(spec), spec)
    await settle(500)
    return page.evaluate(() => T.layout())
  }
  const waiting = await at({ me: table, opp, pile: ['9'], stock: 6, turn: 'opp' })
  const myTurn = await at({ me: table, opp, pile: ['9'], stock: 6 })
  const emptyPile = await at({ me: table, opp, pile: [], stock: 6 })
  assert(myTurn.bar === 'pickup' && waiting.bar === 'idle', `test setup: unexpected action bar modes ${waiting.bar}/${myTurn.bar}`)
  assert(sameLayout(waiting, myTurn), `opponent's turn: ${describeLayout(waiting)}; my turn: ${describeLayout(myTurn)}`)
  assert(sameLayout(emptyPile, myTurn), `my turn, empty pile: ${describeLayout(emptyPile)}; with a pile: ${describeLayout(myTurn)}`)
  await page.locator('.hand-fan__card button').nth(2).click({ force: true })
  await settle(300)
  const selected = await page.evaluate(() => T.layout())
  assert(selected.bar === 'play' && sameLayout(selected, myTurn), `with a selection: ${describeLayout(selected)}; without: ${describeLayout(myTurn)}`)
})

await test('layout: the final row keeps its size through the endgame, on and off the turn', async () => {
  const opp = { hand: ['4', '4', '4'], faceUp: [], faceDown: [] }
  const at = async spec => {
    await page.evaluate(spec => T.craft(spec), spec)
    await settle(500)
    return page.evaluate(() => T.layout())
  }
  for (const [name, me] of [
    ['face-up row', { hand: [], faceUp: ['10', '3', 'K'], faceDown: ['4', '4', '4'] }],
    ['face-down row', { hand: [], faceUp: [], faceDown: ['4', '4', '4'] }],
  ]) {
    const waiting = await at({ me, opp, pile: ['9'], turn: 'opp' })
    const myTurn = await at({ me, opp, pile: ['9'] })
    assert(sameLayout(waiting, myTurn), `${name}, opponent's turn: ${describeLayout(waiting)}; my turn: ${describeLayout(myTurn)}`)
  }
})

await test('no uncaught page errors', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

await browser.close()
await server.close()
const failed = results.filter(result => !result.ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
