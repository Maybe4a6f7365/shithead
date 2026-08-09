// ============================================================================
// App root — landing / online lobby / MP room / hot-seat lobby / SP table.
// ============================================================================
import { useState } from 'react'
import { useSPGame } from './sp/SPSinglePlayer'
import { LandingScreen } from './components/LandingScreen'
import { JoinCreateScreen } from './components/JoinCreateScreen'
import { HotSeatLobby } from './components/HotSeatLobby'
import { GameTable } from './components/GameTable'
import { MultiplayerGameTable } from './components/MultiplayerGameTable'
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
  return { name: 'landing' }
}

export function App() {
  const phase = useSPGame(s => s.state.phase)
  const [mode, setMode] = useState<Mode>(() => initialMode())

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
        />
      )
    case 'hotseat':
      if (phase === 'lobby') {
        return <HotSeatLobby onBack={() => setMode({ name: 'landing' })} />
      }
      return <GameTable onLeave={() => setMode({ name: 'landing' })} />
  }
}
