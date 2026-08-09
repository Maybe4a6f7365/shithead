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

type Mode =
  | { name: 'landing' }
  | { name: 'join-create' }
  | { name: 'mp-room'; roomId: string; playerName: string; intent: 'create' | 'join' }
  | { name: 'hotseat' }

export function App() {
  const phase = useSPGame(s => s.state.phase)
  const [mode, setMode] = useState<Mode>({ name: 'landing' })

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
