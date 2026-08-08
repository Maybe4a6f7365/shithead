import { useState } from 'react'
import { useSPGame } from '../sp/SPSinglePlayer'

export function Lobby() {
  const initGame = useSPGame(s => s.initGame)
  const [players, setPlayers] = useState([
    { name: 'You', isAI: false },
    { name: 'Hans', isAI: true, difficulty: 'medium' as const },
    { name: 'Greta', isAI: true, difficulty: 'easy' as const },
  ])

  const addPlayer = () => {
    if (players.length >= 5) return
    setPlayers([...players, { name: `Player ${players.length + 1}`, isAI: true, difficulty: 'medium' }])
  }
  const removePlayer = (idx: number) => {
    if (players.length <= 2) return
    setPlayers(players.filter((_, i) => i !== idx))
  }
  const updateName = (idx: number, name: string) => {
    setPlayers(players.map((p, i) => i === idx ? { ...p, name } : p))
  }
  const setAI = (idx: number, isAI: boolean) => {
    setPlayers(players.map((p, i) => i === idx ? { ...p, isAI, difficulty: isAI ? 'medium' : undefined } : p))
  }
  const setDiff = (idx: number, difficulty: 'easy' | 'medium' | 'hard') => {
    setPlayers(players.map((p, i) => i === idx ? { ...p, difficulty } : p))
  }

  return (
    <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 shadow-2xl">
        <h1 className="text-5xl font-black text-center text-[#a23a1e] mb-2 tracking-tight">SHITHEAD</h1>
        <p className="text-center text-[#2d4a2b]/70 mb-6 text-sm">The classic shedding card game</p>

        <div className="space-y-2 mb-4">
          {players.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={p.name}
                onChange={e => updateName(i, e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-[#2d4a2b]/20 bg-white text-[#1a1a1a]"
              />
              <button
                onClick={() => setAI(i, !p.isAI)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold ${p.isAI ? 'bg-[#a23a1e] text-[#faf8f3]' : 'bg-[#2d4a2b] text-[#faf8f3]'}`}
              >
                {p.isAI ? 'AI' : 'HUMAN'}
              </button>
              {p.isAI && (
                <select
                  value={p.difficulty}
                  onChange={e => setDiff(i, e.target.value as 'easy' | 'medium' | 'hard')}
                  className="px-2 py-2 rounded-lg border border-[#2d4a2b]/20 bg-white text-xs"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              )}
              {players.length > 2 && (
                <button onClick={() => removePlayer(i)} className="px-2 py-2 text-[#a23a1e] text-xl">×</button>
              )}
            </div>
          ))}
        </div>

        <button onClick={addPlayer} disabled={players.length >= 5} className="w-full py-2 rounded-lg border-2 border-dashed border-[#2d4a2b]/40 text-[#2d4a2b]/70 mb-4 disabled:opacity-30">
          + Add Player ({players.length}/5)
        </button>

        <button onClick={() => initGame(players)} className="w-full py-4 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black text-xl shadow-lg active:scale-95 transition">
          DEAL
        </button>
      </div>
    </div>
  )
}
