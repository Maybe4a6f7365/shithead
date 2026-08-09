// ============================================================================
// Feed text — maps typed GameEvents (state.log) to one-line feed copy and
// screen-reader announcements (DESIGN.md §3.1 ActionFeed, §6.6).
// ============================================================================
import type { Card, GameEvent, GameState, Player } from '../engine'

export interface FeedContext {
  meId: string
  players: Player[]
  /** Cards collected by the most recent pickup (diffed at the boundary). */
  pickupCount?: number
}

const SUIT_NAME: Record<string, string> = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' }

export function cardName(c: Card): string {
  if (c.rank === 'JOKER') return 'the Joker'
  const rank = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' }[c.rank as string] ?? c.rank
  return `the ${rank} of ${c.suit ? SUIT_NAME[c.suit] : 'unknown suit'}`
}

export function actorName(ctx: FeedContext, playerId: string): string {
  if (playerId === ctx.meId) return 'You'
  return ctx.players.find(p => p.id === playerId)?.name ?? 'Someone'
}

/**
 * Events appended by one engine action. The state log is capped, so neither
 * its length nor a retained array index is a safe cursor. A terminal
 * GAME_OVER is deliberately treated as its own block: this prevents a bare
 * legacy/stalemate event from replaying the previous action.
 */
export function latestActionEvents(log: GameEvent[]): GameEvent[] {
  if (log.length === 0) return []
  const last = log[log.length - 1]
  if (last.type === 'GAME_OVER') return [last]

  let start = log.length - 1
  while (start > 0) {
    const event = log[start]
    if (
      event.type === 'PLAY_CARDS' || event.type === 'PICK_UP_PILE' ||
      event.type === 'REARRANGE' || event.type === 'PHASE_CHANGE'
    ) break
    start--
  }

  const root = log[start]
  const previous = log[start - 1]
  if (
    start > 0 && root.type === 'PLAY_CARDS' && previous?.type === 'BLIND_REVEAL' &&
    previous.playerId === root.playerId && previous.success
  ) start--
  if (
    start > 0 && root.type === 'PICK_UP_PILE' && previous?.type === 'BLIND_REVEAL' &&
    previous.playerId === root.playerId && !previous.success
  ) start--
  return log.slice(start)
}

/**
 * The one feed line for the newest log entry. Events that merely elaborate a
 * play (DRAW) are folded into the play line; CLEAR_PILE borrows the actor
 * from the PLAY_CARDS entry that precedes it.
 */
export function feedLine(state: GameState, ctx: FeedContext): { text: string; key: number } | null {
  const log = latestActionEvents(state.log)
  if (log.length === 0) return null
  const last = log[log.length - 1]
  const key = state.seq ?? state.turnCount

  const failedBlind = log.find(event => event.type === 'BLIND_REVEAL' && !event.success)
  if (failedBlind?.type === 'BLIND_REVEAL') {
    const who = actorName(ctx, failedBlind.playerId)
    return { text: `${who} flipped ${cardName(failedBlind.card)} blind — too low`, key }
  }
  const clear = log.find(event => event.type === 'CLEAR_PILE')
  if (clear) {
    const play = log.find(event => event.type === 'PLAY_CARDS' || event.type === 'BLIND_REVEAL')
    const who = play && 'playerId' in play ? actorName(ctx, play.playerId) : 'Someone'
    return { text: `Pile burned by ${who}`, key }
  }
  const play = log.find(event => event.type === 'PLAY_CARDS')
  if (play?.type === 'PLAY_CARDS') {
    const who = actorName(ctx, play.playerId)
    const n = play.cards.length
    const what = n === 1 ? cardName(play.cards[0]) : `${n} ${play.cards[0].rank === 'JOKER' ? 'Jokers' : `${play.cards[0].rank}s`}`
    return { text: `${who} played ${what}`, key }
  }

  switch (last.type) {
    case 'PICK_UP_PILE': {
      const who = actorName(ctx, last.playerId)
      const n = ctx.pickupCount
      return { text: `${who} picked up ${n && n > 0 ? `${n} card${n === 1 ? '' : 's'}` : 'the pile'}`, key }
    }
    case 'BLIND_REVEAL': {
      const who = actorName(ctx, last.playerId)
      return last.success
        ? { text: `${who} flipped ${cardName(last.card)} blind`, key }
        : { text: `${who} flipped ${cardName(last.card)} blind — too low`, key }
    }
    case 'PLAYER_OUT':
      return { text: `${actorName(ctx, last.playerId)} ${last.playerId === ctx.meId ? 'are' : 'is'} clear of cards`, key }
    case 'GAME_OVER': {
      const loser = state.players.find(p => p.id === last.loserId)
      return { text: `Round over — ${loser?.name ?? '?'} is the Shithead`, key }
    }
    case 'PHASE_CHANGE':
      if (last.phase === 'play') return { text: 'Round begins', key }
      return null
    case 'DRAW':
    case 'CLEAR_PILE':
    case 'PLAY_CARDS':
    case 'REARRANGE':
      return null
    default:
      return null
  }
}

/** Assertive-channel text for an event that needs it, else null. */
export function announceEvent(state: GameState, ctx: FeedContext): string | null {
  const line = feedLine(state, ctx)
  return line ? line.text : null
}
