import {
  interruptBurn,
  type Card,
  type GameState,
  type PlayResult,
} from '../engine'

/**
 * Resolve client card identifiers against authoritative state. Client-sent
 * rank/suit fields are never trusted. The blind alias exists only for normal
 * face-down play; interruptBurn will reject it because that zone is hidden.
 */
export function canonicalCards(
  state: GameState,
  playerId: string,
  requested: Card[],
): Card[] | null {
  const player = state.players.find(candidate => candidate.id === playerId)
  if (!player) return null

  const owned = new Map(
    [...player.hand, ...player.faceUp, ...player.faceDown].map(card => [card.id, card]),
  )
  const ids = requested.map(card => card.id)
  if (new Set(ids).size !== ids.length) return null

  const cards = ids.map(id => {
    const blind = /^blind:down:(\d+)$/.exec(id)
    if (blind) return player.faceDown[Number(blind[1])]
    return owned.get(id)
  })
  return cards.every((card): card is Card => !!card) ? cards : null
}

/** Worker boundary for a BURN_IN frame, exported for adversarial tests. */
export function applyInterruptBurnRequest(
  state: GameState,
  playerId: string,
  requested: Card[],
): PlayResult {
  const cards = canonicalCards(state, playerId, requested)
  if (!cards) return { state, error: 'Card is not owned by this player' }
  return interruptBurn(state, playerId, cards)
}
