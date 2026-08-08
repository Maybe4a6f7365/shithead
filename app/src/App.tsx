// ============================================================================
// App root — chooses between single-player (local AI) and multiplayer
// ============================================================================
import { useState } from 'react'
import { useSPGame } from './sp/SPSinglePlayer'
import { Lobby } from './components/Lobby'
import { GameTable } from './components/GameTable'
import { MultiplayerLobby } from './components/MultiplayerLobby'
import { MultiplayerGameTable } from './components/MultiplayerGameTable'

type Mode = 'menu' | 'single' | 'multi-lobby' | 'multi-game'

export function App() {
  const phase = useSPGame(s => s.state.phase)
  const [mode, setMode] = useState<Mode>('menu')
  const [roomId, setRoomId] = useState<string | null>(null)

  if (mode === 'menu') {
    return (
      <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 shadow-2xl text-center">
          <h1 className="text-5xl font-black text-[#a23a1e] mb-2 tracking-tight">SHITHEAD</h1>
          <p className="text-[#2d4a2b]/70 mb-6 text-sm">The classic shedding card game</p>

          <button
            onClick={() => setMode('single')}
            className="w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition mb-3"
          >
            SINGLE PLAYER
          </button>
          <button
            onClick={() => setMode('multi-lobby')}
            className="w-full py-4 rounded-xl bg-[#2d4a2b] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition"
          >
            PLAY ONLINE
          </button>

          <div className="mt-6 text-[10px] text-[#2d4a2b]/40">
            <a href="/leaderboard" className="hover:underline">Leaderboard</a>
            {' · '}
            <a href="/about" className="hover:underline">About</a>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'multi-lobby') {
    return (
      <MultiplayerLobby
        onJoin={(rid) => {
          setRoomId(rid)
          setMode('multi-game')
        }}
      />
    )
  }

  if (mode === 'multi-game' && roomId) {
    return (
      <MultiplayerGameTable
        roomId={roomId}
        onLeave={() => {
          setRoomId(null)
          setMode('menu')
        }}
      />
    )
  }

  // single-player
  if (phase === 'lobby') return <Lobby />
  return <GameTable />
}
