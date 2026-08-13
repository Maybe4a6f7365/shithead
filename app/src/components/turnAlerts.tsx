import { useCallback, useEffect, useRef, useState } from 'react'
import type { Phase } from '../engine'
import {
  emitSound,
  setSoundMuted,
  soundNameForAdhdAlert,
  stopSound,
  type AdhdAlertSound,
  type SoundName,
} from './soundManager'

const SOUND_KEY = 'shithead:sound'
const TURN_ALERTS_KEY = 'shithead:turn-alerts'
const ADHD_MODE_KEY = 'shithead:adhd-mode'
const ADHD_SOUND_KEY = 'shithead:adhd-sound'

export interface TurnAlertPreferences {
  soundOn: boolean
  turnAlertsEnabled: boolean
  adhdMode: boolean
  adhdSound: AdhdAlertSound
}

const DEFAULT_PREFERENCES: TurnAlertPreferences = {
  soundOn: false,
  turnAlertsEnabled: true,
  adhdMode: false,
  adhdSound: 'beat',
}

function browserStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function loadTurnAlertPreferences(storage: Pick<Storage, 'getItem'> | null = browserStorage()): TurnAlertPreferences {
  if (!storage) return { ...DEFAULT_PREFERENCES }
  try {
    const storedAdhdSound = storage.getItem(ADHD_SOUND_KEY)
    return {
      soundOn: storage.getItem(SOUND_KEY) === 'on',
      turnAlertsEnabled: storage.getItem(TURN_ALERTS_KEY) !== 'off',
      adhdMode: storage.getItem(ADHD_MODE_KEY) === 'on',
      // Preserve the user's former second-option choice across the rename.
      adhdSound: storedAdhdSound === 'chime' || storedAdhdSound === 'blast' ? 'chime' : 'beat',
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

function persistPreference(key: string, enabled: boolean): void {
  try { browserStorage()?.setItem(key, enabled ? 'on' : 'off') } catch { /* storage is optional */ }
}

function persistValue(key: string, value: string): void {
  try { browserStorage()?.setItem(key, value) } catch { /* storage is optional */ }
}

/** Shared sensory preferences for this browser tab's current play session. */
export function useTurnAlertPreferences() {
  const [preferences, setPreferences] = useState(loadTurnAlertPreferences)

  useEffect(() => {
    setSoundMuted(!preferences.soundOn)
  }, [preferences.soundOn])

  const toggleSound = useCallback(() => {
    setPreferences(current => {
      const soundOn = !current.soundOn
      persistPreference(SOUND_KEY, soundOn)
      return { ...current, soundOn }
    })
  }, [])

  const toggleTurnAlerts = useCallback(() => {
    setPreferences(current => {
      const turnAlertsEnabled = !current.turnAlertsEnabled
      persistPreference(TURN_ALERTS_KEY, turnAlertsEnabled)
      return { ...current, turnAlertsEnabled }
    })
  }, [])

  const toggleAdhdMode = useCallback(() => {
    setPreferences(current => {
      const adhdMode = !current.adhdMode
      persistPreference(ADHD_MODE_KEY, adhdMode)
      return { ...current, adhdMode }
    })
  }, [])

  const selectAdhdSound = useCallback((adhdSound: AdhdAlertSound) => {
    persistValue(ADHD_SOUND_KEY, adhdSound)
    setPreferences(current => ({ ...current, adhdSound }))
  }, [])

  return { preferences, toggleSound, toggleTurnAlerts, toggleAdhdMode, selectAdhdSound }
}

interface TurnSnapshot {
  phase: Phase | 'waiting' | null
  gameplay: boolean
  currentPlayerId: string | null
}

export interface TurnAlertControllerOptions extends TurnAlertPreferences {
  phase: Phase | 'waiting' | null
  currentPlayerId: string | null
  /** True only when the current actor is a human controlled on this device. */
  localHumanTurn: boolean
}

function isGameplayPhase(phase: TurnSnapshot['phase']): boolean {
  return phase === 'play' || phase === 'endgame'
}

/** Best-effort haptics: unsupported or policy-blocked vibration stays silent. */
function vibrate(pattern: VibratePattern): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(pattern)
  } catch {
    // Some browsers expose the API while denying it in the current context.
  }
}

/**
 * Alert only when ownership enters a new local human turn. State sequence
 * changes made by that same player (burns, pickups, quick follow-ups) do not
 * retrigger it, and a first already-live snapshot after refresh stays quiet.
 */
export function shouldStartTurnAlert(previous: TurnSnapshot | null, next: TurnSnapshot): boolean {
  if (!previous || previous.phase === null || !next.gameplay || !next.currentPlayerId) return false
  if (!previous.gameplay) return true
  return previous.currentPlayerId !== null && previous.currentPlayerId !== next.currentPlayerId
}

/** Owns one-shot sensory cues and the persistent attention visual. */
export function useTurnAlertController({
  phase,
  currentPlayerId,
  localHumanTurn,
  soundOn,
  turnAlertsEnabled,
  adhdMode,
  adhdSound,
}: TurnAlertControllerOptions): boolean {
  const [attentionActive, setAttentionActive] = useState(false)
  const previous = useRef<TurnSnapshot | null>(null)
  const activeAttentionSound = useRef<SoundName | null>(null)

  const dismissAttention = useCallback(() => {
    setAttentionActive(false)
    if (activeAttentionSound.current) stopSound(activeAttentionSound.current)
    activeAttentionSound.current = null
    vibrate(0)
  }, [])

  useEffect(() => {
    const next: TurnSnapshot = {
      phase,
      gameplay: isGameplayPhase(phase),
      currentPlayerId,
    }
    const start = localHumanTurn && shouldStartTurnAlert(previous.current, next)
    previous.current = next

    if (!next.gameplay || !localHumanTurn) {
      dismissAttention()
      stopSound('turn_yours')
      return
    }
    if (!start || !turnAlertsEnabled) return

    if (adhdMode) {
      setAttentionActive(true)
      if (soundOn) {
        const sound = soundNameForAdhdAlert(adhdSound)
        activeAttentionSound.current = sound
        emitSound(sound)
      }
      vibrate([120, 80, 120])
    } else {
      // Haptics are a turn alert, not audio: muting sound must not suppress
      // vibration on browsers that support the Vibration API.
      if (soundOn) emitSound('turn_yours')
      vibrate([80, 45, 80])
    }
  }, [adhdMode, adhdSound, currentPlayerId, dismissAttention, localHumanTurn, phase, soundOn, turnAlertsEnabled])

  useEffect(() => {
    if (!turnAlertsEnabled) {
      dismissAttention()
      stopSound('turn_yours')
    } else if (!adhdMode) {
      dismissAttention()
    }
  }, [adhdMode, dismissAttention, turnAlertsEnabled])

  useEffect(() => {
    if (!soundOn) {
      stopSound('turn_yours')
      if (activeAttentionSound.current) stopSound(activeAttentionSound.current)
      activeAttentionSound.current = null
    }
  }, [soundOn])

  useEffect(() => {
    if (!attentionActive) return
    const dismissPointer = () => dismissAttention()
    const dismissKey = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(event.key)) return
      dismissAttention()
    }
    document.addEventListener('pointerdown', dismissPointer, true)
    document.addEventListener('keydown', dismissKey, true)
    return () => {
      document.removeEventListener('pointerdown', dismissPointer, true)
      document.removeEventListener('keydown', dismissKey, true)
    }
  }, [attentionActive, dismissAttention])

  useEffect(() => () => {
    if (activeAttentionSound.current) stopSound(activeAttentionSound.current)
    activeAttentionSound.current = null
    stopSound('turn_yours')
    vibrate(0)
  }, [])

  return attentionActive
}

/** Decorative, pointer-transparent beacon. The first real press still acts. */
export function TurnAttentionBeacon({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <>
      <div className="turn-attention-beacon" data-testid="turn-attention-beacon" aria-hidden="true">
        <div className="turn-attention-beacon__label">
          <strong>Your turn</strong>
          <span>Tap anywhere to dismiss</span>
        </div>
      </div>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        Your turn. Tap anywhere or press any key to dismiss the attention alert.
      </span>
    </>
  )
}
