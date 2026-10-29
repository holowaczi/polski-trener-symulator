import LZString from 'lz-string'
import { migrateSave } from '../game/migrate'
import type { GameState } from '../game/types'
import type { ScenarioId } from '../game/goals'

const KEY = 'pts-save'
/** zapis, którego nie udało się wczytać: zostaje na boku, żeby nowa kariera go nie nadpisała */
const BROKEN_KEY = 'pts-save-broken'
/** skompresowany zapis zaczyna się od tego znacznika; stare zapisy to zwykły JSON */
const LZ_PREFIX = 'lz1:'
const FILE_APP = 'polski-trener-symulator'

export type LoadResult = { state: GameState | null; problem?: string }

function decode(raw: string): unknown {
  const json = raw.startsWith(LZ_PREFIX) ? LZString.decompressFromUTF16(raw.slice(LZ_PREFIX.length)) : raw
  if (!json) throw new Error('pusty zapis')
  return JSON.parse(json)
}

function setBroken(raw: string): void {
  try {
    localStorage.setItem(BROKEN_KEY, raw)
  } catch {
    // brak miejsca: trudno, komunikat i tak zostanie
  }
}

export function loadGame(): LoadResult {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return { state: null, problem: 'Przeglądarka nie pozwala czytać zapisów (tryb prywatny?). Gra działa, ale kariera nie przetrwa zamknięcia karty.' }
  }
  if (!raw) return { state: null }
  let data: unknown
  try {
    data = decode(raw)
  } catch {
    setBroken(raw)
    clearSave()
    return { state: null, problem: 'Zapis kariery jest uszkodzony i nie da się go wczytać. Odłożyliśmy go na bok, możesz go pobrać poniżej.' }
  }
  const r = migrateSave(data)
  if (!r.ok) {
    setBroken(raw)
    clearSave()
    return { state: null, problem: r.problem }
  }
  return { state: r.state }
}

/** zapisuje karierę; false, gdy przeglądarka odmówiła (brak miejsca, tryb prywatny) */
export function saveGame(s: GameState): boolean {
  try {
    localStorage.setItem(KEY, LZ_PREFIX + LZString.compressToUTF16(JSON.stringify(s)))
    return true
  } catch {
    return false
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // jw.
  }
}

/** odłożony uszkodzony zapis jako plik do pobrania (dla ratunku albo zgłoszenia błędu) */
export function brokenSaveText(): string | null {
  try {
    const raw = localStorage.getItem(BROKEN_KEY)
    if (!raw) return null
    try {
      return JSON.stringify(decode(raw))
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

// ---------- kopia zapasowa w pliku ----------

/** zawartość pliku z kopią: JSON z opisem i skompresowanym zapisem */
export function exportSave(s: GameState): string {
  return JSON.stringify({
    gra: FILE_APP,
    wersjaGry: __APP_VERSION__,
    trener: `${s.coach.firstName} ${s.coach.lastName}`,
    sezon: s.season,
    zapisano: new Date().toISOString(),
    dane: LZString.compressToBase64(JSON.stringify(s)),
  })
}

export function exportFileName(s: GameState): string {
  const slug = `${s.coach.firstName}-${s.coach.lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `trener-${slug || 'kariera'}-sezon-${s.season}.json`
}

export function importSave(text: string): LoadResult {
  let data: unknown
  try {
    const file = JSON.parse(text)
    if (file && file.gra === FILE_APP && typeof file.dane === 'string') {
      const json = LZString.decompressFromBase64(file.dane)
      if (!json) throw new Error('pusty')
      data = JSON.parse(json)
    } else data = file // goły zapis, np. odłożony uszkodzony
  } catch {
    return { state: null, problem: 'Tego pliku nie da się odczytać. Kopia kariery to plik .json pobrany z gry.' }
  }
  const r = migrateSave(data)
  return r.ok ? { state: r.state } : { state: null, problem: r.problem }
}

/** pobranie pliku w przeglądarce */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const RECORDS_KEY = 'pts-records'

export interface CareerRecord {
  id: string
  name: string
  score: number
  multiplier: number
  peak: string
  daily?: boolean
  /** nazwa wyzwania, jeśli kariera zaczęła się od niego */
  scenario?: string
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

// ---------- odznaki i wyzwania zebrane na tym urządzeniu ----------

const BADGES_KEY = 'pts-badges'
const SCENARIOS_KEY = 'pts-scenarios'

export interface ScenarioRecord {
  run: string
  id: ScenarioId
  won: boolean
  /** po ilu sezonach rozstrzygnięte */
  seasons: number
  name: string
  date: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // jw.
  }
}

export const loadBadges = (): string[] => readJson<string[]>(BADGES_KEY, [])
export const loadScenarioRecords = (): ScenarioRecord[] => readJson<ScenarioRecord[]>(SCENARIOS_KEY, [])

/** dopisuje nowe odznaki i rozstrzygnięte wyzwanie z bieżącej kariery do kolekcji urządzenia */
export function recordProgress(s: GameState): void {
  const have = loadBadges()
  const fresh = (s.badges ?? []).filter((b) => !have.includes(b))
  if (fresh.length) writeJson(BADGES_KEY, [...have, ...fresh])
  const sc = s.scenario
  if (sc?.result) {
    const run = `${s.seed}-${sc.id}-${s.coach.firstName}-${s.coach.lastName}`
    const list = loadScenarioRecords()
    if (!list.some((r) => r.run === run)) {
      list.unshift({
        run,
        id: sc.id,
        won: sc.result === 'won',
        seasons: (sc.at ?? s.season) - sc.from + 1,
        name: `${s.coach.firstName} ${s.coach.lastName}`,
        date: new Date().toISOString().slice(0, 10),
      })
      writeJson(SCENARIOS_KEY, list.slice(0, 50))
    }
  }
}
