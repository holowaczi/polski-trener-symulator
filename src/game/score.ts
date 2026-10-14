import { LEVELS, LICENSES } from './data'
import type { GameState, License } from './types'
import { bottomLevel, leagueOf } from './world'

/** licencje, z którymi można zacząć; wyższa licencja to łatwiejszy start, więc mniej punktów */
export const START_LICENSES: { license: License; factor: number }[] = [
  { license: 'UEFA C', factor: 1 },
  { license: 'UEFA B', factor: 0.8 },
  { license: 'UEFA A', factor: 0.6 },
  { license: 'UEFA Pro', factor: 0.45 },
]

/** każdy szczebel startu powyżej najniższej klasy województwa obniża mnożnik */
const LEVEL_FACTOR = 0.85

export function licenseFactor(license: License): number {
  return START_LICENSES.find((l) => l.license === license)?.factor ?? 1
}

/** czy z tą licencją wolno prowadzić klub z tego poziomu */
export function licenseCovers(license: License, level: number): boolean {
  return LICENSES.indexOf(license) >= LICENSES.indexOf(LEVELS[level].license)
}

/**
 * Mnożnik punktów za wybrany start. Domyślny start (UEFA C, oferta z najniższej klasy) i wyzwanie dnia to ×1.
 * Wybrany klub: im wyżej, tym mniej; w obrębie ligi faworyt daje mniej, outsider trochę więcej.
 */
export function startMultiplier(s: Pick<GameState, 'leagues' | 'teams'>, license: License, teamId?: number): number {
  let m = licenseFactor(license)
  if (teamId !== undefined) {
    const t = s.teams[teamId]
    m *= Math.pow(LEVEL_FACTOR, t.level - bottomLevel(s))
    const lg = leagueOf(s, teamId)
    if (lg && lg.teamIds.length > 1) {
      const rank = [...lg.teamIds].sort((a, b) => s.teams[b].strength - s.teams[a].strength).indexOf(teamId)
      m *= 0.85 + (0.25 * rank) / (lg.teamIds.length - 1)
    }
  }
  return Math.max(0.05, Math.round(m * 100) / 100)
}

export interface ScoreLine {
  label: string
  points: number
}

/** punkty kariery przed mnożnikiem, rozpisane na składniki */
export function scoreBreakdown(s: GameState): ScoreLine[] {
  let seasons = 0
  let titles = 0
  let promotions = 0
  let relegations = 0
  for (const h of s.history) {
    const w = h.level + 1
    seasons += 4 * w
    if (h.position === 1 && !h.fired) titles += 10 * w
    if (h.outcome.includes('awans')) promotions += 8 * w
    if (h.outcome.includes('spadek')) relegations -= 3 * w
  }
  const cups = s.trophies.filter((t) => t.startsWith('Puchar Polski (')).length * 150
  const regionalCups = s.trophies.filter((t) => t.startsWith('Puchar Polski na szczeblu')).length * 40
  const peak = s.history.length ? Math.max(...s.history.map((h) => h.level)) : -1
  const lines: ScoreLine[] = [
    { label: 'Sezony (im wyższa liga, tym więcej)', points: seasons },
    { label: 'Mistrzostwa lig', points: titles },
    { label: 'Awanse', points: promotions },
    { label: 'Spadki', points: relegations },
    { label: 'Puchar Polski', points: cups },
    { label: 'Puchary wojewódzkie', points: regionalCups },
    { label: 'Wygrane mecze', points: s.totalStats.w },
    { label: 'Szczyt kariery', points: peak >= 0 ? 10 * (peak + 1) : 0 },
    { label: 'Zwolnienia', points: -20 * s.totalStats.firedCount },
  ]
  return lines.filter((l) => l.points !== 0)
}

export function multiplierOf(s: GameState): number {
  return s.start?.multiplier ?? 1
}

/** punkty kariery po mnożniku za start */
export function careerScore(s: GameState): number {
  const raw = scoreBreakdown(s).reduce((a, l) => a + l.points, 0)
  return Math.max(0, Math.round(raw * multiplierOf(s)))
}
