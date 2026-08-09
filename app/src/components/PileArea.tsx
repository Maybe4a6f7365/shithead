// ============================================================================
// PileArea — stock + wastepile pair, 16px gap, centered in the felt (§3.1).
// Empty pile is a dashed slot, NEVER a face-down card (§2.5). Stock count
// turns danger-bright at ≤5 (§4.4). Burn animation is owned by Wastepile.
// NOTE: only stock.length is meaningful — stock cards arrive masked.
// ============================================================================
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import clsx from 'clsx'
import type { Card as CardT, Rank } from '../engine'
import { Card } from './Card'

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
      <span
        className={clsx('pile-count pile-count--stock text-micro font-semibold tracking-micro', count <= 5 ? 'text-danger-bright' : 'text-muted-felt')}
        aria-label={`${count} cards in stock`}
      >
        {count}
      </span>
    </div>
  )
}

export interface WastepileProps {
  top?: CardT | null
  underCount: number
  /** Effective rule rank when the physical top is a copying 3. */
  effectiveRank?: Rank | null
  burning?: boolean
  /** Empty-pile rule teaching (§4.2): shown only while pile empty + my turn. */
  teachHint?: boolean
}

export function Wastepile({ top, underCount, effectiveRank, burning, teachHint }: WastepileProps) {
  const reduceMotion = useReducedMotion()
  const copiesRank = top?.rank === '3'
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
    >
      <div className="pile-card pile-card--waste relative">
        <AnimatePresence mode="popLayout" initial={false}>
          {burning ? (
            <motion.div
              key={`burn-${top?.id ?? 'empty'}`}
              initial={{ opacity: 1 }}
              animate={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.38, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {top ? <Card card={top} state="in-pile" /> : <EmptySlot teachHint={teachHint} />}
            </motion.div>
          ) : top ? (
            <motion.div
              key={top.id}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 28, scale: 1.06 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.26, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Card card={top} state="in-pile" />
            </motion.div>
          ) : (
            <motion.div key="slot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0.01 : 0.15 }}>
              <EmptySlot teachHint={teachHint} />
            </motion.div>
          )}
        </AnimatePresence>
        {burning && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-button pointer-events-none"
            style={{ borderRadius: 'var(--radius-card)' }}
            initial={{ boxShadow: '0 0 0 2px var(--color-gold-bright)' }}
            animate={reduceMotion
              ? { boxShadow: '0 0 0 0px rgba(0,0,0,0)' }
              : { boxShadow: ['0 0 0 2px var(--color-gold-bright)', '0 0 0 2px var(--color-burgundy)', '0 0 0 0px rgba(0,0,0,0)'] }}
            transition={{ duration: reduceMotion ? 0.01 : 0.38 }}
          />
        )}
      </div>
      <span
        className="pile-count pile-count--waste text-micro font-semibold tracking-micro text-cream-dim h-[16px] whitespace-nowrap"
        aria-hidden={!metaLabel}
        aria-label={metaLabel}
      >
        {metaText}
      </span>
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
  teachHint?: boolean
}

export function PileArea({ stockCount, top, pileCount, effectiveRank, burning, teachHint }: PileAreaProps) {
  return (
    <section
      className="pile-area flex items-start justify-center gap-s4"
      aria-label="Stock and play pile"
      data-pile-empty={pileCount === 0 ? 'true' : 'false'}
      data-stock-empty={stockCount === 0 ? 'true' : 'false'}
    >
      <StockPile count={stockCount} />
      <Wastepile
        top={top}
        underCount={Math.max(0, pileCount - (top ? 1 : 0))}
        effectiveRank={effectiveRank}
        burning={burning}
        teachHint={teachHint}
      />
    </section>
  )
}
