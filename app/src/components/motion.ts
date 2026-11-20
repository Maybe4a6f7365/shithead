// ============================================================================
// motion — the easing curves every table animation shares. One place, so the
// table moves as one system: change a curve here and every flight, slide and
// sweep follows. Each curve exists twice because the two animation engines
// want different shapes: a CSS string for the Web Animations API and a
// four-number tuple for framer-motion.
// ============================================================================
export type Bezier = [number, number, number, number]

const css = (curve: Bezier): string => `cubic-bezier(${curve.join(', ')})`

/** Arrivals: fast out of the gate, long soft landing (flights, entries, reveals). */
export const EASE_LAND: Bezier = [0.16, 1, 0.3, 1]
export const EASE_LAND_CSS = css(EASE_LAND)

/** Layout slides: a hand closing a gap or re-sorting. */
export const EASE_SLIDE: Bezier = [0.2, 0.8, 0.2, 1]
export const EASE_SLIDE_CSS = css(EASE_SLIDE)

/** A small overshoot for things that settle into place (tableau, stamps, recoil). */
export const EASE_SETTLE: Bezier = [0.34, 1.3, 0.4, 1]
export const EASE_SETTLE_CSS = css(EASE_SETTLE)

/**
 * Departures: slow start, accelerating away (pile sweep, quartet slam).
 * @public Only the CSS form is in use, but every curve ships in both forms.
 */
export const EASE_LEAVE: Bezier = [0.5, 0, 0.9, 0.4]
export const EASE_LEAVE_CSS = css(EASE_LEAVE)

/** The default burn: the stack accelerates off the pile. */
export const EASE_EXIT: Bezier = [0.4, 0, 1, 1]
