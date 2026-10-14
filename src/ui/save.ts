import { SAVE_VERSION } from '../game/engine'
import type { GameState } from '../game/types'

const KEY = 'pts-save'

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as GameState
    return s.version === SAVE_VERSION ? s : null
  } catch {
    return null
  }
}

export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // zapis to wygoda, gra działa i bez niego
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // jw.
  }
}
