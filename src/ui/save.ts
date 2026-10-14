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

const RECORDS_KEY = 'pts-records'

export interface CareerRecord {
  id: string
  name: string
  score: number
  multiplier: number
  peak: string
  daily?: boolean
  date: string
}

/** najlepsze kariery na tym urządzeniu, od najlepszej */
export function loadRecords(): CareerRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY)
    return raw ? (JSON.parse(raw) as CareerRecord[]) : []
  } catch {
    return []
  }
}

export function saveRecord(r: CareerRecord): void {
  try {
    const list = loadRecords().filter((x) => x.id !== r.id)
    list.push(r)
    list.sort((a, b) => b.score - a.score)
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {
    // jw.
  }
}
