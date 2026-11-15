// ============================================================================
// pileFx/burns — what clearing the pile looks like, by cause:
//   ten      a corner catches; a ragged, glowing edge eats across the stack
//            with flames standing on it, shedding embers and ash
//   quartet  the set slams down: shock rings and sparks, then the stack
//            burns out from the point of impact
//   joker    gold motes gather on the spinning card, it pops into rings, suits
//            and glints, and the stack dissolves from the middle with a gold rim
// The cards themselves are removed by a CSS mask (see burnMask); the canvas
// draws everything that is not paper. Flat shapes in the table's palette, not
// soft glow: it has to sit next to printed cards.
// ============================================================================
import {
  BLOB_SAMPLES, blobPoint, blobShape, burnMaskSupported, coverRadius, initBurnMask, moveBurnMask, type BlobShape,
} from './burnMask'
import {
  cardPath, clamp01, easeOutCubic, easeOutQuad, glintPath, rand, span, type CardBox, type Fx, type FxFrame,
} from './stage'

export type BurnReason = 'ten' | 'quartet' | 'joker'

export interface BurnFxOptions {
  /** The element holding the burning cards; the burn hole is cut out of it. */
  maskEl: HTMLElement | null
  /** Tilt (degrees) of the top card, so the fire is clipped to the real outline. */
  tilt: number
  /** Ten: start from the bottom-right corner instead of the bottom-left. */
  fromRight: boolean
}

/** When (ms into the burn) the quartet's four cards hit the pile. */
export const QUARTET_IMPACT_MS = 390
/** When the joker stops spinning and bursts. */
export const JOKER_POP_MS = 300

/** How long each burn takes to clear the pile; the table waits this long. */
export const BURN_MS: Record<BurnReason, number> = { ten: 700, quartet: 780, joker: 760 }

const FLAME_TONES = [
  { color: '#cf3d1c', scale: 1 },
  { color: '#f4861f', scale: 0.72 },
  { color: '#ffc83d', scale: 0.44 },
  { color: '#fff3c9', scale: 0.2 },
]
const EMBER_TONES = ['#fff0b8', '#ffb23e', '#e2582a', '#a8301f']
const ASH_TONES = ['#1d140f', '#4b3a30', '#8b8478']
const GOLD_TONES = ['#fff9e3', '#f1d58a', '#d0a64d']
const SUITS = ['♠', '♥', '♣', '♦']
const CREAM = '#f1e5c7'
const WARM = '#f08072'

interface Flame { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; sway: number; phase: number; lift: number }
interface Ember { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; phase: number }
interface Ash { x: number; y: number; vx: number; vy: number; age: number; life: number; w: number; h: number; rot: number; spin: number; phase: number; tone: number }
interface Glint { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; phase: number; tone: number }
interface Glyph { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; rot: number; spin: number; char: string; color: string }
interface Ring { start: number; duration: number; from: number; to: number; color: string; width: number; cardShaped: boolean; alpha: number }
interface Streak { angle: number; start: number; duration: number; from: number; to: number; length: number; color: string }
interface Mote { angle: number; radius: number; turn: number; size: number; delay: number; tone: number }

interface Plan {
  /** Burn centre, measured from the card's top-left corner. */
  cx: number
  cy: number
  start: number
  end: number
  radius: number
  ease: (p: number) => number
  fire: boolean
}

function planFor(reason: BurnReason, card: CardBox, fromRight: boolean, shape: BlobShape | null): Plan {
  // A little past the card's own edge, so its shadow is gone too.
  const cover = (cx: number, cy: number) =>
    (shape ? coverRadius(shape, cx, cy, card.w, card.h) : Math.hypot(card.w, card.h)) + 5
  if (reason === 'ten') {
    const cx = fromRight ? card.w * 1.07 : -card.w * 0.07
    const cy = card.h * 1.05
    return { cx, cy, start: 30, end: 620, radius: cover(cx, cy), ease: p => p * (0.7 + 0.3 * p), fire: true }
  }
  const cx = card.w / 2
  const cy = card.h / 2
  if (reason === 'quartet') {
    return { cx, cy, start: QUARTET_IMPACT_MS + 10, end: 700, radius: cover(cx, cy), ease: easeOutQuad, fire: true }
  }
  return { cx, cy, start: JOKER_POP_MS, end: 670, radius: cover(cx, cy), ease: p => p * (0.55 + 0.45 * p), fire: false }
}

/** A flame tongue: round at the base, drawn out to a point that leans with its drift. */
function tonguePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stretch: number, lean: number) {
  const tipY = y - r * stretch
  ctx.moveTo(x - r, y)
  ctx.quadraticCurveTo(x - r * 0.78, y - r * stretch * 0.42, x + lean, tipY)
  ctx.quadraticCurveTo(x + r * 0.78, y - r * stretch * 0.42, x + r, y)
  ctx.arc(x, y, r, 0, Math.PI)
}

function clipToCard(ctx: CanvasRenderingContext2D, card: CardBox, tilt: number, grow = 0) {
  ctx.save()
  ctx.beginPath()
  cardPath(ctx, card, tilt, grow)
  ctx.restore()
  ctx.clip()
}

export function burnFx(reason: BurnReason, card: CardBox, options: BurnFxOptions): Fx {
  const k = card.w / 80 // every size below is tuned for an 80px-wide card
  const shape = burnMaskSupported() ? blobShape() : null
  const plan = planFor(reason, card, options.fromRight, shape)
  const centreX = card.x + plan.cx
  const centreY = card.y + plan.cy
  const midX = card.x + card.w / 2
  const midY = card.y + card.h / 2
  const maskEl = shape ? options.maskEl : null
  let maskPad = 0
  let maskReady = false
  let released = false
  let heat = 0
  let burst = false
  let flameDebt = 0
  let emberDebt = 0
  let ashDebt = 0
  let glintDebt = 0

  const flames: Flame[] = []
  const embers: Ember[] = []
  const ashes: Ash[] = []
  const glints: Glint[] = []
  const glyphs: Glyph[] = []
  const rings: Ring[] = []
  const streaks: Streak[] = []
  const motes: Mote[] = reason === 'joker'
    ? Array.from({ length: 22 }, (_, index) => ({
        angle: (index / 22) * Math.PI * 2 + rand(-0.2, 0.2),
        radius: rand(58, 104) * k,
        turn: rand(1.6, 2.8),
        size: rand(2.2, 4.4) * k,
        delay: rand(0, 90),
        tone: index % GOLD_TONES.length,
      }))
    : []
  const outline = new Float32Array(BLOB_SAMPLES * 2)
  const live: number[] = []

  const addEmber = (x: number, y: number, vx: number, vy: number) => {
    embers.push({ x, y, vx, vy, age: 0, life: rand(0.45, 1.05), size: rand(1.1, 2.4) * k, phase: rand(0, 6.3) })
  }
  const addAsh = (x: number, y: number, vx: number, vy: number) => {
    ashes.push({
      x, y, vx, vy, age: 0, life: rand(0.6, 1.2), w: rand(2, 4.6) * k, h: rand(1, 2.2) * k,
      rot: rand(0, 6.3), spin: rand(-7, 7), phase: rand(0, 6.3), tone: Math.floor(rand(0, ASH_TONES.length)),
    })
  }
  const addGlint = (x: number, y: number, vx: number, vy: number, size = rand(2.6, 6) * k) => {
    glints.push({ x, y, vx, vy, age: 0, life: rand(0.38, 0.85), size, phase: rand(0, 6.3), tone: Math.floor(rand(0, GOLD_TONES.length)) })
  }

  function quartetImpact() {
    rings.push(
      { start: QUARTET_IMPACT_MS, duration: 360, from: 2 * k, to: 34 * k, color: CREAM, width: 3 * k, cardShaped: true, alpha: 0.95 },
      { start: QUARTET_IMPACT_MS + 60, duration: 480, from: 4 * k, to: 62 * k, color: '#d0a64d', width: 2 * k, cardShaped: true, alpha: 0.7 },
    )
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + rand(-0.12, 0.12)
      streaks.push({
        angle, start: QUARTET_IMPACT_MS + rand(0, 40), duration: rand(220, 340),
        from: rand(50, 62) * k, to: rand(96, 132) * k, length: rand(10, 20) * k, color: i % 3 === 0 ? '#d0a64d' : CREAM,
      })
    }
    for (let i = 0; i < 30; i++) {
      const angle = rand(0, Math.PI * 2)
      const speed = rand(110, 330) * k
      addEmber(midX + Math.cos(angle) * 10 * k, midY + Math.sin(angle) * 10 * k, Math.cos(angle) * speed, Math.sin(angle) * speed - 40 * k)
    }
    for (let i = 0; i < 16; i++) {
      const angle = rand(0, Math.PI * 2)
      const speed = rand(60, 190) * k
      addAsh(midX + Math.cos(angle) * 14 * k, midY + Math.sin(angle) * 14 * k, Math.cos(angle) * speed, Math.sin(angle) * speed - 20 * k)
    }
  }

  function jokerPop() {
    rings.push(
      { start: JOKER_POP_MS, duration: 440, from: 12 * k, to: 92 * k, color: '#d0a64d', width: 2.6 * k, cardShaped: false, alpha: 0.95 },
      { start: JOKER_POP_MS + 90, duration: 460, from: 8 * k, to: 70 * k, color: CREAM, width: 1.8 * k, cardShaped: false, alpha: 0.75 },
    )
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + rand(-0.25, 0.25)
      const speed = rand(150, 270) * k
      const char = SUITS[i % SUITS.length]
      glyphs.push({
        x: midX, y: midY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 70 * k, age: 0, life: rand(0.75, 1.1),
        size: rand(13, 19) * k, rot: rand(-0.5, 0.5), spin: rand(-6, 6), char, color: char === '♥' || char === '♦' ? WARM : CREAM,
      })
    }
    for (let i = 0; i < 18; i++) {
      const angle = rand(0, Math.PI * 2)
      const speed = rand(70, 230) * k
      addGlint(midX, midY, Math.cos(angle) * speed, Math.sin(angle) * speed - 30 * k)
    }
  }

  /** A random point on the part of the burning edge that is still over the card. */
  function edgePoint(): [number, number, number] | null {
    if (live.length === 0) return null
    const index = live[Math.floor(Math.random() * live.length)]
    return [outline[index * 2], outline[index * 2 + 1], index]
  }

  function emit(amount: number, edgeLength: number) {
    if (plan.fire) {
      flameDebt += edgeLength * 2.5 * amount
      emberDebt += edgeLength * 0.55 * amount
      ashDebt += edgeLength * 0.4 * amount
      while (flameDebt >= 1) {
        flameDebt -= 1
        const point = edgePoint()
        if (!point) break
        // Most tongues stand on the edge and merge into one body of fire; a
        // few small ones break away and climb.
        const lick = Math.random() < 0.1
        flames.push(lick
          ? {
              x: point[0], y: point[1], vx: rand(-16, 16) * k, vy: -rand(80, 140) * k, age: 0, life: rand(0.22, 0.36),
              size: rand(2.4, 4.2) * k, sway: rand(10, 26) * k, phase: rand(0, 6.3), lift: 130 * k,
            }
          : {
              x: point[0] + rand(-2, 2) * k, y: point[1] + rand(0, 4) * k, vx: rand(-6, 6) * k, vy: -rand(6, 30) * k, age: 0,
              life: rand(0.13, 0.25), size: rand(4.6, 8.6) * k, sway: rand(4, 12) * k, phase: rand(0, 6.3), lift: 30 * k,
            })
      }
      while (emberDebt >= 1) {
        emberDebt -= 1
        const point = edgePoint()
        if (!point) break
        addEmber(point[0], point[1], rand(-48, 48) * k, -rand(60, 200) * k)
      }
      while (ashDebt >= 1) {
        ashDebt -= 1
        const point = edgePoint()
        if (!point) break
        // Ash lifts off the part that has already burnt, just behind the edge.
        const back = rand(2, 12) * k
        const angle = Math.atan2(centreY - point[1], centreX - point[0])
        addAsh(point[0] + Math.cos(angle) * back, point[1] + Math.sin(angle) * back, rand(-28, 28) * k, -rand(14, 58) * k)
      }
    } else {
      glintDebt += edgeLength * 0.5 * amount
      while (glintDebt >= 1) {
        glintDebt -= 1
        const point = edgePoint()
        if (!point) break
        const angle = Math.atan2(point[1] - centreY, point[0] - centreX)
        const speed = rand(18, 78) * k
        addGlint(point[0], point[1], Math.cos(angle) * speed, Math.sin(angle) * speed - 24 * k)
      }
    }
  }

  function drawRings(ctx: CanvasRenderingContext2D, t: number): boolean {
    let pending = false
    for (const ring of rings) {
      const p = (t - ring.start) / ring.duration
      if (p < 1) pending = true
      if (p <= 0 || p >= 1) continue
      const grow = ring.from + (ring.to - ring.from) * easeOutCubic(p)
      ctx.save()
      ctx.globalAlpha = ring.alpha * (1 - p) * (1 - p)
      ctx.strokeStyle = ring.color
      ctx.lineWidth = Math.max(0.6, ring.width * (1 - p * 0.7))
      ctx.beginPath()
      if (ring.cardShaped) cardPath(ctx, card, options.tilt, grow)
      else ctx.arc(midX, midY, grow, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    return pending
  }

  function drawStreaks(ctx: CanvasRenderingContext2D, t: number): boolean {
    let pending = false
    ctx.lineCap = 'round'
    for (const streak of streaks) {
      const p = (t - streak.start) / streak.duration
      if (p < 1) pending = true
      if (p <= 0 || p >= 1) continue
      const head = streak.from + (streak.to - streak.from) * easeOutCubic(p)
      const tail = head - streak.length * (1 - p)
      const cos = Math.cos(streak.angle)
      const sin = Math.sin(streak.angle)
      ctx.globalAlpha = 1 - p * p
      ctx.strokeStyle = streak.color
      ctx.lineWidth = Math.max(0.6, 2.2 * k * (1 - p))
      ctx.beginPath()
      ctx.moveTo(midX + cos * tail, midY + sin * tail)
      ctx.lineTo(midX + cos * head, midY + sin * head)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return pending
  }

  function drawMotes(ctx: CanvasRenderingContext2D, t: number) {
    for (const mote of motes) {
      const p = span(t, mote.delay, JOKER_POP_MS)
      if (p <= 0 || p >= 1) continue
      const eased = p * p
      const radius = mote.radius * (1 - eased) + 6 * k
      const angle = mote.angle + mote.turn * eased
      ctx.globalAlpha = Math.min(1, p * 4)
      ctx.fillStyle = GOLD_TONES[mote.tone]
      ctx.beginPath()
      glintPath(ctx, midX + Math.cos(angle) * radius, midY + Math.sin(angle) * radius, mote.size * (0.7 + 0.5 * Math.sin(p * 20 + mote.angle)))
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function draw(frame: FxFrame): boolean {
    const { ctx, t, dt } = frame
    const p = span(t, plan.start, plan.end)
    const burning = !released && shape !== null && t >= plan.start && p < 1
    const radius = plan.radius * plan.ease(p)

    if (!burst && !released) {
      if (reason === 'quartet' && t >= QUARTET_IMPACT_MS) { burst = true; quartetImpact() }
      if (reason === 'joker' && t >= JOKER_POP_MS) { burst = true; jokerPop() }
    }

    // ---- The hole in the cards, and the outline everything else follows ----
    live.length = 0
    if (shape && !released && t >= plan.start) {
      if (maskEl) {
        if (!maskReady) {
          maskReady = true
          maskPad = parseFloat(getComputedStyle(maskEl).paddingLeft) || 0
          initBurnMask(maskEl, shape)
        }
        moveBurnMask(maskEl, maskPad + plan.cx, maskPad + plan.cy, radius)
      }
      if (burning) {
        for (let i = 0; i < BLOB_SAMPLES; i++) {
          const [x, y] = blobPoint(shape, i, centreX, centreY, radius)
          outline[i * 2] = x
          outline[i * 2 + 1] = y
          if (x > card.x - 1 && x < card.x + card.w + 1 && y > card.y - 1 && y < card.y + card.h + 1) live.push(i)
        }
      }
    }
    const edgeLength = live.length * ((Math.PI * 2 * radius) / BLOB_SAMPLES)
    if (burning) emit(dt * frame.quality, edgeLength)
    heat += ((burning && live.length > 0 ? 1 : 0) - heat) * Math.min(1, dt * 9)

    // ---- Light thrown on the felt ----
    if (heat > 0.02) {
      let lightX = midX
      let lightY = midY
      if (live.length > 0) {
        lightX = 0
        lightY = 0
        for (const index of live) { lightX += outline[index * 2]; lightY += outline[index * 2 + 1] }
        lightX /= live.length
        lightY /= live.length
      }
      const reach = card.w * 1.5
      const glow = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, reach)
      const strength = heat * (0.86 + 0.14 * Math.sin(t / 31)) * (plan.fire ? 0.2 : 0.13)
      glow.addColorStop(0, plan.fire ? `rgba(255, 150, 50, ${strength})` : `rgba(241, 213, 138, ${strength})`)
      glow.addColorStop(1, plan.fire ? 'rgba(255, 110, 30, 0)' : 'rgba(241, 213, 138, 0)')
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = glow
      ctx.fillRect(lightX - reach, lightY - reach, reach * 2, reach * 2)
      ctx.restore()
    }

    if (reason === 'joker') drawMotes(ctx, t)

    // ---- Charred paper and the glowing rim, both clipped to the card ----
    if (burning && shape && live.length > 0) {
      const tracePath = () => {
        ctx.moveTo(outline[0], outline[1])
        for (let i = 1; i < BLOB_SAMPLES; i++) ctx.lineTo(outline[i * 2], outline[i * 2 + 1])
        ctx.closePath()
      }
      if (plan.fire) {
        ctx.save()
        clipToCard(ctx, card, options.tilt)
        ctx.beginPath()
        ctx.rect(0, 0, frame.width, frame.height)
        tracePath()
        ctx.clip('evenodd')
        const inner = radius * shape.min * 0.92
        const outer = radius + 30 * k
        const char = ctx.createRadialGradient(centreX, centreY, inner, centreX, centreY, outer)
        char.addColorStop(0, 'rgba(10, 5, 2, 0.95)')
        char.addColorStop(0.45, 'rgba(38, 16, 6, 0.84)')
        char.addColorStop(0.75, 'rgba(112, 52, 14, 0.42)')
        char.addColorStop(1, 'rgba(150, 80, 20, 0)')
        ctx.fillStyle = char
        ctx.fillRect(card.x - 8, card.y - 8, card.w + 16, card.h + 16)
        ctx.restore()
      }
      ctx.save()
      clipToCard(ctx, card, options.tilt, 1)
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.86 + 0.14 * Math.sin(t / 23)
      const rim = plan.fire
        ? [[9, 'rgba(214, 70, 24, 0.5)'], [5, 'rgba(245, 134, 31, 0.92)'], [2.3, '#ffd35a'], [1, '#fff6d6']] as const
        : [[8, 'rgba(208, 166, 77, 0.42)'], [4, '#e9c979'], [1.6, '#fff9e3']] as const
      for (const [width, color] of rim) {
        ctx.beginPath()
        tracePath()
        ctx.lineWidth = width * k
        ctx.strokeStyle = color
        ctx.stroke()
      }
      ctx.restore()
    }

    const ringsPending = drawRings(ctx, t)
    const streaksPending = drawStreaks(ctx, t)

    // ---- Ash ----
    for (let i = ashes.length - 1; i >= 0; i--) {
      const ash = ashes[i]
      ash.age += dt
      const q = ash.age / ash.life
      if (q >= 1) { ashes.splice(i, 1); continue }
      const drag = Math.exp(-2.4 * dt)
      ash.vx *= drag
      ash.vy = ash.vy * drag - 22 * k * dt
      ash.x += (ash.vx + Math.sin(ash.age * 9 + ash.phase) * 16 * k) * dt
      ash.y += ash.vy * dt
      ash.rot += ash.spin * dt
      ctx.save()
      ctx.translate(ash.x, ash.y)
      ctx.rotate(ash.rot)
      ctx.globalAlpha = 0.85 * (1 - q * q)
      ctx.fillStyle = ASH_TONES[ash.tone]
      ctx.fillRect(-ash.w / 2, -ash.h / 2, ash.w, ash.h)
      ctx.restore()
    }

    // ---- Flames: every tongue's outer shape first, then each hotter core, so
    // overlapping tongues merge into one flat-shaded fire. ----
    for (let i = flames.length - 1; i >= 0; i--) {
      const flame = flames[i]
      flame.age += dt
      if (flame.age >= flame.life) { flames.splice(i, 1); continue }
      flame.vy -= flame.lift * dt
      flame.x += (flame.vx + Math.sin(flame.age * 15 + flame.phase) * flame.sway) * dt
      flame.y += flame.vy * dt
    }
    if (flames.length > 0) {
      for (const tone of FLAME_TONES) {
        ctx.beginPath()
        for (const flame of flames) {
          const q = flame.age / flame.life
          const r = flame.size * Math.min(1, flame.age / 0.035) * (1 - Math.pow(q, 2.2)) * tone.scale
          if (r < 0.5) continue
          const lean = Math.sin(flame.age * 17 + flame.phase) * r * 0.75
          tonguePath(ctx, flame.x, flame.y, r, 2.3 + q * 1.5, lean)
        }
        ctx.fillStyle = tone.color
        ctx.fill()
      }
    }

    // ---- Embers ----
    for (let i = embers.length - 1; i >= 0; i--) {
      const ember = embers[i]
      ember.age += dt
      const q = ember.age / ember.life
      if (q >= 1) { embers.splice(i, 1); continue }
      const drag = Math.exp(-2.8 * dt)
      ember.vx *= drag
      ember.vy = ember.vy * drag - 46 * k * dt
      ember.x += (ember.vx + Math.sin(ember.age * 11 + ember.phase) * 18 * k) * dt
      ember.y += ember.vy * dt
      ctx.globalAlpha = (q > 0.7 ? (1 - q) / 0.3 : 1) * (0.72 + 0.28 * Math.sin(ember.age * 40 + ember.phase))
      ctx.fillStyle = EMBER_TONES[Math.min(EMBER_TONES.length - 1, Math.floor(q * EMBER_TONES.length))]
      ctx.beginPath()
      ctx.arc(ember.x, ember.y, ember.size * (1 - q * 0.5), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // ---- Joker: gold glints and the four suits ----
    for (let i = glints.length - 1; i >= 0; i--) {
      const glint = glints[i]
      glint.age += dt
      const q = glint.age / glint.life
      if (q >= 1) { glints.splice(i, 1); continue }
      const drag = Math.exp(-3 * dt)
      glint.vx *= drag
      glint.vy = glint.vy * drag + 30 * k * dt
      glint.x += glint.vx * dt
      glint.y += glint.vy * dt
      ctx.globalAlpha = clamp01((1 - q) * 2.4)
      ctx.fillStyle = GOLD_TONES[glint.tone]
      ctx.beginPath()
      glintPath(ctx, glint.x, glint.y, glint.size * (0.55 + 0.45 * Math.sin(glint.age * 24 + glint.phase)) * (1 - q * 0.6))
      ctx.fill()
    }
    ctx.globalAlpha = 1
    if (glyphs.length > 0) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = glyphs.length - 1; i >= 0; i--) {
        const glyph = glyphs[i]
        glyph.age += dt
        const q = glyph.age / glyph.life
        if (q >= 1) { glyphs.splice(i, 1); continue }
        const drag = Math.exp(-2.2 * dt)
        glyph.vx *= drag
        glyph.vy = glyph.vy * drag + 250 * k * dt
        glyph.x += glyph.vx * dt
        glyph.y += glyph.vy * dt
        glyph.rot += glyph.spin * dt
        ctx.save()
        ctx.translate(glyph.x, glyph.y)
        ctx.rotate(glyph.rot)
        ctx.globalAlpha = clamp01((1 - q) / 0.35)
        ctx.fillStyle = glyph.color
        ctx.font = `${(glyph.size * Math.min(1, 0.4 + glyph.age * 9)).toFixed(1)}px Georgia, "Times New Roman", serif`
        ctx.fillText(glyph.char, 0, 0)
        ctx.restore()
      }
    }

    const airborne = flames.length + embers.length + ashes.length + glints.length + glyphs.length
    if (t > 2600) return false
    if (released) return airborne > 0 || ringsPending || streaksPending
    return t < plan.end + 60 || airborne > 0 || ringsPending || streaksPending
  }

  return {
    draw,
    release() { released = true },
  }
}
