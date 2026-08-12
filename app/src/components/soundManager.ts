// ============================================================================
// SoundManager (DESIGN.md §8). Components dispatch semantic sound names and
// the installed backend decides how to render them. The default remains a
// no-op so tests and non-browser runtimes can provide their own handler.
// ============================================================================
import { useEffect, useRef } from 'react'
import type { GameEvent, GameState } from '../engine'
import { latestActionEvents } from './feedText'

export type SoundName =
  | 'deal' | 'select' | 'deselect' | 'play' | 'play_multi' | 'draw' | 'pickup'
  | 'burn' | 'turn_yours' | 'turn_attention' | 'invalid' | 'round_end' | 'reconnect_restored'
  | 'player_joined' | 'player_left'

export type SoundHandler = (name: SoundName) => void

let handler: SoundHandler = () => {}
let muted = false

const browserAudioAssets: Partial<Record<SoundName, { src: string; volume: number }>> = {
  turn_yours: { src: '/audio/turn-notification.mp3', volume: 0.85 },
  // The public-domain alarm peaks at full scale, so keep the persistent cue
  // deliberately lower than the gentle one-shot notification.
  turn_attention: { src: '/audio/attention-alert.mp3', volume: 0.35 },
}

type BrowserAudioRecord = {
  element: HTMLAudioElement
  active: boolean
}

const browserAudio = new Map<SoundName, BrowserAudioRecord>()

/** Register an audio backend (no-op by default). */
export function setSoundHandler(fn: SoundHandler) { handler = fn }

/** Globally gate every sound path, including direct UI feedback. */
export function setSoundMuted(nextMuted: boolean) {
  muted = nextMuted
  if (muted) stopSound()
}

export function emitSound(name: SoundName) {
  if (!muted) handler(name)
}

function getBrowserAudio(name: SoundName): BrowserAudioRecord | null {
  const asset = browserAudioAssets[name]
  if (!asset || typeof Audio === 'undefined') return null

  const existing = browserAudio.get(name)
  if (existing) return existing

  const element = new Audio(asset.src)
  element.preload = 'auto'
  element.volume = asset.volume
  const record: BrowserAudioRecord = { element, active: false }
  element.addEventListener('ended', () => {
    if (!element.loop) record.active = false
  })
  browserAudio.set(name, record)
  return record
}

function safelyPlay(record: BrowserAudioRecord) {
  record.active = true
  try {
    const result = record.element.play()
    void Promise.resolve(result).catch(() => {
      record.active = false
      record.element.loop = false
    })
  } catch {
    // Browser autoplay policies and incomplete media support may reject or
    // synchronously throw. A missed cue must never break the game UI.
    record.active = false
    record.element.loop = false
  }
}

function playBrowserSound(name: SoundName, loop: boolean) {
  const record = getBrowserAudio(name)
  if (!record) return

  if (record.active) {
    try { record.element.pause() } catch { /* best-effort reset */ }
  }
  record.active = false
  record.element.loop = loop
  try { record.element.currentTime = 0 } catch { /* metadata may not be ready */ }
  safelyPlay(record)
}

/** Install the asset-backed browser handler. Safe to call more than once. */
export function installBrowserAudioBackend() {
  if (typeof Audio === 'undefined') return
  setSoundHandler((name) => playBrowserSound(name, false))
}

/** Start a mapped sound continuously until stopSound() is called. */
export function startLoopingSound(name: SoundName) {
  if (muted) return
  playBrowserSound(name, true)
}

/** Stop one mapped sound, or every active sound when no name is supplied. */
export function stopSound(name?: SoundName) {
  const records = name
    ? [browserAudio.get(name)].filter((record): record is BrowserAudioRecord => Boolean(record))
    : [...browserAudio.values()]

  for (const record of records) {
    if (!record.active && !record.element.loop) continue
    try { record.element.pause() } catch { /* already stopped/unavailable */ }
    record.active = false
    record.element.loop = false
    try { record.element.currentTime = 0 } catch { /* metadata may not be ready */ }
  }
}

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
