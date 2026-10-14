import { FORMATIONS, LEVELS, LICENSES, LICENSE_COURSES, COACH_QUOTES, FIRST_NAMES, LAST_NAMES } from './data'
import { EVENTS } from './events'
import { commentary } from './commentary'
import { Rng } from './rng'
import type {
  CupTie,
  Fixture,
  GameState,
  GoalType,
  JobOffer,
  League,
  MatchReport,
  Player,
  Position,
  TableRow,
  Tactic,
  Team,
} from './types'
import {
  clamp,
  cupRoundName,
  drawCup,
  generatePlayer,
  generateSquad,
  generateWorld,
  leagueOf,
  makeFixtures,
  pairUp,
  playerName,
  playerValue,
  shortName,
} from './world'

export const SAVE_VERSION = 1
/** każdy sezon ma tyle tygodni; krótsze ligi kończą wcześniej */
export const SEASON_WEEKS = 30
export const MAX_SQUAD = 26

// ---------- pomocnicze ----------

/** Uruchamia funkcję z generatorem, którego stan zapisywany jest z powrotem w grze. */
export function withRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(s.rng)
  const out = fn(rng)
  s.rng = rng.state
  return out
}

export function news(s: GameState, text: string): void {
  s.news.unshift(`S${s.season} T${s.round}: ${text}`)
  if (s.news.length > 60) s.news.length = 60
}

export function adjustTrust(s: GameState, d: { board?: number; squad?: number; fans?: number }): void {
  s.trust.board = clamp(Math.round(s.trust.board + (d.board ?? 0)), 0, 100)
  s.trust.squad = clamp(Math.round(s.trust.squad + (d.squad ?? 0)), 0, 100)
  s.trust.fans = clamp(Math.round(s.trust.fans + (d.fans ?? 0)), 0, 100)
}

export function club(s: GameState): Team | undefined {
  return s.clubId === null ? undefined : s.teams[s.clubId]
}

export function clubLeague(s: GameState): League | undefined {
  return s.clubId === null ? undefined : leagueOf(s, s.clubId)
}

export function formatMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',')} mln zł`
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)} tys. zł`
  return `${v} zł`
}

export function goalLabel(goal: GoalType, level: number): string {
  if (goal === 'awans') return level === 7 ? 'Mistrzostwo Polski' : 'Awans'
  if (goal === 'czołówka') return 'Czołowa czwórka'
  if (goal === 'środek') return 'Górna połowa tabeli'
  return 'Utrzymanie'
}

export function goalMet(goal: GoalType, pos: number, size: number): boolean {
  if (goal === 'awans') return pos <= 2
  if (goal === 'czołówka') return pos <= 4
  if (goal === 'środek') return pos <= Math.ceil(size / 2)
  return pos <= size - 2
}

const REP_NEEDED = [0, 6, 14, 24, 34, 46, 58, 70]

function licenseIndex(l: GameState['coach']['license']): number {
  return LICENSES.indexOf(l)
}

export function licenseAllows(s: GameState, level: number): boolean {
  return licenseIndex(s.coach.license) >= licenseIndex(LEVELS[level].license)
}

// ---------- nowa gra ----------

export interface NewGameInput {
  firstName: string
  lastName: string
  age: number
  region: string
  seed: number
}

export function newGame(input: NewGameInput): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    seed: input.seed,
    rng: input.seed,
    nextId: 1,
    coach: {
      firstName: input.firstName,
      lastName: input.lastName,
      age: input.age,
      region: input.region,
      license: 'UEFA C',
      reputation: 2,
      savings: 5_000,
      courseLeft: 0,
    },
    teams: {},
    leagues: [],
    cup: { rounds: [], schedule: [] },
    clubId: null,
    squad: [],
    tactic: { formation: '4-4-2', mentality: 'balans', style: 'laga' },
    trust: { board: 60, squad: 60, fans: 50 },
    goal: 'środek',
    budget: 0,
    salary: 0,
    season: 1,
    round: 0,
    phase: 'hiring',
    transferList: [],
    reports: [],
    news: [],
    history: [],
    trophies: [],
    scandals: [],
    offers: [],
    seasonsUnemployed: 0,
    totalStats: { w: 0, d: 0, l: 0, firedCount: 0 },
    usedEvents: [],
    winterWindowDone: false,
  }
  withRng(s, (rng) => {
    generateWorld(rng, s)
    for (const lg of s.leagues) lg.rounds = makeFixtures(rng, lg.teamIds)
  })
  s.cup = withRng(s, (rng) => drawCup(rng, s))
  // start: trzy kluby z B-klasy chcą byłego grajka z licencją UEFA C
  const bklasa = s.leagues[0]
  const picks = withRng(s, (rng) => rng.shuffle([...bklasa.teamIds]).slice(0, 3))
  s.offers = picks.map((id) => makeOffer(s, id, 'Szukają trenera od zaraz. Poprzedni wyjechał do Holandii na szparagi.'))
  s.hiringNote = `Masz ${input.age} lat, licencję UEFA C i kontakty w ${input.region}. Trzy kluby z B-klasy dzwonią.`
  return s
}

function makeOffer(s: GameState, teamId: number, note: string): JobOffer {
  const t = s.teams[teamId]
  const lv = LEVELS[t.level]
  const lg = leagueOf(s, teamId)!
  const rank = rankByStrength(s, lg, teamId)
  return {
    teamId,
    teamName: t.name,
    level: t.level,
    leagueName: lv.name,
    goal: goalFromRank(rank, lg.teamIds.length),
    salary: Math.round(lv.salary * (0.85 + ((teamId * 7) % 10) / 30)),
    note,
  }
}

function goalFromRank(rank: number, size: number): GoalType {
  if (rank <= 2) return 'awans'
  if (rank <= 4) return 'czołówka'
  if (rank <= Math.ceil(size / 2)) return 'środek'
  return 'utrzymanie'
}

function rankByStrength(s: GameState, lg: League, teamId: number): number {
  const sorted = [...lg.teamIds].sort((a, b) => baseStrength(s, b) - baseStrength(s, a))
  return sorted.indexOf(teamId) + 1
}

// ---------- praca ----------

export function takeJob(s: GameState, offer: JobOffer): void {
  const team = s.teams[offer.teamId]
  s.clubId = team.id
  s.salary = offer.salary
  s.goal = offer.goal
  s.trust = { board: 60, squad: 55, fans: 50 }
  s.seasonsUnemployed = 0
  const offset = team.strength - LEVELS[team.level].base
  s.squad = withRng(s, (rng) => {
    const sq = generateSquad(rng, s, team.level, offset - 1)
    // syn prezesa to tradycja klubowa
    if (team.level <= 4 && rng.chance(0.7)) {
      const p = rng.pick(sq.filter((x) => x.pos !== 'BR'))
      p.traits = ['syn_prezesa']
      p.skill = Math.max(8, p.skill - rng.int(4, 9))
      p.value = playerValue(p)
    }
    return sq
  })
  s.budget = Math.round(LEVELS[team.level].budget * (0.7 + ((team.id * 13) % 10) / 15))
  s.offers = []
  s.hiringNote = undefined
  s.tactic = { formation: '4-4-2', mentality: 'balans', style: team.level <= 2 ? 'laga' : 'kontra' }
  refreshTransferList(s)
  news(s, `${s.coach.firstName} ${s.coach.lastName} nowym trenerem ${team.name}! Cel: ${goalLabel(s.goal, team.level).toLowerCase()}.`)
  // w trakcie sezonu od razu do gry, przed sezonem jeszcze okno transferowe
  s.phase = s.round === 0 ? 'transfer' : 'season'
}

// ---------- siła drużyny ----------

function baseStrength(s: GameState, teamId: number): number {
  if (teamId === s.clubId && s.squad.length) return squadRating(s).rating
  return s.teams[teamId].strength
}

export function effectiveSkill(p: Player): number {
  return p.skill + p.form * 1.5 + (p.morale - 60) / 20
}

export interface Lineup {
  xi: Player[]
  missing: number
}

export function pickLineup(squad: Player[], formation: Tactic['formation']): Lineup {
  const need = FORMATIONS[formation]
  const avail = squad.filter((p) => p.injuredFor === 0)
  const used = new Set<number>()
  const xi: Player[] = []
  let missing = 0
  for (const pos of ['BR', 'OBR', 'POM', 'NAP'] as Position[]) {
    const cands = avail
      .filter((p) => p.pos === pos && !used.has(p.id))
      .sort((a, b) => effectiveSkill(b) - effectiveSkill(a))
    for (let i = 0; i < need[pos]; i++) {
      const p = cands[i]
      if (p) {
        xi.push(p)
        used.add(p.id)
      } else {
        missing++
      }
    }
  }
  // dziury łatane zawodnikami z innych pozycji
  const rest = avail.filter((p) => !used.has(p.id)).sort((a, b) => effectiveSkill(b) - effectiveSkill(a))
  while (missing > 0 && rest.length) {
    const p = rest.shift()!
    xi.push(p)
    used.add(p.id)
    missing--
  }
  return { xi, missing }
}

export function styleFit(s: GameState, xi: Player[], level: number): { value: number; note: string } {
  const avg = xi.reduce((a, p) => a + p.skill, 0) / Math.max(1, xi.length)
  const age = xi.reduce((a, p) => a + p.age, 0) / Math.max(1, xi.length)
  const mids = xi.filter((p) => p.pos === 'POM')
  const midAvg = mids.reduce((a, p) => a + p.skill, 0) / Math.max(1, mids.length)
  switch (s.tactic.style) {
    case 'laga':
      if (level <= 2) return { value: 2, note: 'Laga na tym poziomie to sztuka wojenna.' }
      if (level <= 4) return { value: 1, note: 'Laga jeszcze działa, ale obrońcy zaczynają rozumieć.' }
      return { value: -2, note: 'Na tym poziomie laga to podanie do rywala.' }
    case 'pressing':
      if (age < 25) return { value: 2, note: 'Młoda kadra biega jak nakręcona.' }
      if (age < 27.5) return { value: 1, note: 'Pressing jest, ale do 60. minuty.' }
      return { value: -3, note: 'Weterani pressują głównie sędziego.' }
    case 'posiadanie':
      if (level <= 1) return { value: -2, note: 'Na tej murawie piłka sama zmienia kierunek.' }
      if (midAvg - avg >= 2) return { value: 2, note: 'Pomocnicy klepią jak w Barcelonie.' }
      if (midAvg - avg >= -1) return { value: 1, note: 'Posiadanie jest, strzałów mniej.' }
      return { value: -2, note: 'Pomocnicy nie nadążają za własnym pomysłem.' }
    case 'kontra':
      return { value: 0, note: 'Działa najlepiej przeciw silniejszym rywalom.' }
  }
}

export function squadRating(s: GameState): { rating: number; xi: Player[]; fit: { value: number; note: string } } {
  const { xi, missing } = pickLineup(s.squad, s.tactic.formation)
  const level = club(s)?.level ?? 0
  if (!xi.length) return { rating: 10, xi, fit: { value: 0, note: '' } }
  let sum = 0
  for (const p of xi) {
    let v = effectiveSkill(p)
    if (p.traits.includes('weteran')) v += 1
    sum += v
  }
  let rating = sum / 11 - missing * 2
  const leaders = xi.filter((p) => p.traits.includes('lider')).length
  rating += Math.min(1, leaders)
  rating += (s.trust.squad - 50) / 40
  rating += s.coach.reputation / 100
  const fit = styleFit(s, xi, level)
  rating += fit.value
  return { rating: Math.round(rating * 10) / 10, xi, fit }
}

// ---------- mecz ----------

const MENTALITY = {
  obrona: { att: 0.8, def: 0.75 },
  balans: { att: 1, def: 1 },
  atak: { att: 1.18, def: 1.18 },
}

interface MatchResult {
  hg: number
  ag: number
}

function simulateScore(rng: Rng, hs: number, as: number, level: number, hMent = MENTALITY.balans, aMent = MENTALITY.balans): MatchResult {
  const diff = hs + 2.5 - as
  const goalsy = 1 + (7 - level) * 0.045
  const lh = clamp(1.3 * Math.exp(diff / 16) * hMent.att * aMent.def * goalsy, 0.15, 6)
  const la = clamp(1.05 * Math.exp(-diff / 16) * aMent.att * hMent.def * goalsy, 0.15, 6)
  return { hg: rng.poisson(lh), ag: rng.poisson(la) }
}

function aiStrength(rng: Rng, s: GameState, teamId: number): number {
  return s.teams[teamId].strength + rng.normal(0, 2.5)
}

function pickScorer(rng: Rng, xi: Player[]): Player {
  const weights = xi.map((p) => {
    let w = p.pos === 'NAP' ? 5 : p.pos === 'POM' ? 2 : p.pos === 'OBR' ? 0.6 : 0.02
    if (p.traits.includes('krol_strzalow')) w *= 1.8
    return w * Math.max(1, p.skill)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < xi.length; i++) {
    r -= weights[i]
    if (r <= 0) return xi[i]
  }
  return xi[xi.length - 1]
}

function randomSurname(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)[0]}. ${rng.pick(LAST_NAMES)}`
}

/** mecz z udziałem drużyny gracza; aktualizuje kadrę, zaufanie i zwraca raport */
function playClubMatch(rng: Rng, s: GameState, f: { home: number; away: number }, cup: boolean): MatchReport {
  const me = s.clubId!
  const isHome = f.home === me
  const opp = isHome ? f.away : f.home
  const level = s.teams[me].level
  const { rating, xi } = squadRating(s)
  const oppStr = aiStrength(rng, s, opp)
  let myStr = rating + rng.normal(0, 2)
  if (s.tactic.style === 'kontra') myStr += oppStr > rating + 2 ? 3 : -1
  // magia pucharu: niżej notowany ma zawsze trochę więcej serca
  if (cup) {
    const lvlDiff = s.teams[opp].level - level
    if (lvlDiff > 0) myStr += Math.min(4, lvlDiff * 1.5)
  }
  const myMent = MENTALITY[s.tactic.mentality]
  const res = isHome
    ? simulateScore(rng, myStr, oppStr, level, myMent)
    : simulateScore(rng, oppStr, myStr, level, MENTALITY.balans, myMent)
  const myGoals = isHome ? res.hg : res.ag
  const oppGoals = isHome ? res.ag : res.hg

  const scorers: string[] = []
  const goalEvents: { minute: number; mine: boolean; name: string }[] = []
  for (let i = 0; i < myGoals; i++) {
    const p = pickScorer(rng, xi)
    p.goals++
    goalEvents.push({ minute: rng.int(1, 94), mine: true, name: shortName(p) })
  }
  for (let i = 0; i < oppGoals; i++) {
    goalEvents.push({ minute: rng.int(1, 94), mine: false, name: randomSurname(rng) })
  }
  goalEvents.sort((a, b) => a.minute - b.minute)
  for (const g of goalEvents) scorers.push(`${g.minute}' ${g.name}${g.mine ? '' : ` (${s.teams[opp].name})`}`)

  const lines = commentary(rng, {
    level,
    myGoals,
    oppGoals,
    myTeam: s.teams[me].name,
    oppTeam: s.teams[opp].name,
    xiNames: xi.map(shortName),
    goals: goalEvents,
  })

  // skutki meczu
  const pts = myGoals > oppGoals ? 3 : myGoals === oppGoals ? 1 : 0
  if (!cup) {
    if (pts === 3) s.totalStats.w++
    else if (pts === 1) s.totalStats.d++
    else s.totalStats.l++
  }
  const expected = 1 / (1 + Math.exp(-(rating - oppStr + (isHome ? 2.5 : -2.5)) / 6))
  const actual = pts === 3 ? 1 : pts === 1 ? 0.45 : 0
  const surprise = actual - expected
  adjustTrust(s, {
    board: surprise * 6,
    fans: surprise * 7 + (isHome && pts === 3 ? 1 : 0) + (myGoals >= 4 ? 2 : 0),
    squad: pts === 3 ? 1 : pts === 0 ? -1 : 0,
  })
  const xiIds = new Set(xi.map((p) => p.id))
  for (const p of s.squad) {
    if (p.injuredFor > 0) {
      p.injuredFor--
      continue
    }
    if (xiIds.has(p.id)) {
      p.apps++
      p.morale = clamp(p.morale + (pts === 3 ? 4 : pts === 1 ? 1 : -3), 0, 100)
      const injuryChance = p.traits.includes('szklany') ? 0.07 : 0.018
      if (rng.chance(injuryChance)) {
        p.injuredFor = rng.int(1, 6)
        news(s, `${shortName(p)} kontuzjowany. Przerwa: ${p.injuredFor} tyg.`)
      }
    } else {
      p.morale = clamp(p.morale - (p.skill > rating ? 3 : 1), 0, 100)
      if (p.traits.includes('syn_prezesa')) adjustTrust(s, { board: -1.5 })
    }
    const swing = p.traits.includes('imprezowicz') ? 1.6 : p.traits.includes('leniwy') ? 1.1 : 0.8
    p.form = clamp(Math.round(p.form * 0.5 + rng.normal(0, swing)), -3, 3)
  }
  return {
    round: s.round,
    cup,
    home: f.home,
    away: f.away,
    hg: isHome ? myGoals : oppGoals,
    ag: isHome ? oppGoals : myGoals,
    lines,
    scorers,
  }
}

function playAiFixture(rng: Rng, s: GameState, f: Fixture | CupTie, cup = false): void {
  const level = Math.min(s.teams[f.home].level, s.teams[f.away].level)
  let hs = aiStrength(rng, s, f.home)
  let as = aiStrength(rng, s, f.away)
  if (cup) {
    // puchar: lekki bonus dla niższej ligi
    const d = s.teams[f.away].level - s.teams[f.home].level
    if (d > 0) hs += Math.min(3, d)
    if (d < 0) as += Math.min(3, -d)
  }
  const r = simulateScore(rng, hs, as, level)
  f.hg = r.hg
  f.ag = r.ag
}

// ---------- tabela ----------

export function computeTable(lg: League): TableRow[] {
  const rows = new Map<number, TableRow>()
  for (const id of lg.teamIds) rows.set(id, { teamId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })
  for (const round of lg.rounds) {
    for (const f of round) {
      if (f.hg === undefined || f.ag === undefined) continue
      const h = rows.get(f.home)!
      const a = rows.get(f.away)!
      h.p++
      a.p++
      h.gf += f.hg
      h.ga += f.ag
      a.gf += f.ag
      a.ga += f.hg
      if (f.hg > f.ag) {
        h.w++
        h.pts += 3
        a.l++
      } else if (f.hg < f.ag) {
        a.w++
        a.pts += 3
        h.l++
      } else {
        h.d++
        a.d++
        h.pts++
        a.pts++
      }
    }
  }
  return [...rows.values()].sort(
    (x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.teamId - y.teamId,
  )
}

export function clubPosition(s: GameState): number | undefined {
  const lg = clubLeague(s)
  if (!lg) return undefined
  return computeTable(lg).findIndex((r) => r.teamId === s.clubId) + 1
}

// ---------- kolejka ----------

function hasClubMatch(s: GameState, week: number): boolean {
  if (s.clubId === null) return false
  const lg = clubLeague(s)!
  if (week < lg.rounds.length) return true
  return cupTieForWeek(s, week) !== undefined
}

function cupTieForWeek(s: GameState, week: number): CupTie | undefined {
  const idx = s.cup.schedule.indexOf(week)
  if (idx < 0) return undefined
  return s.cup.rounds[idx]?.find((t) => t.home === s.clubId || t.away === s.clubId)
}

/** Rozgrywa jeden tydzień: ligi i ewentualnie runda pucharu. */
export function playWeek(s: GameState): void {
  if (s.phase !== 'season') return
  const week = s.round
  withRng(s, (rng) => {
    // ligi
    for (const lg of s.leagues) {
      const round = lg.rounds[week]
      if (!round) continue
      for (const f of round) {
        if (f.hg !== undefined) continue
        if (s.clubId !== null && (f.home === s.clubId || f.away === s.clubId)) {
          const rep = playClubMatch(rng, s, f, false)
          f.hg = rep.hg
          f.ag = rep.ag
          s.reports.unshift(rep)
        } else {
          playAiFixture(rng, s, f)
        }
      }
    }
    // puchar
    const cupIdx = s.cup.schedule.indexOf(week)
    if (cupIdx >= 0 && s.cup.rounds[cupIdx]) playCupRound(rng, s, cupIdx)
  })
  if (s.reports.length > 40) s.reports.length = 40
  s.round++
  afterWeek(s)
}

function playCupRound(rng: Rng, s: GameState, idx: number): void {
  const ties = s.cup.rounds[idx]
  const winners: number[] = []
  for (const t of ties) {
    if (t.winner !== undefined) {
      winners.push(t.winner)
      continue
    }
    if (s.clubId !== null && (t.home === s.clubId || t.away === s.clubId)) {
      const rep = playClubMatch(rng, s, t, true)
      t.hg = rep.hg
      t.ag = rep.ag
      s.reports.unshift(rep)
    } else {
      playAiFixture(rng, s, t, true)
    }
    if (t.hg! > t.ag!) t.winner = t.home
    else if (t.hg! < t.ag!) t.winner = t.away
    else {
      const homeWins = rng.chance(0.5)
      const a = rng.int(3, 5)
      const b = a - 1 - (rng.chance(0.3) ? 1 : 0)
      t.pens = homeWins ? `${a}:${Math.max(0, b)}` : `${Math.max(0, b)}:${a}`
      t.winner = homeWins ? t.home : t.away
    }
    winners.push(t.winner)
    if (s.clubId !== null && (t.home === s.clubId || t.away === s.clubId)) {
      if (t.winner === s.clubId) {
        news(s, `Puchar Polski: awans dalej! (${cupRoundName(idx)})`)
        adjustTrust(s, { fans: 4, board: 2 })
      } else {
        s.cup.eliminatedAt = idx
        news(s, `Puchar Polski: odpadamy w rundzie ${cupRoundName(idx)}.`)
      }
    }
  }
  if (winners.length === 1) {
    s.cup.winner = winners[0]
    if (winners[0] === s.clubId) {
      s.trophies.push(`Puchar Polski (sezon ${s.season})`)
      adjustTrust(s, { fans: 20, board: 15, squad: 10 })
      s.coach.reputation = clamp(s.coach.reputation + 10, 0, 100)
      news(s, 'PUCHAR POLSKI JEST NASZ! Kibice wnoszą trenera do autobusu.')
    } else {
      news(s, `Puchar Polski zdobywa ${s.teams[winners[0]].name}.`)
    }
  } else {
    s.cup.rounds[idx + 1] = pairUp(rng, s.teams, winners)
  }
}

function afterWeek(s: GameState): void {
  if (s.clubId === null) return
  // zwolnienie
  if (s.trust.board < 12) {
    fire(s, 'Prezes zadzwonił w niedzielę o 7 rano. Dziękujemy za współpracę.')
    return
  }
  if (s.trust.squad < 12) {
    withRng(s, (rng) => {
      for (const p of s.squad) p.form = clamp(p.form - rng.int(0, 2), -3, 3)
    })
    news(s, 'Bunt w szatni. Zawodnicy grają „na trenera”.')
    adjustTrust(s, { board: -4 })
  }
  if (s.trust.fans < 15) {
    adjustTrust(s, { board: -2 })
    news(s, 'Na trybunach transparent: „Trener do pieczarek!”.')
  }
  const lg = clubLeague(s)!
  // zimowe okno transferowe
  if (!s.winterWindowDone && s.round >= Math.ceil(lg.rounds.length / 2)) {
    s.winterWindowDone = true
    refreshTransferList(s)
    s.phase = 'transfer'
    news(s, 'Przerwa zimowa. Okno transferowe otwarte, obóz w Turcji odwołany z braku środków.')
    return
  }
  if (isSeasonOver(s)) {
    endSeason(s)
    return
  }
  maybeEvent(s)
}

export function isSeasonOver(s: GameState): boolean {
  for (let w = s.round; w < SEASON_WEEKS; w++) if (hasClubMatch(s, w)) return false
  return true
}

/** pomija puste tygodnie, żeby kolejne kliknięcie zawsze grało mecz drużyny */
export function nextMatchInfo(s: GameState): { week: number; league?: Fixture; cup?: CupTie } | undefined {
  if (s.clubId === null) return undefined
  const lg = clubLeague(s)!
  for (let w = s.round; w < SEASON_WEEKS; w++) {
    const league = lg.rounds[w]?.find((f) => f.home === s.clubId || f.away === s.clubId)
    const cup = cupTieForWeek(s, w)
    if (league || cup) return { week: w, league, cup }
  }
  return undefined
}

export function playNext(s: GameState): void {
  const info = nextMatchInfo(s)
  if (!info) {
    endSeason(s)
    return
  }
  while (s.round < info.week && s.phase === 'season') playWeek(s)
  if (s.phase === 'season') playWeek(s)
}

export function playUntilBreak(s: GameState): void {
  const startPhase = s.phase
  let guard = 0
  while (s.phase === 'season' && startPhase === 'season' && guard++ < 40) playNext(s)
}

// ---------- zdarzenia ----------

function maybeEvent(s: GameState): void {
  if (s.phase !== 'season') return
  withRng(s, (rng) => {
    if (!rng.chance(0.32)) return
    const level = club(s)!.level
    const pool = EVENTS.filter(
      (e) =>
        (e.minLevel ?? 0) <= level &&
        (e.maxLevel ?? 7) >= level &&
        !(e.once && s.usedEvents.includes(e.id)) &&
        s.usedEvents.slice(-12).indexOf(e.id) < 0 &&
        (!e.condition || e.condition(s)),
    )
    if (!pool.length) return
    const total = pool.reduce((a, e) => a + (e.weight ?? 1), 0)
    let r = rng.next() * total
    let ev = pool[0]
    for (const e of pool) {
      r -= e.weight ?? 1
      if (r <= 0) {
        ev = e
        break
      }
    }
    let player: Player | undefined
    if (ev.player) {
      const cands = s.squad.filter((p) => ev.player === 'any' || p.traits.includes(ev.player as never))
      if (!cands.length) return
      player = rng.pick(cands)
    }
    s.usedEvents.push(ev.id)
    s.pendingEvent = {
      eventId: ev.id,
      playerId: player?.id,
      text: fillText(s, ev.text, player),
      options: ev.options.map((o) => ({ label: fillText(s, o.label, player) })),
    }
    s.resumePhase = 'season'
    s.phase = 'event'
  })
}

export function fillText(s: GameState, text: string, p?: Player): string {
  const t = club(s)
  return text
    .replace(/\{p\}/g, p ? playerName(p) : 'zawodnik')
    .replace(/\{ps\}/g, p ? shortName(p) : 'zawodnik')
    .replace(/\{klub\}/g, t?.name ?? 'klub')
    .replace(/\{miasto\}/g, t?.town ?? 'miasto')
    .replace(/\{trener\}/g, `${s.coach.firstName} ${s.coach.lastName}`)
}

export function resolveEvent(s: GameState, optionIndex: number): string {
  const pe = s.pendingEvent
  if (!pe) return ''
  const ev = EVENTS.find((e) => e.id === pe.eventId)!
  const player = s.squad.find((p) => p.id === pe.playerId)
  const opt = ev.options[optionIndex]
  const result = withRng(s, (rng) => opt.apply({ s, rng, p: player }))
  const text = fillText(s, result, player)
  news(s, text)
  s.pendingEvent = undefined
  s.phase = s.resumePhase ?? 'season'
  s.resumePhase = undefined
  if (s.clubId !== null && s.trust.board < 12) fire(s, 'Po tej akcji zarząd nie miał wyjścia. Kluczyki do szatni na biurko.')
  return text
}

// ---------- transfery ----------

export function refreshTransferList(s: GameState): void {
  const t = club(s)
  if (!t) return
  s.transferList = withRng(s, (rng) => {
    const list = []
    const positions: Position[] = ['BR', 'OBR', 'OBR', 'POM', 'POM', 'POM', 'NAP', 'NAP', 'OBR', 'NAP']
    for (const pos of positions) {
      const free = rng.chance(0.3)
      const p = generatePlayer(rng, s, t.level, pos, {
        skillOffset: free ? -4 : rng.int(-2, 5),
        foreign: rng.chance(t.level >= 4 ? 0.25 : 0.05),
      })
      const fee = free ? 0 : Math.round((p.value * (1 + rng.next() * 0.8)) / 100) * 100
      const from = free ? 'wolny zawodnik' : s.teams[rng.pick(s.leagues[t.level].teamIds.filter((x) => x !== t.id))].name
      list.push({ player: p, fee, from })
    }
    return list
  })
}

export function buyPlayer(s: GameState, playerId: number): string {
  const idx = s.transferList.findIndex((x) => x.player.id === playerId)
  if (idx < 0) return ''
  const tt = s.transferList[idx]
  if (tt.fee > s.budget) return 'Brakuje pieniędzy. Prezes proponuje zapłacić w ziemniakach, ale klub sprzedający odmawia.'
  if (s.squad.length >= MAX_SQUAD) return `Kadra jest pełna (${MAX_SQUAD}). Najpierw kogoś zwolnij.`
  s.budget -= tt.fee
  tt.player.morale = 70
  s.squad.push(tt.player)
  s.transferList.splice(idx, 1)
  const msg = `${playerName(tt.player)} dołącza do ${club(s)!.name}${tt.fee ? ` za ${formatMoney(tt.fee)}` : ' za darmo'}.`
  news(s, msg)
  return msg
}

export function sellPlayer(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return ''
  const price = Math.round((p.value * 0.75) / 100) * 100
  s.budget += price
  s.squad = s.squad.filter((x) => x.id !== playerId)
  if (p.traits.includes('syn_prezesa')) adjustTrust(s, { board: -20 })
  if (p.traits.includes('kibic_z_mlyna')) adjustTrust(s, { fans: -10 })
  if (p.traits.includes('lider')) adjustTrust(s, { squad: -6 })
  const msg = `${playerName(p)} sprzedany za ${formatMoney(price)}.${p.traits.includes('syn_prezesa') ? ' Prezes nie odbiera telefonów.' : ''}`
  news(s, msg)
  return msg
}

export function releasePlayer(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return ''
  s.squad = s.squad.filter((x) => x.id !== playerId)
  adjustTrust(s, { squad: p.traits.includes('lider') ? -8 : -2, board: p.traits.includes('syn_prezesa') ? -25 : 0 })
  const msg = `${playerName(p)} odchodzi z klubu za porozumieniem stron. Głównie Twoim.`
  news(s, msg)
  return msg
}

export function finishTransfers(s: GameState): void {
  s.phase = 'season'
  if (isSeasonOver(s)) endSeason(s)
}

// ---------- koniec sezonu ----------

function fire(s: GameState, why: string): void {
  const t = club(s)!
  const lg = clubLeague(s)!
  s.history.push({
    season: s.season,
    clubName: t.name,
    level: t.level,
    leagueName: lg.name,
    position: clubPosition(s),
    outcome: 'zwolniony w trakcie sezonu',
    cup: '',
    fired: true,
  })
  s.totalStats.firedCount++
  s.coach.reputation = clamp(s.coach.reputation - 6, 0, 100)
  news(s, `Zwolnienie z ${t.name}. ${why}`)
  s.clubId = null
  s.squad = []
  s.transferList = []
  s.pendingEvent = undefined
  s.hiringNote = `${why} Kilka klubów i tak dzwoni, bo w tej lidze trenerów jest mniej niż boisk.`
  s.offers = generateOffers(s, t.level, true, t.id)
  s.phase = 'hiring'
}

/** gdy bezrobotny: dograj sezon bez nas */
export function waitForOffers(s: GameState): void {
  while (s.round < SEASON_WEEKS) {
    withRng(s, (rng) => {
      for (const lg of s.leagues) for (const f of lg.rounds[s.round] ?? []) if (f.hg === undefined) playAiFixture(rng, s, f)
      const ci = s.cup.schedule.indexOf(s.round)
      if (ci >= 0 && s.cup.rounds[ci]) playCupRound(rng, s, ci)
    })
    s.round++
  }
  s.seasonsUnemployed++
  endSeason(s)
}

function generateOffers(s: GameState, aroundLevel: number, afterFiring: boolean, excludeId?: number): JobOffer[] {
  return withRng(s, (rng) => {
    const offers: JobOffer[] = []
    const rep = s.coach.reputation
    const minL = Math.max(0, aroundLevel - (afterFiring ? 2 : 1))
    const maxL = Math.min(7, aroundLevel + (afterFiring ? 0 : 2))
    for (let level = maxL; level >= minL; level--) {
      if (!licenseAllows(s, level)) continue
      const need = REP_NEEDED[level]
      const p = rep >= need + 8 ? 0.9 : rep >= need ? 0.6 : rep >= need - 6 ? 0.25 : 0
      if (!rng.chance(p)) continue
      const lg = s.leagues[level]
      const id = rng.pick(lg.teamIds.filter((x) => x !== s.clubId && x !== excludeId))
      if (offers.some((o) => o.teamId === id)) continue
      offers.push(makeOffer(s, id, rng.pick(OFFER_NOTES)))
      if (offers.length >= 4) break
    }
    if (!offers.length) {
      const level = Math.max(0, Math.min(minL, 1))
      const id = rng.pick(s.leagues[level].teamIds.filter((x) => x !== excludeId))
      offers.push(makeOffer(s, id, 'Nikt inny nie chciał. Ale mają nowe siatki w bramkach!'))
    }
    return offers
  })
}

const OFFER_NOTES = [
  'Prezes widział Twój ostatni mecz. Podobno płakał ze wzruszenia.',
  'Ambitny projekt. Tak twierdzi właściciel firmy budowlanej, który go finansuje.',
  'Szukają kogoś, kto „ogarnie szatnię”.',
  'Kibice zbierali podpisy, żebyś przyszedł. Zebrali 14.',
  'Oferta przyszła faksem. Klub ma tradycje.',
  'Dyrektor sportowy to kuzyn Twojego sąsiada. Same plusy.',
  'Stadion po remoncie, krzesełka w kolorach klubu. Prawie wszystkie.',
  'Sponsor strategiczny: lokalna masarnia. Kiełbasa po meczach w cenie.',
]

function evolvePlayers(rng: Rng, s: GameState): string[] {
  const notes: string[] = []
  const level = club(s)?.level ?? 0
  for (const p of s.squad) {
    p.age++
    let delta = 0
    if (p.age <= 23) delta = Math.min(p.potential - p.skill, rng.int(1, 6) + (p.apps > 10 ? 2 : 0))
    else if (p.age <= 28) delta = Math.min(p.potential - p.skill, rng.int(0, 3))
    else if (p.age <= 31) delta = rng.int(-2, 1)
    else delta = -rng.int(1, 5)
    if (p.traits.includes('talent') && p.age <= 24) delta += 2
    if (p.traits.includes('pracus')) delta += 1
    if (p.traits.includes('leniwy')) delta -= 1
    p.skill = clamp(p.skill + delta, 5, 97)
    p.potential = Math.max(p.potential, p.skill)
    p.goals = 0
    p.apps = 0
    p.form = 0
    p.injuredFor = 0
    p.value = playerValue(p)
    if (p.traits.includes('talent') && p.skill > LEVELS[level].base + 8 && rng.chance(0.4)) {
      notes.push(`${playerName(p)} zbiera oferty z wyższych lig.`)
    }
  }
  const retiring = s.squad.filter((p) => (p.age >= 35 && rng.chance(0.5)) || p.age >= 39)
  for (const p of retiring) notes.push(`${playerName(p)} (${p.age} l.) kończy karierę. Otwiera warsztat samochodowy.`)
  s.squad = s.squad.filter((p) => !retiring.includes(p))
  // juniorzy
  for (let i = 0; i < 2; i++) {
    const pos = rng.pick(['OBR', 'POM', 'NAP', 'POM'] as Position[])
    const j = generatePlayer(rng, s, level, pos, { age: rng.int(16, 18), skillOffset: -2 })
    if (s.squad.length < MAX_SQUAD) {
      s.squad.push(j)
      notes.push(`Z juniorów awansuje ${playerName(j)} (${j.age} l., ${j.pos}).`)
    }
  }
  return notes
}

export function endSeason(s: GameState): void {
  const summary: string[] = []
  // dograj wszystko, co zostało
  withRng(s, (rng) => {
    for (const lg of s.leagues) for (const round of lg.rounds) for (const f of round) if (f.hg === undefined) playAiFixture(rng, s, f)
    for (let i = 0; i < s.cup.schedule.length; i++) if (s.cup.rounds[i] && s.cup.winner === undefined && !s.cup.rounds[i].every((t) => t.winner !== undefined)) playCupRound(rng, s, i)
  })
  const t = club(s)
  const tables = s.leagues.map((lg) => computeTable(lg))
  let fired = false
  if (t) {
    const lg = clubLeague(s)!
    const table = tables[lg.level]
    const pos = table.findIndex((r) => r.teamId === t.id) + 1
    const size = lg.teamIds.length
    const met = goalMet(s.goal, pos, size)
    const promoted = lg.level < 7 && pos <= 2
    const relegated = lg.level > 0 && pos > size - 2
    let outcome = `${pos}. miejsce`
    if (pos === 1) {
      const title = lg.level === 7 ? `Mistrzostwo Polski (sezon ${s.season})` : `Mistrzostwo: ${lg.name} (sezon ${s.season})`
      s.trophies.push(title)
      outcome += ', mistrzostwo'
    }
    if (promoted) outcome += ', awans'
    if (relegated) outcome += ', spadek'
    const cupText =
      s.cup.winner === t.id
        ? 'zwycięstwo'
        : s.cup.eliminatedAt !== undefined
          ? cupRoundName(s.cup.eliminatedAt)
          : s.cup.rounds[0].some((x) => x.home === t.id || x.away === t.id)
            ? 'finał'
            : 'nie grał'
    summary.push(`${t.name}: ${outcome} w lidze ${lg.name}. Cel: ${goalLabel(s.goal, lg.level).toLowerCase()} (${met ? 'wykonany' : 'niewykonany'}).`)
    const repGain = (met ? 6 : -4) + (promoted ? 6 + lg.level : 0) + (pos === 1 ? 4 + lg.level : 0) - (relegated ? 6 : 0)
    s.coach.reputation = clamp(s.coach.reputation + repGain, 0, 100)
    adjustTrust(s, { board: met ? 15 : -20, fans: promoted ? 20 : relegated ? -20 : 0 })
    if (s.trust.board < 30) fired = true
    s.history.push({
      season: s.season,
      clubName: t.name,
      level: lg.level,
      leagueName: lg.name,
      position: pos,
      outcome,
      cup: cupText,
      fired,
    })
    for (const p of s.squad) {
      if (!s.bestPlayer || p.skill > s.bestPlayer.skill) s.bestPlayer = { name: playerName(p), skill: p.skill }
    }
    const top = [...s.squad].sort((a, b) => b.goals - a.goals)[0]
    if (top && top.goals > 0) summary.push(`Król strzelców drużyny: ${playerName(top)} (${top.goals} goli).`)
  } else {
    summary.push('Sezon spędzony w roli eksperta w lokalnym radiu. Słuchalność: 37 osób.')
  }

  // awanse i spadki we wszystkich ligach
  for (let level = 0; level < 7; level++) {
    const lower = s.leagues[level]
    const upper = s.leagues[level + 1]
    const up = tables[level].slice(0, 2).map((r) => r.teamId)
    const down = tables[level + 1].slice(-2).map((r) => r.teamId)
    lower.teamIds = lower.teamIds.filter((id) => !up.includes(id)).concat(down)
    upper.teamIds = upper.teamIds.filter((id) => !down.includes(id)).concat(up)
    for (const id of up) {
      s.teams[id].level = level + 1
      s.teams[id].strength += 2
    }
    for (const id of down) {
      s.teams[id].level = level
      s.teams[id].strength -= 2
    }
  }
  withRng(s, (rng) => {
    for (const team of Object.values(s.teams)) {
      const base = LEVELS[team.level].base
      // kluby mają swoją tożsamość: silni zostają silni, ale wszystko trochę faluje
      team.strength = Math.round(team.strength + (base + (team.id % 7) - 3 - team.strength) * 0.2 + rng.normal(0, 2.5))
    }
    if (t) summary.push(...evolvePlayers(rng, s))
    // rywale się zbroją, kiedy gracz dominuje
    if (t && s.history[s.history.length - 1]?.position !== undefined && s.history[s.history.length - 1].position! <= 2) {
      const lg = clubLeague(s)!
      const rivals = lg.teamIds.filter((id) => id !== t.id).sort((a, b) => s.teams[b].strength - s.teams[a].strength).slice(0, 3)
      for (const id of rivals) s.teams[id].strength += rng.int(1, 3)
      summary.push(`${s.teams[rivals[0]].name} ogłasza wielkie zakupy. „Nie oddamy wam tej ligi” – mówi ich prezes.`)
    }
  })

  // trener
  s.coach.age++
  s.coach.savings += t ? s.salary : 2_000
  if (s.coach.courseLeft > 0) {
    s.coach.courseLeft = 0
    const next = LICENSES[licenseIndex(s.coach.license) + 1]
    if (next) {
      s.coach.license = next
      summary.push(`Ukończyłeś kurs. Masz licencję ${next}! Zdjęcie z dyplomem trafia na Facebooka klubu.`)
    }
  }

  s.lastSeasonSummary = summary
  if (s.coach.age >= 70) {
    retire(s, 'Siedemdziesiątka na karku. Czas na działkę i komentowanie meczów z pilotem w ręku.')
    return
  }
  if (t && fired) {
    s.totalStats.firedCount++
    s.coach.reputation = clamp(s.coach.reputation - 5, 0, 100)
    s.clubId = null
    s.squad = []
    s.hiringNote = `Zarząd ${t.name} podziękował Ci za współpracę. Na pożegnanie dostałeś szalik i kosz owocowy.`
    s.offers = generateOffers(s, t.level, true, t.id)
  } else {
    s.offers = generateOffers(s, t ? t.level : 1, false, t?.id)
  }
  startNewSeasonWorld(s)
  s.phase = 'seasonEnd'
}

function startNewSeasonWorld(s: GameState): void {
  s.season++
  s.round = 0
  s.winterWindowDone = false
  s.cup = { rounds: [], schedule: [] }
  withRng(s, (rng) => {
    for (const lg of s.leagues) lg.rounds = makeFixtures(rng, lg.teamIds)
  })
  s.cup = withRng(s, (rng) => drawCup(rng, s))
  s.reports = []
}

/** wybór na koniec sezonu: zostań w klubie */
export function stayAtClub(s: GameState): void {
  const t = club(s)
  if (!t) return
  const lg = clubLeague(s)!
  s.goal = goalFromRank(rankByStrength(s, lg, t.id), lg.teamIds.length)
  s.budget = Math.round(LEVELS[t.level].budget * (0.8 + s.trust.board / 250)) + Math.round(s.budget * 0.3)
  s.salary = Math.round(Math.max(s.salary, LEVELS[t.level].salary * (0.8 + s.coach.reputation / 200)))
  s.trust.board = clamp(s.trust.board, 45, 80)
  refreshTransferList(s)
  s.offers = []
  s.phase = 'transfer'
  news(s, `Sezon ${s.season}: zostajesz w ${t.name}. Cel: ${goalLabel(s.goal, t.level).toLowerCase()}.`)
}

export function acceptOffer(s: GameState, teamId: number): void {
  const offer = s.offers.find((o) => o.teamId === teamId)
  if (!offer) return
  takeJob(s, offer)
}

export function startLicenseCourse(s: GameState): string {
  const next = LICENSES[licenseIndex(s.coach.license) + 1]
  if (!next) return 'Masz już najwyższą licencję.'
  const course = LICENSE_COURSES[next]!
  if (s.coach.courseLeft > 0) return 'Już jesteś na kursie.'
  if (s.coach.reputation < course.rep) return `Na kurs ${next} potrzebujesz reputacji ${course.rep}.`
  if (s.coach.savings < course.cost) return `Kurs ${next} kosztuje ${formatMoney(course.cost)}. Nie stać Cię.`
  s.coach.savings -= course.cost
  s.coach.courseLeft = 1
  return `Zapisałeś się na kurs ${next}. Dyplom po zakończeniu sezonu.`
}

export function retire(s: GameState, reason: string): void {
  s.retireReason = reason
  s.phase = 'retired'
}

export function careerCard(s: GameState) {
  const best = [...s.history].sort((a, b) => b.level - a.level || (a.position ?? 99) - (b.position ?? 99))[0]
  // bez losowania, żeby karta nie zmieniała stanu gry przy każdym renderze
  const quote = COACH_QUOTES[(s.seed + s.history.length) % COACH_QUOTES.length]
  const total = s.totalStats.w + s.totalStats.d + s.totalStats.l
  return {
    name: `${s.coach.firstName} ${s.coach.lastName}`,
    age: s.coach.age,
    region: s.coach.region,
    license: s.coach.license,
    reputation: s.coach.reputation,
    seasons: s.history.length,
    clubs: [...new Set(s.history.map((h) => h.clubName))],
    peak: best ? `${best.leagueName} (${best.clubName})` : 'brak',
    trophies: s.trophies,
    scandal: s.scandals[s.scandals.length - 1],
    bestPlayer: s.bestPlayer,
    record: `${s.totalStats.w}Z ${s.totalStats.d}R ${s.totalStats.l}P`,
    winPct: total ? Math.round((s.totalStats.w / total) * 100) : 0,
    fired: s.totalStats.firedCount,
    quote,
    path: s.history.map((h) => h.level),
    reason: s.retireReason ?? '',
  }
}
