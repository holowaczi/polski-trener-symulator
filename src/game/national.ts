import { EURO_CLUBS } from './euroClubs'
import type { GameEvent } from './events'
import { playClubMatch, simulateScore } from './match'
import type { Rng } from './rng'
import type { CupTie, Fixture, GameState, JobOffer, MatchReport, NatGroup, NationalJob, NationalSide, Player, Position, Team } from './types'
import { addModifier, adjustCoach, adjustTrust, computeTable, isAvailable, news, setMorale, teamPower } from './util'
import { clamp, generatePlayer, makeFixtures, playerName } from './world'

/**
 * Reprezentacja: pełny etat zamiast klubu. Sezon to eliminacje w przerwach na kadrę (grupa pięciu drużyn, mecz i rewanż),
 * a dwie najlepsze drużyny jadą latem na turniej: grupa czterech drużyn, potem ćwierćfinał, półfinał i finał.
 * Turnieje idą na zmianę: mistrzostwa Europy i świata, a młodzieżówka co roku gra o mistrzostwo Europy U21.
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

/** kolejki eliminacji: przerwy na kadrę jesienią i wiosną (grupa pięciu drużyn to dziesięć kolejek, w dwóch Polska pauzuje) */
export const QUAL_WEEKS = [2, 3, 7, 8, 12, 13, 22, 23, 27, 28]
/** turniej po sezonie ligowym: trzy kolejki grupy, potem mecze o wszystko */
export const TOURN_GROUP_WEEKS = [37, 38, 39]
export const KO_WEEKS = { QF: 40, SF: 41, F: 42 } as const
/** sezon selekcjonera trwa dłużej niż ligowy, bo turniej jest latem */
export const NATIONAL_SEASON_WEEKS = 43

export const STAGE_LABEL = { QF: 'Ćwierćfinał', SF: 'Półfinał', F: 'Finał' } as const
/** jak daleko zaszła drużyna: do historii, karty trenera i punktów */
export const REACHED_LABEL = ['bez awansu na turniej', 'faza grupowa', 'ćwierćfinał', 'półfinał', 'finał', 'złoto']

/** rok turnieju: sezon 1 to 2026/27, więc turniej po nim jest latem 2027 */
export function eventFor(side: NationalSide, season: number): string {
  const year = 2026 + season
  if (side === 'U21') return `Mistrzostwa Europy U21 ${year}`
  return year % 2 === 0 ? `Mistrzostwa Europy ${year}` : `Mistrzostwa Świata ${year}`
}

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

const POOL: [Position, number][] = [
  ['BR', 3],
  ['OBR', 8],
  ['POM', 9],
  ['NAP', 6],
]

/** klub powołanego: reprezentanci grają głównie za granicą, młodzieżowcy w Ekstraklasie i I lidze */
function clubFor(rng: Rng, s: GameState, p: Player, side: NationalSide): string {
  if (side === 'U21' || rng.chance(0.25)) {
    const home = Object.values(s.teams).filter((t) => !t.nt && !t.country && (t.level === 9 || (side === 'U21' && t.level === 8)) && !t.reserve)
    if (home.length && (side === 'U21' ? rng.chance(0.7) : true)) return rng.pick(home).name
  }
  const fits = EURO_CLUBS.filter((c) => c.strength >= p.skill + 2 && c.strength <= p.skill + 12)
  const c = fits.length ? rng.pick(fits) : rng.pick(EURO_CLUBS)
  return `${c.name}`
}

function callUp(rng: Rng, s: GameState, side: NationalSide, pos: Position, young = false): Player {
  const age = side === 'U21' ? (young ? 18 : rng.int(18, 21)) : young ? rng.int(20, 23) : rng.int(22, 33)
  const p = generatePlayer(rng, s, 9, pos, { age, skillOffset: side === 'A' ? 13 : 2 })
  p.club = clubFor(rng, s, p, side)
  // reprezentant ma umowę z klubem, a nie z federacją: w kadrze nie ma pensji ani negocjacji
  p.wage = 0
  p.contract = 3
  p.morale = 70
  return p
}

/** pierwsza kadra selekcjonera: 26 powołanych */
export function nationalPool(rng: Rng, s: GameState, side: NationalSide): Player[] {
  const pool: Player[] = []
  for (const [pos, count] of POOL) for (let i = 0; i < count; i++) pool.push(callUp(rng, s, side, pos))
  return pool
}

/**
 * Po sezonie kadra się zmienia: starsi kończą karierę reprezentacyjną, młodzieżowcy wyrastają z U21,
 * a w miejsce słabszych przychodzą nowi. Zostaje tylu, żeby na każdej pozycji było z kogo wybierać.
 */
export function refreshPool(rng: Rng, s: GameState, side: NationalSide): string[] {
  const notes: string[] = []
  const leaving = s.squad.filter((p) => (side === 'U21' ? p.age > 21 : p.age >= 35 || (p.age >= 32 && rng.chance(0.3))))
  for (const p of leaving.slice(0, 6))
    notes.push(side === 'U21' ? `${playerName(p)} wyrasta z młodzieżówki. Powodzenia w dorosłej kadrze.` : `${playerName(p)} kończy karierę reprezentacyjną. Na pożegnanie dostaje koszulkę z numerem ${p.age}.`)
  s.squad = s.squad.filter((p) => !leaving.includes(p))
  for (const p of s.squad) {
    p.goals = 0
    p.assists = 0
    p.apps = 0
    p.ratingSum = 0
    p.yellows = 0
    p.suspendedFor = 0
    p.injuredFor = 0
  }
  // nowi: w miejsce odchodzących, a do tego jeden czy dwóch najlepszych z ligi wypycha najsłabszych
  const fresh: Player[] = []
  for (const [pos, count] of POOL) {
    const have = s.squad.filter((p) => p.pos === pos).length
    for (let i = have; i < count; i++) fresh.push(callUp(rng, s, side, pos, rng.chance(0.4)))
  }
  for (let i = 0; i < 2; i++) {
    const pos = rng.pick(['OBR', 'POM', 'NAP'] as Position[])
    const weakest = s.squad.filter((p) => p.pos === pos).sort((a, b) => a.skill - b.skill)[0]
    const cand = callUp(rng, s, side, pos, true)
    if (weakest && cand.skill > weakest.skill) {
      s.squad = s.squad.filter((p) => p !== weakest)
      fresh.push(cand)
      notes.push(`${playerName(weakest)} wypada z kadry. Dzwoni do Ciebie jego mama, ale decyzja zapadła.`)
    }
  }
  for (const p of fresh) notes.push(`Pierwsze powołanie: ${playerName(p)} (${p.age} l., ${p.pos}, ${p.club}).`)
  s.squad.push(...fresh)
  s.lineup.xi = s.lineup.xi.filter((id) => s.squad.some((p) => p.id === id))
  s.lineup.bench = s.lineup.bench.filter((id) => s.squad.some((p) => p.id === id))
  return notes
}

// ---------- losowanie ----------

function nationsFor(world: boolean): Nation[] {
  return NATIONS.filter((x) => x.name !== 'Polska' && (world || x.europe))
}

/** eliminacje: Polska i po jednej drużynie z czterech koszyków */
function drawQualifiers(rng: Rng, s: GameState, side: NationalSide, me: number, event: string): NatGroup {
  const eu = [...nationsFor(false)].sort((a, b) => b.strength - a.strength)
  const pots = [eu.slice(0, 10), eu.slice(10, 22), eu.slice(22, 36), eu.slice(36)]
  const ids = [me, ...pots.map((pot) => rivalTeam(rng, s, rng.pick(pot), side))]
  const letter = 'ABCDEFGHIJ'[rng.int(0, 9)]
  return { name: `Eliminacje ${eventShort(event)} · grupa ${letter}`, teamIds: ids, rounds: makeFixtures(rng, ids), weeks: QUAL_WEEKS }
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
  return { name: `${job.event} · grupa ${'ABCDEF'[rng.int(0, 5)]}`, teamIds: ids, rounds, weeks: TOURN_GROUP_WEEKS }
}

/** rywal w fazie pucharowej: im dalej, tym mocniejszy */
function koOpponent(rng: Rng, s: GameState, job: NationalJob, stage: 'QF' | 'SF' | 'F'): number {
  const field = [...nationsFor(isWorldCup(job.event))].sort((a, b) => b.strength - a.strength)
  const met = new Set([...(job.tourn?.group.teamIds ?? []), ...(job.tourn?.ko ?? []).flatMap((k) => [k.tie.home, k.tie.away])].map((id) => s.teams[id]?.country))
  const range = stage === 'QF' ? field.slice(2, 16) : stage === 'SF' ? field.slice(0, 10) : field.slice(0, 6)
  const free = range.filter((x) => !met.has(x.name))
  return rivalTeam(rng, s, rng.pick(free.length ? free : range), job.side)
}

/** nowy sezon selekcjonera: losowanie eliminacji */
export function newNationalSeason(rng: Rng, s: GameState, side: NationalSide, teamId: number, since: number): NationalJob {
  const event = eventFor(side, s.season)
  const job: NationalJob = { side, teamId, since, season: s.season, event, qual: undefined as unknown as NatGroup, reached: 0 }
  job.qual = drawQualifiers(rng, s, side, teamId, event)
  const rivals = job.qual.teamIds.filter((id) => id !== teamId).map((id) => s.teams[id].name)
  news(s, `Losowanie eliminacji ${eventShort(event)}: ${rivals.join(', ')}. Na turniej jadą dwie najlepsze drużyny z grupy.`)
  return job
}

// ---------- mecze ----------

export function nationalFixtureForWeek(s: GameState, week: number): { f: Fixture | CupTie; label: string; ko?: 'QF' | 'SF' | 'F' } | undefined {
  const job = s.national
  if (!job || job.season !== s.season) return undefined
  const me = job.teamId
  for (const g of [job.qual, job.tourn?.group]) {
    if (!g) continue
    const idx = g.weeks.indexOf(week)
    const f = idx >= 0 ? g.rounds[idx]?.find((x) => x.home === me || x.away === me) : undefined
    if (f) return { f, label: g === job.qual ? `Eliminacje ${eventShort(job.event)} · ${idx + 1}. kolejka` : `${eventShort(job.event)} · grupa, ${idx + 1}. mecz` }
  }
  const ko = job.tourn?.ko.find((k) => k.week === week)
  if (ko) return { f: ko.tie, label: `${eventShort(job.event)} · ${STAGE_LABEL[ko.stage].toLowerCase()}`, ko: ko.stage }
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
  for (const g of [job.qual, job.tourn?.group]) {
    if (!g) continue
    const idx = g.weeks.indexOf(week)
    if (idx < 0 || !g.rounds[idx]) continue
    for (const f of g.rounds[idx]) {
      if (f.hg !== undefined) continue
      if (f.home === me || f.away === me) {
        const rep = playClubMatch(rng, s, f, false)
        rep.national = true
        rep.cupName = g === job.qual ? `Eliminacje ${eventShort(job.event)} · ${idx + 1}. kolejka` : `${eventShort(job.event)} · grupa, ${idx + 1}. mecz`
        f.hg = rep.hg
        f.ag = rep.ag
        push(rep)
      } else aiMatch(rng, s, f)
    }
    if (idx === g.rounds.length - 1) {
      if (g === job.qual) finishQualifiers(rng, s, job)
      else finishTournamentGroup(rng, s, job)
    }
  }
  const ko = job.tourn?.ko.find((k) => k.week === week && k.tie.winner === undefined)
  if (ko) {
    const rep = playClubMatch(rng, s, ko.tie, true)
    rep.national = true
    rep.cupName = `${eventShort(job.event)} · ${STAGE_LABEL[ko.stage].toLowerCase()}`
    ko.tie.hg = rep.hg
    ko.tie.ag = rep.ag
    if (rep.hg !== rep.ag) ko.tie.winner = rep.hg > rep.ag ? ko.tie.home : ko.tie.away
    else {
      pens(rng, ko.tie)
      rep.pens = ko.tie.pens
    }
    const won = ko.tie.winner === me
    if (ko.stage === 'F' && won) rep.trophy = job.event
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
  if (pos <= 2) {
    job.reached = 1
    job.tourn = { group: drawTournament(rng, s, job), ko: [] }
    const rivals = job.tourn.group.teamIds.filter((id) => id !== job.teamId).map((id) => s.teams[id].name)
    adjustTrust(s, { board: 12, fans: 12, squad: 4 })
    adjustCoach(s, { reputation: 4, stress: -15 })
    news(s, `JEDZIEMY NA ${eventShort(job.event).toUpperCase()}! ${pos}. miejsce w grupie. Losowanie turnieju: ${rivals.join(', ')}.`)
  } else {
    adjustTrust(s, { board: -25, fans: -20 })
    adjustCoach(s, { reputation: -5, stress: 15 })
    news(s, `Eliminacje przegrane: ${pos}. miejsce w grupie. Latem turniej w telewizji, a Ty na cenzurowanym.`)
  }
}

function finishTournamentGroup(rng: Rng, s: GameState, job: NationalJob): void {
  const t = job.tourn!
  const table = computeTable(t.group)
  const pos = table.findIndex((r) => r.teamId === job.teamId) + 1
  if (pos <= 2) {
    job.reached = 2
    const opp = koOpponent(rng, s, job, 'QF')
    t.ko.push({ stage: 'QF', week: KO_WEEKS.QF, tie: rng.chance(0.5) ? { home: job.teamId, away: opp } : { home: opp, away: job.teamId } })
    adjustTrust(s, { board: 6, fans: 8 })
    adjustCoach(s, { reputation: 3 })
    news(s, `Wyjście z grupy! W ćwierćfinale ${s.teams[opp].name}. W kraju ruszają zakupy flag i grilli.`)
  } else {
    t.out = true
    adjustTrust(s, { board: -8, fans: -10 })
    adjustCoach(s, { stress: 8 })
    news(s, `Koniec turnieju po fazie grupowej (${pos}. miejsce). Samolot do kraju odlatuje szybciej, niż planowano.`)
  }
}

function afterKo(rng: Rng, s: GameState, job: NationalJob, stage: 'QF' | 'SF' | 'F', won: boolean): void {
  const t = job.tourn!
  if (!won) {
    t.out = true
    adjustTrust(s, { fans: stage === 'QF' ? 4 : 8, board: stage === 'QF' ? 2 : 6 })
    news(s, stage === 'F' ? `Srebro! Przegrany finał ${eventShort(job.event)}, ale na lotnisku czeka tłum.` : `Odpadamy w ${stage === 'QF' ? 'ćwierćfinale' : 'półfinale'}. Kraj płacze, ale z dumą.`)
    return
  }
  job.reached = stage === 'QF' ? 3 : stage === 'SF' ? 4 : 5
  if (stage === 'F') {
    s.trophies.push(`Złoto: ${job.event} (sezon ${s.season})`)
    adjustTrust(s, { fans: 30, board: 30, squad: 15 })
    adjustCoach(s, { reputation: job.side === 'A' ? 20 : 10, stress: -30 })
    news(s, `ZŁOTO! ${job.event} dla Polski! Prezydent dzwoni z gratulacjami, a premier już szuka miejsca na wspólne zdjęcie.`)
    return
  }
  const next = stage === 'QF' ? 'SF' : 'F'
  const opp = koOpponent(rng, s, job, next)
  t.ko.push({ stage: next, week: KO_WEEKS[next], tie: rng.chance(0.5) ? { home: job.teamId, away: opp } : { home: opp, away: job.teamId } })
  adjustTrust(s, { fans: 8, board: 6 })
  adjustCoach(s, { reputation: 3 })
  news(s, `${stage === 'QF' ? 'Półfinał' : 'FINAŁ'}! Rywal: ${s.teams[opp].name}. Na ulicach trąbią samochody.`)
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
    if ((job.reached >= 3 && rng.chance(0.6)) || (rep >= 88 && rng.chance(0.35))) side = 'A'
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

/** wpis do historii kariery za sezon selekcjonera */
export function nationalRecord(s: GameState, outcome?: string, fired = false) {
  const job = s.national!
  const pos = computeTable(job.qual).findIndex((r) => r.teamId === job.teamId) + 1
  return {
    season: s.season,
    clubName: SIDE_NAME[job.side],
    level: 9,
    leagueName: job.event,
    position: pos || undefined,
    outcome: outcome ?? (job.reached === 0 ? `${pos}. miejsce w eliminacjach, bez awansu` : `awans na turniej, ${REACHED_LABEL[job.reached]}`),
    cup: '',
    fired,
    national: { side: job.side, reached: job.reached },
  }
}

/** podsumowanie sezonu selekcjonera; zwraca, czy PZPN dziękuje za współpracę */
export function nationalSeasonEnd(s: GameState, summary: string[]): boolean {
  const job = s.national!
  const rec = nationalRecord(s)
  summary.push(`${SIDE_NAME[job.side]}: ${job.event}, ${rec.outcome}.`)
  // oczekiwania: awans na turniej to minimum, każda runda dalej to premia
  const repGain = [-6, 2, 6, 10, 14, 20][job.reached] * (job.side === 'A' ? 1 : 0.6)
  adjustCoach(s, { reputation: Math.round(repGain), stress: job.reached >= 2 ? -15 : job.reached === 0 ? 10 : 0 })
  adjustTrust(s, { board: job.reached === 0 ? -10 : job.reached >= 3 ? 10 : 0 })
  const fired = (job.reached === 0 && s.trust.board < 55) || s.trust.board < 25
  s.history.push({ ...rec, fired })
  const top = [...s.squad].sort((a, b) => b.goals - a.goals)[0]
  if (top && top.goals > 0) summary.push(`Najlepszy strzelec kadry: ${playerName(top)} (${top.goals} goli).`)
  for (const p of s.squad) if (!s.bestPlayer || p.skill > s.bestPlayer.skill) s.bestPlayer = { name: playerName(p), skill: p.skill }
  if (fired) summary.push('PZPN dziękuje za współpracę. Na pożegnanie dostajesz dres z orzełkiem i list od prezesa, podpisany przez sekretarkę.')
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
