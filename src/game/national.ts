import { EURO_CLUBS } from './euroClubs'
import type { GameEvent } from './events'
import { developFromMatch, playClubMatch, simulateScore } from './match'
import type { Rng } from './rng'
import type { CupTie, Fixture, GameState, JobOffer, MatchReport, NatGroup, NationalJob, NationalSide, NatKo, NatStage, Player, Position, Team } from './types'
import { addModifier, adjustCoach, adjustTrust, computeTable, isAvailable, news, setMorale, teamPower } from './util'
import { clamp, generatePlayer, makeFixtures, playerName } from './world'

/**
 * Reprezentacja: pełny etat zamiast klubu. Eliminacje (grupa pięciu drużyn, mecz i rewanż) trwają dwa sezony,
 * latem jest turniej: grupa, potem mecze o wszystko. W sezonie bez turnieju kadra A gra w Lidze Narodów.
 * Rywale to prawdziwe reprezentacje z ogólną siłą, a Polska gra zawodnikami z kadry, którą selekcjoner ma pod ręką.
 */

export interface Nation {
  name: string
  /** siła pierwszej reprezentacji w skali meczów drużyny gracza (Polska ok. 86) */
  strength: number
  europe: boolean
}

const n = (europe: boolean, list: [string, number][]): Nation[] => list.map(([name, strength]) => ({ name, strength, europe }))

export const NATIONS: Nation[] = [
  ...n(true, [
    ['Hiszpania', 96],
    ['Francja', 96],
    ['Anglia', 95],
    ['Niemcy', 93],
    ['Portugalia', 93],
    ['Holandia', 91],
    ['Włochy', 91],
    ['Belgia', 89],
    ['Chorwacja', 89],
    ['Dania', 87],
    ['Szwajcaria', 87],
    ['Austria', 87],
    ['Turcja', 86],
    ['Norwegia', 86],
    ['Ukraina', 85],
    ['Serbia', 85],
    ['Czechy', 84],
    ['Szwecja', 84],
    ['Szkocja', 83],
    ['Węgry', 83],
    ['Grecja', 83],
    ['Słowacja', 82],
    ['Słowenia', 81],
    ['Rumunia', 81],
    ['Walia', 81],
    ['Gruzja', 81],
    ['Irlandia', 80],
    ['Albania', 79],
    ['Bośnia i Hercegowina', 79],
    ['Islandia', 78],
    ['Finlandia', 78],
    ['Izrael', 78],
    ['Irlandia Północna', 77],
    ['Macedonia Północna', 76],
    ['Czarnogóra', 76],
    ['Kosowo', 76],
    ['Bułgaria', 75],
    ['Kazachstan', 73],
    ['Luksemburg', 73],
    ['Armenia', 72],
    ['Białoruś', 72],
    ['Azerbejdżan', 71],
    ['Estonia', 70],
    ['Cypr', 70],
    ['Łotwa', 68],
    ['Litwa', 68],
    ['Wyspy Owcze', 67],
    ['Mołdawia', 66],
    ['Malta', 64],
    ['Andora', 58],
    ['Liechtenstein', 57],
    ['Gibraltar', 55],
    ['San Marino', 48],
  ]),
  ...n(false, [
    ['Argentyna', 95],
    ['Brazylia', 94],
    ['Urugwaj', 89],
    ['Kolumbia', 88],
    ['Maroko', 88],
    ['Japonia', 87],
    ['Senegal', 86],
    ['Meksyk', 85],
    ['USA', 85],
    ['Korea Południowa', 85],
    ['Ekwador', 85],
    ['Wybrzeże Kości Słoniowej', 84],
    ['Kanada', 83],
    ['Nigeria', 83],
    ['Iran', 82],
    ['Egipt', 82],
    ['Australia', 81],
    ['Arabia Saudyjska', 78],
  ]),
]

/** młodzieżówki są słabsze od pierwszych reprezentacji mniej więcej o tyle */
const U21_GAP = 11

export const SIDE_NAME: Record<NationalSide, string> = { A: 'Reprezentacja Polski', U21: 'Reprezentacja Polski U21' }
export const SIDE_SHORT: Record<NationalSide, string> = { A: 'kadra', U21: 'młodzieżówka' }

/**
 * Kalendarz jak w prawdziwej piłce. Sezon 1 kończy się latem 2027, sezon n latem 2026+n.
 * Kadra A: mundial w latach 2030, 2034…, Euro w 2028, 2032…, czyli co cztery lata z przesunięciem o dwa.
 * W sezonie bez turnieju jesienią gra się Ligę Narodów, a wiosną zaczynają się eliminacje (4 z 10 kolejek),
 * które kończą się jesienią sezonu turniejowego. Młodzieżówka gra o Euro U21 w latach nieparzystych.
 */
export function summerYear(season: number): number {
  return 2026 + season
}

/** czy latem tego sezonu jest turniej danej drużyny */
export function isTournamentSeason(side: NationalSide, season: number): boolean {
  const y = summerYear(season)
  return side === 'U21' ? y % 2 === 1 : y % 2 === 0
}

function tournamentName(side: NationalSide, year: number): string {
  if (side === 'U21') return `Mistrzostwa Europy U21 ${year}`
  return year % 4 === 0 ? `Mistrzostwa Europy ${year}` : `Mistrzostwa Świata ${year}`
}

/** turniej, o który toczą się eliminacje w tym sezonie: tegoroczny albo przyszłoroczny */
export function eventFor(side: NationalSide, season: number): string {
  const y = summerYear(season)
  return tournamentName(side, isTournamentSeason(side, season) ? y : y + 1)
}

/** Liga Narodów jesienią sezonu bez turnieju, np. „Liga Narodów 2028/29” */
export function nationsLeagueName(season: number): string {
  const y = summerYear(season)
  return `Liga Narodów ${y - 1}/${String(y).slice(2)}`
}

/** tygodnie eliminacji: [pierwszy sezon, sezon turniejowy] */
const QUAL_WEEKS: Record<NationalSide, [number[], number[]]> = {
  A: [
    [22, 23, 27, 28],
    [2, 3, 7, 8, 12, 13],
  ],
  U21: [
    [2, 7, 12, 22, 27],
    [2, 7, 12, 22, 27],
  ],
}
/** Liga Narodów: jesienne przerwy na kadrę */
const NL_WEEKS = [2, 3, 7, 8, 12, 13]
/** turniej po sezonie ligowym: trzy kolejki grupy, potem mecze o wszystko */
const TOURN_GROUP_WEEKS = [36, 37, 38]
export const KO_WEEKS = { R32: 39, R16: 40, QF: 41, SF: 42, F: 43, NLSF: 40, NLF: 42, PO1: 22, PO2: 23 } as const
/** sezon selekcjonera trwa dłużej niż ligowy, bo turniej jest latem */
export const NATIONAL_SEASON_WEEKS = 44

export const STAGE_LABEL: Record<NatStage, string> = {
  PO1: 'Baraż · półfinał',
  PO2: 'Baraż · finał',
  R32: '1/16 finału',
  R16: '1/8 finału',
  QF: 'Ćwierćfinał',
  SF: 'Półfinał',
  F: 'Finał',
  NLSF: 'Półfinał',
  NLF: 'Finał',
}
/** jak daleko zaszła drużyna: do historii, karty trenera i punktów */
export const REACHED_LABEL = ['bez awansu na turniej', 'faza grupowa', 'faza pucharowa', 'ćwierćfinał', 'półfinał', 'finał', 'złoto']
/** do którego miejsca w REACHED_LABEL prowadzi gra w danym etapie */
const STAGE_REACHED: Partial<Record<NatStage, number>> = { R32: 2, R16: 2, QF: 3, SF: 4, F: 5 }
const NEXT_STAGE: Partial<Record<NatStage, NatStage>> = { PO1: 'PO2', R32: 'R16', R16: 'QF', QF: 'SF', SF: 'F', NLSF: 'NLF' }

const isWorldCup = (event: string) => event.startsWith('Mistrzostwa Świata')

/** „Mistrzostwa Europy 2028” → „ME 2028” do krótkich etykiet */
export function eventShort(event: string): string {
  return event.replace('Mistrzostwa Europy', 'ME').replace('Mistrzostwa Świata', 'MŚ')
}

// ---------- drużyny ----------

function nationTeam(s: GameState, name: string, country: string, strength: number): number {
  const existing = Object.values(s.teams).find((t) => t.nt && t.name === name)
  if (existing) return existing.id
  const id = s.nextId++
  s.teams[id] = { id, name, town: country, level: 9, strength, real: true, country, nt: true }
  return id
}

/** Polska albo Polska U21 jako drużyna w grze (poza ligami) */
export function polandTeam(s: GameState, side: NationalSide): number {
  return nationTeam(s, side === 'A' ? 'Polska' : 'Polska U21', 'Polska', side === 'A' ? 86 : 75)
}

/** rywal: pierwsza reprezentacja albo młodzieżówka, z lekką formą sezonu */
function rivalTeam(rng: Rng, s: GameState, nation: Nation, side: NationalSide): number {
  const name = side === 'A' ? nation.name : `${nation.name} U21`
  const id = nationTeam(s, name, nation.name, 0)
  // forma sezonu: ta sama reprezentacja raz jest mocniejsza, raz słabsza
  s.teams[id].strength = Math.round(nation.strength - (side === 'U21' ? U21_GAP : 0) + rng.normal(0, 1.5))
  s.teams[id].form = undefined
  return id
}

export function isNationalTeam(t: Team | undefined): boolean {
  return !!t?.nt
}

// ---------- kadra ----------

/** typowa kadra na zgrupowanie: 26 powołanych */
const POOL: [Position, number][] = [
  ['BR', 3],
  ['OBR', 8],
  ['POM', 9],
  ['NAP', 6],
]
/** kandydaci: 50 najlepszych Polaków, z czego 26 jest powołanych */
const CANDIDATES: [Position, number][] = [
  ['BR', 6],
  ['OBR', 15],
  ['POM', 17],
  ['NAP', 12],
]
export const SQUAD_SIZE = 26
export const CANDIDATE_COUNT = 50

export const CLUB_ROLE_LABEL = { pewniak: 'gra w pierwszym składzie', rotacja: 'gra w rotacji', lawka: 'grzeje ławkę' } as const

/** klub kandydata: reprezentanci grają głównie za granicą, młodzieżowcy w Ekstraklasie i I lidze */
function clubFor(rng: Rng, s: GameState, skill: number, side: NationalSide, ambition = 0): { name: string; strength: number } {
  if (side === 'U21' || rng.chance(0.25 - ambition * 0.1)) {
    const home = Object.values(s.teams).filter((t) => !t.nt && !t.country && (t.level === 9 || (side === 'U21' && t.level === 8)) && !t.reserve)
    if (home.length && (side === 'U21' ? rng.chance(0.7 - ambition * 0.2) : true)) {
      const t = rng.pick(home)
      return { name: t.name, strength: t.strength }
    }
  }
  // ambicja > 0: zawodnik w formie idzie wyżej, < 0: szuka klubu, w którym zagra
  const lo = skill - 4 + ambition * 4
  const fits = EURO_CLUBS.filter((c) => c.strength >= lo && c.strength <= lo + 12)
  const c = fits.length ? rng.pick(fits) : rng.pick(EURO_CLUBS)
  return { name: c.name, strength: c.strength }
}

/** rola w klubie wynika z tego, jak zawodnik wypada na tle drużyny */
function clubRole(p: Player): 'pewniak' | 'rotacja' | 'lawka' {
  const gap = p.skill - (p.clubStr ?? p.skill)
  return gap >= -3 ? 'pewniak' : gap >= -9 ? 'rotacja' : 'lawka'
}

function setClub(p: Player, c: { name: string; strength: number }): void {
  p.club = c.name
  p.clubStr = c.strength
  p.clubRole = clubRole(p)
}

export function callUp(rng: Rng, s: GameState, side: NationalSide, pos: Position, young = false): Player {
  const age = side === 'U21' ? (young ? rng.int(17, 18) : rng.int(18, 21)) : young ? rng.int(19, 22) : rng.int(22, 33)
  const p = generatePlayer(rng, s, 9, pos, { age, skillOffset: side === 'A' ? 13 : 2 })
  setClub(p, clubFor(rng, s, p.skill, side))
  // reprezentant ma umowę z klubem, a nie z federacją: w kadrze nie ma pensji ani negocjacji
  p.wage = 0
  p.contract = 3
  p.morale = 70
  p.clubMins = 0
  p.clubApps = 0
  p.clubRatings = []
  return p
}

/** ocena kandydata dla asystenta: umiejętności plus forma i minuty w klubie */
export function candidateScore(p: Player): number {
  const role = p.clubRole === 'pewniak' ? 1.5 : p.clubRole === 'lawka' ? -2 : 0
  return p.skill + p.form * 1.2 + role - (p.injuredFor > 0 ? 6 : 0)
}

/** asystent wybiera 26 najlepszych z zachowaniem pozycji */
export function bestSquad(players: Player[]): Player[] {
  const out: Player[] = []
  for (const [pos, count] of POOL)
    out.push(
      ...players
        .filter((p) => p.pos === pos)
        .sort((a, b) => candidateScore(b) - candidateScore(a))
        .slice(0, count),
    )
  return out
}

/** pierwsza kadra selekcjonera: 50 kandydatów, a asystent od razu powołuje 26 */
export function nationalPool(rng: Rng, s: GameState, side: NationalSide): { squad: Player[]; pool: Player[] } {
  const all: Player[] = []
  for (const [pos, count] of CANDIDATES) for (let i = 0; i < count; i++) all.push(callUp(rng, s, side, pos, rng.chance(0.2)))
  const squad = bestSquad(all)
  return { squad, pool: all.filter((p) => !squad.includes(p)) }
}

/** kandydaci w starych zapisach: dobieramy brakujących do pięćdziesiątki */
export function ensurePool(rng: Rng, s: GameState): void {
  const job = s.national
  if (!job || job.pool) return
  job.pool = []
  for (const [pos, count] of CANDIDATES) {
    const have = s.squad.filter((p) => p.pos === pos).length
    for (let i = have; i < count; i++) job.pool.push(callUp(rng, s, job.side, pos, rng.chance(0.2)))
  }
  for (const p of s.squad) if (p.clubStr === undefined) setClub(p, clubFor(rng, s, p.skill, job.side))
}

/** wszyscy kandydaci: powołani i reszta listy */
export function allCandidates(s: GameState): Player[] {
  return [...s.squad, ...(s.national?.pool ?? [])]
}

/** powołanie z listy kandydatów */
export function callUpCandidate(s: GameState, id: number): string {
  const job = s.national
  const p = job?.pool?.find((x) => x.id === id)
  if (!job || !p) return ''
  if (s.squad.length >= SQUAD_SIZE) return `Na zgrupowanie jedzie najwyżej ${SQUAD_SIZE} zawodników. Najpierw kogoś odeślij do klubu.`
  job.pool = job.pool!.filter((x) => x !== p)
  p.morale = Math.max(p.morale, 70)
  s.squad.push(p)
  if (s.lineup.auto) s.lineup = { ...s.lineup }
  const msg = `${playerName(p)} (${p.club}) dostaje powołanie. W klubie już zamawiają tort.`
  news(s, msg)
  return msg
}

/** asystent ustawia powołania od nowa: 26 najlepszych według formy i minut w klubie */
export function autoCallUps(s: GameState): void {
  const job = s.national
  if (!job) return
  const all = allCandidates(s)
  const squad = bestSquad(all)
  s.squad = squad
  job.pool = all.filter((p) => !squad.includes(p))
  const ids = new Set(squad.map((p) => p.id))
  s.lineup.xi = s.lineup.xi.filter((id) => ids.has(id))
  s.lineup.bench = s.lineup.bench.filter((id) => ids.has(id))
}

/**
 * Tydzień w klubach: kandydaci grają (albo nie) w swoich klubach, łapią formę, minuty, kontuzje i rozwijają się.
 * Zimą i latem co lepsi zmieniają kluby: ci w formie idą wyżej, ci z ławki szukają gry.
 */
export function simulateClubWeek(rng: Rng, s: GameState, week: number, nationalMatch: boolean): void {
  const job = s.national
  if (!job || week >= 36) return
  ensurePool(rng, s)
  for (const p of allCandidates(s)) {
    if (p.injuredFor > 0) {
      if (!nationalMatch) p.injuredFor--
      continue
    }
    if (nationalMatch && s.squad.includes(p)) continue
    const role = p.clubRole ?? 'rotacja'
    const plays = rng.chance(role === 'pewniak' ? 0.88 : role === 'rotacja' ? 0.55 : 0.2)
    if (plays) {
      const mins = role === 'lawka' ? rng.int(10, 45) : rng.chance(0.75) ? 90 : rng.int(45, 85)
      p.clubMins = (p.clubMins ?? 0) + mins
      p.clubApps = (p.clubApps ?? 0) + 1
      const rating = clamp(rng.normal(6.5 + (p.skill - (p.clubStr ?? p.skill)) * 0.04, 0.7), 3, 10)
      p.clubRatings = [...(p.clubRatings ?? []), Math.round(rating * 10) / 10].slice(-5)
      developFromMatch(p, rating)
      if (rng.chance(0.006)) p.injuredFor = rng.int(1, 5)
    } else p.clubRatings = [...(p.clubRatings ?? []), 5.8].slice(-5)
    const r = p.clubRatings!
    p.form = clamp(Math.round(((r.reduce((a, b) => a + b, 0) / r.length) - 6.3) * 1.8), -3, 3)
    p.clubRole = clubRole(p)
  }
  // zimowe okno: kilka transferów
  if (week === 18) for (const p of allCandidates(s)) if (rng.chance(0.06)) transferCandidate(rng, s, p)
}

function transferCandidate(rng: Rng, s: GameState, p: Player): void {
  const job = s.national!
  const ambition = p.clubRole === 'lawka' ? -1 : p.form >= 1 ? 1 : 0
  const c = clubFor(rng, s, p.skill, job.side, ambition)
  if (c.name === p.club) return
  const from = p.club
  setClub(p, c)
  if (s.squad.includes(p) || p.skill >= 84)
    news(s, `Transfer: ${playerName(p)} przechodzi z ${from} do ${c.name}. ${ambition > 0 ? 'Krok w górę.' : ambition < 0 ? 'Idzie tam, gdzie będzie grał.' : 'Nowe wyzwanie.'}`)
}

/**
 * Po sezonie lista kandydatów się zmienia: wszyscy starzeją się o rok, młodzi rosną, starsi słabną,
 * weterani kończą karierę reprezentacyjną, młodzieżowcy wyrastają z U21, a z lig wyskakują nowi.
 * Zostaje 50 najlepszych. Powołani zostają w kadrze, dopóki są na liście.
 */
export function refreshPool(rng: Rng, s: GameState, side: NationalSide): string[] {
  const notes: string[] = []
  const job = s.national!
  ensurePool(rng, s)
  let all = allCandidates(s)
  for (const p of all) {
    p.age++
    // rozwój poza sezonem: młodzi z minutami rosną, starsi tracą
    if (p.age <= 23 && p.skill < p.potential) p.skill = Math.min(p.potential, p.skill + rng.int(0, (p.clubMins ?? 0) > 1500 ? 3 : 1))
    if (p.age >= 31) p.skill = Math.max(40, p.skill - rng.int(0, p.age >= 34 ? 3 : 1))
  }
  const leaving = all.filter((p) => (side === 'U21' ? p.age > 21 : p.age >= 36 || (p.age >= 33 && rng.chance(0.25))))
  for (const p of leaving.filter((x) => s.squad.includes(x)).slice(0, 5))
    notes.push(side === 'U21' ? `${playerName(p)} wyrasta z młodzieżówki. Powodzenia w dorosłej kadrze.` : `${playerName(p)} kończy karierę reprezentacyjną. Na pożegnanie dostaje koszulkę z numerem ${p.age}.`)
  all = all.filter((p) => !leaving.includes(p))
  // nowi: młodzi, którzy wyskoczyli w lidze, plus ci, którzy dojrzeli
  const fresh: Player[] = []
  for (const [pos, count] of CANDIDATES) {
    const have = all.filter((p) => p.pos === pos).length
    const n = Math.max(count - have, 0) + rng.int(1, 2)
    for (let i = 0; i < n; i++) fresh.push(callUp(rng, s, side, pos, rng.chance(0.6)))
  }
  all.push(...fresh)
  // zostaje 50 najlepszych z zachowaniem pozycji
  const keep: Player[] = []
  for (const [pos, count] of CANDIDATES)
    keep.push(
      ...all
        .filter((p) => p.pos === pos)
        .sort((a, b) => b.skill - a.skill)
        .slice(0, count),
    )
  for (const p of fresh) if (keep.includes(p) && p.skill >= 78) notes.push(`Nowe nazwisko na liście: ${playerName(p)} (${p.age} l., ${p.pos}, ${p.club}).`)
  for (const p of s.squad) if (!keep.includes(p) && !leaving.includes(p)) notes.push(`${playerName(p)} wypada z czołowej pięćdziesiątki. Dzwoni do Ciebie jego mama, ale liczby nie kłamią.`)
  // letnie transfery i nowy sezon w klubach
  for (const p of keep) {
    if (rng.chance(0.2)) transferCandidate(rng, s, p)
    p.goals = 0
    p.assists = 0
    p.apps = 0
    p.ratingSum = 0
    p.yellows = 0
    p.suspendedFor = 0
    p.injuredFor = 0
    p.clubMins = 0
    p.clubApps = 0
    p.clubRole = clubRole(p)
  }
  s.squad = s.squad.filter((p) => keep.includes(p))
  job.pool = keep.filter((p) => !s.squad.includes(p))
  // brakujące miejsca w kadrze uzupełnia asystent
  if (s.squad.length < SQUAD_SIZE) {
    const best = bestSquad(keep).filter((p) => !s.squad.includes(p))
    for (const [pos, count] of POOL) {
      const need = count - s.squad.filter((p) => p.pos === pos).length
      for (const p of best.filter((x) => x.pos === pos).slice(0, Math.max(0, need))) {
        s.squad.push(p)
        job.pool = job.pool.filter((x) => x !== p)
        notes.push(`Pierwsze powołanie: ${playerName(p)} (${p.age} l., ${p.pos}, ${p.club}).`)
      }
    }
  }
  s.lineup.xi = s.lineup.xi.filter((id) => s.squad.some((p) => p.id === id))
  s.lineup.bench = s.lineup.bench.filter((id) => s.squad.some((p) => p.id === id))
  return notes
}

// ---------- losowanie ----------

function nationsFor(world: boolean): Nation[] {
  return NATIONS.filter((x) => x.name !== 'Polska' && (world || x.europe))
}

const europeByStrength = () => [...nationsFor(false)].sort((a, b) => b.strength - a.strength)

/** eliminacje: Polska i po jednej drużynie z czterech koszyków; kolejki rozłożone na dwa sezony */
function drawQualifiers(rng: Rng, s: GameState, side: NationalSide, me: number, event: string, firstSeason: number): NatGroup {
  const eu = europeByStrength()
  const pots = [eu.slice(0, 10), eu.slice(10, 22), eu.slice(22, 36), eu.slice(36)]
  const ids = [me, ...pots.map((pot) => rivalTeam(rng, s, rng.pick(pot), side))]
  const letter = 'ABCDEFGHIJ'[rng.int(0, 9)]
  const [w1, w2] = QUAL_WEEKS[side]
  return {
    name: `Eliminacje ${eventShort(event)} · grupa ${letter}`,
    teamIds: ids,
    rounds: makeFixtures(rng, ids),
    weeks: [...w1, ...w2],
    seasons: [...w1.map(() => firstSeason), ...w2.map(() => firstSeason + 1)],
  }
}

/** Liga Narodów: grupa czterech drużyn z tej samej dywizji, mecz i rewanż */
function drawNationsLeague(rng: Rng, s: GameState, me: number, div: 'A' | 'B', season: number) {
  const eu = europeByStrength()
  const range = div === 'A' ? eu.slice(0, 16) : eu.slice(16, 32)
  const picked = rng.shuffle([...range]).slice(0, 3)
  const ids = [me, ...picked.map((x) => rivalTeam(rng, s, x, 'A'))]
  const name = nationsLeagueName(season)
  const group: NatGroup = { name: `${name} · dywizja ${div}, grupa ${rng.int(1, 4)}`, teamIds: ids, rounds: makeFixtures(rng, ids), weeks: NL_WEEKS }
  return { name, div, group, finals: [], reached: 0 }
}

/** turniej: grupa z jednym faworytem, jednym średniakiem i jednym słabszym rywalem */
function drawTournament(rng: Rng, s: GameState, job: NationalJob): NatGroup {
  const field = [...nationsFor(isWorldCup(job.event))].sort((a, b) => b.strength - a.strength)
  const used = new Set(job.qual.teamIds.map((id) => s.teams[id].country))
  const pick = (from: Nation[]) => {
    const free = from.filter((x) => !used.has(x.name))
    const c = rng.pick(free.length ? free : from)
    used.add(c.name)
    return rivalTeam(rng, s, c, job.side)
  }
  const ids = [job.teamId, pick(field.slice(0, 8)), pick(field.slice(8, 20)), pick(field.slice(20, 30))]
  // trzy kolejki: każdy z każdym raz
  const rounds = makeFixtures(rng, ids).slice(0, 3)
  return { name: `${job.event} · grupa ${'ABCDEFGHIJKL'[rng.int(0, isWorldCup(job.event) ? 11 : 5)]}`, teamIds: ids, rounds, weeks: TOURN_GROUP_WEEKS }
}

/** rywal w meczu o wszystko: im dalej, tym mocniejszy */
function koOpponent(rng: Rng, s: GameState, job: NationalJob, stage: NatStage): number {
  const world = stage !== 'NLSF' && stage !== 'NLF' && stage !== 'PO1' && stage !== 'PO2' && isWorldCup(job.event)
  const field = [...nationsFor(world)].sort((a, b) => b.strength - a.strength)
  const met = new Set(
    [...(job.tourn?.group.teamIds ?? []), ...(job.tourn?.ko ?? []).flatMap((k) => [k.tie.home, k.tie.away]), ...(job.nl?.finals ?? []).flatMap((k) => [k.tie.home, k.tie.away])].map(
      (id) => s.teams[id]?.country,
    ),
  )
  const ranges: Record<NatStage, [number, number]> = {
    PO1: [14, 34],
    PO2: [12, 30],
    R32: [8, 32],
    R16: [4, 20],
    QF: [2, 16],
    SF: [0, 10],
    F: [0, 6],
    NLSF: [0, 10],
    NLF: [0, 6],
  }
  const range = field.slice(...ranges[stage])
  const free = range.filter((x) => !met.has(x.name))
  return rivalTeam(rng, s, rng.pick(free.length ? free : range), job.side)
}

function addKo(rng: Rng, list: NatKo[], stage: NatStage, me: number, opp: number, after = 0): void {
  // nigdy w tym samym tygodniu co poprzedni mecz (stare zapisy miały turniej o tydzień później)
  const week = Math.max(KO_WEEKS[stage], after + 1, ...list.map((k) => k.week + 1))
  list.push({ stage, week, tie: rng.chance(0.5) ? { home: me, away: opp } : { home: opp, away: me } })
}

/**
 * Nowy sezon selekcjonera. Eliminacje, które już trwają, idą dalej. Nowy selekcjoner w sezonie turniejowym
 * przejmuje grupę po poprzedniku z rozegranymi wiosennymi meczami.
 */
export function newNationalSeason(rng: Rng, s: GameState, side: NationalSide, teamId: number, since: number, prev?: NationalJob): NationalJob {
  const event = eventFor(side, s.season)
  const tournSeason = isTournamentSeason(side, s.season)
  const job: NationalJob = { side, teamId, since, season: s.season, event, tournSeason, qual: undefined as unknown as NatGroup, reached: 0, nlDiv: prev?.nlDiv ?? 'A', pool: prev?.side === side ? prev.pool : undefined }
  const carry = prev && prev.event === event && prev.qual?.seasons?.includes(s.season) ? prev.qual : undefined
  if (carry) job.qual = carry
  else {
    const first = tournSeason ? s.season - 1 : s.season
    job.qual = drawQualifiers(rng, s, side, teamId, event, first)
    // kolejki z poprzedniego sezonu rozegrał poprzednik
    const played = job.qual.rounds.filter((_, i) => job.qual.seasons![i] < s.season)
    for (const r of played) for (const f of r) aiMatch(rng, s, f)
    if (played.length) {
      const pos = computeTable(job.qual).findIndex((r) => r.teamId === teamId) + 1
      const row = computeTable(job.qual).find((r) => r.teamId === teamId)!
      news(s, `Poprzednik zostawił Ci ${pos}. miejsce w grupie eliminacji ${eventShort(event)}: ${row.pts} pkt po ${row.p} meczach. Spadek po nim: worek z piłkami i kalendarz z 2019 roku.`)
    }
  }
  if (!carry) {
    const rivals = job.qual.teamIds.filter((id) => id !== teamId).map((id) => s.teams[id].name)
    news(s, `Losowanie eliminacji ${eventShort(event)}: ${rivals.join(', ')}. ${qualRule(side, event)}`)
  }
  if (side === 'A' && !tournSeason) {
    job.nl = drawNationsLeague(rng, s, teamId, job.nlDiv!, s.season)
    const rivals = job.nl.group.teamIds.filter((id) => id !== teamId).map((id) => s.teams[id].name)
    news(s, `${job.nl.name}, dywizja ${job.nl.div}: ${rivals.join(', ')}. ${job.nl.div === 'A' ? 'Zwycięzca grupy jedzie na Final Four, ostatni spada do dywizji B.' : 'Zwycięzca grupy awansuje do dywizji A.'}`)
  }
  return job
}

/** cel na sezon w jednym zdaniu, do wiadomości i nagłówka */
export function nationalGoal(job: NationalJob): string {
  if (job.tournSeason) return `Cel: awans na ${job.event}`
  return job.nl ? `Cel: dobra Liga Narodów i mocny start eliminacji ${eventShort(job.event)}` : `Cel: mocny start eliminacji ${eventShort(job.event)}`
}

/** kto jedzie na turniej z grupy eliminacyjnej */
export function qualRule(side: NationalSide, event: string): string {
  return side === 'A' && isWorldCup(event)
    ? 'Zwycięzca grupy jedzie na mundial, druga drużyna gra baraże.'
    : 'Na turniej jadą dwie najlepsze drużyny z grupy.'
}

// ---------- mecze ----------

/** indeks kolejki grupy rozgrywanej w tym tygodniu tego sezonu */
function roundAt(g: NatGroup, season: number, week: number, groupSeason: number): number {
  return g.weeks.findIndex((w, i) => w === week && (g.seasons?.[i] ?? groupSeason) === season)
}

type NatSlot = { g: NatGroup; label: (idx: number) => string; done: () => void }

function slots(rng: Rng | undefined, s: GameState, job: NationalJob): NatSlot[] {
  const out: NatSlot[] = [
    {
      g: job.qual,
      label: (idx) => `Eliminacje ${eventShort(job.event)} · ${idx + 1}. kolejka`,
      done: () => rng && finishQualifiers(rng, s, job),
    },
  ]
  if (job.nl) {
    const nl = job.nl
    out.push({ g: nl.group, label: (idx) => `Liga Narodów · ${idx + 1}. kolejka`, done: () => rng && finishNationsLeagueGroup(rng, s, job) })
  }
  if (job.tourn) out.push({ g: job.tourn.group, label: (idx) => `${eventShort(job.event)} · grupa, ${idx + 1}. mecz`, done: () => rng && finishTournamentGroup(rng, s, job) })
  return out
}

function koLists(job: NationalJob): NatKo[][] {
  return [job.playoff ?? [], job.nl?.finals ?? [], job.tourn?.ko ?? []]
}

function koLabel(job: NationalJob, ko: NatKo): string {
  if (ko.stage === 'PO1' || ko.stage === 'PO2') return `Baraże ${eventShort(job.event)} · ${ko.stage === 'PO1' ? 'półfinał' : 'finał'}`
  if (ko.stage === 'NLSF' || ko.stage === 'NLF') return `Liga Narodów · ${ko.stage === 'NLSF' ? 'półfinał' : 'finał'}`
  return `${eventShort(job.event)} · ${STAGE_LABEL[ko.stage].toLowerCase()}`
}

export function nationalFixtureForWeek(s: GameState, week: number): { f: Fixture | CupTie; label: string; ko?: NatStage } | undefined {
  const job = s.national
  if (!job || job.season !== s.season) return undefined
  const me = job.teamId
  for (const { g, label } of slots(undefined, s, job)) {
    const idx = roundAt(g, s.season, week, job.season)
    const f = idx >= 0 ? g.rounds[idx]?.find((x) => x.home === me || x.away === me) : undefined
    if (f) return { f, label: label(idx) }
  }
  for (const list of koLists(job)) {
    const ko = list.find((k) => k.week === week)
    if (ko) return { f: ko.tie, label: koLabel(job, ko), ko: ko.stage }
  }
  return undefined
}

/** najbliższy nierozegrany mecz reprezentacji od danego tygodnia */
export function nextNationalMatch(s: GameState, from: number): { week: number; f: Fixture | CupTie; label: string } | undefined {
  for (let w = from; w < NATIONAL_SEASON_WEEKS; w++) {
    const x = nationalFixtureForWeek(s, w)
    if (x && x.f.hg === undefined) return { week: w, f: x.f, label: x.label }
  }
  return undefined
}

function aiMatch(rng: Rng, s: GameState, f: Fixture): void {
  const r = simulateScore(rng, teamPower(s.teams[f.home]) + rng.normal(0, 2.5), teamPower(s.teams[f.away]) + rng.normal(0, 2.5), 9)
  f.hg = r.hg
  f.ag = r.ag
}

function pens(rng: Rng, t: CupTie): void {
  const homeWins = rng.chance(0.5)
  const a = rng.int(3, 5)
  const b = Math.max(0, a - 1 - (rng.chance(0.3) ? 1 : 0))
  t.pens = homeWins ? `${a}:${b}` : `${b}:${a}`
  t.winner = homeWins ? t.home : t.away
}

/** mecze reprezentacji w danym tygodniu: nasz gra trener, resztę grupy symulujemy */
export function playNationalForWeek(rng: Rng, s: GameState, week: number, push: (rep: MatchReport) => void): void {
  const job = s.national
  if (!job || job.season !== s.season) return
  const me = job.teamId
  for (const { g, label, done } of slots(rng, s, job)) {
    const idx = roundAt(g, s.season, week, job.season)
    if (idx < 0 || !g.rounds[idx]) continue
    for (const f of g.rounds[idx]) {
      if (f.hg !== undefined) continue
      if (f.home === me || f.away === me) {
        const rep = playClubMatch(rng, s, f, false)
        rep.national = true
        rep.cupName = label(idx)
        f.hg = rep.hg
        f.ag = rep.ag
        push(rep)
      } else aiMatch(rng, s, f)
    }
    if (idx === g.rounds.length - 1) done()
  }
  for (const list of koLists(job)) {
    const ko = list.find((k) => k.week === week && k.tie.winner === undefined)
    if (!ko) continue
    const rep = playClubMatch(rng, s, ko.tie, true)
    rep.national = true
    rep.cupName = koLabel(job, ko)
    ko.tie.hg = rep.hg
    ko.tie.ag = rep.ag
    if (rep.hg !== rep.ag) ko.tie.winner = rep.hg > rep.ag ? ko.tie.home : ko.tie.away
    else {
      pens(rng, ko.tie)
      rep.pens = ko.tie.pens
    }
    const won = ko.tie.winner === me
    if (won && ko.stage === 'F') rep.trophy = job.event
    if (won && ko.stage === 'NLF') rep.trophy = job.nl!.name
    push(rep)
    afterKo(rng, s, job, ko.stage, won)
  }
}

export function groupTable(g: NatGroup) {
  return computeTable(g)
}

function finishQualifiers(rng: Rng, s: GameState, job: NationalJob): void {
  const table = computeTable(job.qual)
  const pos = table.findIndex((r) => r.teamId === job.teamId) + 1
  const direct = job.side === 'A' && isWorldCup(job.event) ? 1 : 2
  if (pos <= direct) qualify(rng, s, job, `${pos}. miejsce w grupie`)
  else if (pos === 2) {
    job.playoff = []
    const opp = koOpponent(rng, s, job, 'PO1')
    addKo(rng, job.playoff, 'PO1', job.teamId, opp)
    adjustCoach(s, { stress: 8 })
    news(s, `Drugie miejsce w grupie, czyli baraże o mundial. W marcu półfinał z ${s.teams[opp].name}. Cały kraj liczy punkty i obgryza paznokcie.`)
  } else {
    adjustTrust(s, { board: -25, fans: -20 })
    adjustCoach(s, { reputation: -5, stress: 15 })
    news(s, `Eliminacje przegrane: ${pos}. miejsce w grupie. Latem turniej w telewizji, a Ty na cenzurowanym.`)
  }
}

function qualify(rng: Rng, s: GameState, job: NationalJob, how: string): void {
  job.reached = 1
  job.tourn = { group: drawTournament(rng, s, job), ko: [] }
  const rivals = job.tourn.group.teamIds.filter((id) => id !== job.teamId).map((id) => s.teams[id].name)
  adjustTrust(s, { board: 12, fans: 12, squad: 4 })
  adjustCoach(s, { reputation: 4, stress: -15 })
  news(s, `JEDZIEMY NA ${eventShort(job.event).toUpperCase()}! ${how}. Losowanie turnieju: ${rivals.join(', ')}.`)
}

function finishNationsLeagueGroup(rng: Rng, s: GameState, job: NationalJob): void {
  const nl = job.nl!
  const table = computeTable(nl.group)
  const pos = table.findIndex((r) => r.teamId === job.teamId) + 1
  if (nl.div === 'A' && pos === 1) {
    nl.reached = 1
    nl.result = 'Final Four'
    addKo(rng, nl.finals, 'NLSF', job.teamId, koOpponent(rng, s, job, 'NLSF'))
    adjustTrust(s, { board: 8, fans: 10 })
    adjustCoach(s, { reputation: 3 })
    news(s, `Polska wygrywa grupę Ligi Narodów i jedzie w czerwcu na Final Four! Kibice pytają, czy to już mundial.`)
  } else if (nl.div === 'A' && pos === 4) {
    job.nlDiv = 'B'
    nl.result = 'spadek do dywizji B'
    adjustTrust(s, { board: -10, fans: -8 })
    news(s, 'Ostatnie miejsce w grupie Ligi Narodów i spadek do dywizji B. Eksperci w studiu mają materiał na cały wieczór.')
  } else if (nl.div === 'B' && pos === 1) {
    job.nlDiv = 'A'
    nl.result = 'awans do dywizji A'
    adjustTrust(s, { board: 6, fans: 6 })
    adjustCoach(s, { reputation: 2 })
    news(s, 'Awans do dywizji A Ligi Narodów! Teraz Polska znowu gra z najlepszymi, a sponsorzy z ulgą drukują nowe plakaty.')
  } else {
    nl.result = `${pos}. miejsce w grupie`
    news(s, `Liga Narodów: ${pos}. miejsce w grupie. Ani wstydu, ani fajerwerków.`)
  }
}

function finishTournamentGroup(rng: Rng, s: GameState, job: NationalJob): void {
  const t = job.tourn!
  const table = computeTable(t.group)
  const pos = table.findIndex((r) => r.teamId === job.teamId) + 1
  const row = table[pos - 1]
  // na Euro i mundialu wychodzą też najlepsze trzecie drużyny; młodzieżówka gra od razu ćwierćfinał
  const u21 = job.side === 'U21'
  const bestThird = !u21 && pos === 3 && (row.pts >= 4 || (row.pts === 3 && row.gf - row.ga >= 0 && rng.chance(0.6)))
  if (pos <= 2 || bestThird) {
    const stage: NatStage = u21 ? 'QF' : isWorldCup(job.event) ? 'R32' : 'R16'
    job.reached = STAGE_REACHED[stage]!
    const opp = koOpponent(rng, s, job, stage)
    addKo(rng, t.ko, stage, job.teamId, opp, t.group.weeks[t.group.weeks.length - 1])
    adjustTrust(s, { board: 6, fans: 8 })
    adjustCoach(s, { reputation: 3 })
    news(
      s,
      `${bestThird ? 'Z trzeciego miejsca, ale wychodzimy z grupy!' : 'Wyjście z grupy!'} W ${STAGE_LABEL[stage].toLowerCase()} ${s.teams[opp].name}. W kraju ruszają zakupy flag i grilli.`,
    )
  } else {
    t.out = true
    adjustTrust(s, { board: -8, fans: -10 })
    adjustCoach(s, { stress: 8 })
    news(s, `Koniec turnieju po fazie grupowej (${pos}. miejsce). Samolot do kraju odlatuje szybciej, niż planowano.`)
  }
}

function afterKo(rng: Rng, s: GameState, job: NationalJob, stage: NatStage, won: boolean): void {
  // baraże o mundial
  if (stage === 'PO1' || stage === 'PO2') {
    if (!won) {
      adjustTrust(s, { board: -20, fans: -15 })
      adjustCoach(s, { reputation: -4, stress: 15 })
      news(s, `Przegrany baraż. Mundial ${eventShort(job.event).slice(3)} obejrzymy w telewizji, a Ty w kółko powtórkę tego meczu.`)
    } else if (stage === 'PO1') {
      const opp = koOpponent(rng, s, job, 'PO2')
      addKo(rng, job.playoff!, 'PO2', job.teamId, opp)
      news(s, `Półfinał baraży wygrany! Za kilka dni finał z ${s.teams[opp].name} o bilet na mundial.`)
    } else qualify(rng, s, job, 'Wygrany finał baraży')
    return
  }
  // Liga Narodów
  if (stage === 'NLSF' || stage === 'NLF') {
    const nl = job.nl!
    if (!won) {
      nl.result = stage === 'NLF' ? 'finał Ligi Narodów' : 'półfinał Ligi Narodów'
      news(s, stage === 'NLF' ? 'Przegrany finał Ligi Narodów. Srebro, którego nikt nie liczy, ale wszyscy pamiętają.' : 'Odpadamy w półfinale Ligi Narodów. Wakacje zaczynają się o tydzień wcześniej.')
      return
    }
    if (stage === 'NLSF') {
      nl.reached = 2
      const opp = koOpponent(rng, s, job, 'NLF')
      addKo(rng, nl.finals, 'NLF', job.teamId, opp)
      adjustTrust(s, { fans: 6, board: 4 })
      news(s, `Finał Ligi Narodów! Rywal: ${s.teams[opp].name}. Niby mniej ważne niż mundial, ale puchar to puchar.`)
    } else {
      nl.reached = 3
      nl.result = 'zwycięstwo w Lidze Narodów'
      s.trophies.push(`${nl.name} (sezon ${s.season})`)
      adjustTrust(s, { fans: 15, board: 15, squad: 8 })
      adjustCoach(s, { reputation: 8, stress: -15 })
      news(s, `Polska wygrywa Ligę Narodów! Puchar jedzie do Warszawy, a kibice już śpiewają o mundialu.`)
    }
    return
  }
  // turniej
  const t = job.tourn!
  if (!won) {
    t.out = true
    adjustTrust(s, { fans: (STAGE_REACHED[stage] ?? 2) * 2, board: STAGE_REACHED[stage]! - 1 })
    news(
      s,
      stage === 'F'
        ? `Srebro! Przegrany finał ${eventShort(job.event)}, ale na lotnisku czeka tłum.`
        : `Odpadamy w ${STAGE_LABEL[stage].toLowerCase().replace('ćwierćfinał', 'ćwierćfinale').replace('półfinał', 'półfinale')}. Kraj płacze, ale z dumą.`,
    )
    return
  }
  if (stage === 'F') {
    job.reached = 6
    s.trophies.push(`Złoto: ${job.event} (sezon ${s.season})`)
    adjustTrust(s, { fans: 30, board: 30, squad: 15 })
    adjustCoach(s, { reputation: job.side === 'A' ? 20 : 10, stress: -30 })
    news(s, `ZŁOTO! ${job.event} dla Polski! Prezydent dzwoni z gratulacjami, a premier już szuka miejsca na wspólne zdjęcie.`)
    return
  }
  const next = NEXT_STAGE[stage]!
  job.reached = STAGE_REACHED[next]!
  const opp = koOpponent(rng, s, job, next)
  addKo(rng, t.ko, next, job.teamId, opp)
  adjustTrust(s, { fans: 8, board: 6 })
  adjustCoach(s, { reputation: 3 })
  news(s, `${next === 'F' ? 'FINAŁ' : STAGE_LABEL[next]}! Rywal: ${s.teams[opp].name}. Na ulicach trąbią samochody.`)
}

// ---------- oferty ----------

/** pensja selekcjonera za sezon */
export function nationalSalary(side: NationalSide): number {
  return side === 'A' ? 2_400_000 : 700_000
}

/**
 * Oferta z PZPN po sezonie: najpierw młodzieżówka (UEFA Pro i wysoka reputacja), potem pierwsza reprezentacja.
 * Selekcjoner młodzieżówki po dobrym turnieju dostaje propozycję awansu szybciej.
 */
export function nationalOffer(rng: Rng, s: GameState): JobOffer | undefined {
  if (s.coach.license !== 'UEFA Pro' || s.coach.age >= 68) return undefined
  const rep = s.coach.reputation
  const job = s.national
  if (job?.side === 'A') return undefined
  let side: NationalSide | undefined
  if (job?.side === 'U21') {
    if ((job.reached >= 4 && rng.chance(0.6)) || (rep >= 88 && rng.chance(0.35))) side = 'A'
  } else if (rep >= 90 && rng.chance(0.35)) side = 'A'
  else if (rep >= 72 && rng.chance(rep >= 85 ? 0.45 : 0.25)) side = 'U21'
  if (!side) return undefined
  const teamId = polandTeam(s, side)
  return {
    national: side,
    teamId,
    teamName: SIDE_NAME[side],
    level: 9,
    leagueName: 'PZPN',
    goal: 'awans',
    salary: nationalSalary(side),
    note:
      side === 'A'
        ? 'Dzwoni prezes PZPN. „Kraj na Pana czeka. Media też, ale tym się Pan nie przejmuje”.'
        : 'PZPN szuka trenera młodzieżówki. „Talenty mamy, brakuje kogoś, kto im nie przeszkodzi”.',
  }
}

// ---------- koniec sezonu ----------

/** jak idą eliminacje, które jeszcze trwają, np. „2. miejsce po 4 meczach” */
function qualStatus(job: NationalJob): string {
  const table = computeTable(job.qual)
  const row = table.find((r) => r.teamId === job.teamId)
  const pos = table.findIndex((r) => r.teamId === job.teamId) + 1
  return row && row.p > 0 ? `eliminacje ${eventShort(job.event)}: ${pos}. miejsce po ${row.p} meczach` : `eliminacje ${eventShort(job.event)} jeszcze przed nami`
}

/** wpis do historii kariery za sezon selekcjonera */
export function nationalRecord(s: GameState, outcome?: string, fired = false) {
  const job = s.national!
  const between = !job.tournSeason
  const pos = computeTable(job.nl ? job.nl.group : job.qual).findIndex((r) => r.teamId === job.teamId) + 1
  const auto = between
    ? [job.nl ? `Liga Narodów: ${job.nl.result ?? `${pos}. miejsce w grupie`}` : '', qualStatus(job)].filter(Boolean).join(', ')
    : job.reached === 0
      ? `${pos}. miejsce w eliminacjach, bez awansu`
      : `awans na turniej, ${REACHED_LABEL[job.reached]}`
  return {
    season: s.season,
    clubName: SIDE_NAME[job.side],
    level: 9,
    leagueName: job.nl ? `${job.nl.name} (dywizja ${job.nl.div})` : between ? `Eliminacje ${eventShort(job.event)}` : job.event,
    position: pos || undefined,
    outcome: outcome ?? auto,
    cup: '',
    fired,
    national: { side: job.side, reached: between ? 0 : job.reached, ...(between ? { between: true, nl: job.nl?.reached ?? 0 } : {}) },
  }
}

/** podsumowanie sezonu selekcjonera; zwraca, czy PZPN dziękuje za współpracę */
export function nationalSeasonEnd(s: GameState, summary: string[]): boolean {
  const job = s.national!
  const rec = nationalRecord(s)
  const weight = job.side === 'A' ? 1 : 0.6
  let fired: boolean
  if (job.tournSeason) {
    summary.push(`${SIDE_NAME[job.side]}: ${job.event}, ${rec.outcome}.`)
    // oczekiwania: awans na turniej to minimum, każda runda dalej to premia
    const repGain = [-6, 2, 4, 6, 10, 14, 20][job.reached] * weight
    adjustCoach(s, { reputation: Math.round(repGain), stress: job.reached >= 3 ? -15 : job.reached === 0 ? 10 : 0 })
    adjustTrust(s, { board: job.reached === 0 ? -10 : job.reached >= 4 ? 10 : 0 })
    fired = (job.reached === 0 && s.trust.board < 55) || s.trust.board < 25
  } else {
    summary.push(`${SIDE_NAME[job.side]}: ${rec.outcome}.`)
    // sezon przejściowy: liczy się Liga Narodów i to, czy eliminacje idą w dobrą stronę
    const pos = computeTable(job.qual).findIndex((r) => r.teamId === job.teamId) + 1
    const nlGain = job.nl ? [0, 3, 5, 8][job.nl.reached] + (job.nl.result?.startsWith('awans') ? 2 : 0) - (job.nl.result?.startsWith('spadek') ? 4 : 0) : 0
    adjustCoach(s, { reputation: Math.round((nlGain + (pos <= 2 ? 1 : -2)) * weight) })
    adjustTrust(s, { board: pos <= 2 ? 3 : -6 })
    fired = s.trust.board < 25
  }
  s.history.push({ ...rec, fired })
  const top = [...s.squad].sort((a, b) => b.goals - a.goals)[0]
  if (top && top.goals > 0) summary.push(`Najlepszy strzelec kadry: ${playerName(top)} (${top.goals} goli).`)
  for (const p of s.squad) if (!s.bestPlayer || p.skill > s.bestPlayer.skill) s.bestPlayer = { name: playerName(p), skill: p.skill }
  if (fired) summary.push('PZPN dziękuje za współpracę. Na pożegnanie dostajesz dres z orzełkiem i list od prezesa, podpisany przez sekretarkę.')
  else if (!job.tournSeason) summary.push(`Za rok ${job.event}. ${qualRule(job.side, job.event)}`)
  return fired
}

// ---------- zdarzenia ----------

const trust = (s: GameState, board = 0, squad = 0, fans = 0) => adjustTrust(s, { board, squad, fans })
const coach = (s: GameState, stress = 0, reputation = 0) => adjustCoach(s, { stress, reputation })

/** zdarzenia selekcjonera: w kadrze nie ma transferów ani budżetu, są za to media, kluby i prezes PZPN */
export const NATIONAL_EVENTS: GameEvent[] = [
  {
    id: 'nt_klub_prosi',
    player: (p) => p.skill >= 84 && isAvailable(p),
    text: 'Dzwoni dyrektor sportowy z klubu {p}. Zawodnik ma lekki uraz i klub prosi, żeby nie grał w obu meczach zgrupowania.',
    options: [
      {
        label: 'Puszczam go do klubu',
        apply: ({ s, p }) => {
          p!.injuredFor = Math.max(p!.injuredFor, 2)
          trust(s, 0, 0, -3)
          return 'Klub dziękuje, kibice marudzą, że „kadra to nie przedszkole”. {ps} odpoczywa.'
        },
      },
      {
        label: 'Gra, kadra jest najważniejsza',
        apply: ({ s, p, rng }) => {
          trust(s, 2, 0, 3)
          if (rng.chance(0.35)) {
            p!.injuredFor = 4
            coach(s, 6)
            return '{ps} zagrał i uraz się odnowił. Klub wysyła do PZPN pismo na trzy strony.'
          }
          return '{ps} zagrał bez problemu. Dyrektor klubu i tak przestał odbierać od Ciebie telefony.'
        },
      },
    ],
  },
  {
    id: 'nt_gwiazda_ligi',
    text: 'Dziennikarz pyta na konferencji, dlaczego nie powołujesz króla strzelców Ekstraklasy. „Bo ma 34 lata i biega jak ja” – chcesz odpowiedzieć.',
    options: [
      {
        label: 'Odpowiadam szczerze',
        apply: ({ s }) => {
          trust(s, -2, 3, -4)
          coach(s, 2)
          return 'Cytat ląduje na okładkach. Szatnia się śmieje, kibice z jego miasta zakładają petycję.'
        },
      },
      {
        label: '„Obserwujemy wszystkich zawodników”',
        apply: ({ s }) => {
          trust(s, 1, 0, -1)
          return 'Odpowiedź tak okrągła, że nikt nie zrobił z niej nagłówka. Sukces.'
        },
      },
      {
        label: 'Powołuję go dla świętego spokoju',
        apply: ({ s, rng }) => {
          const p = callUp(rng, s, s.national?.side ?? 'A', 'NAP')
          p.firstName = rng.pick(['Mariusz', 'Krzysztof', 'Sławomir'])
          p.age = 34
          p.skill = Math.max(70, p.skill - 6)
          p.potential = p.skill
          p.traits = ['weteran']
          p.club = 'król strzelców Ekstraklasy'
          s.squad.push(p)
          trust(s, 0, -2, 5)
          return `${p.firstName} ${p.lastName} dostaje powołanie. Kibice szczęśliwi, młodsi napastnicy mniej.`
        },
      },
    ],
  },
  {
    id: 'nt_reklama',
    text: 'Prezes {prezes} umówił kadrę na nagranie reklamy chipsów. Termin: dzień przed meczem.',
    options: [
      {
        label: 'Nagrywamy, sponsor to sponsor',
        apply: ({ s }) => {
          trust(s, 6, -3, 0)
          addModifier(s, 'Chipsy przed meczem', -1, 1)
          return 'Reklama wyszła zabawnie, nogi trochę gorzej. Prezes zadowolony.'
        },
      },
      {
        label: 'Nie przed meczem',
        apply: ({ s }) => {
          trust(s, -6, 3, 1)
          return 'Prezes przekłada nagranie i zapamiętuje. Zawodnicy mają spokojny wieczór.'
        },
      },
    ],
  },
  {
    id: 'nt_gwizdy',
    player: (p) => p.apps >= 2,
    text: 'Po ostatnim meczu część trybun gwizdała na {p}. Media pytają, czy dalej na niego stawiasz.',
    options: [
      {
        label: 'Bronię go publicznie',
        apply: ({ s, p }) => {
          setMorale(p!, 15)
          trust(s, 0, 4, -2)
          return '{ps} dziękuje w wywiadzie. Szatnia docenia, że selekcjoner trzyma za swoich.'
        },
      },
      {
        label: 'Sadzam go na ławce',
        apply: ({ s, p }) => {
          setMorale(p!, -15)
          trust(s, 0, -3, 3)
          return '{ps} siedzi na ławce i patrzy w telefon. Kibice zadowoleni, on mniej.'
        },
      },
    ],
  },
  {
    id: 'nt_naturalizacja',
    once: true,
    text: 'Brazylijski pomocnik grający od ośmiu lat w Ekstraklasie dostał polskie obywatelstwo i chce grać dla Polski. Mówi już „kurczę” i „dzień dobry”.',
    options: [
      {
        label: 'Powołuję',
        apply: ({ s, rng }) => {
          const p = callUp(rng, s, s.national?.side ?? 'A', 'POM')
          p.firstName = 'Rafael'
          p.lastName = rng.pick(['Silva', 'Santos', 'Oliveira'])
          p.age = s.national?.side === 'U21' ? 21 : 29
          p.skill += 2
          p.potential = Math.max(p.potential, p.skill)
          p.club = 'Ekstraklasa'
          s.squad.push(p)
          trust(s, 0, 2, -3)
          return `${p.firstName} ${p.lastName} w kadrze. Część kibiców kręci nosem, ale pierwsze podanie przekonuje wszystkich.`
        },
      },
      {
        label: 'Kadra dla wychowanków',
        apply: ({ s }) => {
          trust(s, 0, 0, 4)
          return 'Zostajesz przy swoich. Brazylijczyk mówi, że rozumie, i idzie na pierogi.'
        },
      },
    ],
  },
  {
    id: 'nt_hotel',
    text: 'W hotelu na zgrupowaniu za ścianą odbywa się wesele. Disco polo do czwartej, a jutro mecz.',
    options: [
      {
        label: 'Zmieniamy hotel w nocy',
        apply: ({ s }) => {
          coach(s, 4)
          trust(s, -2, 2, 0)
          return 'Przeprowadzka o północy. Kierownik kadry nigdy Ci tego nie wybaczy, zawodnicy się wyspali.'
        },
      },
      {
        label: 'Idę poprosić o ciszę',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 0, 2, 3)
            return 'Państwo młodzi ściszają muzykę i proszą o zdjęcie. Zdjęcie robi furorę w internecie.'
          }
          addModifier(s, 'Nieprzespana noc', -1.5, 1)
          return 'Wujek panny młodej zaprosił Cię na wódkę. Odmówiłeś, ale cisza nie nastała.'
        },
      },
      {
        label: 'Zatyczki do uszu dla wszystkich',
        apply: ({ s }) => {
          addModifier(s, 'Nieprzespana noc', -0.5, 1)
          return 'Zatyczki pomogły połowie drużyny. Druga połowa zna już cały repertuar zespołu Weekend.'
        },
      },
    ],
  },
  {
    id: 'nt_kapitan',
    text: 'Dwóch liderów kadry chce nosić opaskę kapitana. Obaj mają swoich ludzi w szatni.',
    options: [
      {
        label: 'Kapitanem zostaje starszy',
        apply: ({ s }) => {
          trust(s, 0, 2, 0)
          return 'Hierarchia zachowana. Młodszy lider mówi, że „jeszcze przyjdzie jego czas”, i trzaska drzwiami.'
        },
      },
      {
        label: 'Opaska na zmianę',
        apply: ({ s }) => {
          trust(s, 0, -4, -2)
          return 'Kompromis nie zadowolił nikogo. Media liczą, kto ile razy nosił opaskę.'
        },
      },
      {
        label: 'Wybierają zawodnicy',
        apply: ({ s }) => {
          trust(s, 0, 4, 0)
          coach(s, -2)
          return 'Głosowanie tajne, wynik jawny, wszyscy podają sobie ręce. Przynajmniej przed kamerami.'
        },
      },
    ],
  },
  {
    id: 'nt_ekspert',
    text: 'Były selekcjoner w telewizji mówi, że Twoja taktyka „to jest jakiś eksperyment na żywym organizmie”.',
    options: [
      {
        label: 'Odpowiadam w wywiadzie',
        apply: ({ s }) => {
          coach(s, 5, 1)
          trust(s, -2, 0, 2)
          return 'Wymiana zdań trwa tydzień. Oglądalność studia rośnie, Twoje ciśnienie też.'
        },
      },
      {
        label: 'Milczę',
        apply: ({ s }) => {
          coach(s, -2)
          return 'Nie odpowiadasz. Po trzech dniach telewizja zaprasza innego eksperta, który mówi to samo.'
        },
      },
    ],
  },
  {
    id: 'nt_talent',
    cooldown: 20,
    text: 'Siedemnastolatek z akademii robi furorę w Ekstraklasie. Wszyscy pytają, czy dostanie powołanie.',
    options: [
      {
        label: 'Powołuję',
        apply: ({ s, rng }) => {
          const side = s.national?.side ?? 'A'
          const p = callUp(rng, s, side, rng.pick(['POM', 'NAP'] as Position[]), true)
          p.age = 17
          p.potential = clamp(p.skill + rng.int(10, 18), p.skill, 95)
          p.traits = ['talent']
          s.squad.push(p)
          trust(s, 0, -1, 5)
          return `${playerName(p)} w kadrze! Szkoła daje mu zwolnienie z kartkówki z chemii.`
        },
      },
      {
        label: 'Niech się jeszcze ogra',
        apply: ({ s }) => {
          trust(s, 0, 1, -3)
          return 'Chłopak zostaje w klubie. Internet nazywa Cię „dziadersem”, ale klub dziękuje.'
        },
      },
    ],
  },
  {
    id: 'nt_bol',
    player: (p) => p.skill >= 82 && isAvailable(p),
    text: '{p} przyjechał na zgrupowanie z bólem pleców. Lekarz kadry mówi „pięćdziesiąt na pięćdziesiąt”.',
    options: [
      {
        label: 'Odsyłam go do domu',
        apply: ({ s, p }) => {
          p!.injuredFor = Math.max(p!.injuredFor, 2)
          trust(s, 0, 1, 0)
          return '{ps} wraca do klubu. W szatni szacunek za rozsądek.'
        },
      },
      {
        label: 'Zostaje, zobaczymy na treningu',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            p!.injuredFor = 3
            coach(s, 4)
            return 'Na treningu coś strzeliło. {ps} pauzuje dłużej.'
          }
          setMorale(p!, 5)
          return 'Po masażu i dwóch tabletkach {ps} biega jak nowy.'
        },
      },
    ],
  },
]
