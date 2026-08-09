// ============================================================================
// PassGate — hot-seat hand privacy (§3.1 "Your identity never moves" +
// pass-and-play). When another human's turn comes on a shared device, their
// cards stay hidden behind this deliberate gate; identity never hot-swaps
// on its own.
// ============================================================================
import type { Player } from '../engine'

export function PassGate({ player, onReveal }: { player: Player; onReveal: () => void }) {
  return (
    <div
      className="fixed inset-0 z-overlay bg-felt flex flex-col items-center justify-center p-s4 text-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Pass the device to ${player.name}`}
    >
      <div className="text-label font-bold tracking-label uppercase text-cream-dim">Pass and play</div>
      <h1 className="font-display text-display font-semibold text-cream mt-s2">Pass to {player.name}</h1>
      <p className="text-body text-cream-dim mt-s2 max-w-[280px]">
        {player.name}'s cards are hidden until the device changes hands.
      </p>
      <button
        type="button"
        onClick={onReveal}
        className="mt-s6 min-h-[48px] min-w-[88px] px-s6 rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
      >
        I'm {player.name}
      </button>
    </div>
  )
}
