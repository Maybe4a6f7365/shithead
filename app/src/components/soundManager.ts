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
  | 'burn' | 'turn_yours' | 'turn_attention_beat' | 'turn_attention_chime'
  | 'invalid' | 'round_end' | 'reconnect_restored'
  | 'player_joined' | 'player_left'

export type AdhdAlertSound = 'beat' | 'chime'

export function soundNameForAdhdAlert(sound: AdhdAlertSound): SoundName {
  return sound === 'chime' ? 'turn_attention_chime' : 'turn_attention_beat'
}

export type SoundHandler = (name: SoundName) => void

let handler: SoundHandler = () => {}
// Audio stays gated until the session preference effect explicitly enables it.
let muted = true

const browserAudioAssets: Partial<Record<SoundName, { src: string; volume: number }>> = {
  // The short chime is shared by the standard alert and ADHD Chime option.
  turn_yours: { src: '/audio/turn-notification.mp3', volume: 0.55 },
  // The gabber cue is sustained and peaks at full scale. Keep its one-shot
  // playback well below the short notification.
  turn_attention_beat: { src: '/audio/adhd-beat.mp3', volume: 0.25 },
  turn_attention_chime: { src: '/audio/turn-notification.mp3', volume: 0.55 },
}

type BrowserAudioRecord = {
  element: HTMLAudioElement
  active: boolean
  playId: number
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
  const record: BrowserAudioRecord = { element, active: false, playId: 0 }
  element.addEventListener('ended', () => {
    record.active = false
  })
  browserAudio.set(name, record)
  return record
}

function safelyPlay(record: BrowserAudioRecord) {
  const playId = ++record.playId
  record.active = true
  // Every app sound is a one-shot. Keeping this invariant next to play()
  // prevents a reused media element from retaining an outside loop setting.
  record.element.loop = false
  try {
    const result = record.element.play()
    void Promise.resolve(result).catch(() => {
      // A rejected promise from an older attempt must not mark a newer replay
      // inactive and make it impossible to stop.
      if (record.playId === playId) record.active = false
    })
  } catch {
    // Browser autoplay policies and incomplete media support may reject or
    // synchronously throw. A missed cue must never break the game UI.
    if (record.playId === playId) record.active = false
  }
}

function playBrowserSound(name: SoundName) {
  const record = getBrowserAudio(name)
  if (!record) return

  if (record.active) {
    try { record.element.pause() } catch { /* best-effort reset */ }
  }
  record.active = false
  record.element.loop = false
  try { record.element.currentTime = 0 } catch { /* metadata may not be ready */ }
  safelyPlay(record)
}

/** Install the asset-backed browser handler. Safe to call more than once. */
export function installBrowserAudioBackend() {
  if (typeof Audio === 'undefined') return
  setSoundHandler(playBrowserSound)
}

/** Stop one mapped sound, or every active sound when no name is supplied. */
export function stopSound(name?: SoundName) {
  const records = name
    ? [browserAudio.get(name)].filter((record): record is BrowserAudioRecord => Boolean(record))
    : [...browserAudio.values()]

  for (const record of records) {
    if (!record.active && !record.element.loop) continue
    record.playId += 1
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
