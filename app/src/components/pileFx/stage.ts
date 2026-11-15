// ============================================================================
// pileFx/stage — one canvas over the play pile that every special-card effect
// draws on. The canvas is far larger than the card so flames, embers and rings
// can leave the card's edges; it only repaints while an effect is alive and is
// transparent the rest of the time.
// ============================================================================

/** The pile's card slot, in canvas (CSS pixel) coordinates. */
export interface CardBox {
  x: number
  y: number
  w: number
  h: number
  /** Corner radius. */
  r: number
}

export interface FxFrame {
  ctx: CanvasRenderingContext2D
  /** Milliseconds since the effect started. */
  t: number
  /** Seconds since the previous frame, clamped so a stalled tab cannot explode the physics. */
  dt: number
  card: CardBox
  width: number
  height: number
}

export interface Fx {
  /** Paint one frame; return false once nothing is left to draw. */
  draw(frame: FxFrame): boolean
  /** The thing being animated has left the table: stop emitting, let what is airborne die out. */
  release?(): void
}

export interface FxHandle {
  release(): void
}

const MAX_DPR = 2
const MAX_DT = 0.05

/** jsdom has a canvas element but no 2D context; do not even ask it for one. */
export function canvasFxSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof CanvasRenderingContext2D !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
}

export class PileFxStage {
  private ctx: CanvasRenderingContext2D | null = null
  private running: Array<{ fx: Fx; start: number }> = []
  private raf = 0
  private last = 0
  private dpr = 1
  private width = 0
  private height = 0
  private card: CardBox = { x: 0, y: 0, w: 0, h: 0, r: 0 }

  constructor(private canvas: HTMLCanvasElement, private anchor: HTMLElement) {}

  /** Start an effect. `make` receives the card slot so it can lay itself out. */
  play(make: (card: CardBox) => Fx): FxHandle | null {
    if (!canvasFxSupported() || !this.measure()) return null
    const fx = make(this.card)
    this.running.push({ fx, start: performance.now() })
    this.canvas.dataset.active = 'true'
    if (!this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
    return { release: () => fx.release?.() }
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.running.forEach(entry => entry.fx.release?.())
    this.running = []
    this.clear()
  }

  private measure(): boolean {
    const canvasRect = this.canvas.getBoundingClientRect()
    const anchorRect = this.anchor.getBoundingClientRect()
    if (canvasRect.width <= 0 || anchorRect.width <= 0 || anchorRect.height <= 0) return false
    this.ctx ??= this.canvas.getContext('2d')
    if (!this.ctx) return false
    // An effect already in flight keeps its geometry; the table does not move mid-burn.
    if (this.running.length > 0) return true
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    this.width = canvasRect.width
    this.height = canvasRect.height
    const pixelWidth = Math.round(this.width * this.dpr)
    const pixelHeight = Math.round(this.height * this.dpr)
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight
    this.card = {
      x: anchorRect.left - canvasRect.left,
      y: anchorRect.top - canvasRect.top,
      w: anchorRect.width,
      h: anchorRect.height,
      r: anchorRect.width * 0.11,
    }
    return true
  }

  private clear() {
    if (!this.ctx) return
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.canvas.dataset.active = 'false'
  }

  private tick = (now: number) => {
    const ctx = this.ctx
    if (!ctx) return
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000))
    this.last = now
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.running = this.running.filter(entry => {
      ctx.save()
      const alive = entry.fx.draw({
        ctx, t: now - entry.start, dt, card: this.card, width: this.width, height: this.height,
      })
      ctx.restore()
      return alive
    })
    if (this.running.length > 0) {
      this.raf = requestAnimationFrame(this.tick)
    } else {
      this.raf = 0
      this.clear()
    }
  }
}

// ---- Small shared drawing helpers -----------------------------------------

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
export const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount
export const rand = (min: number, max: number) => min + Math.random() * (max - min)
export const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
export const easeOutQuad = (p: number) => 1 - (1 - p) * (1 - p)
export const easeInQuad = (p: number) => p * p

/** Progress of `t` through the window [start, end], clamped to 0..1. */
export const span = (t: number, start: number, end: number) => clamp01((t - start) / (end - start))

/** Trace a rounded rectangle (not every engine in the wild has ctx.roundRect). */
export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Trace the card's outline. Cards on the pile sit at a small tilt, rotated
 * about the middle of their bottom edge (see `.card` transform-origin).
 */
export function cardPath(ctx: CanvasRenderingContext2D, card: CardBox, tiltDeg = 0, grow = 0) {
  const pivotX = card.x + card.w / 2
  const pivotY = card.y + card.h
  ctx.translate(pivotX, pivotY)
  ctx.rotate((tiltDeg * Math.PI) / 180)
  ctx.translate(-pivotX, -pivotY)
  roundedRect(ctx, card.x - grow, card.y - grow, card.w + grow * 2, card.h + grow * 2, card.r + grow)
}

/** A four-point glint centred on (x, y). */
export function glintPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.moveTo(x, y - size)
  ctx.quadraticCurveTo(x, y, x + size, y)
  ctx.quadraticCurveTo(x, y, x, y + size)
  ctx.quadraticCurveTo(x, y, x - size, y)
  ctx.quadraticCurveTo(x, y, x, y - size)
}
