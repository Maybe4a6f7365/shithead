// ============================================================================
// BurnFx — what a burn looks like depends on what caused it:
//   ten     scorches in place (heat wash + rising embers), then lifts away
//   quartet four cards slam together, the stack punches, a shockwave rings out
//   joker   a gold ring and sparkles burst around the spinning stack
// Rendered inside the pile card slot next to the burning stack, which carries
// the matching base motion (see burnStackMotion). Web Animations API with
// fill: both — transform/opacity only, no end-of-animation flash. Not rendered
// under reduced motion.
// ============================================================================
import { useLayoutEffect, useRef } from 'react'
import type { Card as CardT } from '../engine'
import { Card } from './Card'

export type BurnReason = 'ten' | 'quartet' | 'joker'

export function burnCleanupMs(reason: BurnReason | null | undefined): number {
  return reason === 'joker' ? 760 : reason === 'quartet' ? 720 : 560
}

/** Base motion for the burning stack itself, per reason. */
export function burnStackMotion(reason: BurnReason | null | undefined) {
  if (reason === 'quartet') {
    return {
      animate: { opacity: [1, 1, 1, 0.8, 0], scale: [1, 1, 1.09, 1, 0.9], x: 0, y: 0, rotate: 0 },
      transition: { duration: 0.72, times: [0, 0.38, 0.45, 0.6, 1], ease: 'easeOut' as const },
    }
  }
  if (reason === 'joker') {
    return {
      animate: { opacity: [1, 1, 0], scale: [1, 1.18, 0.5], x: 0, y: [0, -6, -14], rotate: [0, 200, 360] },
      transition: { duration: 0.76, times: [0, 0.5, 1], ease: 'easeInOut' as const },
    }
  }
  if (reason === 'ten') {
    // Scorch in place, then lift away like smoke.
    return {
      animate: { opacity: [1, 1, 0.8, 0], scale: [1, 1, 1.03, 1.06], x: [0, -1.5, 1.5, 0], y: [0, 0, -10, -22], rotate: 0 },
      transition: { duration: 0.56, times: [0, 0.4, 0.7, 1], ease: 'easeOut' as const },
    }
  }
  return null
}

type Keyframes = Keyframe[]

function play(el: Element | null, keyframes: Keyframes, options: KeyframeAnimationOptions) {
  if (el && typeof (el as HTMLElement).animate === 'function') {
    ;(el as HTMLElement).animate(keyframes, { fill: 'both', ...options })
  }
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'

export function BurnFx({ reason, card }: { reason: BurnReason; card: CardT | null }) {
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const q = (selector: string) => Array.from(el.querySelectorAll(selector))
    if (reason === 'ten') {
      play(el.querySelector('[data-fx="scorch"]'), [{ opacity: 0 }, { opacity: 0.8, offset: 0.4 }, { opacity: 0.95, offset: 0.7 }, { opacity: 0 }], { duration: 560 })
      q('[data-fx="ember"]').forEach((ember, i) => {
        const drift = (i % 2 === 0 ? -1 : 1) * (6 + i * 4)
        play(ember, [
          { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
          { opacity: 1, offset: 0.25 },
          { transform: `translate(${drift}px, -${54 + i * 9}px) scale(1)`, opacity: 0 },
        ], { duration: 520, delay: 90 + i * 45, easing: 'ease-out' })
      })
    } else if (reason === 'quartet') {
      q('[data-fx="slam"]').forEach((layer, i) => {
        const dir = i - 1.5 // -1.5, -0.5, 0.5, 1.5
        play(layer, [
          { transform: `translate(${dir * 24}px, ${-16 - Math.abs(dir) * 5}px) rotate(${dir * 11}deg) scale(1.1)`, opacity: 0.9 },
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1, offset: 0.55 },
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1, offset: 0.62 },
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 0 },
        ], { duration: 720, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' })
      })
      play(el.querySelector('[data-fx="ring"]'), [
        { transform: 'scale(0.7)', opacity: 0 },
        { transform: 'scale(0.8)', opacity: 0.85, offset: 0.4 },
        { transform: 'scale(1.9)', opacity: 0 },
      ], { duration: 720, easing: EASE_OUT })
    } else {
      play(el.querySelector('[data-fx="ring"]'), [
        { transform: 'scale(0.6)', opacity: 0.9 },
        { transform: 'scale(2.1)', opacity: 0 },
      ], { duration: 640, easing: EASE_OUT })
      q('[data-fx="spark"]').forEach((spark, i, all) => {
        const angle = (i / all.length) * Math.PI * 2
        play(spark, [
          { transform: 'translate(0, 0) scale(0.4)', opacity: 1 },
          { transform: `translate(${Math.cos(angle) * 78}px, ${Math.sin(angle) * 78}px) scale(1)`, opacity: 0 },
        ], { duration: 620, delay: 60, easing: EASE_OUT })
      })
    }
  }, [reason])

  return (
    <div ref={root} className="burn-fx absolute inset-0 pointer-events-none" style={{ zIndex: 4 }} aria-hidden="true" data-burn-fx={reason}>
      {reason === 'ten' && (
        <>
          <div
            data-fx="scorch"
            className="absolute inset-0"
            style={{
              borderRadius: 'var(--radius-card)',
              opacity: 0,
              background: 'radial-gradient(circle at 50% 75%, rgba(255,150,50,0.9), rgba(150,40,15,0.8) 55%, rgba(25,12,6,0.9))',
            }}
          />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span
              key={i}
              data-fx="ember"
              className="absolute rounded-full"
              style={{ left: `${18 + i * 13}%`, bottom: '22%', width: 6, height: 6, opacity: 0, background: i % 2 ? 'var(--color-gold)' : 'var(--color-danger-bright)' }}
            />
          ))}
        </>
      )}
      {reason === 'quartet' && (
        <>
          {[0, 1, 2, 3].map(i => (
            <div key={i} data-fx="slam" className="absolute inset-0" style={{ opacity: 0 }}>
              {card ? <Card card={card} state="in-pile" /> : null}
            </div>
          ))}
          <div data-fx="ring" className="absolute inset-0" style={{ borderRadius: 'var(--radius-card)', border: '2px solid var(--color-gold-bright)', opacity: 0 }} />
        </>
      )}
      {reason === 'joker' && (
        <>
          <div data-fx="ring" className="absolute inset-0" style={{ borderRadius: '50%', border: '2px solid var(--color-gold)', opacity: 0 }} />
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              data-fx="spark"
              className="absolute rounded-full"
              style={{ left: 'calc(50% - 3px)', top: 'calc(50% - 3px)', width: 6, height: 6, opacity: 0, background: i % 2 ? 'var(--color-gold-bright)' : 'var(--color-gold)' }}
            />
          ))}
        </>
      )}
    </div>
  )
}
