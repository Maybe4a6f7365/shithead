// ============================================================================
// App root — landing / online lobby / MP room / hot-seat lobby / SP table.
// ============================================================================
import { useEffect, useState } from 'react'
import { hasResumableLocalRound, useSPGame } from './sp/SPSinglePlayer'
import { LandingScreen } from './components/LandingScreen'
import { JoinCreateScreen } from './components/JoinCreateScreen'
import { HotSeatLobby } from './components/HotSeatLobby'
import { GameTable } from './components/GameTable'
import { GhostBtn, MultiplayerGameTable, PrimaryBtn, StatePanel } from './components/MultiplayerGameTable'
import { pushBackHandler } from './backStack'
import { loadRestoredRoomIntent } from './net/useMultiplayerRoom'

export type Mode =
  | { name: 'landing' }
  | { name: 'join-create' }
  | { name: 'mp-room'; roomId: string; playerName: string; intent: 'create' | 'join' }
  | { name: 'hotseat' }

/** Refresh-safe initial route with explicit invite links taking precedence. */
export function initialMode(search = typeof window === 'undefined' ? '' : window.location.search): Mode {
  const linkedParam = new URLSearchParams(search).get('room')
  const linkedRoom = linkedParam && /^[A-Z0-9]{6}$/i.test(linkedParam) ? linkedParam.toUpperCase() : null
  const restored = loadRestoredRoomIntent()
  // A deliberately opened invite for another room must not be swallowed by
  // an older saved seat. The same-room invite still resumes securely.
  if (restored && (!linkedRoom || linkedRoom === restored.roomId)) {
    return {
      name: 'mp-room',
      roomId: restored.roomId,
      playerName: restored.playerName,
      intent: restored.intent,
    }
  }

  if (linkedRoom) return { name: 'join-create' }
  // A pass-and-play round interrupted by a reload resumes on its table.
  if (hasResumableLocalRound()) return { name: 'hotseat' }
  return { name: 'landing' }
}

export function App() {
  const phase = useSPGame(s => s.state.phase)
  const [mode, setMode] = useState<Mode>(() => initialMode())
  const [leavePrompt, setLeavePrompt] = useState(false)
  const [backGuardKey, setBackGuardKey] = useState(0)
  const [mpLeaveRequest, setMpLeaveRequest] = useState(0)
  const inMatch = mode.name === 'mp-room' || (mode.name === 'hotseat' && phase !== 'lobby')

  // System Back: sub-screens return to the landing screen; a running match
  // asks first and stays put. On the landing screen Back leaves the app.
  useEffect(() => {
    if (mode.name === 'landing') return
    return pushBackHandler(() => {
      if (inMatch) {
        setLeavePrompt(open => !open)
        setBackGuardKey(key => key + 1)
      } else {
        setMode({ name: 'landing' })
      }
    })
  }, [mode.name, inMatch, backGuardKey])

  useEffect(() => {
    if (!inMatch) setLeavePrompt(false)
  }, [inMatch])

  const confirmLeave = () => {
    setLeavePrompt(false)
    if (mode.name === 'mp-room') {
      setMpLeaveRequest(request => request + 1)
    } else {
      useSPGame.getState().reset()
      setMode({ name: 'landing' })
    }
  }

  return (
    <>
      {renderMode()}
      {leavePrompt && inMatch && (
        <StatePanel
          title="Leave the game?"
          copy={mode.name === 'mp-room'
            ? 'The table carries on without you.'
            : 'This round will be discarded.'}
          actions={<>
            <PrimaryBtn onClick={() => setLeavePrompt(false)}>Stay</PrimaryBtn>
            <GhostBtn onClick={confirmLeave}>Leave</GhostBtn>
          </>}
        />
      )}
    </>
  )

  function renderMode() {
  switch (mode.name) {
    case 'landing':
      return (
        <LandingScreen
          onPlayOnline={() => setMode({ name: 'join-create' })}
          onPassAndPlay={() => setMode({ name: 'hotseat' })}
        />
      )
    case 'join-create':
      return (
        <JoinCreateScreen
          onBack={() => setMode({ name: 'landing' })}
          onEnterRoom={(roomId, playerName, intent) => setMode({ name: 'mp-room', roomId, playerName, intent })}
        />
      )
    case 'mp-room':
      return (
        <MultiplayerGameTable
          roomId={mode.roomId}
          playerName={mode.playerName}
          intent={mode.intent}
          onLeave={() => setMode({ name: 'landing' })}
          leaveRequest={mpLeaveRequest}
        />
      )
    case 'hotseat':
      if (phase === 'lobby') {
        return <HotSeatLobby onBack={() => setMode({ name: 'landing' })} />
      }
      return <GameTable onLeave={() => setMode({ name: 'landing' })} />
  }
  }
}
