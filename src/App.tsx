import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState } from './game/types'
import { clearSave, loadGame, recordProgress, saveGame, saveGameNow, type LoadResult } from './ui/save'
import { StartScreen } from './ui/StartScreen'
import { GameScreen } from './ui/GameScreen'
import { CareerCard } from './ui/CareerCard'

export type Act = (fn: (s: GameState) => string | void) => void

/** kompresja długiej kariery trwa chwilę, więc nie zapisujemy po każdym kliknięciu */
const SAVE_DELAY = 600

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  // zapis wczytuje się w tle (rozpakowanie gzipu jest asynchroniczne)
  const [loaded, setLoaded] = useState<LoadResult | null>(null)
  const [saved, setSaved] = useState<GameState | null>(null)
  useEffect(() => {
    let live = true
    void loadGame().then((r) => {
      if (!live) return
      setLoaded(r)
      setSaved(r.state)
    })
    return () => {
      live = false
    }
  }, [])
  const [toast, setToast] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const pending = useRef<GameState | null>(null)

  const flush = useCallback(() => {
    const s = pending.current
    if (!s) return
    pending.current = null
    void saveGame(s).then((ok) => setSaveFailed(!ok))
    recordProgress(s)
  }, [])

  /** zamknięcie karty: zapis od razu, bez pracy w tle, która mogłaby nie zdążyć */
  const flushNow = useCallback(() => {
    const s = pending.current
    if (!s) return
    pending.current = null
    saveGameNow(s)
    recordProgress(s)
  }, [])

  // zapis najwyżej co SAVE_DELAY, zawsze z najnowszym stanem (także w trybie automatycznym, który zmienia stan co pół sekundy)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!state) return
    pending.current = state
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      flush()
    }, SAVE_DELAY)
  }, [state, flush])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // zamknięcie karty albo przejście do innej aplikacji na telefonie: zapis od razu
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flushNow()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushNow)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushNow)
    }
  }, [flushNow])

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
      {!state && loaded && (
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
