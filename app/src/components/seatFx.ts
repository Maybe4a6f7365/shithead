// ============================================================================
// seatFx — a skip happens to a player, so it shows on that player: each seat
// an 8 passes over ducks and dims for a moment, in the order it is passed.
// Opponents are their seat in the strip; the viewer is their own hand.
// Transform and opacity only; never called under reduced motion.
// ============================================================================
import type { GameState } from '../engine'
import { EASE_SLIDE_CSS } from './motion'

/** Gap (ms) between one seat being passed and the next. */
export const SEAT_PASS_STAGGER_MS = 110
export const SEAT_PASS_MS = 640

/**
 * The seats an 8 just skipped, in play order. Read off the state the action
 * produced: everyone still in the round who sits between the player who acted
 * and the player whose turn it now is. `count` is how many 8s were played.
 */
export function skippedSeatIds(
  state: Pick<GameState, 'players' | 'currentPlayerIdx' | 'playDirection'>,
  actorId: string,
  count: number,
): string[] {
  const { players } = state
  const actorIdx = players.findIndex(player => player.id === actorId)
  const skipped: string[] = []
  if (actorIdx < 0) return skipped
  let idx = actorIdx
  for (let step = 0; step < players.length && skipped.length < count; step++) {
    idx = (idx + state.playDirection + players.length) % players.length
    // An 8 never skips the player who played it, and stops at whoever is up next.
    if (idx === actorIdx || idx === state.currentPlayerIdx) break
    if (!players[idx].isOut) skipped.push(players[idx].id)
  }
  return skipped
}

function seatElement(id: string, viewerId: string | null): HTMLElement | null {
  if (id === viewerId) return document.querySelector<HTMLElement>('.hand-fan')
  return Array.from(document.querySelectorAll<HTMLElement>('[data-seat-id]')).find(el => el.dataset.seatId === id) ?? null
}

/** Duck and dim each skipped seat, starting `delayMs` from now. Returns a cancel. */
export function passOverSeats(ids: string[], viewerId: string | null, delayMs: number): () => void {
  const timers = ids.map((id, index) => window.setTimeout(() => {
    const el = seatElement(id, viewerId)
    if (!el || typeof el.animate !== 'function') return
    // Only the held pose is spelled out, so the seat leaves from and returns
    // to whatever it already looks like (an offline seat is dimmed already).
    const passed = id === viewerId
      ? { opacity: 0.5, transform: 'translateY(6px)' }
      : { opacity: 0.4, transform: 'translateY(5px) scale(0.96)' }
    // Each leg is eased on its own; one curve over the whole thing would rush the hold.
    el.animate([
      { ...passed, offset: 0.2, easing: 'ease-in-out' },
      { ...passed, offset: 0.62, easing: EASE_SLIDE_CSS },
    ], { duration: SEAT_PASS_MS, easing: 'ease-out' })
  }, delayMs + index * SEAT_PASS_STAGGER_MS))
  return () => timers.forEach(timer => window.clearTimeout(timer))
}
