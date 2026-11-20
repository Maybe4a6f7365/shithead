// ============================================================================
// BurnFx — what a burn looks like depends on what caused it:
//   ten     a corner catches and a glowing, ragged edge eats across the stack
//   quartet the four cards fan out, slam down, and the stack burns out from
//           the point of impact
//   joker   the stack spins, pops into rings, suits and glints, and dissolves
// The fire is drawn on the pile's effects canvas (see pileFx/burns); this
// component starts it, owns the quartet's four real cards, and tells the fire
// when the stack has left the table. The stack carries the matching base
// motion (see burnStackMotion). Not rendered under reduced motion.
// ============================================================================
import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import type { Card as CardT } from '../engine'
import { Card, pileTilt } from './Card'
import { EASE_LAND_CSS, EASE_LEAVE_CSS, EASE_SETTLE_CSS } from './motion'
import { BURN_MS, QUARTET_IMPACT_MS, burnFx, type BurnReason } from './pileFx/burns'
import type { PileFxStage } from './pileFx/stage'

export type { BurnReason }

export function burnCleanupMs(reason: BurnReason | null | undefined): number {
  return BURN_MS[reason ?? 'ten']
}

/**
 * Base motion for the burning stack itself, per reason. The burn removes the
 * cards through a mask, so opacity only drops at the very end, as a fallback
 * where the mask is unavailable.
 */
export function burnStackMotion(reason: BurnReason | null | undefined) {
  if (reason === 'quartet') {
    // Braces under the four cards, then takes the hit.
    const impact = QUARTET_IMPACT_MS / BURN_MS.quartet
    return {
      animate: { opacity: [1, 1, 1, 1, 1, 0], scale: [1, 1, 0.92, 1.01, 1, 1], x: 0, y: 0, rotate: 0 },
      transition: { duration: BURN_MS.quartet / 1000, times: [0, impact, impact + 0.05, impact + 0.12, 0.9, 1], ease: 'easeOut' as const },
    }
  }
  if (reason === 'joker') {
    // One full turn, lifted off the felt, back down flat before it dissolves.
    return {
      animate: {
        opacity: [1, 1, 1, 1, 0], scale: [1, 1.14, 1, 1, 1], x: 0, y: [0, -12, 0, 0, 0],
        rotate: 0, rotateY: [0, 180, 360, 360, 360],
      },
      // Constant, not animated: a perspective that eases in from zero balloons the card.
      style: { transformPerspective: 700 },
      transition: { duration: BURN_MS.joker / 1000, times: [0, 0.19, 0.38, 0.9, 1], ease: 'easeInOut' as const },
    }
  }
  if (reason === 'ten') {
    // Flinches as it catches, then holds still while it burns.
    return {
      animate: { opacity: [1, 1, 1, 1, 0], scale: [1, 0.975, 1, 1, 1], x: 0, y: 0, rotate: 0 },
      transition: { duration: BURN_MS.ten / 1000, times: [0, 0.07, 0.2, 0.9, 1], ease: 'easeOut' as const },
    }
  }
  return null
}

function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (el && typeof (el as HTMLElement).animate === 'function') (el as HTMLElement).animate(keyframes, options)
}

export interface BurnFxProps {
  reason: BurnReason
  /** The card on top of the burning stack. */
  card: CardT | null
  /** Quartet: the four cards of the set, top card first. */
  fan?: CardT[] | null
  stage: PileFxStage | null
}

export function BurnFx({ reason, card, fan, stage }: BurnFxProps) {
  const root = useRef<HTMLDivElement>(null)

  // One burn per mount (the pile keys this component by burn): the card and
  // the canvas are read as they stand when it starts.
  const burn = useEffectEvent(() => {
    const el = root.current
    if (!el) return
    const tilt = card ? pileTilt(card.id) : 0
    const handle = stage?.play(box => burnFx(reason, box, {
      maskEl: el.parentElement?.querySelector<HTMLElement>('.waste-pile__burn-mask') ?? null,
      tilt,
      fromRight: tilt > 0,
    })) ?? null

    if (reason === 'quartet') {
      // The set shows itself, hangs for a beat, and comes down as one.
      const layers = Array.from(el.querySelectorAll('[data-fx="slam"]'))
      const total = QUARTET_IMPACT_MS + 20
      const at = (ms: number) => ms / total
      layers.forEach((layer, index) => {
        const dir = index - (layers.length - 1) / 2 // -1.5 … 1.5, left to right
        const lift = -30 + Math.abs(dir) * 6
        const open = `translate(${dir * 27}%, ${lift}%) rotate(${dir * 10}deg) scale(1.05)`
        const hang = `translate(${dir * 29}%, ${lift - 3}%) rotate(${dir * 11}deg) scale(1.07)`
        animate(layer, [
          { transform: 'translate(0%, 0%) rotate(0deg) scale(1)', opacity: 1, offset: 0, easing: EASE_LAND_CSS },
          { transform: open, opacity: 1, offset: at(170), easing: 'ease-in-out' },
          { transform: hang, opacity: 1, offset: at(290), easing: EASE_LEAVE_CSS },
          { transform: 'translate(0%, 0%) rotate(0deg) scale(1)', opacity: 1, offset: at(QUARTET_IMPACT_MS) },
          { transform: 'translate(0%, 0%) rotate(0deg) scale(1)', opacity: 0, offset: 1 },
        ], { duration: total, fill: 'both' })
      })
      // The stock next door jumps with the impact.
      animate(el.closest('.pile-area__stage')?.querySelector('.pile-card--stock'), [
        { transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' },
      ], { duration: 260, delay: QUARTET_IMPACT_MS + 20, easing: EASE_SETTLE_CSS })
    }
    return () => handle?.release()
  })
  useLayoutEffect(() => burn(), [reason])

  const set = reason === 'quartet' && card
    ? Array.from({ length: 4 }, (_, index) => fan?.[index] ?? card).reverse()
    : []

  return (
    <div ref={root} className="burn-fx absolute inset-0 pointer-events-none" style={{ zIndex: 4 }} aria-hidden="true" data-burn-fx={reason}>
      {set.map((layerCard, index) => (
        <div key={index} data-fx="slam" className="absolute inset-0" style={{ opacity: 0 }}>
          <Card card={layerCard} state="in-pile" />
        </div>
      ))}
    </div>
  )
}
