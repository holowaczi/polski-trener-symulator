import { LEVELS, REGIONS } from './data'
import { LOWER_LEAGUES } from './lowerData'
import { III_LIGA, REGION_TOWNS } from './realData'
import type { Rng } from './rng'
import type { Cup, CupTie, GameState, Team } from './types'
import { teamsAtLevel } from './world'
import { leagueRegion, teamRegion, thirdGroupOf } from './regions'

/**
 * Puchar Polski jak w rzeczywistości:
 * - etap wojewódzki: drużyny od IV ligi w dół (okręgówka i IV liga obowiązkowo, klasy A, B i C chętne) plus III liga z województwa,
 *   gra cały sezon, a jego zwycięzca reprezentuje województwo w etapie centralnym w następnym sezonie;
 * - etap centralny: runda wstępna (II liga i część III ligi), od 1/32 finału Ekstraklasa, I liga i 16 zwycięzców pucharów wojewódzkich.
 */

/** tygodnie rund etapu centralnego: runda wstępna, 1/32, 1/16, 1/8, ćwierćfinał, półfinał, finał */
const CENTRAL_WEEKS = [3, 7, 11, 16, 21, 26, 31]
const CENTRAL_NAMES = ['Runda wstępna', '1/32 finału', '1/16 finału', '1/8 finału', 'Ćwierćfinał', 'Półfinał', 'Finał']
/** chętni z klas A, B i C: mniej więcej co drugi klub się zgłasza */
const VOLUNTARY_SHARE = 0.5
/** ilu zawodników z III ligi spoza województwa trafia do rundy wstępnej etapu centralnego */
const PRELIM_III_LIGA = 6



export function pairUp(rng: Rng, teams: Record<number, Team>, ids: number[]): CupTie[] {
  const pool = rng.shuffle([...ids])
  const ties: CupTie[] = []
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const a = teams[pool[i]]
    const b = teams[pool[i + 1]]
    // w Pucharze Polski gospodarzem jest drużyna z niższej ligi
    ties.push(a.level <= b.level ? { home: a.id, away: b.id } : { home: b.id, away: a.id })
  }
  return ties
}

/** nazwy rund od końca: finał, półfinał, ćwierćfinał, 1/8, potem rundy numerowane i runda wstępna */
function regionalNames(rounds: number, prelim: boolean): string[] {
  const tail = ['Finał', 'Półfinał', 'Ćwierćfinał', '1/8 finału']
  const names: string[] = []
  const numbered = rounds - (prelim ? 1 : 0)
  for (let i = 0; i < numbered; i++) {
    const fromEnd = numbered - 1 - i
    names.push(tail[fromEnd] ?? `${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]} runda`)
  }
  return prelim ? ['Runda wstępna', ...names] : names
}

/** tygodnie rund etapu wojewódzkiego: od początku sezonu do wiosny, poza tygodniami etapu centralnego */
function regionalWeeks(rounds: number): number[] {
  const free = Array.from({ length: 30 }, (_, i) => i + 1).filter((w) => !CENTRAL_WEEKS.includes(w))
  return Array.from({ length: rounds }, (_, i) => free[Math.round((i * (free.length - 1)) / Math.max(1, rounds - 1))])
}

/** etap wojewódzki: najsłabsze drużyny grają rundę wstępną, reszta wchodzi do drabinki od I rundy */
/** województwo, w którym gracz gra puchar: klubu (do III ligi) albo trenera */
export function cupRegion(s: GameState): string {
  const t = s.clubId !== null ? s.teams[s.clubId] : undefined
  return t && t.level <= 6 ? teamRegion(s, t.id) : s.coach.region
}

export function drawRegionalCup(rng: Rng, s: GameState): Cup {
  const region = cupRegion(s)
  const entrants: number[] = []
  for (const lg of s.leagues) {
    if (lg.level > 6) continue
    // IV liga i niżej: tylko ligi województwa gracza
    const lr = leagueRegion(s, lg)
    if (lr !== undefined && lr !== region) continue
    for (const id of lg.teamIds) {
      if (lg.level === 6 && teamRegion(s, id) !== region && id !== s.clubId) continue
      // III liga, IV liga, V liga i okręgówka obowiązkowo, klasy A, B i C z własnej woli
      const mandatory = !/klasa [ABC]\b|^[ABC]-klasa/i.test(lg.name)
      if (mandatory || id === s.clubId || rng.chance(VOLUNTARY_SHARE)) entrants.push(id)
    }
  }
  const n = entrants.length
  let p = 1
  while (p * 2 <= n) p *= 2
  const sorted = rng.shuffle(entrants).sort((a, b) => s.teams[a].level - s.teams[b].level)
  const prelimCount = n === p ? 0 : 2 * (n - p)
  const rounds = Math.log2(p) + (prelimCount ? 1 : 0)
  const names = regionalNames(rounds, prelimCount > 0)
  const schedule = regionalWeeks(rounds)
  const first = prelimCount ? pairUp(rng, s.teams, sorted.slice(0, prelimCount)) : pairUp(rng, s.teams, sorted)
  return {
    title: `Puchar Polski · etap wojewódzki (${region})`,
    names,
    rounds: [first],
    schedule,
    byes: prelimCount ? sorted.slice(prelimCount) : undefined,
  }
}

/** goście etapu centralnego: zwycięzcy pucharów innych województw i III liga z innych grup */
function addGuest(s: GameState, name: string, town: string, level: number, strength: number, guest: string): number {
  const id = s.nextId++
  s.teams[id] = { id, name, town, level, strength, real: true, guest }
  return id
}

/** etap centralny: runda wstępna (II liga + część III ligi), potem 1/32 finału z Ekstraklasą, I ligą i zwycięzcami pucharów wojewódzkich */
export function drawCentralCup(rng: Rng, s: GameState): Cup {
  // goście z poprzedniego sezonu znikają
  for (const t of Object.values(s.teams)) if (t.guest && t.id !== s.cupQualifier) delete s.teams[t.id]
  const region = cupRegion(s)
  const myGroup = thirdGroupOf(region)
  const used = new Set(Object.values(s.teams).map((t) => t.name))

  // zwycięzcy pucharów wojewódzkich z poprzedniego sezonu
  const regional: number[] = []
  if (s.cupQualifier !== undefined && s.teams[s.cupQualifier]) regional.push(s.cupQualifier)
  for (const r of REGIONS) {
    if (r === region) continue
    // w świecie ze wszystkimi województwami puchar regionu wygrywa jeden z klubów jego IV ligi
    const ivLeague = s.leagues.find((l) => l.level === 5 && l.region === r)
    if (ivLeague) {
      const strong = [...ivLeague.teamIds].filter((id) => id !== s.clubId).sort((a, b) => s.teams[b].strength - s.teams[a].strength)
      regional.push(rng.pick(strong.slice(0, Math.max(3, Math.ceil(strong.length / 2)))))
      continue
    }
    const iv = LOWER_LEAGUES[r]?.[0]?.groups.flatMap((g) => g.clubs).filter((c) => !c.reserve && !used.has(c.name)) ?? []
    // zwykle wygrywa mocny klub IV ligi
    const c = iv.length ? rng.pick(iv.slice(0, Math.max(3, Math.ceil(iv.length / 2)))) : undefined
    const name = c?.name ?? `${rng.pick(REGION_TOWNS[r] ?? ['Nowa Wieś'])} (${r})`
    used.add(name)
    regional.push(addGuest(s, name, c?.town ?? r, 5, Math.round(rng.normal(LEVELS[5].base + 4, 3)), `zdobywca PP · ${r}`))
  }

  // III liga z innych grup do rundy wstępnej
  const otherGroups = s.leagues.filter((l) => l.level === 6 && l.group && l.group !== myGroup)
  const thirds = otherGroups.length
    ? rng
        .shuffle(otherGroups.flatMap((l) => l.teamIds).filter((id) => !s.teams[id].reserve && !regional.includes(id)))
        .slice(0, PRELIM_III_LIGA)
    : rng
        .shuffle(
          (Object.keys(III_LIGA) as (keyof typeof III_LIGA)[])
            .filter((g) => g !== myGroup)
            .flatMap((g) => III_LIGA[g])
            .filter((c) => !c.reserve && !used.has(c.name)),
        )
        .slice(0, PRELIM_III_LIGA)
        .map((c) => addGuest(s, c.name, c.town, 6, c.strength, `III liga · inna grupa`))
  const prelim = [...teamsAtLevel(s, 7).filter((id) => !regional.includes(id)), ...thirds]
  const direct = [...teamsAtLevel(s, 9), ...teamsAtLevel(s, 8), ...regional]
  return {
    title: 'Puchar Polski · etap centralny',
    names: CENTRAL_NAMES,
    rounds: [pairUp(rng, s.teams, prelim)],
    schedule: CENTRAL_WEEKS,
    byes: direct,
  }
}

/** nazwa rundy pucharu */
export function roundName(cup: Cup, i: number): string {
  return cup.names?.[i] ?? `Runda ${i + 1}`
}

/** krótki opis poziomu drużyny w drabince, np. „IV liga” albo „zdobywca PP · opolskie” */
export function cupLabel(s: GameState, id: number): string {
  const t = s.teams[id]
  if (!t) return ''
  if (t.guest) return t.guest
  const lg = s.leagues.find((l) => l.teamIds.includes(id))
  if (!lg) return LEVELS[t.level].name
  return lg.group ? lg.name.split(' · ')[0] : lg.name.replace(/ \(.*\)$/, '')
}
