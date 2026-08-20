// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  TurnAttentionBeacon,
  latestAcceptedGameplayAction,
  loadTurnAlertPreferences,
  useTurnAlertController,
  useTurnAlertPreferences,
  type TurnAlertControllerOptions,
} from '../turnAlerts'
import { QuietMenu } from '../QuietMenu'

const soundMocks = vi.hoisted(() => ({
  emitSound: vi.fn(),
  setSoundMuted: vi.fn(),
  soundNameForAdhdAlert: (sound: 'beat' | 'chime') => (
    sound === 'chime' ? 'turn_attention_chime' : 'turn_attention_beat'
  ),
  stopSound: vi.fn(),
}))

const vibrateMock = vi.fn()

vi.mock('../soundManager', () => soundMocks)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vibrateMock,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  sessionStorage.clear()
  soundMocks.emitSound.mockClear()
  soundMocks.setSoundMuted.mockClear()
  soundMocks.stopSound.mockClear()
  vibrateMock.mockReset()
})

interface AlertHarnessProps extends TurnAlertControllerOptions {
  onPointerDown?: () => void
  onKeyDown?: () => void
}

function AlertHarness({ onPointerDown, onKeyDown, ...options }: AlertHarnessProps) {
  const active = useTurnAlertController(options)
  return (
    <div className="game-screen">
      <TurnAttentionBeacon active={active} />
      <button type="button" onPointerDown={onPointerDown} onKeyDown={onKeyDown}>Table action</button>
    </div>
  )
}

const waiting: TurnAlertControllerOptions = {
  phase: 'waiting',
  currentPlayerId: null,
  turnCount: null,
  latestGameplayActorId: null,
  latestGameplayActionBurned: false,
  localHumanTurn: false,
  soundOn: true,
  turnAlertsEnabled: true,
  repeatTurnAlertsEnabled: false,
  adhdMode: false,
  adhdSound: 'beat',
}

function PreferenceHarness() {
  const {
    preferences,
    toggleSound,
    toggleTurnAlerts,
    toggleRepeatTurnAlerts,
    toggleAdhdMode,
    selectAdhdSound,
  } = useTurnAlertPreferences()
  return (
    <>
      <button type="button" onClick={toggleSound}>Sound {preferences.soundOn ? 'on' : 'off'}</button>
      <button type="button" onClick={toggleTurnAlerts}>Alerts {preferences.turnAlertsEnabled ? 'on' : 'off'}</button>
      <button type="button" onClick={toggleRepeatTurnAlerts}>
        Repeat alerts {preferences.repeatTurnAlertsEnabled ? 'on' : 'off'}
      </button>
      <button type="button" onClick={toggleAdhdMode}>ADHD {preferences.adhdMode ? 'on' : 'off'}</button>
      <button type="button" onClick={() => selectAdhdSound(preferences.adhdSound === 'beat' ? 'chime' : 'beat')}>
        ADHD sound {preferences.adhdSound}
      </button>
    </>
  )
}

function IntegratedAlertMenuHarness({
  phase,
  currentPlayerId,
  localHumanTurn,
}: Pick<TurnAlertControllerOptions, 'phase' | 'currentPlayerId' | 'localHumanTurn'>) {
  const {
    preferences,
    toggleSound,
    toggleTurnAlerts,
    toggleRepeatTurnAlerts,
    toggleAdhdMode,
    selectAdhdSound,
  } = useTurnAlertPreferences()
  const active = useTurnAlertController({
    phase,
    currentPlayerId,
    turnCount: null,
    latestGameplayActorId: null,
    latestGameplayActionBurned: false,
    localHumanTurn,
    ...preferences,
  })
  return (
    <div className="game-screen">
      <TurnAttentionBeacon active={active} />
      <QuietMenu
        onOpenRules={vi.fn()}
        soundOn={preferences.soundOn}
        onToggleSound={toggleSound}
        turnAlertsEnabled={preferences.turnAlertsEnabled}
        onToggleTurnAlerts={toggleTurnAlerts}
        repeatTurnAlertsEnabled={preferences.repeatTurnAlertsEnabled}
        onToggleRepeatTurnAlerts={toggleRepeatTurnAlerts}
        adhdMode={preferences.adhdMode}
        onToggleAdhdMode={toggleAdhdMode}
        adhdSound={preferences.adhdSound}
        onSelectAdhdSound={selectAdhdSound}
        onLeave={vi.fn()}
        matchRunning
      />
    </div>
  )
}

describe('turn alert preferences', () => {
  it('starts a fresh browser profile muted with repeat alerts and ADHD mode off', async () => {
    expect(loadTurnAlertPreferences(localStorage, sessionStorage)).toEqual({
      soundOn: false,
      turnAlertsEnabled: true,
      repeatTurnAlertsEnabled: false,
      adhdMode: false,
      adhdSound: 'beat',
    })

    render(<PreferenceHarness />)
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alerts on' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Repeat alerts off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ADHD off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ADHD sound beat' })).toBeTruthy()
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(true))
  })

  it('restores explicitly saved durable choices', () => {
    localStorage.setItem('shithead:sound', 'on')
    localStorage.setItem('shithead:turn-alerts', 'off')
    localStorage.setItem('shithead:repeat-turn-alerts', 'on')
    localStorage.setItem('shithead:adhd-mode', 'on')
    localStorage.setItem('shithead:adhd-sound', 'chime')
    expect(loadTurnAlertPreferences(localStorage, sessionStorage)).toEqual({
      soundOn: true,
      turnAlertsEnabled: false,
      repeatTurnAlertsEnabled: true,
      adhdMode: true,
      adhdSound: 'chime',
    })
  })

  it('migrates current-session values once into local storage', () => {
    sessionStorage.setItem('shithead:sound', 'on')
    sessionStorage.setItem('shithead:turn-alerts', 'off')
    sessionStorage.setItem('shithead:repeat-turn-alerts', 'on')
    sessionStorage.setItem('shithead:adhd-mode', 'on')
    sessionStorage.setItem('shithead:adhd-sound', 'chime')

    expect(loadTurnAlertPreferences(localStorage, sessionStorage)).toEqual({
      soundOn: true,
      turnAlertsEnabled: false,
      repeatTurnAlertsEnabled: true,
      adhdMode: true,
      adhdSound: 'chime',
    })
    expect(localStorage.getItem('shithead:sound')).toBe('on')
    expect(localStorage.getItem('shithead:turn-alerts')).toBe('off')
    expect(localStorage.getItem('shithead:repeat-turn-alerts')).toBe('on')
    expect(localStorage.getItem('shithead:adhd-mode')).toBe('on')
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('chime')
    expect(sessionStorage.getItem('shithead:sound')).toBeNull()
    expect(sessionStorage.getItem('shithead:turn-alerts')).toBeNull()
    expect(sessionStorage.getItem('shithead:repeat-turn-alerts')).toBeNull()
    expect(sessionStorage.getItem('shithead:adhd-mode')).toBeNull()
    expect(sessionStorage.getItem('shithead:adhd-sound')).toBeNull()
  })

  it('keeps an existing local choice ahead of a stale session value', () => {
    localStorage.setItem('shithead:sound', 'off')
    sessionStorage.setItem('shithead:sound', 'on')
    expect(loadTurnAlertPreferences(localStorage, sessionStorage).soundOn).toBe(false)
    expect(sessionStorage.getItem('shithead:sound')).toBeNull()
  })

  it('migrates the former second ADHD choice to Chime', () => {
    sessionStorage.setItem('shithead:adhd-sound', 'blast')
    expect(loadTurnAlertPreferences(localStorage, sessionStorage).adhdSound).toBe('chime')
  })

  it('persists every menu choice and applies mute to the shared sound backend', async () => {
    render(<PreferenceHarness />)
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: 'Sound off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alerts on' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat alerts off' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADHD off' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADHD sound beat' }))

    expect(localStorage.getItem('shithead:sound')).toBe('on')
    expect(localStorage.getItem('shithead:turn-alerts')).toBe('off')
    expect(localStorage.getItem('shithead:repeat-turn-alerts')).toBe('on')
    expect(localStorage.getItem('shithead:adhd-mode')).toBe('on')
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('chime')
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(false))
  })

  it('keeps previews silent while muted but still saves either selection', () => {
    render(<PreferenceHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'ADHD sound beat' }))
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('chime')
    fireEvent.click(screen.getByRole('button', { name: 'ADHD sound chime' }))
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('beat')
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
  })

  it('switches Chime back to Beat, previews gabber once, and uses it on the next ADHD turn', async () => {
    localStorage.setItem('shithead:sound', 'on')
    localStorage.setItem('shithead:adhd-mode', 'on')
    const { rerender } = render(
      <IntegratedAlertMenuHarness phase="waiting" currentPlayerId={null} localHumanTurn={false} />,
    )
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(false))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    soundMocks.emitSound.mockClear()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'ADHD sound: Chime' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: 'ADHD sound: Chime' }).getAttribute('aria-checked')).toBe('true')
    })
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('chime')
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_chime')

    soundMocks.emitSound.mockClear()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'ADHD sound: Beat' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: 'ADHD sound: Beat' }).getAttribute('aria-checked')).toBe('true')
    })
    expect(localStorage.getItem('shithead:adhd-sound')).toBe('beat')
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_yours')
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention_chime')
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_beat')

    soundMocks.emitSound.mockClear()
    rerender(<IntegratedAlertMenuHarness phase="play" currentPlayerId="other" localHumanTurn={false} />)
    rerender(<IntegratedAlertMenuHarness phase="play" currentPlayerId="me" localHumanTurn />)
    await waitFor(() => expect(soundMocks.emitSound).toHaveBeenCalledTimes(1))
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_beat')
  })
})

describe('turn alert transitions', () => {
  it('plays one normal cue when a local turn begins and never replays for the same actor', () => {
    const { rerender } = render(<AlertHarness {...waiting} />)
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_yours')
    expect(vibrateMock).toHaveBeenCalledTimes(1)
    expect(vibrateMock).toHaveBeenCalledWith([80, 45, 80])

    // A phase/state update during the same person's turn is not a new turn.
    rerender(
      <AlertHarness
        {...waiting}
        phase="endgame"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(vibrateMock).toHaveBeenCalledTimes(1)
  })

  it('alerts for an opted-in consecutive turn owned by the accepted actor', () => {
    const { rerender } = render(<AlertHarness {...waiting} />)
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={4}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={5}
        latestGameplayActorId="me"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )

    expect(soundMocks.emitSound).toHaveBeenCalledOnce()
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_yours')
    expect(vibrateMock).toHaveBeenCalledWith([80, 45, 80])
  })

  it.each([560, 140])('waits %i ms for burn cleanup before a repeat alert', (delay) => {
    vi.useFakeTimers()
    const { rerender } = render(<AlertHarness {...waiting} />)
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={4}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={5}
        latestGameplayActorId="me"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={delay}
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )

    act(() => vi.advanceTimersByTime(delay - 1))
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    expect(vibrateMock).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_yours')
    expect(vibrateMock).toHaveBeenCalledWith([80, 45, 80])

    // A burn that transfers ownership (for example, its actor went out) must
    // also wait for cleanup instead of chiming over the pile animation.
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="other"
        turnCount={6}
        latestGameplayActorId="other"
        localHumanTurn={false}
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={7}
        latestGameplayActorId="other"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={delay}
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    act(() => vi.advanceTimersByTime(delay - 1))
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_yours')
  })

  it('cancels a pending burn repeat alert when a newer action changes owner', () => {
    vi.useFakeTimers()
    const { rerender } = render(<AlertHarness {...waiting} />)
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={9}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={10}
        latestGameplayActorId="me"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={560}
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="other"
        turnCount={11}
        latestGameplayActorId="other"
        localHumanTurn={false}
        repeatTurnAlertsEnabled
      />,
    )
    act(() => vi.advanceTimersByTime(560))
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    expect(vibrateMock).toHaveBeenCalledWith(0)
    expect(vibrateMock).not.toHaveBeenCalledWith([80, 45, 80])
  })

  it('cancels pending burn alerts when alerts are disabled or the controller unmounts', () => {
    vi.useFakeTimers()
    const view = render(<AlertHarness {...waiting} />)
    view.rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={1}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()
    view.rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={2}
        latestGameplayActorId="me"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={560}
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    view.rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={2}
        latestGameplayActorId="me"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={560}
        localHumanTurn
        repeatTurnAlertsEnabled
        turnAlertsEnabled={false}
      />,
    )
    act(() => vi.advanceTimersByTime(560))
    expect(soundMocks.emitSound).not.toHaveBeenCalled()

    view.rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={3}
        latestGameplayActorId="me"
        latestGameplayActionBurned
        repeatTurnAlertDelayMs={560}
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    view.unmount()
    act(() => vi.advanceTimersByTime(560))
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
  })

  it('does not mistake another actor quick-following, a cosmetic update, or a skipped snapshot for a repeat turn', () => {
    const { rerender } = render(<AlertHarness {...waiting} />)
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={7}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()

    // Another player's authoritative quick follow-up changed the action count
    // while the already-current local player remained the turn owner.
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={8}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    // A phase-only render carries the same accepted-action cursor.
    rerender(
      <AlertHarness
        {...waiting}
        phase="endgame"
        currentPlayerId="me"
        turnCount={8}
        latestGameplayActorId="me"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    // A reconnect jump cannot prove that ownership was consecutive.
    rerender(
      <AlertHarness
        {...waiting}
        phase="endgame"
        currentPlayerId="me"
        turnCount={10}
        latestGameplayActorId="me"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )

    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    expect(vibrateMock).not.toHaveBeenCalled()
  })

  it('keeps the first already-live snapshot quiet even with repeat alerts enabled', () => {
    render(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        turnCount={12}
        latestGameplayActorId="me"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    expect(vibrateMock).not.toHaveBeenCalledWith([80, 45, 80])
    expect(vibrateMock).not.toHaveBeenCalledWith([120, 80, 120])
  })

  it('reuses the selected ADHD cue and beacon on an opted-in repeat turn', async () => {
    const { rerender } = render(<AlertHarness {...waiting} adhdMode adhdSound="chime" />)
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="me"
        turnCount={2}
        latestGameplayActorId="other"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table action' }))
    await waitFor(() => expect(screen.queryByTestId('turn-attention-beacon')).toBeNull())
    soundMocks.emitSound.mockClear()
    vibrateMock.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="me"
        turnCount={3}
        latestGameplayActorId="me"
        localHumanTurn
        repeatTurnAlertsEnabled
      />,
    )

    await waitFor(() => expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy())
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_chime')
    expect(vibrateMock).toHaveBeenCalledWith([120, 80, 120])
  })

  it('derives the accepted actor and burn flag from a play action group', () => {
    expect(latestAcceptedGameplayAction([
      { type: 'PLAY_CARDS', playerId: 'prior', cards: [{ id: 'c', rank: '6', suit: '♣' }] },
      { type: 'QUICK_FOLLOW_UP', playerId: 'prior', cards: [{ id: 'd', rank: '6', suit: '♦' }] },
      { type: 'CLEAR_PILE', reason: 'quartet' },
      { type: 'DRAW', playerId: 'prior', count: 1 },
    ])).toEqual({ actorId: 'prior', burned: true })
    expect(latestAcceptedGameplayAction([{ type: 'PHASE_CHANGE', phase: 'endgame' }])).toBeNull()
  })

  it('keeps haptic turn alerts active when sound is muted', () => {
    const { rerender } = render(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    vibrateMock.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="other"
        localHumanTurn={false}
        soundOn={false}
      />,
    )
    vibrateMock.mockClear()
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
        soundOn={false}
      />,
    )
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
    expect(vibrateMock).toHaveBeenCalledTimes(1)
    expect(vibrateMock).toHaveBeenCalledWith([80, 45, 80])
  })

  it('stops an active normal cue when turn alerts are disabled', () => {
    const { rerender } = render(<AlertHarness {...waiting} />)
    rerender(
      <AlertHarness {...waiting} phase="play" currentPlayerId="me" localHumanTurn />,
    )
    soundMocks.stopSound.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
        turnAlertsEnabled={false}
      />,
    )

    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_yours')
  })

  it('degrades safely when vibration is unavailable or rejected', () => {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: undefined,
    })
    const { rerender } = render(<AlertHarness {...waiting} />)
    expect(() => rerender(
      <AlertHarness {...waiting} phase="play" currentPlayerId="me" localHumanTurn />,
    )).not.toThrow()

    cleanup()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vi.fn(() => { throw new Error('policy blocked') }),
    })
    const second = render(<AlertHarness {...waiting} />)
    expect(() => second.rerender(
      <AlertHarness {...waiting} phase="play" currentPlayerId="me" localHumanTurn />,
    )).not.toThrow()
  })

  it('keeps the muted ADHD beacon visual while leaving audio stopped', async () => {
    const { rerender } = render(<AlertHarness {...waiting} adhdMode soundOn={false} />)
    soundMocks.emitSound.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        soundOn={false}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )

    await waitFor(() => expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain(
      'Your turn. Tap anywhere or press any key to dismiss the attention alert.',
    )
    expect(soundMocks.emitSound).not.toHaveBeenCalled()
  })

  it('plays ADHD audio once per new turn and lets the first action dismiss it without being swallowed', async () => {
    const pointerAction = vi.fn()
    const keyAction = vi.fn()
    const { rerender } = render(
      <AlertHarness {...waiting} adhdMode onPointerDown={pointerAction} onKeyDown={keyAction} />,
    )
    soundMocks.emitSound.mockClear()
    soundMocks.stopSound.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        phase="play"
        currentPlayerId="me"
        localHumanTurn
        onPointerDown={pointerAction}
        onKeyDown={keyAction}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy())
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_beat')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table action' }))
    expect(pointerAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByTestId('turn-attention-beacon')).toBeNull())
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention_beat')

    // Let another player take a turn, then return to the local player.
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        phase="play"
        currentPlayerId="other"
        localHumanTurn={false}
        onPointerDown={pointerAction}
        onKeyDown={keyAction}
      />,
    )
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        phase="play"
        currentPlayerId="me"
        localHumanTurn
        onPointerDown={pointerAction}
        onKeyDown={keyAction}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy())
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Table action' }), { key: 'Shift' })
    expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Table action' }), { key: 'Enter' })
    expect(keyAction).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByTestId('turn-attention-beacon')).toBeNull())
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention_beat')
  })

  it('uses the selected Chime sound for ADHD mode', async () => {
    const { rerender } = render(<AlertHarness {...waiting} adhdMode adhdSound="chime" />)
    soundMocks.emitSound.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )

    await waitFor(() => expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_chime'))
  })

  it('does not replay an active ADHD cue on rerender, selection change, or unmute', async () => {
    const { rerender } = render(<AlertHarness {...waiting} adhdMode />)
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    await waitFor(() => expect(soundMocks.emitSound).toHaveBeenCalledWith('turn_attention_beat'))
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)

    soundMocks.stopSound.mockClear()
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="endgame"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.stopSound).not.toHaveBeenCalledWith('turn_attention_beat')

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        soundOn={false}
        phase="endgame"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    await waitFor(() => expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention_beat'))

    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        soundOn
        phase="endgame"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSound).toHaveBeenCalledTimes(1)

    // Only genuinely losing and regaining the turn permits the new choice.
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="other"
        localHumanTurn={false}
      />,
    )
    rerender(
      <AlertHarness
        {...waiting}
        adhdMode
        adhdSound="chime"
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    await waitFor(() => expect(soundMocks.emitSound).toHaveBeenCalledTimes(2))
    expect(soundMocks.emitSound).toHaveBeenLastCalledWith('turn_attention_chime')
  })
})
