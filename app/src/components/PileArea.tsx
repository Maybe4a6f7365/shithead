// ============================================================================
// PileArea — stock + wastepile pair, 16px gap, centered in the felt (§3.1).
// Empty pile is a dashed slot, NEVER a face-down card (§2.5). Stock count
// turns danger-bright at ≤5 (§4.4). Burn animation is owned by Wastepile.
// NOTE: only stock.length is meaningful — stock cards arrive masked.
// ============================================================================
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import clsx from 'clsx'
import type { Card as CardT, Rank } from '../engine'
import { Card } from './Card'
import { BlindReveal, type BlindRevealData } from './BlindReveal'
import { PileSweep, type PileSweepData } from './PileSweep'
import { MirrorGhost } from './MirrorGhost'
import { BurnFx, burnStackMotion, type BurnReason } from './BurnFx'
import type { SpecialEffect } from './SpecialEffectFeedback'
import {
  flightDuration, flightOffset, forgetCardRect, groupGhostTiming, groupTilt, isTrivialFlight, peekCardRect,
  peekSeatRect, registerSeat, staggerDelay, type FlightOffset,
} from './cardFlight'

export type PileEntryKind = 'reset' | 'mirror' | 'low' | 'skip' | 'standard'

export function pileEntryKind(rank: Rank | null | undefined): PileEntryKind {
  if (rank === '2') return 'reset'
  if (rank === '3') return 'mirror'
  if (rank === '7') return 'low'
  if (rank === '8') return 'skip'
  return 'standard'
}

export function pileEntryChoreography(kind: PileEntryKind, skipCount: number, reduceMotion: boolean) {
  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.12 },
    }
  }
  if (kind === 'reset') {
    return {
      initial: { opacity: 0, y: 18, scale: 1 },
      animate: { opacity: 1, y: [18, -3, 0], scale: [1, 0.95, 1] },
      transition: { duration: 0.28, times: [0, 0.62, 1], ease: [0.16, 1, 0.3, 1] },
    }
  }
  if (kind === 'mirror') {
    return {
      initial: { opacity: 0, x: 18, y: 12, rotate: 3 },
      animate: { opacity: 1, x: [18, 7, 0], y: [12, 0, 0], rotate: [3, -2, -1] },
      transition: { duration: 0.32, times: [0, 0.64, 1], ease: [0.16, 1, 0.3, 1] },
    }
  }
  if (kind === 'low') {
    return {
      initial: { opacity: 0, y: -14, scale: 1.03 },
      animate: { opacity: 1, y: [-14, 4, 0], scale: [1.03, 0.97, 1] },
      transition: { duration: 0.3, times: [0, 0.68, 1], ease: [0.16, 1, 0.3, 1] },
    }
  }
  if (kind === 'skip') {
    const finalTilt = skipCount > 1 ? 2 : 1
    return {
      initial: { opacity: 0, y: 16, rotate: -5 },
      animate: {
        opacity: 1,
        y: [16, -2, 0],
        rotate: [-5, skipCount > 1 ? 4 : 2, finalTilt],
      },
      transition: { duration: skipCount > 1 ? 0.36 : 0.3, times: [0, 0.66, 1], ease: [0.16, 1, 0.3, 1] },
    }
  }
  return {
    initial: { opacity: 0, y: 16, scale: 1.025 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
  }
}

export function StockPile({ count }: { count: number }) {
  return (
    <div
      className="pile-column pile-column--stock stock-pile flex flex-col items-center gap-s1"
      data-empty={count === 0 ? 'true' : 'false'}
      data-low={count > 0 && count <= 5 ? 'true' : 'false'}
    >
      <div className="pile-card pile-card--stock">
        {count > 0 ? (
          <Card faceDown />
        ) : (
          <div className="pile-slot pile-slot--stock" aria-label="Stock empty">
            <span className="pile-slot__label text-micro font-semibold tracking-micro">STOCK</span>
          </div>
        )}
      </div>
      <div className="pile-column__meta pile-column__meta--stock">
        <span className="pile-column__label" aria-hidden="true">Deck</span>
        <span
          className={clsx('pile-count pile-count--stock text-micro font-semibold tracking-micro', count <= 5 ? 'text-danger-bright' : 'text-muted-felt')}
          aria-label={`${count} cards in stock`}
        >
          {count}
        </span>
      </div>
    </div>
  )
}

export interface WastepileProps {
  top?: CardT | null
  underCount: number
  /** Effective rule rank when the physical top is a copying 3. */
  effectiveRank?: Rank | null
  burning?: boolean
  burnKey?: string
  burnReason?: BurnReason | null
  skipCount?: number
  /** Empty-pile rule teaching (§4.2): shown only while pile empty + my turn. */
  teachHint?: boolean
  /** Opponent who played the top card; their seat is the flight origin. */
  playedBy?: string | null
  /** Every card of the latest multi-card play; the first is the pile's top card. */
  group?: CardT[] | null
  /** The card a mirroring 3 on top is copying. */
  mirrorOf?: CardT | null
  /** Face-down play being revealed over the pile. */
  blind?: BlindRevealData | null
  onBlindDone?: (key: string) => void
  /** The pile being swept to whoever picked it up. */
  sweep?: PileSweepData | null
  onSweepDone?: (key: string) => void
  /** Top card already shown by the blind reveal; skip its entry animation. */
  suppressEntryId?: string | null
}

export function Wastepile({
  top,
  underCount,
  effectiveRank,
  burning,
  burnKey,
  burnReason,
  skipCount = 1,
  teachHint,
  playedBy,
  group,
  mirrorOf,
  blind,
  onBlindDone,
  sweep,
  onSweepDone,
  suppressEntryId,
}: WastepileProps) {
  const reduceMotion = useReducedMotion()
  const pileRef = useRef<HTMLDivElement>(null)
  // A 3 already on top when the table mounts (reconnect) is history, not news.
  const mountTopId = useRef(top?.id)
  const copiesRank = top?.rank === '3'
  const entryKind = pileEntryKind(top?.rank)
  // Where the new top card came from: its own hand/tableau slot when we saw
  // it, else the playing opponent's seat. Computed once per top card.
  const flight = useMemo<FlightOffset | null>(() => {
    if (reduceMotion || !top) return null
    const to = pileRef.current?.getBoundingClientRect()
    if (!to || to.width <= 0 || to.height <= 0) return null
    const from = peekCardRect(top.id) ?? peekSeatRect(playedBy)
    if (!from) return null
    const offset = flightOffset(from, to)
    return isTrivialFlight(offset) ? null : offset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id])
  // The rest of a multi-card play lands one after another, top card last.
  const ghosts = useMemo(() => {
    if (!flight || !top || !group || group.length < 2) return []
    if (group[0].id !== top.id || suppressEntryId === top.id) return []
    const to = pileRef.current?.getBoundingClientRect()
    if (!to || to.width <= 0) return []
    return group.slice(1).flatMap((card, index) => {
      const from = peekCardRect(card.id) ?? peekSeatRect(playedBy)
      return from ? [{ card, index, offset: flightOffset(from, to) }] : []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id])
  const topDelay = ghosts.length > 0 ? staggerDelay(ghosts.length) : 0
  useEffect(() => {
    forgetCardRect(top?.id)
    group?.forEach(card => forgetCardRect(card.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id])
  const variantMotion = reduceMotion ? null : burnStackMotion(burnReason)
  const baseEntry = pileEntryChoreography(entryKind, skipCount, Boolean(reduceMotion))
  const entry = top && suppressEntryId === top.id
    ? {
        initial: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 },
        animate: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 },
        transition: { duration: 0 },
      }
    : flight
    ? {
        // With a delay the card stays invisible until its turn in the sequence.
        initial: { opacity: topDelay > 0 ? 0 : 1, x: flight.x, y: flight.y, scale: flight.scale, rotate: 0 },
        animate: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 },
        transition: {
          duration: flightDuration(flight),
          delay: topDelay,
          opacity: { duration: 0.01, delay: topDelay },
          ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
        },
      }
    : baseEntry
  const metaText = copiesRank
    ? `= ${effectiveRank ?? 'OPEN'}${underCount > 0 ? ` · +${underCount}` : ''}`
    : underCount > 0 ? `+${underCount}` : ''
  const metaLabel = copiesRank
    ? `Three copies ${effectiveRank ?? 'an open pile'}${underCount > 0 ? `; ${underCount} card${underCount === 1 ? '' : 's'} underneath` : ''}`
    : underCount > 0 ? `${underCount} card${underCount === 1 ? '' : 's'} underneath` : undefined
  return (
    <div
      className="pile-column pile-column--waste waste-pile flex flex-col items-center gap-s1"
      data-empty={top ? 'false' : 'true'}
      data-burning={burning ? 'true' : 'false'}
      data-copies-rank={copiesRank ? 'true' : 'false'}
      data-entry-effect={entryKind}
      data-skip-count={entryKind === 'skip' ? skipCount : undefined}
    >
      <div ref={pileRef} className="pile-card pile-card--waste relative">
        {ghosts.map(ghost => {
          const travel = flightDuration(ghost.offset)
          const delay = staggerDelay(ghost.index)
          const timing = groupGhostTiming(travel, topDelay + (flight ? flightDuration(flight) : travel), delay)
          const tilt = groupTilt(ghost.index)
          return (
            <motion.div
              key={`ghost-${top?.id}-${ghost.card.id}`}
              className="waste-pile__ghost absolute inset-0 pointer-events-none"
              aria-hidden="true"
              initial={{ opacity: 0, x: ghost.offset.x, y: ghost.offset.y, scale: ghost.offset.scale, rotate: 0 }}
              animate={{
                opacity: timing.opacity,
                x: [ghost.offset.x, 0, 0, 0],
                y: [ghost.offset.y, 0, 0, 0],
                scale: [ghost.offset.scale, 1, 1, 1],
                rotate: [0, tilt, tilt, tilt],
              }}
              transition={{ duration: timing.total, times: timing.times, delay, ease: 'easeOut' }}
            >
              <Card card={ghost.card} state="in-pile" />
            </motion.div>
          )
        })}
        <AnimatePresence mode="popLayout" initial={false}>
          {burning ? (
            <motion.div
              key={`burn-${burnKey ?? top?.id ?? 'empty'}`}
              className="waste-pile__burn-stack"
              initial={{ opacity: 1 }}
              animate={reduceMotion
                ? { opacity: 0 }
                : variantMotion?.animate ?? {
                    opacity: [1, 1, 0.82, 0],
                    x: [0, -2, 14, 50],
                    y: [0, 2, 10, 24],
                    scale: [1, 0.94, 0.92, 0.84],
                    rotate: [0, -0.5, 2, 4],
                  }}
              transition={reduceMotion
                ? { duration: 0.12 }
                : variantMotion?.transition ?? { duration: 0.52, times: [0, 0.18, 0.58, 1], ease: [0.4, 0, 1, 1] }}
            >
              {top && underCount > 0 && (
                <span className="waste-pile__burn-edges" aria-hidden="true">
                  <span />
                  <span />
                </span>
              )}
              {top ? <Card card={top} state="in-pile" /> : <EmptySlot teachHint={teachHint} />}
            </motion.div>
          ) : top ? (
            <motion.div
              key={top.id}
              className="waste-pile__entry"
              data-entry-effect={entryKind}
              data-skip-count={entryKind === 'skip' ? skipCount : undefined}
              initial={entry.initial}
              animate={entry.animate}
              transition={entry.transition}
            >
              <Card card={top} state="in-pile" />
            </motion.div>
          ) : (
            <motion.div key="slot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0.01 : 0.15 }}>
              <EmptySlot teachHint={teachHint} />
            </motion.div>
          )}
        </AnimatePresence>
        {mirrorOf && !reduceMotion && top?.rank === '3' && top.id !== mountTopId.current && (
          <MirrorGhost key={`mirror-${top.id}`} source={mirrorOf} />
        )}
        {sweep && onSweepDone && <PileSweep key={sweep.key} data={sweep} onDone={onSweepDone} />}
        {blind && onBlindDone && <BlindReveal key={blind.key} data={blind} onDone={onBlindDone} />}
        {burning && burnReason && !reduceMotion && <BurnFx key={burnKey} reason={burnReason} card={top ?? null} />}
        {burning && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-button pointer-events-none"
            style={{ borderRadius: 'var(--radius-card)' }}
            initial={{ boxShadow: '0 0 0 2px var(--color-gold-bright)' }}
            animate={reduceMotion
              ? { boxShadow: '0 0 0 0px rgba(0,0,0,0)' }
              : { boxShadow: ['0 0 0 2px var(--color-gold-bright)', '0 0 0 2px var(--color-burgundy)', '0 0 0 0px rgba(0,0,0,0)'] }}
            transition={{ duration: reduceMotion ? 0.12 : 0.52 }}
          />
        )}
        <AnimatePresence initial={false}>
          {!burning && entryKind === 'skip' && skipCount > 1 && (
            <motion.span
              key={`skip-${top?.id ?? 'empty'}-${skipCount}`}
              className="waste-pile__skip-count absolute -right-2 -top-2 pointer-events-none"
              data-count={skipCount}
              aria-hidden="true"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.9 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              ×{skipCount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="pile-column__meta pile-column__meta--waste">
        <span className="pile-column__label" aria-hidden="true">Pile</span>
        <span
          className="pile-count pile-count--waste text-micro font-semibold tracking-micro text-cream-dim h-[16px] whitespace-nowrap"
          aria-hidden={!metaLabel}
          aria-label={metaLabel}
        >
          {metaText}
        </span>
      </div>
    </div>
  )
}

function EmptySlot({ teachHint }: { teachHint?: boolean }) {
  return (
    <div
      className="pile-slot pile-slot--waste"
      data-teaching={teachHint ? 'true' : 'false'}
      aria-label={teachHint ? 'Empty pile — any card may lead' : 'Empty pile'}
    >
      {teachHint ? (
        <span className="pile-slot__hint text-small text-cream-dim px-s1 text-center leading-tight">any card leads</span>
      ) : (
        <span className="pile-slot__label text-micro font-semibold tracking-micro">PILE</span>
      )}
    </div>
  )
}

export interface PileAreaProps {
  stockCount: number
  top?: CardT | null
  pileCount: number
  effectiveRank?: Rank | null
  burning?: boolean
  burnKey?: string
  burnReason?: BurnReason | null
  specialEffect?: SpecialEffect | null
  teachHint?: boolean
  playedBy?: string | null
  group?: CardT[] | null
  mirrorOf?: CardT | null
  blind?: BlindRevealData | null
  onBlindDone?: (key: string) => void
  sweep?: PileSweepData | null
  onSweepDone?: (key: string) => void
  suppressEntryId?: string | null
}

export type PileRuleKind = 'open' | 'mirror' | 'low'

type PileRule = {
  kind: PileRuleKind
  label: string
  value: string
  announcement: string
}

function currentPileRule(top: CardT | null | undefined, effectiveRank: Rank | null | undefined): PileRule | null {
  if (!top) return null
  if (top.rank === '2') {
    return { kind: 'open', label: 'Reset', value: 'Any card', announcement: 'Reset: any card may follow' }
  }
  if (top.rank === '3') {
    const copied = effectiveRank ?? 'OPEN'
    return {
      kind: 'mirror',
      label: 'Mirror',
      value: copied === 'OPEN' ? 'Open pile' : `Plays as ${copied}`,
      announcement: copied === 'OPEN' ? 'Mirror: open pile' : `Mirror: plays as ${copied}`,
    }
  }
  if (top.rank === '7') {
    return { kind: 'low', label: 'Low card', value: '7 or lower', announcement: 'Low card: play 7 or lower' }
  }
  return null
}

export function pileRuleChipInitial(kind: PileRuleKind, reduceMotion: boolean) {
  if (reduceMotion) return { opacity: 0 }
  if (kind === 'mirror') return { opacity: 0, x: -8, scale: 0.98 }
  if (kind === 'low') return { opacity: 0, y: 6, scale: 0.98 }
  return { opacity: 0, y: -6, scaleY: 0.84 }
}

export function PileArea({
  stockCount,
  top,
  pileCount,
  effectiveRank,
  burning,
  burnKey,
  burnReason,
  specialEffect,
  teachHint,
  playedBy,
  group,
  mirrorOf,
  blind,
  onBlindDone,
  sweep,
  onSweepDone,
  suppressEntryId,
}: PileAreaProps) {
  const rule = currentPileRule(top, effectiveRank)
  const reduceMotion = useReducedMotion()
  const areaRef = useRef<HTMLElement>(null)
  // Drawn and picked-up cards fly into the hand from these two anchors.
  useLayoutEffect(() => {
    const area = areaRef.current
    registerSeat('stock', area?.querySelector('.pile-card--stock') ?? null)
    registerSeat('pile', area?.querySelector('.pile-card--waste') ?? null)
  })
  const skipCount = specialEffect?.kind === 'skip'
    ? Math.max(1, specialEffect.count ?? 1)
    : 1
  return (
    <section
      ref={areaRef}
      className="pile-area flex items-start justify-center gap-s4"
      aria-label="Stock and play pile"
      data-pile-empty={pileCount === 0 ? 'true' : 'false'}
      data-stock-empty={stockCount === 0 ? 'true' : 'false'}
      data-rule={rule?.kind ?? 'standard'}
      data-special-effect={specialEffect?.kind}
      data-skip-count={specialEffect?.kind === 'skip' ? skipCount : undefined}
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {rule?.announcement ?? ''}
      </span>
      <div className="pile-area__stage">
        <StockPile count={stockCount} />
        <Wastepile
          top={top}
          underCount={Math.max(0, pileCount - (top ? 1 : 0))}
          effectiveRank={effectiveRank}
          burning={burning}
          burnKey={burnKey}
          burnReason={burnReason}
          skipCount={skipCount}
          teachHint={teachHint}
          playedBy={playedBy}
          group={group}
          mirrorOf={mirrorOf}
          blind={blind}
          onBlindDone={onBlindDone}
          sweep={sweep}
          onSweepDone={onSweepDone}
          suppressEntryId={suppressEntryId}
        />
      </div>
      {rule && !burning && (
        <motion.div
          key={`${rule.kind}-${rule.value}`}
          className="pile-area__rule"
          data-rule={rule.kind}
          aria-hidden="true"
          initial={pileRuleChipInitial(rule.kind, Boolean(reduceMotion))}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1, scaleY: 1 }}
          transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="pile-area__rule-label" aria-hidden="true">{rule.label}</span>
          <strong className="pile-area__rule-value" aria-hidden="true">{rule.value}</strong>
        </motion.div>
      )}
    </section>
  )
}
