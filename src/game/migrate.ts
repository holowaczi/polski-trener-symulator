import { SAVE_VERSION } from './engine'
import type { GameState } from './types'
import { nationOf } from './world'

/** najstarszy zapis, który da się jeszcze wczytać (wersje 1–2 to pierwsze dni alfy) */
export const MIN_SAVE_VERSION = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OldSave = any

/**
 * Migracje zapisu: klucz to wersja, z której migracja podnosi zapis o jeden.
 * Zmiana kształtu GameState = SAVE_VERSION + 1 i nowa migracja tutaj, a nie kasowanie kariery.
 */
export const MIGRATIONS: Record<number, (s: OldSave) => void> = {
  // 3 → 4: łatki z 0.5–0.9, które dotąd odpalały się przy każdym wczytaniu
  3: (s) => {
    // zapisy sprzed kontraktów: każdy dostaje umowę na 1–3 sezony
    for (const p of s.squad) if (p.contract === undefined) p.contract = 1 + ((p.id * 7 + p.age) % 3)
    // zapisy sprzed narodowości: kraj zgadujemy z nazwiska
    for (const p of [...s.squad, ...(s.reserveSquad ?? []), ...(s.transferList ?? []).map((x: OldSave) => x.player)]) p.nation ??= nationOf(p)
    // zapisy z 0.7.0: faza ligowa była jednym wynikiem; taką przygodę z Europą kończymy, następna będzie już pełna
    const run = s.euro
    if (run && (run.leagueWeek !== undefined || (run.league && !run.league.teamIds))) {
      run.league = undefined
      run.result ??= 'Europa (stary zapis)'
      run.done = true
    }
  },
}

export type MigrateResult = { ok: true; state: GameState; from: number } | { ok: false; problem: string }

/** podnosi zapis do bieżącej wersji; nie rzuca wyjątkami */
export function migrateSave(data: unknown): MigrateResult {
  const s = data as OldSave
  if (!s || typeof s !== 'object' || typeof s.version !== 'number' || !Array.isArray(s.squad) || !Array.isArray(s.leagues) || !s.coach)
    return { ok: false, problem: 'To nie wygląda na zapis kariery. Chyba że trener prowadził drużynę w Excelu.' }
  const from = s.version
  if (from > SAVE_VERSION)
    return { ok: false, problem: 'Ten zapis pochodzi z nowszej wersji gry niż ta otwarta w przeglądarce. Pobierz go, odśwież stronę i wczytaj z pliku.' }
  if (from < MIN_SAVE_VERSION)
    return { ok: false, problem: 'Ten zapis jest z pierwszych dni alfy, kiedy gra wyglądała zupełnie inaczej. Tej kariery nie da się już wczytać.' }
  try {
    for (let v = from; v < SAVE_VERSION; v++) {
      MIGRATIONS[v](s)
      s.version = v + 1
    }
  } catch {
    return { ok: false, problem: 'Nie udało się przenieść zapisu do nowej wersji gry. Pobierz go i wyślij autorowi, a on już będzie wiedział, komu podziękować.' }
  }
  return { ok: true, state: s as GameState, from }
}
