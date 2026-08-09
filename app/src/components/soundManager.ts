// ============================================================================
// SoundManager — hook point ONLY (DESIGN.md §8). Components never call audio;
// the GameEvent stream is mapped to sound names here and dispatched to a
// subscriber. No audio assets ship yet: the default subscriber is a no-op.
// When assets land, implement a Web-Audio sprite player and call
// setSoundHandler() once at app start.
// ============================================================================
import { useEffect, useRef } from 'react'
import type { GameEvent, GameState } from '../engine'
import { latestActionEvents } from './feedText'

export type SoundName =
  | 'deal' | 'select' | 'deselect' | 'play' | 'play_multi' | 'draw' | 'pickup'
  | 'burn' | 'turn_yours' | 'invalid' | 'round_end' | 'reconnect_restored'
  | 'player_joined' | 'player_left'

export type SoundHandler = (name: SoundName) => void

let handler: SoundHandler = () => {}

/** Register the audio backend (no-op by default; assets not yet shipped). */
export function setSoundHandler(fn: SoundHandler) { handler = fn }

export function emitSound(name: SoundName) { handler(name) }

const lastPlayed = new Map<SoundName, number>()

/** Debounce: identical events within 120ms collapse to one (§8). */
export function emitSoundDebounced(name: SoundName) {
  const now = Date.now()
  if (now - (lastPlayed.get(name) ?? 0) < 120) return
  lastPlayed.set(name, now)
  emitSound(name)
}

/** Map one GameEvent to its sound (§8 table). */
export function soundForEvent(ev: GameEvent): SoundName | null {
  switch (ev.type) {
    case 'PLAY_CARDS': return ev.cards.length > 1 ? 'play_multi' : 'play'
    case 'PICK_UP_PILE': return 'pickup'
    case 'CLEAR_PILE': return 'burn'
    case 'DRAW': return 'draw'
    case 'GAME_OVER': return 'round_end'
    case 'BLIND_REVEAL': return 'play'
    default: return null // win/lose are silent — silence is the design
  }
}

/** Subscribe a component to the GameEvent stream (state.log) for sound. */
export function useSoundFromLog(state: GameState | null, enabled: boolean) {
  const seenSeqRef = useRef<number | null>(null)
  useEffect(() => {
    if (!state) { seenSeqRef.current = null; return }
    const cursor = state.seq ?? state.turnCount
    // Mounting/re-enabling audio must never replay retained history.
    if (seenSeqRef.current === null) {
      seenSeqRef.current = cursor
      return
    }
    if (seenSeqRef.current === cursor) return
    seenSeqRef.current = cursor
    if (!enabled) return
    for (const ev of latestActionEvents(state.log)) {
      const name = soundForEvent(ev)
      if (name) emitSoundDebounced(name)
    }
  }, [state, enabled])
}
