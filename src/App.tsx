import { useCallback, useEffect, useState } from 'react'
import type { GameState } from './game/types'
import { clearSave, loadGame, saveGame } from './ui/save'
import { StartScreen } from './ui/StartScreen'
import { GameScreen } from './ui/GameScreen'
import { CareerCard } from './ui/CareerCard'

export type Act = (fn: (s: GameState) => string | void) => void

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [saved, setSaved] = useState<GameState | null>(() => loadGame())
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (state) saveGame(state)
  }, [state])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  /** każda akcja gracza działa na kopii stanu, więc React widzi zmianę */
  const act: Act = useCallback((fn) => {
    setState((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      const msg = fn(next)
      if (msg) setTimeout(() => setToast(msg), 0)
      return next
    })
  }, [])

  const newCareer = () => {
    clearSave()
    setSaved(null)
    setState(null)
  }

  return (
    <div className="app">
      {!state && (
        <StartScreen
          saved={saved}
          onStart={(s) => setState(s)}
          onContinue={() => saved && setState(saved)}
        />
      )}
      {state && state.phase !== 'retired' && <GameScreen s={state} act={act} />}
      {state && state.phase === 'retired' && <CareerCard s={state} onNew={newCareer} />}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
