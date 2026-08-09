// ============================================================================
// PileArea — stock + wastepile pair, 16px gap, centered in the felt (§3.1).
// Empty pile is a dashed slot, NEVER a face-down card (§2.5). Stock count
// turns danger-bright at ≤5 (§4.4). Burn animation is owned by Wastepile.
// NOTE: only stock.length is meaningful — stock cards arrive masked.
// ============================================================================
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import type { Card as CardT } from '../engine'
import { Card } from './Card'

export function StockPile({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center gap-s1">
      {count > 0 ? (
        <Card faceDown />
      ) : (
        <div className="pile-slot" aria-label="Stock empty">
          <span className="text-micro font-semibold tracking-micro">STOCK</span>
        </div>
      )}
      <span
        className={clsx('text-micro font-semibold tracking-micro', count <= 5 ? 'text-danger-bright' : 'text-muted-felt')}
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
  burning?: boolean
  /** Empty-pile rule teaching (§4.2): shown only while pile empty + my turn. */
  teachHint?: boolean
}

export function Wastepile({ top, underCount, burning, teachHint }: WastepileProps) {
  return (
    <div className="flex flex-col items-center gap-s1">
      <div className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          {burning ? (
            <motion.div
              key={`burn-${top?.id ?? 'empty'}`}
              initial={{ opacity: 1, scale: 1 }}
              animate={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.38, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {top ? <Card card={top} state="in-pile" /> : <EmptySlot teachHint={teachHint} />}
            </motion.div>
          ) : top ? (
            <motion.div
              key={top.id}
              initial={{ opacity: 0, y: 28, scale: 1.06 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Card card={top} state="in-pile" />
            </motion.div>
          ) : (
            <motion.div key="slot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
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
            animate={{ boxShadow: ['0 0 0 2px var(--color-gold-bright)', '0 0 0 2px var(--color-burgundy)', '0 0 0 0px rgba(0,0,0,0)'] }}
            transition={{ duration: 0.38 }}
          />
        )}
      </div>
      <span className="text-micro font-semibold tracking-micro text-cream-dim h-[16px]" aria-hidden={underCount === 0}>
        {underCount > 0 ? `+${underCount}` : ''}
      </span>
    </div>
  )
}

function EmptySlot({ teachHint }: { teachHint?: boolean }) {
  return (
    <div className="pile-slot" aria-label={teachHint ? 'Empty pile — any card may lead' : 'Empty pile'}>
      {teachHint ? (
        <span className="text-small text-cream-dim px-s1 text-center leading-tight">any card leads</span>
      ) : (
        <span className="text-micro font-semibold tracking-micro">PILE</span>
      )}
    </div>
  )
}

export interface PileAreaProps {
  stockCount: number
  top?: CardT | null
  pileCount: number
  burning?: boolean
  teachHint?: boolean
}

export function PileArea({ stockCount, top, pileCount, burning, teachHint }: PileAreaProps) {
  return (
    <div className="flex items-start justify-center gap-s4" style={{ transform: 'translateY(-4%)' }}>
      <StockPile count={stockCount} />
      <Wastepile top={top} underCount={Math.max(0, pileCount - (top ? 1 : 0))} burning={burning} teachHint={teachHint} />
    </div>
  )
}
