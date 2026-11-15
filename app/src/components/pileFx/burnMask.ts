// ============================================================================
// pileFx/burnMask — the hole a burn eats into the pile. One ragged blob is
// used twice: as a CSS mask that removes the burnt part of the real cards, and
// as the outline the canvas draws its glowing rim, char and flames along. Both
// read the same sample table, so the fire sits exactly on the paper's edge.
// ============================================================================

const SAMPLES = 180
const TEXTURE_SIZE = 384
/** Texture pixels from the blob's centre to its widest point. */
const TEXTURE_UNIT = 184
const SHAPE_COUNT = 3

export interface BlobShape {
  /** Radius multiplier (0..1, widest point = 1) at SAMPLES evenly spaced angles. */
  radii: Float32Array
  /** The narrowest multiplier: a burn of radius R has certainly cleared R * min. */
  min: number
  /** The blob as an opaque shape on a transparent square, for CSS masking. */
  url: string
}

const shapes: Array<BlobShape | null> = Array.from({ length: SHAPE_COUNT }, () => null)

function buildShape(): BlobShape | null {
  // Layered sine octaves: periodic in angle by construction, detail at every scale.
  const octaves = [2, 3, 5, 7, 11, 17, 26, 39].map(frequency => ({
    frequency,
    amplitude: 0.2 / Math.pow(frequency, 0.82),
    phase: Math.random() * Math.PI * 2,
  }))
  const radii = new Float32Array(SAMPLES)
  let max = 0
  for (let i = 0; i < SAMPLES; i++) {
    const theta = (i / SAMPLES) * Math.PI * 2
    let value = 1
    for (const octave of octaves) value += octave.amplitude * Math.sin(theta * octave.frequency + octave.phase)
    radii[i] = value
    max = Math.max(max, value)
  }
  let min = 1
  for (let i = 0; i < SAMPLES; i++) {
    radii[i] /= max
    min = Math.min(min, radii[i])
  }
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const centre = TEXTURE_SIZE / 2
  ctx.beginPath()
  for (let i = 0; i < SAMPLES; i++) {
    const theta = (i / SAMPLES) * Math.PI * 2
    const x = centre + Math.cos(theta) * radii[i] * TEXTURE_UNIT
    const y = centre + Math.sin(theta) * radii[i] * TEXTURE_UNIT
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#000'
  ctx.fill()
  return { radii, min, url: canvas.toDataURL('image/png') }
}

/** A ragged blob; a few are built on first use and then shared by every burn. */
export function blobShape(): BlobShape | null {
  const index = Math.floor(Math.random() * SHAPE_COUNT)
  shapes[index] ??= buildShape()
  return shapes[index]
}

/** Point `index` of the blob's outline for a burn of radius `radius` centred on (cx, cy). */
export function blobPoint(shape: BlobShape, index: number, cx: number, cy: number, radius: number): [number, number] {
  const theta = (index / SAMPLES) * Math.PI * 2
  const reach = shape.radii[index] * radius
  return [cx + Math.cos(theta) * reach, cy + Math.sin(theta) * reach]
}

export const BLOB_SAMPLES = SAMPLES

/**
 * The burn radius at which the blob, centred on (cx, cy), has swallowed the
 * whole w × h box whose top-left corner is the origin.
 */
export function coverRadius(shape: BlobShape, cx: number, cy: number, w: number, h: number): number {
  let needed = 0
  const steps = 12
  const reach = (x: number, y: number) => {
    const distance = Math.hypot(x - cx, y - cy)
    if (distance < 0.5) return
    const turn = Math.atan2(y - cy, x - cx) / (Math.PI * 2)
    const index = Math.round((turn - Math.floor(turn)) * SAMPLES) % SAMPLES
    // The outline is ragged between samples; take the weakest of the neighbours.
    const weakest = Math.min(shape.radii[index], shape.radii[(index + 1) % SAMPLES], shape.radii[(index + SAMPLES - 1) % SAMPLES])
    needed = Math.max(needed, distance / weakest)
  }
  for (let step = 0; step <= steps; step++) {
    const along = step / steps
    reach(w * along, 0)
    reach(w * along, h)
    reach(0, h * along)
    reach(w, h * along)
  }
  return needed
}

/** True where masks can be subtracted from one another (every current browser). */
export function burnMaskSupported(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  return CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor')
}

function setMask(el: HTMLElement, property: string, value: string) {
  el.style.setProperty(`-webkit-mask-${property}`, value)
  el.style.setProperty(`mask-${property}`, value)
}

/** Prepare `el` to have a blob-shaped hole cut out of it. */
export function initBurnMask(el: HTMLElement, shape: BlobShape) {
  setMask(el, 'image', `url("${shape.url}"), linear-gradient(#000, #000)`)
  setMask(el, 'repeat', 'no-repeat')
  setMask(el, 'size', '0px 0px, 100% 100%')
  el.style.setProperty('-webkit-mask-composite', 'xor')
  el.style.setProperty('mask-composite', 'exclude')
}

/**
 * Size and place the hole. (cx, cy) is the burn's centre measured from the
 * masked element's own top-left corner; `radius` reaches the blob's widest point.
 */
export function moveBurnMask(el: HTMLElement, cx: number, cy: number, radius: number) {
  const size = (TEXTURE_SIZE * radius) / TEXTURE_UNIT
  setMask(el, 'size', `${size.toFixed(1)}px ${size.toFixed(1)}px, 100% 100%`)
  setMask(el, 'position', `${(cx - size / 2).toFixed(1)}px ${(cy - size / 2).toFixed(1)}px, 0 0`)
}
