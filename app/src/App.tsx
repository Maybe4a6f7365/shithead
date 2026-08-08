import { useGame } from './game/state'
import { Lobby } from './components/Lobby'
import { GameTable } from './components/GameTable'

export function App() {
  const phase = useGame(s => s.state.phase)
  return phase === 'lobby' ? <Lobby /> : <GameTable />
}
