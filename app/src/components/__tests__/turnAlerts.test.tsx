// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  TurnAttentionBeacon,
  loadTurnAlertPreferences,
  useTurnAlertController,
  useTurnAlertPreferences,
  type TurnAlertControllerOptions,
} from '../turnAlerts'

const soundMocks = vi.hoisted(() => ({
  emitSoundDebounced: vi.fn(),
  setSoundMuted: vi.fn(),
  startLoopingSound: vi.fn(),
  stopSound: vi.fn(),
}))

vi.mock('../soundManager', () => soundMocks)

afterEach(() => {
  cleanup()
  localStorage.clear()
  soundMocks.emitSoundDebounced.mockClear()
  soundMocks.setSoundMuted.mockClear()
  soundMocks.startLoopingSound.mockClear()
  soundMocks.stopSound.mockClear()
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
  localHumanTurn: false,
  soundOn: true,
  turnAlertsEnabled: true,
  adhdMode: false,
}

function PreferenceHarness() {
  const { preferences, toggleSound, toggleTurnAlerts, toggleAdhdMode } = useTurnAlertPreferences()
  return (
    <>
      <button type="button" onClick={toggleSound}>Sound {preferences.soundOn ? 'on' : 'off'}</button>
      <button type="button" onClick={toggleTurnAlerts}>Alerts {preferences.turnAlertsEnabled ? 'on' : 'off'}</button>
      <button type="button" onClick={toggleAdhdMode}>ADHD {preferences.adhdMode ? 'on' : 'off'}</button>
    </>
  )
}

describe('turn alert preferences', () => {
  it('defaults alerts and sound on, with ADHD mode opt-in, and restores saved choices', () => {
    expect(loadTurnAlertPreferences(localStorage)).toEqual({
      soundOn: true,
      turnAlertsEnabled: true,
      adhdMode: false,
    })

    localStorage.setItem('shithead:sound', 'off')
    localStorage.setItem('shithead:turn-alerts', 'off')
    localStorage.setItem('shithead:adhd-mode', 'on')
    expect(loadTurnAlertPreferences(localStorage)).toEqual({
      soundOn: false,
      turnAlertsEnabled: false,
      adhdMode: true,
    })
  })

  it('persists every menu choice and applies mute to the shared sound backend', async () => {
    render(<PreferenceHarness />)
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(false))

    fireEvent.click(screen.getByRole('button', { name: 'Sound on' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alerts on' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADHD off' }))

    expect(localStorage.getItem('shithead:sound')).toBe('off')
    expect(localStorage.getItem('shithead:turn-alerts')).toBe('off')
    expect(localStorage.getItem('shithead:adhd-mode')).toBe('on')
    await waitFor(() => expect(soundMocks.setSoundMuted).toHaveBeenLastCalledWith(true))
  })
})

describe('turn alert transitions', () => {
  it('plays one normal cue when a local turn begins and never replays for the same actor', () => {
    const { rerender } = render(<AlertHarness {...waiting} />)
    soundMocks.emitSoundDebounced.mockClear()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSoundDebounced).toHaveBeenCalledTimes(1)
    expect(soundMocks.emitSoundDebounced).toHaveBeenCalledWith('turn_yours')

    // A phase/state update during the same person's turn is not a new turn.
    rerender(
      <AlertHarness
        {...waiting}
        phase="endgame"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSoundDebounced).toHaveBeenCalledTimes(1)
  })

  it('does not alert for the first already-live snapshot or when sound is muted', () => {
    const { rerender } = render(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
      />,
    )
    expect(soundMocks.emitSoundDebounced).not.toHaveBeenCalled()

    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="other"
        localHumanTurn={false}
        soundOn={false}
      />,
    )
    rerender(
      <AlertHarness
        {...waiting}
        phase="play"
        currentPlayerId="me"
        localHumanTurn
        soundOn={false}
      />,
    )
    expect(soundMocks.emitSoundDebounced).not.toHaveBeenCalled()
    expect(soundMocks.startLoopingSound).not.toHaveBeenCalled()
  })

  it('keeps the muted ADHD beacon visual while leaving audio stopped', async () => {
    const { rerender } = render(<AlertHarness {...waiting} adhdMode soundOn={false} />)
    soundMocks.startLoopingSound.mockClear()

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
      'Your turn. Tap anywhere or press any key to stop the attention alert.',
    )
    expect(soundMocks.startLoopingSound).not.toHaveBeenCalled()
  })

  it('loops ADHD audio and lets the first pointer or key action dismiss it without swallowing that action', async () => {
    const pointerAction = vi.fn()
    const keyAction = vi.fn()
    const { rerender } = render(
      <AlertHarness {...waiting} adhdMode onPointerDown={pointerAction} onKeyDown={keyAction} />,
    )
    soundMocks.startLoopingSound.mockClear()
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
    expect(soundMocks.startLoopingSound).toHaveBeenCalledTimes(1)
    expect(soundMocks.startLoopingSound).toHaveBeenCalledWith('turn_attention')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table action' }))
    expect(pointerAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByTestId('turn-attention-beacon')).toBeNull())
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention')

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
    expect(soundMocks.startLoopingSound).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Table action' }), { key: 'Shift' })
    expect(screen.getByTestId('turn-attention-beacon')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Table action' }), { key: 'Enter' })
    expect(keyAction).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByTestId('turn-attention-beacon')).toBeNull())
    expect(soundMocks.stopSound).toHaveBeenCalledWith('turn_attention')
  })
})
