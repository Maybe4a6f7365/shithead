import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameEvent, Phase } from '../engine'
import { latestActionEvents } from './feedText'
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
const REPEAT_TURN_ALERTS_KEY = 'shithead:repeat-turn-alerts'
const ADHD_MODE_KEY = 'shithead:adhd-mode'
const ADHD_SOUND_KEY = 'shithead:adhd-sound'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface TurnAlertPreferences {
  soundOn: boolean
  turnAlertsEnabled: boolean
  repeatTurnAlertsEnabled: boolean
  adhdMode: boolean
  adhdSound: AdhdAlertSound
}

const DEFAULT_PREFERENCES: TurnAlertPreferences = {
  soundOn: false,
  turnAlertsEnabled: true,
  repeatTurnAlertsEnabled: false,
  adhdMode: false,
  adhdSound: 'beat',
}

function browserLocalStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function browserSessionStorage(): PreferenceStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * Prefer durable local storage. A value left by the former tab-scoped version
 * is copied once and removed only after that copy succeeds.
 */
function readStoredValue(
  key: string,
  storage: PreferenceStorage | null,
  legacyStorage: PreferenceStorage | null,
): string | null {
  try {
    const current = storage?.getItem(key) ?? null
    if (current !== null) {
      if (legacyStorage && legacyStorage !== storage) {
        try { legacyStorage.removeItem(key) } catch { /* the durable value already wins */ }
      }
      return current
    }
  } catch {
    // A policy-blocked localStorage must not prevent the session fallback.
  }

  let legacy: string | null = null
  try { legacy = legacyStorage?.getItem(key) ?? null } catch { return null }
  if (legacy === null) return null

  if (storage) {
    try {
      storage.setItem(key, legacy)
      try { legacyStorage?.removeItem(key) } catch { /* the durable copy is enough */ }
    } catch {
      // Keep the session value when durable storage is unavailable.
    }
  }
  return legacy
}

export function loadTurnAlertPreferences(
  storage: PreferenceStorage | null = browserLocalStorage(),
  legacyStorage: PreferenceStorage | null = browserSessionStorage(),
): TurnAlertPreferences {
  try {
    const storedAdhdSound = readStoredValue(ADHD_SOUND_KEY, storage, legacyStorage)
    return {
      soundOn: readStoredValue(SOUND_KEY, storage, legacyStorage) === 'on',
      turnAlertsEnabled: readStoredValue(TURN_ALERTS_KEY, storage, legacyStorage) !== 'off',
      repeatTurnAlertsEnabled: readStoredValue(REPEAT_TURN_ALERTS_KEY, storage, legacyStorage) === 'on',
      adhdMode: readStoredValue(ADHD_MODE_KEY, storage, legacyStorage) === 'on',
      // Preserve the user's former second-option choice across the rename.
      adhdSound: storedAdhdSound === 'chime' || storedAdhdSound === 'blast' ? 'chime' : 'beat',
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

function persistPreference(key: string, enabled: boolean): void {
  const value = enabled ? 'on' : 'off'
  try {
    const storage = browserLocalStorage()
    if (storage) {
      storage.setItem(key, value)
      return
    }
  } catch { /* fall back to this tab */ }
  try { browserSessionStorage()?.setItem(key, value) } catch { /* storage is optional */ }
}

function persistValue(key: string, value: string): void {
  try {
    const storage = browserLocalStorage()
    if (storage) {
      storage.setItem(key, value)
      return
    }
  } catch { /* fall back to this tab */ }
  try { browserSessionStorage()?.setItem(key, value) } catch { /* storage is optional */ }
}

/** Shared sensory preferences retained for later games on this browser origin. */
export function useTurnAlertPreferences() {
  const [preferences, setPreferences] = useState(loadTurnAlertPreferences)
  const [previewSound, setPreviewSound] = useState<SoundName | null>(null)

  useEffect(() => {
    setSoundMuted(!preferences.soundOn)
    if (!preferences.soundOn) setPreviewSound(null)
  }, [preferences.soundOn])

  useEffect(() => {
    if (!previewSound) return
    const dismissPointer = () => setPreviewSound(null)
    const dismissKey = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(event.key)) return
      setPreviewSound(null)
    }
    document.addEventListener('pointerdown', dismissPointer, true)
    document.addEventListener('keydown', dismissKey, true)
    return () => {
      document.removeEventListener('pointerdown', dismissPointer, true)
      document.removeEventListener('keydown', dismissKey, true)
      stopSound(previewSound)
    }
  }, [previewSound])

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

  const toggleRepeatTurnAlerts = useCallback(() => {
    setPreferences(current => {
      const repeatTurnAlertsEnabled = !current.repeatTurnAlertsEnabled
      persistPreference(REPEAT_TURN_ALERTS_KEY, repeatTurnAlertsEnabled)
      return { ...current, repeatTurnAlertsEnabled }
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
    // Make both directions immediately verifiable. A selection is a single,
    // user-initiated preview and never changes the automatic one-play-per-turn
    // behavior. Stop either previous sample before starting the new choice.
    stopSound('turn_yours')
    stopSound('turn_attention_beat')
    stopSound('turn_attention_chime')
    setPreviewSound(null)
    if (preferences.soundOn) {
      const sound = soundNameForAdhdAlert(adhdSound)
      emitSound(sound)
      setPreviewSound(sound)
    }
  }, [preferences.soundOn])

  return {
    preferences,
    toggleSound,
    toggleTurnAlerts,
    toggleRepeatTurnAlerts,
    toggleAdhdMode,
    selectAdhdSound,
  }
}

interface TurnSnapshot {
  phase: Phase | 'waiting' | null
  gameplay: boolean
  currentPlayerId: string | null
  turnCount: number | null
  latestGameplayActorId: string | null
  latestGameplayActionBurned: boolean
}

export interface TurnAlertControllerOptions extends TurnAlertPreferences {
  phase: Phase | 'waiting' | null
  currentPlayerId: string | null
  /** Authoritative accepted-gameplay cursor; null before a game is available. */
  turnCount: number | null
  /** Actor of the latest accepted play/pickup action, derived from the game log. */
  latestGameplayActorId: string | null
  /** True when that action also contains an authoritative CLEAR_PILE event. */
  latestGameplayActionBurned: boolean
  /** Burn cleanup duration supplied by the table's reduced-motion timing. */
  repeatTurnAlertDelayMs?: number
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
 * Alert when ownership enters a local turn, plus opted-in consecutive turns
 * that an accepted action genuinely leaves with the same actor. Merely
 * rerendering, changing phase, or receiving another actor's quick follow-up
 * cannot pass the turn-count/actor gate. A first live refresh stays quiet.
 */
export function shouldStartTurnAlert(
  previous: TurnSnapshot | null,
  next: TurnSnapshot,
  repeatTurnAlertsEnabled = false,
): boolean {
  if (!previous || previous.phase === null || !next.gameplay || !next.currentPlayerId) return false
  if (!previous.gameplay) return true
  if (previous.currentPlayerId !== null && previous.currentPlayerId !== next.currentPlayerId) return true
  return repeatTurnAlertsEnabled &&
    previous.currentPlayerId === next.currentPlayerId &&
    previous.turnCount !== null &&
    next.turnCount === previous.turnCount + 1 &&
    next.latestGameplayActorId === next.currentPlayerId
}

export interface AcceptedGameplayActionAlertMeta {
  actorId: string
  burned: boolean
}

/** Public action metadata is sufficient; no private cards or schema field is needed. */
export function latestAcceptedGameplayAction(
  log: readonly GameEvent[],
): AcceptedGameplayActionAlertMeta | null {
  const events = latestActionEvents([...log])
  const action = events.find(event =>
    event.type === 'PLAY_CARDS' || event.type === 'PICK_UP_PILE'
  )
  return action && 'playerId' in action
    ? { actorId: action.playerId, burned: events.some(event => event.type === 'CLEAR_PILE') }
    : null
}

/** Owns one-shot sensory cues and the persistent attention visual. */
export function useTurnAlertController({
  phase,
  currentPlayerId,
  turnCount,
  latestGameplayActorId,
  latestGameplayActionBurned,
  repeatTurnAlertDelayMs = 0,
  localHumanTurn,
  soundOn,
  turnAlertsEnabled,
  repeatTurnAlertsEnabled,
  adhdMode,
  adhdSound,
}: TurnAlertControllerOptions): boolean {
  const [attentionActive, setAttentionActive] = useState(false)
  const previous = useRef<TurnSnapshot | null>(null)
  const sensoryPreferences = useRef({ soundOn, adhdMode, adhdSound })
  sensoryPreferences.current = { soundOn, adhdMode, adhdSound }

  const dismissAttention = useCallback(() => {
    setAttentionActive(false)
    stopSound('turn_attention_beat')
    stopSound('turn_attention_chime')
    vibrate(0)
  }, [])

  const startSensoryAlert = useCallback(() => {
    const sensory = sensoryPreferences.current
    if (sensory.adhdMode) {
      setAttentionActive(true)
      if (sensory.soundOn) emitSound(soundNameForAdhdAlert(sensory.adhdSound))
      vibrate([120, 80, 120])
    } else {
      // Haptics are a turn alert, not audio: muting sound must not suppress
      // vibration on browsers that support the Vibration API.
      if (sensory.soundOn) emitSound('turn_yours')
      vibrate([80, 45, 80])
    }
  }, [])

  useEffect(() => {
    const next: TurnSnapshot = {
      phase,
      gameplay: isGameplayPhase(phase),
      currentPlayerId,
      turnCount,
      latestGameplayActorId,
      latestGameplayActionBurned,
    }
    const prior = previous.current
    const start = localHumanTurn && shouldStartTurnAlert(
      prior,
      next,
      repeatTurnAlertsEnabled,
    )
    previous.current = next

    if (!next.gameplay || !localHumanTurn) {
      dismissAttention()
      stopSound('turn_yours')
      return
    }
    if (!start || !turnAlertsEnabled) return

    // Any burn-derived local turn waits for the visual pile cleanup. This also
    // covers an interrupt/quick-follow-up burn that transfers ownership, not
    // only the common case where the same actor keeps the turn.
    if (next.latestGameplayActionBurned && repeatTurnAlertDelayMs > 0) {
      const timer = setTimeout(startSensoryAlert, repeatTurnAlertDelayMs)
      return () => clearTimeout(timer)
    }
    startSensoryAlert()
  }, [
    currentPlayerId,
    dismissAttention,
    latestGameplayActionBurned,
    latestGameplayActorId,
    localHumanTurn,
    phase,
    repeatTurnAlertDelayMs,
    repeatTurnAlertsEnabled,
    startSensoryAlert,
    turnAlertsEnabled,
    turnCount,
  ])

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
      stopSound('turn_attention_beat')
      stopSound('turn_attention_chime')
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
    stopSound('turn_attention_beat')
    stopSound('turn_attention_chime')
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
