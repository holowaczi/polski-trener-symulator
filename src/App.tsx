import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState } from './game/types'
import { clearSave, loadGame, saveGame } from './ui/save'
import { StartScreen } from './ui/StartScreen'
import { GameScreen } from './ui/GameScreen'
import { CareerCard } from './ui/CareerCard'

export type Act = (fn: (s: GameState) => string | void) => void

/** kompresja długiej kariery trwa chwilę, więc zapisujemy po krótkiej przerwie w klikaniu */
const SAVE_DELAY = 600

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [loaded] = useState(() => loadGame())
  const [saved, setSaved] = useState<GameState | null>(loaded.state)
  const [toast, setToast] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const pending = useRef<GameState | null>(null)

  const flush = useCallback(() => {
    const s = pending.current
    if (!s) return
    pending.current = null
    setSaveFailed(!saveGame(s))
  }, [])

  useEffect(() => {
    if (!state) return
    pending.current = state
    const t = setTimeout(flush, SAVE_DELAY)
    return () => clearTimeout(t)
  }, [state, flush])

  // zamknięcie karty albo przejście do innej aplikacji na telefonie: zapis od razu
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

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
    pending.current = null
    clearSave()
    setSaved(null)
    setState(null)
  }

  return (
    <div className="app">
      {!state && (
        <StartScreen
          saved={saved}
          loadProblem={loaded.problem}
          onStart={(s) => setState(s)}
          onContinue={() => saved && setState(saved)}
        />
      )}
      {state && state.phase !== 'retired' && <GameScreen s={state} act={act} />}
      {state && state.phase === 'retired' && <CareerCard s={state} onNew={newCareer} />}
      {saveFailed && state && (
        <div className="save-alert" role="alert">
          <span>
            <b>Gra się nie zapisała.</b> Przeglądarka nie ma miejsca albo działa w trybie prywatnym. Pobierz kopię kariery w zakładce Trener, zanim
            zamkniesz kartę.
          </span>
          <button className="ghost" onClick={() => setSaveFailed(false)} aria-label="Zamknij">
            ✕
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
