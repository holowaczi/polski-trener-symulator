import type { GameState, League, MatchReport } from './types'
import { news } from './util'

// ---------- odznaki ----------

export interface BadgeDef {
  id: string
  icon: string
  name: string
  desc: string
}

export const BADGES: BadgeDef[] = [
  { id: 'awans_c', icon: '🌱', name: 'Awans z klasy C', desc: 'Wyprowadź drużynę z samego dna piramidy.' },
  { id: 'awans_b', icon: '🪜', name: 'Pierwszy szczebel', desc: 'Awansuj z dowolnej ligi.' },
  { id: 'ekstraklasa', icon: '🏟️', name: 'Witaj w Ekstraklasie', desc: 'Poprowadź klub w Ekstraklasie.' },
  { id: 'mistrz_polski', icon: '👑', name: 'Mistrz Polski', desc: 'Zdobądź mistrzostwo Polski.' },
  { id: 'puchar_polski', icon: '🏆', name: 'Puchar na półce', desc: 'Zdobądź Puchar Polski.' },
  { id: 'europa', icon: '🌍', name: 'Wieczór w Europie', desc: 'Zagraj mecz w europejskich pucharach.' },
  { id: 'niepokonani', icon: '🛡️', name: 'Niepokonani', desc: 'Skończ sezon ligowy bez porażki.' },
  { id: 'derby_5_0', icon: '🔥', name: '5:0 w derbach', desc: 'Wygraj derby różnicą pięciu goli do zera.' },
  { id: 'pogrom', icon: '💥', name: 'Pogrom', desc: 'Wygraj mecz różnicą siedmiu goli.' },
  { id: 'trzech_prezesow', icon: '🎩', name: 'Przeżyłem 3 prezesów', desc: 'Pracuj u trzech różnych prezesów.' },
  { id: 'licencja_na_papierze', icon: '📄', name: 'Licencja na papierze', desc: 'Przetrwaj sezon jako oficjalny „asystent” bez licencji.' },
  { id: 'trzy_zwolnienia', icon: '📦', name: 'Kosz owocowy ×3', desc: 'Zostań zwolniony trzy razy i dalej szukaj pracy.' },
  { id: 'kielbasa', icon: '🌭', name: 'Kiełbasa na koszt prezesa', desc: 'Wygraj mecz po przemowie o kiełbasie u prezesa z masarnią.' },
  { id: 'weteran', icon: '🧓', name: 'Weteran ławki', desc: 'Przepracuj 20 sezonów jako trener.' },
  { id: 'jeden_klub', icon: '💍', name: 'Wierny jak pies', desc: 'Przepracuj 8 sezonów w jednym klubie.' },
]

const badgeDef = (id: string) => BADGES.find((b) => b.id === id)!

function award(s: GameState, id: string): void {
  s.badges ??= []
  if (s.badges.includes(id)) return
  s.badges.push(id)
  const b = badgeDef(id)
  news(s, `${b.icon} Odznaka: „${b.name}”.`)
}

/** po każdym meczu trenera */
export function matchBadges(s: GameState, rep: MatchReport): void {
  const me = rep.me ?? s.clubId
  if (me === null || me === undefined) return
  const mine = rep.home === me ? rep.hg : rep.ag
  const theirs = rep.home === me ? rep.ag : rep.hg
  if (rep.euro) award(s, 'europa')
  if (rep.derby && mine - theirs >= 5 && theirs === 0) award(s, 'derby_5_0')
  if (mine - theirs >= 7) award(s, 'pogrom')
  if (mine > theirs && rep.lines.some((l) => l.includes('masarni prezesa'))) award(s, 'kielbasa')
}

/** po sezonie, gdy historia sezonu jest już zapisana, a tabela jeszcze ta sama */
export function seasonBadges(s: GameState, lg: League | undefined, table: { teamId: number; l: number }[] | undefined): void {
  const h = s.history[s.history.length - 1]
  if (h && !h.fired && h.season === s.season) {
    if (h.outcome.includes('awans')) {
      award(s, 'awans_b')
      if (h.level === 0) award(s, 'awans_c')
    }
    if (h.level === 9) award(s, 'ekstraklasa')
    const row = table?.find((r) => r.teamId === s.clubId)
    if (lg && row && row.l === 0) award(s, 'niepokonani')
  }
  if (s.trophies.some((t) => t.startsWith('Mistrzostwo Polski'))) award(s, 'mistrz_polski')
  if (s.trophies.some((t) => t.startsWith('Puchar Polski ('))) award(s, 'puchar_polski')
  if ((s.figurant ?? 0) >= 1) award(s, 'licencja_na_papierze')
  if ((s.presidents ?? 0) >= 3) award(s, 'trzech_prezesow')
  if (s.totalStats.firedCount >= 3) award(s, 'trzy_zwolnienia')
  if (new Set(s.history.map((x) => x.season)).size >= 20) award(s, 'weteran')
  // ten sam klub sezon po sezonie
  let run = 0
  for (let i = s.history.length - 1; i >= 0 && s.history[i].clubName === s.history[s.history.length - 1].clubName; i--) run++
  if (run >= 8) award(s, 'jeden_klub')
}

// ---------- wyzwania-scenariusze ----------

export type ScenarioId = 'beniaminek' | 'b_do_ekstraklasy' | 'puchar_z_iv' | 'uratuj_klub'

export interface ScenarioDef {
  id: ScenarioId
  icon: string
  title: string
  desc: string
  /** liczba sezonów na wykonanie */
  seasons: number
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'beniaminek',
    icon: '🆕',
    title: 'Utrzymaj beniaminka',
    desc: 'Najsłabszy klub Ekstraklasy, kadra prosto z I ligi i budżet na waciki. Cel: nie spaść w pierwszym sezonie.',
    seasons: 1,
  },
  {
    id: 'uratuj_klub',
    icon: '🚑',
    title: 'Uratuj klub w 10 kolejek',
    desc: 'Przejmujesz drużynę ze strefy spadkowej I ligi na dziesięć kolejek przed końcem. Poprzedni trener już pakuje kubek.',
    seasons: 1,
  },
  {
    id: 'puchar_z_iv',
    icon: '🏆',
    title: 'Puchar Polski z IV ligi',
    desc: 'Średniak IV ligi, licencja UEFA B. Zdobądź Puchar Polski w ciągu 5 sezonów, w dowolnym klubie.',
    seasons: 5,
  },
  {
    id: 'b_do_ekstraklasy',
    icon: '🚀',
    title: 'Z samego dołu do Ekstraklasy w 10 sezonów',
    desc: 'Klasyczny start z najniższej klasy województwa. Wywalcz awans do Ekstraklasy (albo dostań tam pracę) w ciągu 10 sezonów.',
    seasons: 10,
  },
]

export const scenarioDef = (id: ScenarioId) => SCENARIOS.find((x) => x.id === id)!

export interface ScenarioState {
  id: ScenarioId
  /** pierwszy sezon kariery w scenariuszu */
  from: number
  result?: 'won' | 'lost'
  /** sezon, w którym rozstrzygnięto */
  at?: number
}

function finish(s: GameState, won: boolean, text: string): void {
  const sc = s.scenario!
  sc.result = won ? 'won' : 'lost'
  sc.at = s.season
  const def = scenarioDef(sc.id)
  news(s, `${won ? '✅ Wyzwanie wykonane' : '❌ Wyzwanie przegrane'}: „${def.title}”. ${text}`)
}

/** wynik wyzwania po sezonie albo po zwolnieniu; dalej kariera toczy się normalnie */
export function checkScenario(s: GameState, firedNow = false): string | undefined {
  const sc = s.scenario
  if (!sc || sc.result) return undefined
  const def = scenarioDef(sc.id)
  const last = s.history[s.history.length - 1]
  const deadline = sc.from + def.seasons - 1
  switch (sc.id) {
    case 'beniaminek':
    case 'uratuj_klub': {
      if (firedNow) {
        finish(s, false, 'Zarząd stracił cierpliwość przed końcem sezonu.')
        break
      }
      if (!last || last.season !== sc.from) return undefined
      if (last.fired || last.outcome.includes('spadek')) finish(s, false, 'Klub spada, a Ty razem z nim.')
      else finish(s, true, sc.id === 'beniaminek' ? 'Beniaminek zostaje w Ekstraklasie!' : 'Klub uratowany. Kubek poprzedniego trenera możesz oddać.')
      break
    }
    case 'puchar_z_iv': {
      const won = s.trophies.some((t) => t.startsWith('Puchar Polski (') && Number(t.match(/sezon (\d+)/)?.[1]) <= deadline)
      if (won) finish(s, true, 'Puchar Polski zdobyty!')
      else if (s.season >= deadline && !firedNow) finish(s, false, `Minęło ${def.seasons} sezonów, a puchar dalej stoi u kogoś innego.`)
      break
    }
    case 'b_do_ekstraklasy': {
      const hit = s.history.find((h) => h.season <= deadline && (h.level === 9 || (h.level === 8 && !h.fired && h.outcome.includes('awans'))))
      if (hit) finish(s, true, `Ekstraklasa po ${hit.season - sc.from + 1} ${hit.season - sc.from + 1 === 1 ? 'sezonie' : 'sezonach'}!`)
      else if (s.season >= deadline && !firedNow) finish(s, false, 'Dziesięć sezonów minęło, a Ekstraklasa dalej w telewizji.')
      break
    }
  }
  return sc.result ? `${sc.result === 'won' ? '✅ Wyzwanie wykonane' : '❌ Wyzwanie przegrane'}: ${def.title}.` : undefined
}

/** opis postępu wyzwania do nagłówka i zakładki Trener */
export function scenarioStatus(s: GameState): string | undefined {
  const sc = s.scenario
  if (!sc) return undefined
  const def = scenarioDef(sc.id)
  if (sc.result === 'won') return `${def.icon} ${def.title}: wykonane w sezonie ${sc.at}`
  if (sc.result === 'lost') return `${def.icon} ${def.title}: przegrane`
  const left = sc.from + def.seasons - s.season
  return `${def.icon} ${def.title}: ${left <= 1 ? 'ostatni sezon' : `zostało ${left} sezonów`}`
}
