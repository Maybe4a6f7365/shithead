// ============================================================================
// pileFx/landings — the mark a rule card leaves on the felt as it lands. These
// happen many times a round, so they are brief line work around the card that
// says what the card does, never a show:
//   reset   a ripple and a burst of ticks: the slate is wiped
//   mirror  a sheen crosses the 3 and two glints catch: it is glass
//   low     chevrons step down both sides and a line presses in under the card
//   skip    an arrow hops clean over the card, once per seat passed
// ============================================================================
import {
  cardPath, clamp01, easeOutCubic, glintPath, span, type CardBox, type Fx, type FxFrame,
} from './stage'

export type LandingKind = 'reset' | 'mirror' | 'low' | 'skip'

export interface LandingOptions {
  /** Tilt (degrees) of the landed card. */
  tilt: number
  /** Skip: how many 8s were played together. */
  count: number
}

const CREAM = '#f1e5c7'
const GOLD = '#d0a64d'
const WARM = '#f08072'

/** Longest a landing mark stays on screen (ms). */
export function landingFxMs(kind: LandingKind, count = 1): number {
  if (kind === 'skip') return 520 + (Math.min(4, Math.max(1, count)) - 1) * 90
  if (kind === 'mirror') return 640
  return 580
}

function resetFx(card: CardBox, options: LandingOptions): Fx {
  const k = card.w / 80
  const midX = card.x + card.w / 2
  const midY = card.y + card.h / 2
  const ticks = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2 + Math.PI / 12
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Distance from the card's centre to its edge along this ray.
    const edge = Math.min(card.w / 2 / Math.max(1e-3, Math.abs(cos)), card.h / 2 / Math.max(1e-3, Math.abs(sin)))
    return { cos, sin, edge }
  })
  return {
    draw({ ctx, t }: FxFrame) {
      for (const ring of [{ delay: 0, reach: 17, alpha: 0.9, width: 2.4 }, { delay: 70, reach: 29, alpha: 0.5, width: 1.6 }]) {
        const p = span(t, ring.delay, ring.delay + 400)
        if (p <= 0 || p >= 1) continue
        ctx.save()
        ctx.globalAlpha = ring.alpha * (1 - p) * (1 - p)
        ctx.strokeStyle = CREAM
        ctx.lineWidth = Math.max(0.6, ring.width * k * (1 - p * 0.6))
        ctx.beginPath()
        cardPath(ctx, card, options.tilt, ring.reach * k * easeOutCubic(p))
        ctx.stroke()
        ctx.restore()
      }
      const p = span(t, 40, 380)
      if (p > 0 && p < 1) {
        const travel = easeOutCubic(p)
        ctx.lineCap = 'round'
        ctx.strokeStyle = CREAM
        ctx.lineWidth = Math.max(0.6, 2 * k * (1 - p))
        ctx.globalAlpha = 1 - p * p
        ctx.beginPath()
        for (const tick of ticks) {
          const head = tick.edge + (9 + 15 * travel) * k
          const tail = head - 8 * k * (1 - p)
          ctx.moveTo(midX + tick.cos * tail, midY + tick.sin * tail)
          ctx.lineTo(midX + tick.cos * head, midY + tick.sin * head)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      return t < 560
    },
  }
}

function mirrorFx(card: CardBox, options: LandingOptions): Fx {
  const k = card.w / 80
  const glints = [
    // Just off the corners, on the felt, where a pale glint can be seen.
    { x: card.x + card.w + 5 * k, y: card.y - 3 * k, at: 130, size: 10 },
    { x: card.x - 6 * k, y: card.y + card.h * 0.82, at: 270, size: 7 },
  ]
  return {
    draw({ ctx, t }: FxFrame) {
      const p = span(t, 0, 430)
      if (p > 0 && p < 1) {
        ctx.save()
        ctx.save()
        ctx.beginPath()
        cardPath(ctx, card, options.tilt)
        ctx.restore()
        ctx.clip()
        // Two bands of light, a wide one and a thin follower, crossing on a slant.
        const travel = easeOutCubic(p)
        const reach = card.w + card.h
        ctx.translate(card.x + card.w / 2, card.y + card.h / 2)
        ctx.rotate(-0.42)
        const x = -reach * 0.62 + reach * 1.24 * travel
        ctx.globalAlpha = Math.sin(p * Math.PI)
        for (const band of [{ offset: 0, width: 0.34, alpha: 0.5 }, { offset: -0.28, width: 0.09, alpha: 0.4 }]) {
          const left = x + band.offset * card.w
          const width = band.width * card.w
          const sheen = ctx.createLinearGradient(left, 0, left + width, 0)
          // Gold, not white: the card is cream, and white light would not show on it.
          sheen.addColorStop(0, 'rgba(208, 166, 77, 0)')
          sheen.addColorStop(0.5, `rgba(208, 166, 77, ${band.alpha})`)
          sheen.addColorStop(1, 'rgba(208, 166, 77, 0)')
          ctx.fillStyle = sheen
          ctx.fillRect(left, -reach, width, reach * 2)
        }
        ctx.restore()
      }
      for (const glint of glints) {
        const q = span(t, glint.at, glint.at + 320)
        if (q <= 0 || q >= 1) continue
        ctx.globalAlpha = clamp01(Math.sin(q * Math.PI) * 1.4)
        ctx.fillStyle = CREAM
        ctx.beginPath()
        glintPath(ctx, glint.x, glint.y, glint.size * k * Math.sin(q * Math.PI))
        ctx.fill()
        ctx.globalAlpha = 1
      }
      return t < 620
    },
  }
}

function lowFx(card: CardBox): Fx {
  const k = card.w / 80
  const midX = card.x + card.w / 2
  const sides = [card.x - 11 * k, card.x + card.w + 11 * k]
  return {
    draw({ ctx, t }: FxFrame) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = WARM
      for (let row = 0; row < 3; row++) {
        const p = span(t, row * 75, row * 75 + 300)
        if (p <= 0 || p >= 1) continue
        const y = card.y + card.h * (0.3 + row * 0.2) + 9 * k * easeOutCubic(p)
        const half = 5 * k
        ctx.globalAlpha = Math.sin(p * Math.PI)
        ctx.lineWidth = 2.3 * k
        ctx.beginPath()
        for (const x of sides) {
          ctx.moveTo(x - half, y - half * 0.6)
          ctx.lineTo(x, y + half * 0.6)
          ctx.lineTo(x + half, y - half * 0.6)
        }
        ctx.stroke()
      }
      // The table takes the weight: a line spreads under the card, then fades.
      const p = span(t, 120, 520)
      if (p > 0 && p < 1) {
        const half = card.w * (0.2 + 0.46 * easeOutCubic(p))
        const y = card.y + card.h + 6 * k
        ctx.globalAlpha = (1 - p) * 0.9
        ctx.lineWidth = Math.max(0.6, 2.4 * k * (1 - p * 0.5))
        ctx.beginPath()
        ctx.moveTo(midX - half, y)
        ctx.lineTo(midX + half, y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      return t < 560
    },
  }
}

function skipFx(card: CardBox, options: LandingOptions): Fx {
  const k = card.w / 80
  const midX = card.x + card.w / 2
  const midY = card.y + card.h / 2
  const hops = Math.min(4, Math.max(1, options.count))
  const from = Math.PI * 1.08
  const to = Math.PI * 1.94
  const total = landingFxMs('skip', hops)
  return {
    draw({ ctx, t }: FxFrame) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let hop = 0; hop < hops; hop++) {
        const p = span(t, hop * 90, hop * 90 + 430)
        if (p <= 0 || p >= 1) continue
        const rx = card.w / 2 + (13 + hop * 9) * k
        const ry = card.h / 2 + (11 + hop * 9) * k
        // The stroke is a comet: its head runs the arc, its tail catches up.
        const head = from + (to - from) * easeOutCubic(p)
        const tail = from + (to - from) * easeOutCubic(clamp01(p * 1.7 - 0.7))
        const point = (angle: number): [number, number] => [midX + Math.cos(angle) * rx, midY + Math.sin(angle) * ry]
        ctx.globalAlpha = clamp01((1 - p) * 3)
        ctx.strokeStyle = hop % 2 === 0 ? GOLD : CREAM
        ctx.lineWidth = 2.8 * k
        ctx.beginPath()
        for (let step = 0; step <= 24; step++) {
          const [x, y] = point(tail + ((head - tail) * step) / 24)
          if (step === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        // Arrowhead, pointing along the direction of travel.
        const [hx, hy] = point(head)
        const [bx, by] = point(head - 0.06)
        const direction = Math.atan2(hy - by, hx - bx)
        const barb = 7 * k
        ctx.beginPath()
        ctx.moveTo(hx + Math.cos(direction + 2.5) * barb, hy + Math.sin(direction + 2.5) * barb)
        ctx.lineTo(hx, hy)
        ctx.lineTo(hx + Math.cos(direction - 2.5) * barb, hy + Math.sin(direction - 2.5) * barb)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      return t < total
    },
  }
}

export function landingFx(kind: LandingKind, card: CardBox, options: LandingOptions): Fx {
  if (kind === 'reset') return resetFx(card, options)
  if (kind === 'mirror') return mirrorFx(card, options)
  if (kind === 'low') return lowFx(card)
  return skipFx(card, options)
}
