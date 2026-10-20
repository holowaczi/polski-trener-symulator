import { licenseCovers, startMultiplier } from './score'
import { expireContracts, seasonContracts } from './contracts'
import { drawCentralCup, drawRegionalCup, pairUp, roundName } from './cup'
import { LEVELS, LICENSES, LICENSE_COURSES, RESERVE_MAX_LEVEL, SWAPS } from './data'
import { EVENTS, type GameEvent } from './events'
import { departureEffects, generateBids, MIN_SQUAD, refreshTransferList, wageLimitFor } from './market'
import { aiStrength, autoLineup, playClubMatch, previewStrength, simulateScore } from './match'
import type { Rng } from './rng'
import type { CareerEnding, Cup, CupTie, Playoff, Fixture, GameState, GoalType, JobOffer, League, License, Player, Position, TableRow } from './types'
import { adjustCoach, adjustTrust, club, clubLeague, formatMoney, news, setMorale, wageBill, withRng } from './util'
import { parentRaid, parentTeam, refreshReserves, returnSentDown } from './reserves'
import { leagueRegion, teamRegion, thirdGroupOf } from './regions'
import {
  clamp,
  generatePlayer,
  generateSquad,
  generateWorld,
  leagueOf,
  makeFixtures,
  playerName,
  playerValue,
  teamsAtLevel,
  bottomLevel,
  wageFor,
  newcomerTeams,
} from './world'

export { club, clubLeague, formatMoney } from './util'
import {
  ASSISTANT_CHOICE,
  BURNOUT_END,
  burnoutEnding,
  careerWarning,
  choiceEnding,
  DIRT_END,
  pressQuote,
  resolveDoctor,
  resolveJournalist,
  retirementEnding,
  scandalEnding,
  seasonCoolDown,
  unemployedEnding,
} from './endings'

export const SAVE_VERSION = 3
/** najdłuższa liga ma 34 kolejki; krótsze kończą wcześniej */
export const SEASON_WEEKS = 36

/** baraże o awans grają II i I liga: miejsca 3–6, półfinały i finał po zakończeniu ligi */
export const PLAYOFF_LEVELS = [7, 8]
export const PLAYOFF_WEEKS = [34, 35]

// ---------- cele i licencje ----------

export function goalLabel(goal: GoalType, level: number): string {
  if (goal === 'awans') return level === 9 ? 'Mistrzostwo Polski' : 'Awans'
  if (goal === 'czołówka') return 'Czołowa czwórka'
  if (goal === 'środek') return 'Górna połowa tabeli'
  return 'Utrzymanie'
}

export function goalMet(goal: GoalType, pos: number, size: number, level: number, up = SWAPS[level] ?? 2, down = SWAPS[level - 1] ?? 2): boolean {
  if (goal === 'awans') return level === 9 ? pos === 1 : pos <= up
  if (goal === 'czołówka') return pos <= 4
  if (goal === 'środek') return pos <= Math.ceil(size / 2)
  return pos <= size - down
}

function groupsAt(s: GameState, level: number): League[] {
  return s.leagues.filter((l) => l.level === level)
}

/** ilu awansuje z jednej grupy: przy kilku grupach tylko zwycięzca, przy pojedynczych ligach jak w SWAPS */
export function promotionSlots(s: GameState, level: number): number {
  if (level >= 9) return 0
  return groupsAt(s, level).length === 1 && groupsAt(s, level + 1).length === 1 ? SWAPS[level] : 1
}

/** czy na tym poziomie ostatnie miejsce awansu rozstrzygają baraże */
export function hasPlayoffs(s: GameState, level: number): boolean {
  return PLAYOFF_LEVELS.includes(level) && groupsAt(s, level).length === 1 && groupsAt(s, level + 1).length === 1
}

/** awans bezpośredni: przy barażach o jedno miejsce mniej */
export function directPromotion(s: GameState, level: number): number {
  return promotionSlots(s, level) - (hasPlayoffs(s, level) ? 1 : 0)
}

/** czy drużyna może awansować (rezerwy nie wyżej niż II liga i zawsze poniżej pierwszej drużyny) */
function canGoUp(s: GameState, teamId: number, level: number): boolean {
  if (!s.teams[teamId].reserve) return true
  if (level + 1 > RESERVE_MAX_LEVEL) return false
  // rezerwy nie mogą grać na tym samym poziomie co pierwsza drużyna ani wyżej
  const parent = parentTeam(s, teamId)
  return !parent || level + 1 < parent.level
}

/** ilu spada z danej grupy przy obecnych tabelach (zależy też od tego, kto spada z ligi wyżej) */
export function relegationSlots(s: GameState, lg: League): number {
  const tables = new Map(s.leagues.map((l) => [l, computeTable(l)] as const))
  return promotionPlan(s, tables).downCount.get(lg) ?? 0
}

/** IV liga województwa bez niższych lig w grze: beniaminkowie przychodzą z okręgówki spoza świata gry */
export const NEWCOMERS_FROM_BELOW = 3

export interface PromotionPlan {
  up: Set<number>
  down: Set<number>
  /** drużyny, które wypadają ze świata gry (spadek do okręgówki innego województwa albo wycofanie z najniższej klasy) */
  gone: Set<number>
  moves: { lg: League; out: number[]; in: number[] }[]
  /** ile nowych drużyn dołącza do grupy spoza świata gry */
  newcomers: { lg: League; count: number }[]
  downCount: Map<League, number>
}

/**
 * Awanse i spadki między wszystkimi grupami.
 * Beniaminek z IV ligi trafia do grupy III ligi swojego województwa, spadkowicz z II ligi tak samo,
 * a spadkowicz z III ligi do IV ligi swojego województwa. Każda grupa spuszcza tylu, ilu przyjmuje,
 * więc liczba drużyn się nie zmienia.
 */
export function promotionPlan(s: GameState, tables: Map<League, TableRow[]>): PromotionPlan {
  const up = new Set<number>()
  const down = new Set<number>()
  const gone = new Set<number>()
  const inbox = new Map<League, number[]>(s.leagues.map((l) => [l, []]))
  const outs = new Map<League, number[]>(s.leagues.map((l) => [l, []]))
  const upOut = new Map<League, number[]>()
  const extra = new Map<League, number>()
  const downCount = new Map<League, number>()

  /** grupa na danym poziomie, do której trafia drużyna; undefined = poza światem gry */
  const target = (level: number, id: number, mode: 'up' | 'down', from: League): League | undefined => {
    const all = groupsAt(s, level)
    if (level >= 7 || all.length === 1 && level === 6) return all[0]
    // województwo: z IV ligi i niżej bierzemy województwo ligi, z III ligi i wyżej województwo klubu
    const region = (from.level <= 5 ? leagueRegion(s, from) : undefined) ?? teamRegion(s, id)
    if (level === 6) {
      const g = thirdGroupOf(region)
      return all.find((l) => l.group === g) ?? all[0]
    }
    let cands = all.filter((l) => leagueRegion(s, l) === region)
    // spadek z III ligi: stare zapisy mają IV ligę tylko jednego województwa
    if (!cands.length && level === 5) cands = all
    if (!cands.length) return undefined
    // beniaminków rozkładamy równo, spadkowiczów tam, skąd najwięcej ubyło
    const score = (l: League) => (mode === 'up' ? -inbox.get(l)!.length : (upOut.get(l)?.length ?? 0) - inbox.get(l)!.length)
    return cands.reduce((best, l) => (score(l) > score(best) ? l : best))
  }

  // awanse: wyniki z tabel i baraży
  for (let level = 0; level < 9; level++) {
    const k = promotionSlots(s, level)
    for (const lg of groupsAt(s, level)) {
      const eligible = tables
        .get(lg)!
        .filter((r) => canGoUp(s, r.teamId, level))
        .map((r) => r.teamId)
      let ids: number[]
      if (!hasPlayoffs(s, level)) ids = eligible.slice(0, k)
      else {
        // ostatnie miejsce awansu bierze zwycięzca baraży
        const po = s.playoffs?.find((x) => x.level === level)?.winner
        ids = [...eligible.slice(0, k - 1), po ?? eligible[k - 1]].filter((id) => id !== undefined)
      }
      upOut.set(lg, ids)
    }
    for (const lg of groupsAt(s, level))
      for (const id of upOut.get(lg)!) {
        const t = target(level + 1, id, 'up', lg)
        if (!t) continue
        up.add(id)
        outs.get(lg)!.push(id)
        inbox.get(t)!.push(id)
      }
  }
  // IV ligi województw, których niższych lig nie ma w grze
  for (const lg of groupsAt(s, 5)) {
    const r = leagueRegion(s, lg)
    if (!groupsAt(s, 4).some((l) => leagueRegion(s, l) === r)) extra.set(lg, NEWCOMERS_FROM_BELOW)
  }

  // spadki od góry: każda grupa oddaje tylu, ilu dostała, minus tych, co awansowali
  for (let level = 9; level >= 0; level--) {
    for (const lg of groupsAt(s, level)) {
      const nUp = outs.get(lg)!.length
      const below = level > 0 && groupsAt(s, level - 1).some((l) => level - 1 >= 5 || leagueRegion(s, l) === leagueRegion(s, lg))
      // najniższa klasa: braki uzupełniają nowe kluby, nadmiar się wycofuje
      if (!below && !extra.has(lg)) extra.set(lg, Math.max(0, nUp - inbox.get(lg)!.length))
      const n = Math.max(0, inbox.get(lg)!.length + (extra.get(lg) ?? 0) - nUp)
      downCount.set(lg, n)
      if (!n) continue
      const rel = tables
        .get(lg)!
        .map((r) => r.teamId)
        .filter((id) => !up.has(id))
        .slice(-n)
      for (const id of rel) {
        outs.get(lg)!.push(id)
        const t = level > 0 ? target(level - 1, id, 'down', lg) : undefined
        if (t) {
          down.add(id)
          inbox.get(t)!.push(id)
        } else {
          gone.add(id)
          // spadek do okręgówki innego województwa: drużyna dalej istnieje, tylko poza grą
          if (below || level === 5) down.add(id)
        }
      }
    }
  }
  return {
    up,
    down,
    gone,
    moves: s.leagues.map((lg) => ({ lg, out: outs.get(lg)!, in: inbox.get(lg)! })),
    newcomers: [...extra].filter(([, c]) => c > 0).map(([lg, count]) => ({ lg, count })),
    downCount,
  }
}

const REP_NEEDED = [0, 0, 0, 6, 14, 24, 35, 48, 62, 76]

function licenseIndex(l: GameState['coach']['license']): number {
  return LICENSES.indexOf(l)
}

export function licenseAllows(s: GameState, level: number): boolean {
  return licenseIndex(s.coach.license) >= licenseIndex(LEVELS[level].license)
}

export interface LicenseStatus {
  /** licencja wymagana w lidze klubu */
  need: License
  ok: boolean
  /** trener jest na kursie, który da wymaganą licencję: związek wydaje zgodę warunkową */
  studying: boolean
  /** klub musi zgłosić „trenera na papierze” */
  figurant: boolean
  /** czy można zostać w klubie na kolejny sezon */
  canStay: boolean
  /** koszt trenera na papierze za sezon, płaci klub z budżetu transferowego */
  cost: number
}

/**
 * Licencja po awansie: liga wyżej może wymagać wyższej licencji.
 * Jeśli trener jest na kursie, związek wydaje zgodę warunkową. Jeśli nie, klub przez jeden sezon
 * zgłasza do rozgrywek trenera z licencją „na papierze” (płaci za to z budżetu). Drugi taki sezon nie przejdzie.
 */
export function licenseStatus(s: GameState): LicenseStatus | undefined {
  const t = club(s)
  if (!t) return undefined
  const need = LEVELS[t.level].license
  const cost = Math.round((LEVELS[t.level].budget * 0.15) / 100) * 100
  if (licenseAllows(s, t.level)) return { need, ok: true, studying: false, figurant: false, canStay: true, cost }
  const next = LICENSES[licenseIndex(s.coach.license) + 1]
  const studying = s.coach.courseLeft > 0 && !!next && licenseIndex(next) >= licenseIndex(need)
  const used = s.figurant ?? 0
  return { need, ok: false, studying, figurant: !studying, canStay: studying || used < 1, cost }
}

// ---------- nowa gra ----------

export interface NewGameInput {
  firstName: string
  lastName: string
  age: number
  region: string
  seed: number
  /** licencja na start (domyślnie UEFA C) */
  license?: License
  /** klub wybrany na start zamiast ofert z najniższej klasy */
  teamId?: number
  /** wyzwanie dnia: zawsze zwykły start */
  daily?: boolean
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
      license: input.daily ? 'UEFA C' : (input.license ?? 'UEFA C'),
      reputation: 2,
      stress: 20,
      savings: 5_000,
      courseLeft: 0,
    },
    teams: {},
    leagues: [],
    cup: { rounds: [], schedule: [] },
    clubId: null,
    squad: [],
    lineup: { auto: true, xi: [], bench: [] },
    tactic: { formation: '4-4-2', mentality: 'balans', style: 'laga' },
    trust: { board: 60, squad: 60, fans: 50 },
    goal: 'środek',
    budget: 0,
    wageLimit: 0,
    salary: 0,
    season: 1,
    round: 0,
    phase: 'hiring',
    transferList: [],
    bids: [],
    modifiers: [],
    flags: {},
    streak: [],
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
    generateWorld(rng, s, input.region)
    for (const lg of s.leagues) lg.rounds = makeFixtures(rng, lg.teamIds)
  })
  // zwycięzca zeszłorocznego pucharu wojewódzkiego: zwykle mocny klub IV ligi
  s.cupQualifier = withRng(s, (rng) => rng.pick([...teamsAtLevel(s, 5).filter((id) => teamRegion(s, id) === input.region)].sort((a, b) => s.teams[b].strength - s.teams[a].strength).slice(0, 6)))
  drawCups(s)
  const picks = withRng(s, (rng) => rng.shuffle(teamsAtLevel(s, bottomLevel(s))).slice(0, 3))
  s.offers = picks.map((id) => makeOffer(s, id, 'Szukają trenera od zaraz. Poprzedni wyjechał do Holandii na szparagi.'))
  s.hiringNote = `Masz ${input.age} lat, licencję ${s.coach.license} i kontakty w województwie ${input.region}. Trzy kluby z najniższej ligi dzwonią.`
  const teamId = input.daily ? undefined : input.teamId
  s.start = { license: s.coach.license, teamId, daily: input.daily || undefined, multiplier: startMultiplier(s, s.coach.license, teamId) }
  if (teamId !== undefined && s.teams[teamId] && licenseCovers(s.coach.license, s.teams[teamId].level)) {
    // wybrany klub: reputacja na miarę ligi, żeby zarząd i rynek pracy traktowały trenera poważnie
    s.coach.reputation = Math.max(2, REP_NEEDED[s.teams[teamId].level])
    s.offers = [makeOffer(s, teamId, 'Sam wybrałeś ten klub. Prezes już żałuje, że się zgodził.')]
    takeJob(s, s.offers[0])
  } else if (s.start.teamId !== undefined) {
    s.start = { ...s.start, teamId: undefined, multiplier: startMultiplier(s, s.coach.license) }
  }
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
    leagueName: lg.name,
    goal: goalFromRank(rank, lg.teamIds.length),
    salary: Math.round((lv.salary * (0.85 + ((teamId * 7) % 10) / 30)) / 1000) * 1000,
    note,
  }
}

function goalFromRank(rank: number, size: number): GoalType {
  if (rank <= 2) return 'awans'
  if (rank <= 4) return 'czołówka'
  if (rank <= Math.ceil(size / 2)) return 'środek'
  return 'utrzymanie'
}

function baseStrength(s: GameState, teamId: number): number {
  if (teamId === s.clubId && s.squad.length) return previewStrength(s).overall
  return s.teams[teamId].strength
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
  s.figurant = 0
  s.modifiers = []
  s.streak = []
  s.bids = []
  const offset = team.strength - LEVELS[team.level].base
  s.squad = withRng(s, (rng) => {
    const sq = generateSquad(rng, s, team.level, offset - 2)
    // syn prezesa to tradycja klubowa
    if (team.level <= 6 && !team.reserve && rng.chance(0.7)) {
      const p = rng.pick(sq.filter((x) => x.pos !== 'BR'))
      p.traits = ['syn_prezesa']
      p.skill = Math.max(8, p.skill - rng.int(4, 9))
      p.value = playerValue(p)
    }
    return sq
  })
  s.wageLimit = wageLimitFor(team)
  // klub zaczyna z lekkim zapasem w pensjach
  const bill = wageBill(s)
  if (bill > s.wageLimit * 0.92) s.wageLimit = Math.round((bill * 1.08) / 100) * 100
  s.budget = Math.round(LEVELS[team.level].budget * (0.7 + ((team.id * 13) % 10) / 15))
  s.offers = []
  s.hiringNote = undefined
  s.tactic = { formation: '4-4-2', mentality: 'balans', style: team.level <= 4 ? 'laga' : 'kontra' }
  s.lineup = { auto: true, xi: [], bench: [] }
  fillLineupFromAuto(s)
  refreshTransferList(s)
  s.interim = undefined
  s.reserveSquad = undefined
  refreshReserves(s)
  // nowy klub z innego województwa: przed sezonem losujemy puchar jego województwa
  const rc = s.regionalCup
  if (s.round === 0 && rc && team.level <= 6 && !rc.rounds[0]?.some((x) => x.home === team.id || x.away === team.id) && !rc.byes?.includes(team.id))
    s.regionalCup = withRng(s, (rng) => drawRegionalCup(rng, s))
  news(s, `${s.coach.firstName} ${s.coach.lastName} nowym trenerem ${team.name}! Cel: ${goalLabel(s.goal, team.level).toLowerCase()}.`)
  s.phase = s.round === 0 ? 'transfer' : 'season'
}

/** zapisuje bieżący automatyczny skład jako punkt wyjścia do ręcznych zmian */
export function fillLineupFromAuto(s: GameState): void {
  const { xi, bench } = autoLineup(s.squad, s.tactic.formation)
  s.lineup.xi = xi.map((p) => p.id)
  s.lineup.bench = bench.map((p) => p.id)
}

export type SlotState = 'xi' | 'bench' | 'out'

export function setPlayerSlot(s: GameState, playerId: number, slot: SlotState): string | void {
  const l = s.lineup
  if (l.auto) {
    fillLineupFromAuto(s)
    l.auto = false
  }
  l.xi = l.xi.filter((id) => id !== playerId)
  l.bench = l.bench.filter((id) => id !== playerId)
  if (slot === 'xi') {
    if (l.xi.length >= 11) return 'W pierwszym składzie jest już 11 zawodników. Najpierw kogoś przesuń.'
    l.xi.push(playerId)
  } else if (slot === 'bench') {
    if (l.bench.length >= 7) return 'Na ławce jest już 7 zawodników.'
    l.bench.push(playerId)
  }
}

export function setAutoLineup(s: GameState, auto: boolean): void {
  if (!auto) fillLineupFromAuto(s)
  s.lineup.auto = auto
}

// ---------- tabela ----------

export function computeTable(lg: League): TableRow[] {
  const rows = new Map<number, TableRow>()
  for (const id of lg.teamIds) rows.set(id, { teamId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })
  for (const round of lg.rounds) {
    for (const f of round) {
      if (f.hg === undefined || f.ag === undefined) continue
      const h = rows.get(f.home)
      const a = rows.get(f.away)
      if (!h || !a) continue
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

function playAiFixture(rng: Rng, s: GameState, f: Fixture | CupTie, cup = false): void {
  const level = Math.min(s.teams[f.home].level, s.teams[f.away].level)
  let hs = aiStrength(rng, s, f.home)
  let as = aiStrength(rng, s, f.away)
  if (cup) {
    const d = s.teams[f.away].level - s.teams[f.home].level
    if (d > 0) hs += Math.min(3, d)
    if (d < 0) as += Math.min(3, -d)
  }
  const r = simulateScore(rng, hs, as, level)
  f.hg = r.hg
  f.ag = r.ag
}

function hasClubMatch(s: GameState, week: number): boolean {
  if (s.clubId === null) return false
  const lg = clubLeague(s)!
  if (week < lg.rounds.length) return true
  return cupTieForWeek(s, week) !== undefined || playoffTieForWeek(s, week) !== undefined
}

// ---------- baraże ----------

function playoffTieForWeek(s: GameState, week: number): { po: Playoff; tie: CupTie; idx: number } | undefined {
  for (const po of s.playoffs ?? []) {
    const idx = po.schedule.indexOf(week)
    const tie = idx >= 0 ? po.rounds[idx]?.find((t) => t.home === s.clubId || t.away === s.clubId) : undefined
    if (tie) return { po, tie, idx }
  }
  return undefined
}

/** nazwa baraży i rundy dla meczu klubu w danym tygodniu */
export function playoffRoundLabel(s: GameState, week: number): string | undefined {
  const x = playoffTieForWeek(s, week)
  return x ? `${x.po.title} · ${x.po.names![x.idx]}` : undefined
}

/** po ostatniej kolejce ligi: miejsca 3–6 grają baraże, półfinały u wyżej sklasyfikowanego */
function drawPlayoffs(s: GameState): void {
  s.playoffs ??= []
  for (const level of PLAYOFF_LEVELS) {
    if (!hasPlayoffs(s, level) || s.playoffs.some((p) => p.level === level)) continue
    const lg = groupsAt(s, level)[0]
    if (lg.rounds.some((r) => r.some((f) => f.hg === undefined))) continue
    const eligible = computeTable(lg)
      .map((r) => r.teamId)
      .filter((id) => canGoUp(s, id, level))
    const direct = directPromotion(s, level)
    const seeds = eligible.slice(direct, direct + 4)
    if (seeds.length < 4) continue
    const po: Playoff = {
      level,
      seeds,
      title: `Baraże o ${LEVELS[level + 1].name}`,
      names: ['półfinał', 'finał'],
      schedule: PLAYOFF_WEEKS,
      rounds: [
        [
          { home: seeds[0], away: seeds[3] },
          { home: seeds[1], away: seeds[2] },
        ],
      ],
    }
    s.playoffs.push(po)
    if (s.clubId !== null && seeds.includes(s.clubId))
      news(s, `${po.title}! ${seeds.indexOf(s.clubId) + direct + 1}. miejsce daje półfinał z ${s.teams[seeds[3 - seeds.indexOf(s.clubId)]].name}.`)
  }
}

/** remis w meczu bez dogrywki: rzuty karne */
function decideByPens(rng: Rng, t: CupTie): void {
  const homeWins = rng.chance(0.5)
  const a = rng.int(3, 5)
  const b = Math.max(0, a - 1 - (rng.chance(0.3) ? 1 : 0))
  t.pens = homeWins ? `${a}:${b}` : `${b}:${a}`
  t.winner = homeWins ? t.home : t.away
}

function playPlayoffsForWeek(rng: Rng, s: GameState, week: number): void {
  for (const po of s.playoffs ?? []) {
    const idx = po.schedule.indexOf(week)
    const ties = idx >= 0 ? po.rounds[idx] : undefined
    if (!ties || ties.every((t) => t.winner !== undefined)) continue
    for (const t of ties) {
      if (t.winner !== undefined) continue
      const mine = s.clubId !== null && (t.home === s.clubId || t.away === s.clubId)
      if (mine) {
        const rep = playClubMatch(rng, s, t, true)
        rep.cupName = `${po.title} · ${po.names![idx]}`
        rep.playoff = true
        t.hg = rep.hg
        t.ag = rep.ag
        s.reports.unshift(rep)
      } else playAiFixture(rng, s, t, true)
      if (t.hg! > t.ag!) t.winner = t.home
      else if (t.hg! < t.ag!) t.winner = t.away
      else decideByPens(rng, t)
      if (mine) {
        if (t.pens) s.reports[0].pens = t.pens
        if (t.winner === s.clubId) news(s, idx === 0 ? `${po.title}: jesteśmy w finale!` : `${po.title}: AWANS! Wygrany finał, szampan leje się po szatni.`)
        else {
          po.eliminatedAt = idx
          news(s, `${po.title}: przegrany ${po.names![idx]}. Do zobaczenia za rok.`)
        }
      }
    }
    if (idx === 0) {
      // finał u lepszego z tabeli
      const [a, b] = ties.map((t) => t.winner!).sort((x, y) => po.seeds.indexOf(x) - po.seeds.indexOf(y))
      po.rounds[1] = [{ home: a, away: b }]
    } else po.winner = ties[0].winner
  }
}

/** koniec sezonu bez klubu w barażach: rozstrzygamy je od razu */
function finishPlayoffs(rng: Rng, s: GameState): void {
  drawPlayoffs(s)
  for (const w of PLAYOFF_WEEKS) playPlayoffsForWeek(rng, s, w)
}

/** oba etapy Pucharu Polski grane w tym sezonie */
export function cupsOf(s: GameState): Cup[] {
  return s.regionalCup ? [s.regionalCup, s.cup] : [s.cup]
}

function drawCups(s: GameState): void {
  s.regionalCup = withRng(s, (rng) => drawRegionalCup(rng, s))
  s.cup = withRng(s, (rng) => drawCentralCup(rng, s))
}

function cupTieForWeek(s: GameState, week: number): CupTie | undefined {
  for (const cup of cupsOf(s)) {
    const idx = cup.schedule.indexOf(week)
    if (idx < 0) continue
    const tie = cup.rounds[idx]?.find((t) => t.home === s.clubId || t.away === s.clubId)
    if (tie) return tie
  }
  return undefined
}

function playCupsForWeek(rng: Rng, s: GameState, week: number): void {
  for (const cup of cupsOf(s)) {
    const idx = cup.schedule.indexOf(week)
    if (idx >= 0 && cup.rounds[idx]) playCupRound(rng, s, cup, idx)
  }
}

/** mecz ligowy klubu w danym tygodniu, jeszcze nierozegrany */
function pendingLeagueFixture(s: GameState, week: number): Fixture | undefined {
  if (s.clubId === null) return undefined
  return clubLeague(s)?.rounds[week]?.find((f) => (f.home === s.clubId || f.away === s.clubId) && f.hg === undefined)
}

/** mecz pucharowy klubu w danym tygodniu, jeszcze nierozegrany */
function pendingCupTie(s: GameState, week: number): CupTie | undefined {
  const t = cupTieForWeek(s, week)
  return t && t.winner === undefined ? t : undefined
}

/**
 * Tydzień gra się w dwóch krokach, jeśli klub ma w nim i ligę, i puchar:
 * najpierw kolejka ligowa, przy następnym kliknięciu mecz pucharowy. Każdy mecz osobno.
 */
export function playWeek(s: GameState): void {
  if (s.phase !== 'season') return
  const week = s.round
  const splitCup = !!pendingLeagueFixture(s, week) && !!pendingCupTie(s, week)
  withRng(s, (rng) => {
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
        } else playAiFixture(rng, s, f)
      }
    }
    if (!splitCup) {
      playCupsForWeek(rng, s, week)
      playPlayoffsForWeek(rng, s, week)
    }
  })
  if (s.reports.length > 40) s.reports.length = 40
  if (splitCup) {
    // puchar w tym samym tygodniu czeka na osobne kliknięcie
    maybeEvent(s)
    return
  }
  s.round++
  afterWeek(s)
}

function playCupRound(rng: Rng, s: GameState, cup: Cup, idx: number): void {
  const ties = cup.rounds[idx]
  const regional = cup !== s.cup
  const cupName = regional ? 'Puchar wojewódzki' : 'Puchar Polski'
  const winners: number[] = []
  for (const t of ties) {
    if (t.winner !== undefined) {
      winners.push(t.winner)
      continue
    }
    const mine = s.clubId !== null && (t.home === s.clubId || t.away === s.clubId)
    if (mine) {
      const rep = playClubMatch(rng, s, t, true)
      rep.cupName = `${cupName} · ${roundName(cup, idx)}`
      t.hg = rep.hg
      t.ag = rep.ag
      s.reports.unshift(rep)
    } else playAiFixture(rng, s, t, true)
    if (t.hg! > t.ag!) t.winner = t.home
    else if (t.hg! < t.ag!) t.winner = t.away
    else {
      decideByPens(rng, t)
      if (mine && s.reports[0]?.cup) s.reports[0].pens = t.pens
    }
    winners.push(t.winner!)
    if (mine) {
      if (t.winner === s.clubId) {
        news(s, `${cupName}: awans dalej! (${roundName(cup, idx)})`)
        adjustTrust(s, { fans: regional ? 2 : 4, board: regional ? 1 : 2 })
      } else {
        cup.eliminatedAt = idx
        news(s, `${cupName}: odpadamy (${roundName(cup, idx)}).`)
      }
    }
  }
  if (winners.length === 1 && !cup.byes?.length) {
    cup.winner = winners[0]
    if (regional) {
      if (winners[0] === s.clubId) {
        s.trophies.push(`Puchar Polski na szczeblu wojewódzkim (sezon ${s.season})`)
        adjustTrust(s, { fans: 10, board: 8, squad: 5 })
        adjustCoach(s, { reputation: 3, stress: -8 })
        news(s, 'Puchar wojewódzki nasz! W przyszłym sezonie gramy w Pucharze Polski z ligowcami z całego kraju.')
      } else news(s, `Puchar wojewódzki zdobywa ${s.teams[winners[0]].name}. Zagra w przyszłym sezonie w etapie centralnym.`)
    } else if (winners[0] === s.clubId) {
      s.trophies.push(`Puchar Polski (sezon ${s.season})`)
      adjustTrust(s, { fans: 20, board: 15, squad: 10 })
      adjustCoach(s, { reputation: 10, stress: -20 })
      news(s, 'PUCHAR POLSKI JEST NASZ! Kibice wnoszą trenera do autobusu.')
    } else news(s, `Puchar Polski zdobywa ${s.teams[winners[0]].name}.`)
  } else {
    // po pierwszej rundzie dochodzą drużyny, które miały wolny los
    const next = [...winners, ...(idx === 0 ? (cup.byes ?? []) : [])]
    if (idx === 0) cup.byes = undefined
    cup.rounds[idx + 1] = pairUp(rng, s.teams, next)
  }
}

/**
 * Kasa klubu nie schodzi poniżej zera: dziurę łata prezes z własnej kieszeni,
 * ale zapamiętuje to i relacje z zarządem spadają.
 */
export function coverDeficit(s: GameState): void {
  const t = club(s)
  if (!t || s.budget >= 0) return
  const gap = -s.budget
  const share = gap / LEVELS[t.level].budget
  s.budget = 0
  adjustTrust(s, { board: -Math.min(12, 2 + Math.round(share * 20)) })
  news(s, `W kasie klubu zabrakło ${formatMoney(gap)}. Prezes łata dziurę z własnej kieszeni i długo patrzy Ci w oczy.`)
}

function afterWeek(s: GameState): void {
  coverDeficit(s)
  if (s.clubId === null) return
  if (forcedEnding(s)) return
  if (s.trust.board < 12) {
    // prezes może być wściekły, ale lidera tabeli zwolnić nie wypada
    const pos = clubPosition(s)
    const size = clubLeague(s)!.teamIds.length
    if (pos !== undefined && pos <= Math.ceil(size / 3) && s.trust.board >= 5) {
      s.trust.board = 15
      news(s, 'Prezes chciał Cię zwolnić, ale ktoś pokazał mu tabelę. Na razie zostajesz.')
    } else {
      fire(s, 'Prezes zadzwonił w niedzielę o 7 rano. Dziękujemy za współpracę.')
      return
    }
  }
  if (s.trust.squad < 15 && !s.modifiers.some((m) => m.label === 'Bunt w szatni')) {
    s.modifiers.push({ label: 'Bunt w szatni', amount: -3, matches: 3 })
    news(s, 'Bunt w szatni. Zawodnicy grają „na trenera”.')
    adjustTrust(s, { board: -4 })
  }
  if (s.trust.fans < 15) {
    adjustTrust(s, { board: -2 })
    adjustCoach(s, { stress: 2 })
    news(s, 'Na trybunach transparent: „Trener do pieczarek!”.')
  }
  const lg = clubLeague(s)!
  if (!s.winterWindowDone && s.round >= Math.ceil(lg.rounds.length / 2)) {
    s.winterWindowDone = true
    openWindow(s)
    news(s, 'Przerwa zimowa. Okno transferowe otwarte, obóz w Turcji odwołany z braku środków.')
    return
  }
  drawPlayoffs(s)
  if (isSeasonOver(s)) {
    endSeason(s)
    return
  }
  // maks. jedno wydarzenie na mecz: tylko po tygodniu, w którym klub grał
  if (hasClubMatch(s, s.round - 1) && !maybeInterim(s)) maybeEvent(s)
}

function openWindow(s: GameState): void {
  s.signings = 0
  withRng(s, (rng) => parentRaid(rng, s))
  refreshTransferList(s)
  generateBids(s)
  s.phase = 'transfer'
}

export function isSeasonOver(s: GameState): boolean {
  for (let w = s.round; w < SEASON_WEEKS; w++) if (hasClubMatch(s, w)) return false
  return true
}

/** nazwa pucharu i rundy dla meczu pucharowego klubu w danym tygodniu */
export function cupRoundLabel(s: GameState, week: number): string | undefined {
  for (const cup of cupsOf(s)) {
    const idx = cup.schedule.indexOf(week)
    if (idx < 0 || !cup.rounds[idx]?.some((t) => t.home === s.clubId || t.away === s.clubId)) continue
    return `${cup === s.cup ? 'Puchar Polski' : 'Puchar wojewódzki'} · ${roundName(cup, idx)}`
  }
  return undefined
}

export function nextMatchInfo(s: GameState): { week: number; league?: Fixture; cup?: CupTie; playoff?: CupTie } | undefined {
  if (s.clubId === null) return undefined
  const lg = clubLeague(s)!
  for (let w = s.round; w < SEASON_WEEKS; w++) {
    // najpierw liga, potem puchar z tego samego tygodnia: zawsze jeden najbliższy mecz
    const league = lg.rounds[w]?.find((f) => (f.home === s.clubId || f.away === s.clubId) && f.hg === undefined)
    if (league) return { week: w, league }
    const cup = pendingCupTie(s, w)
    if (cup) return { week: w, cup }
    const po = playoffTieForWeek(s, w)
    if (po && po.tie.winner === undefined) return { week: w, playoff: po.tie }
  }
  return undefined
}

export function playNext(s: GameState): void {
  let info = nextMatchInfo(s)
  // klub pauzuje w ostatniej kolejce, a baraże jeszcze nierozlosowane: gramy kolejkę bez nas i sprawdzamy, czy w nich jesteśmy
  const lv = club(s)?.level
  while (!info && lv !== undefined && hasPlayoffs(s, lv) && !s.playoffs?.some((p) => p.level === lv) && s.round < PLAYOFF_WEEKS[0] && s.phase === 'season') {
    playWeek(s)
    info = nextMatchInfo(s)
  }
  if (s.phase !== 'season') return
  if (!info) {
    endSeason(s)
    return
  }
  while (s.round < info.week && s.phase === 'season') playWeek(s)
  if (s.phase === 'season') playWeek(s)
}

export function playUntilBreak(s: GameState): void {
  let guard = 0
  while (s.phase === 'season' && guard++ < 40) playNext(s)
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  const d = n % 10
  const t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many
}

/**
 * Szybka symulacja: gra aż do okna transferowego, końca sezonu albo zwolnienia.
 * Zdarzenia rozstrzyga asystent: oferty za zawodników odrzuca, resztę wybiera po swojemu.
 */
export function simulateToBreak(s: GameState): string {
  let played = 0
  let decided = 0
  let guard = 0
  while ((s.phase === 'season' || s.phase === 'event') && guard++ < 200) {
    if (s.phase === 'event') {
      const pe = s.pendingEvent!
      const choice = pe.eventId === 'bid' ? 1 : (ASSISTANT_CHOICE[pe.eventId] ?? withRng(s, (rng) => rng.int(0, pe.options.length - 1)))
      news(s, `Asystent zdecydował: „${pe.options[choice].label}”.`)
      resolveEvent(s, choice)
      decided++
    } else {
      if (nextMatchInfo(s)) played++
      playNext(s)
    }
  }
  const where =
    s.phase === 'transfer' ? 'do okna transferowego' : s.phase === 'seasonEnd' ? 'do końca sezonu' : s.phase === 'hiring' ? 'do zwolnienia' : s.phase === 'retired' ? 'do końca kariery' : 'dalej'
  return `Przesymulowano ${where}: ${played} ${plural(played, 'mecz', 'mecze', 'meczów')}${decided ? `, asystent rozstrzygnął ${decided} ${plural(decided, 'sprawę', 'sprawy', 'spraw')}` : ''}.`
}

// ---------- zdarzenia ----------

function pickEvent(rng: Rng, s: GameState): { ev: GameEvent; player?: Player } | undefined {
  const level = club(s)!.level
  const pool: { ev: GameEvent; players?: Player[] }[] = []
  for (const e of EVENTS) {
    if ((e.minLevel ?? 0) > level || (e.maxLevel ?? 9) < level) continue
    if (e.once && s.usedEvents.includes(e.id)) continue
    // to samo zdarzenie wraca dopiero po kilkudziesięciu innych
    if (s.usedEvents.slice(-(e.cooldown ?? 30)).includes(e.id)) continue
    if (e.condition && !e.condition(s)) continue
    if (e.player) {
      const players = s.squad.filter((p) => (typeof e.player === 'function' ? e.player(p, s) : e.player === 'any' || p.traits.includes(e.player!)))
      if (!players.length) continue
      pool.push({ ev: e, players })
    } else pool.push({ ev: e })
  }
  if (!pool.length) return undefined
  const total = pool.reduce((a, x) => a + (x.ev.weight ?? 1), 0)
  let r = rng.next() * total
  for (const x of pool) {
    r -= x.ev.weight ?? 1
    if (r <= 0) return { ev: x.ev, player: x.players ? rng.pick(x.players) : undefined }
  }
  return undefined
}

const FOREIGN_CLUBS = ['FK Astana', 'Omonia Nikozja', 'Sheriff Tyraspol', 'FC Vaduz', 'Spartak Trnawa', 'Ferencváros', 'Slavia Praga']

/**
 * Trener rezerw: gdy pierwsza drużyna jest na dnie tabeli, zarząd zwalnia jej trenera
 * i proponuje Ci zastępstwo do końca sezonu.
 */
function maybeInterim(s: GameState): boolean {
  const t = club(s)
  const parent = t ? parentTeam(s, t.id) : undefined
  if (!t || !parent || s.round < 6 || s.flags['zastepstwo'] === s.season) return false
  const plg = leagueOf(s, parent.id)
  if (!plg) return false
  const table = computeTable(plg)
  const pos = table.findIndex((r) => r.teamId === parent.id) + 1
  if (pos <= table.length - 3) return false
  if (!withRng(s, (rng) => rng.chance(0.25))) return false
  s.flags['zastepstwo'] = s.season
  s.pendingEvent = {
    eventId: 'zastepstwo',
    data: { teamId: parent.id, fee: 0 },
    text: `${parent.name} jest na ${pos}. miejscu w tabeli. Zarząd zwolnił trenera pierwszej drużyny i dzwoni do Ciebie: „Przejmie pan zespół do końca sezonu? Jak się pan sprawdzi, zostaje pan na dłużej”.`,
    options: [{ label: 'Biorę pierwszą drużynę' }, { label: 'Zostaję z rezerwami' }],
  }
  s.resumePhase = 'season'
  s.phase = 'event'
  return true
}

function takeInterim(s: GameState, parentId: number): string {
  const from = club(s)!
  const parent = s.teams[parentId]
  const lg = leagueOf(s, parentId)!
  takeJob(s, {
    teamId: parentId,
    teamName: parent.name,
    level: parent.level,
    leagueName: lg.name,
    goal: 'utrzymanie',
    salary: Math.round(Math.max(s.salary, LEVELS[parent.level].salary * 0.6) / 1000) * 1000,
    note: '',
  })
  s.interim = { reserveId: from.id, season: s.season }
  return `Jesteś trenerem ${parent.name} na zastępstwo. Cel: utrzymanie. Jak się uda, zostajesz na stałe.`
}

function maybeEvent(s: GameState): void {
  if (s.phase !== 'season') return
  if (forcedEnding(s)) return
  const warning = careerWarning(s)
  if (warning) {
    s.pendingEvent = warning
    s.resumePhase = 'season'
    s.phase = 'event'
    return
  }
  withRng(s, (rng) => {
    // transfery tylko w oknach: w trakcie rundy nikt nie składa ofert za zawodników
    // częściej zdarzenia, gdy dzieje się coś ważnego
    const hot = s.streak.slice(-3).join('') === 'LLL' || s.streak.slice(-3).join('') === 'WWW' || s.coach.stress > 70
    if (!rng.chance(hot ? 0.45 : 0.3)) return
    const picked = pickEvent(rng, s)
    if (!picked) return
    const { ev, player } = picked
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
  const avg = p && p.apps ? (p.ratingSum / p.apps).toFixed(1) : '–'
  return text
    .replace(/\{p\}/g, p ? playerName(p) : 'zawodnik')
    .replace(/\{ps\}/g, p ? `${p.firstName[0]}. ${p.lastName}` : 'zawodnik')
    .replace(/\{ocena\}/g, avg)
    .replace(/\{mecze\}/g, p ? String(p.benchStreak) : '0')
    .replace(/\{klub\}/g, t?.name ?? 'klub')
    .replace(/\{miasto\}/g, t?.town ?? 'miasto')
    .replace(/\{trener\}/g, `${s.coach.firstName} ${s.coach.lastName}`)
}

export function resolveEvent(s: GameState, optionIndex: number): string {
  const pe = s.pendingEvent
  if (!pe) return ''
  let text: string
  if (pe.eventId === 'lekarz' && optionIndex === 0) {
    s.pendingEvent = undefined
    s.resumePhase = undefined
    s.phase = 'season'
    text = takeLeave(s)
    news(s, text)
    return text
  }
  if (pe.eventId === 'bid') text = resolveSeasonBid(s, pe.playerId!, pe.data!.fee, pe.data!.teamId, optionIndex)
  else if (pe.eventId === 'lekarz') text = resolveDoctor(s, optionIndex)
  else if (pe.eventId === 'dziennikarz') text = resolveJournalist(s, optionIndex, withRng(s, (rng) => rng.next()))
  else if (pe.eventId === 'zastepstwo')
    text =
      optionIndex === 0
        ? takeInterim(s, pe.data!.teamId)
        : (adjustTrust(s, { board: 3, squad: 4 }), 'Zostajesz z rezerwami. Chłopaki doceniają, prezes rezerw też.')
  else {
    const ev = EVENTS.find((e) => e.id === pe.eventId)!
    const player = s.squad.find((p) => p.id === pe.playerId)
    const result = withRng(s, (rng) => ev.options[optionIndex].apply({ s, rng, p: player }))
    text = fillText(s, result, player)
  }
  news(s, text)
  coverDeficit(s)
  s.pendingEvent = undefined
  s.phase = s.resumePhase ?? 'season'
  s.resumePhase = undefined
  if (s.clubId !== null && forcedEnding(s)) return text
  if (s.clubId !== null && s.trust.board < 12) fire(s, 'Po tej akcji zarząd nie miał wyjścia. Kluczyki do szatni na biurko.')
  return text
}

function resolveSeasonBid(s: GameState, playerId: number, fee: number, teamId: number, option: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return 'Zawodnika już nie ma w klubie.'
  const buyer = teamId >= 0 ? s.teams[teamId].name : FOREIGN_CLUBS[-1 - teamId]
  const ambitious = teamId < 0 || s.teams[teamId].level > club(s)!.level
  const sell = (price: number, note: string) => {
    s.budget += price
    const extra = departureEffects(s, p)
    if (p.ratingSum / Math.max(1, p.apps) >= 7) adjustTrust(s, { fans: -4 })
    return `${playerName(p)} odchodzi do: ${buyer}, za ${formatMoney(price)}.${note}${extra}`
  }
  if (option === 0) return sell(fee, '')
  if (option === 1) {
    if (ambitious) {
      setMorale(p, -15)
      return `Odrzucasz ofertę. ${playerName(p)} przez tydzień nie odzywa się na treningach.`
    }
    adjustTrust(s, { fans: 1 })
    return `Odrzucasz ofertę za ${playerName(p)}. Kibice doceniają.`
  }
  return withRng(s, (rng) => {
    if (rng.chance(0.5)) return sell(Math.round((fee * 1.3) / 100) * 100, ' Negocjacje się opłaciły.')
    if (ambitious) setMorale(p, -10)
    return `${buyer} wycofuje się z rozmów. ${playerName(p)} jest zawiedziony.`
  })
}

// ---------- okno transferowe ----------

/** za mało ludzi do gry: kierownik drużyny ściąga bezrobotnych z okolicy */
function fillSquad(s: GameState): void {
  const t = club(s)
  if (!t || s.squad.length >= MIN_SQUAD + 2) return
  const added: string[] = []
  withRng(s, (rng) => {
    const need: Position[] = ['BR', 'OBR', 'POM', 'NAP']
    while (s.squad.length < MIN_SQUAD + 2) {
      const pos = s.squad.filter((p) => p.pos === 'BR').length < 2 ? 'BR' : need[1 + (s.squad.length % 3)]
      const p = generatePlayer(rng, s, t.level, pos, { skillOffset: -5 })
      p.wage = Math.round((wageFor(p.skill) * 0.8) / 50) * 50
      p.contract = 1
      s.squad.push(p)
      added.push(playerName(p))
    }
  })
  news(s, `Brakowało ludzi do gry. Kierownik drużyny ściągnął wolnych zawodników: ${added.join(', ')}.`)
}

export function finishTransfers(s: GameState): void {
  expireContracts(s)
  fillSquad(s)
  s.bids = []
  s.phase = 'season'
  if (isSeasonOver(s)) endSeason(s)
}

// ---------- zwolnienie i oferty ----------

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
  adjustCoach(s, { reputation: -6, stress: 15 })
  news(s, `Zwolnienie z ${t.name}. ${why}`)
  leaveClub(s)
  s.hiringNote = `${why} Kilka klubów i tak dzwoni, bo trenerów jest mniej niż boisk.`
  s.offers = generateOffers(s, t.level, true, t.id)
  if (!s.offers.length) s.hiringNote = `${why} Telefon milczy. Możesz przeczekać do końca sezonu i liczyć, że ktoś sobie o Tobie przypomni.`
  s.phase = 'hiring'
}

function leaveClub(s: GameState): void {
  s.clubId = null
  s.squad = []
  s.reserveSquad = undefined
  s.interim = undefined
  s.transferList = []
  s.bids = []
  s.modifiers = []
  s.pendingEvent = undefined
}

/** trener odchodzi z klubu w trakcie sezonu, a sezon w historii kończy się tym, co się stało */
function leaveMidSeason(s: GameState, outcome: string): void {
  const t = club(s)
  const lg = clubLeague(s)
  if (!t || !lg) return
  if (s.phase === 'season' && s.round > 0)
    s.history.push({ season: s.season, clubName: t.name, level: t.level, leagueName: lg.name, position: clubPosition(s), outcome, cup: '' })
  leaveClub(s)
}

/** wypalenie albo afera w gazecie kończą karierę; zwraca, czy to już koniec */
function forcedEnding(s: GameState): boolean {
  const name = club(s)?.name
  if ((s.burnout ?? 0) >= BURNOUT_END) {
    leaveMidSeason(s, 'wypalenie w trakcie sezonu')
    endCareer(s, burnoutEnding(s, name))
    return true
  }
  if ((s.dirt ?? 0) >= DIRT_END) {
    leaveMidSeason(s, 'afera w trakcie sezonu')
    endCareer(s, scandalEnding(s))
    return true
  }
  return false
}

/** urlop po ostrzeżeniu lekarza: sezon przerwy (albo jego reszta), spadek reputacji, wypalenie znika */
export function takeLeave(s: GameState): string {
  const t = club(s)
  if (t) {
    if (s.phase === 'season') leaveMidSeason(s, 'urlop w trakcie sezonu')
    else leaveClub(s)
  }
  adjustCoach(s, { reputation: -8 })
  s.onLeave = true
  s.offers = []
  s.phase = 'season'
  const msg = t
    ? `Bierzesz urlop. ${t.name} żegna Cię kwiatami i pytaniem, kto teraz poprowadzi trening.`
    : 'Bierzesz urlop. Telefon ląduje w szufladzie, a Ty na działce.'
  waitForOffers(s)
  return msg
}

/** urlop jest możliwy, kiedy trener jest wyraźnie przemęczony */
export function canTakeLeave(s: GameState): boolean {
  return (s.burnout ?? 0) >= 6 || s.coach.stress >= 70
}

export function waitForOffers(s: GameState): void {
  while (s.round < SEASON_WEEKS) {
    withRng(s, (rng) => {
      for (const lg of s.leagues) for (const f of lg.rounds[s.round] ?? []) if (f.hg === undefined) playAiFixture(rng, s, f)
      playCupsForWeek(rng, s, s.round)
    })
    s.round++
  }
  if (!s.onLeave) {
    s.seasonsUnemployed++
    // kto długo nie pracuje, o tym prezesi zapominają
    adjustCoach(s, { reputation: -4 })
  }
  adjustCoach(s, { stress: -25 })
  endSeason(s)
}

function generateOffers(s: GameState, aroundLevel: number, afterFiring: boolean, excludeId?: number): JobOffer[] {
  return withRng(s, (rng) => {
    const offers: JobOffer[] = []
    const rep = s.coach.reputation
    const minL = Math.max(bottomLevel(s), aroundLevel - (afterFiring ? 2 : 1))
    // najwyżej szczebel wyżej: prezesi z wyższych lig rzadko ryzykują trenera prosto z dołu
    const maxL = Math.min(9, aroundLevel + (afterFiring ? 0 : 1))
    for (let level = maxL; level >= minL; level--) {
      if (!licenseAllows(s, level)) continue
      const cands = teamsAtLevel(s, level).filter((x) => x !== s.clubId && x !== excludeId)
      if (!cands.length) continue
      // wielkie kluby wymagają większej reputacji
      const id = rng.pick(cands)
      const need = REP_NEEDED[level] + Math.max(0, s.teams[id].strength - LEVELS[level].base) * 1.5
      const p = rep >= need + 8 ? 0.9 : rep >= need ? 0.6 : rep >= need - 6 ? 0.25 : 0
      if (!rng.chance(p)) continue
      if (offers.some((o) => o.teamId === id)) continue
      offers.push(makeOffer(s, id, rng.pick(OFFER_NOTES)))
      if (offers.length >= 4) break
    }
    // po zwolnieniu albo długiej przerwie oferta „z łaski” nie jest pewna
    const fallback = afterFiring ? Math.max(0.1, 0.9 - 0.35 * s.seasonsUnemployed) : 1
    if (!offers.length && rng.chance(fallback)) {
      const level = Math.max(bottomLevel(s), Math.min(minL, bottomLevel(s) + 1))
      const id = rng.pick(teamsAtLevel(s, level).filter((x) => x !== excludeId))
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

// ---------- koniec sezonu ----------

/** po sezonie: wiek, spadek formy fizycznej u starszych, emerytury, juniorzy */
/** co robią po karierze piłkarze z niższych lig */
const AFTER_CAREER_AMATEUR = [
  'Otwiera warsztat samochodowy.',
  'Przejmuje gospodarstwo po ojcu. Na mecze będzie przyjeżdżał ciągnikiem.',
  'Zostaje trenerem trampkarzy. Już krzyczy na dzieci jak Ty na niego.',
  'Zaczyna sędziować. Szatnia uznaje to za zdradę.',
  'Wyjeżdża do Holandii na budowę. Obiecuje wrócić na mecz oldbojów.',
  'Otwiera budkę z kebabem przy stadionie. Dla drużyny rabat 10%.',
  'Startuje na sołtysa. Hasło wyborcze: „Gram do końca”.',
  'Gra dalej w oldbojach. Mówi, że to zupełnie inna piłka.',
  'Zostaje kierownikiem drużyny. Wreszcie ktoś będzie pamiętał o kluczach.',
  'Prowadzi szkółkę piłkarską w gminie. Zapisało się 40 dzieci i jeden dziadek.',
]
const AFTER_CAREER_PRO = [
  'Zostaje ekspertem w telewizji. Już krytykuje Twoją taktykę.',
  'Dostaje pracę w akademii klubu.',
  'Otwiera agencję menedżerską. Pierwszym klientem jest jego syn.',
  'Zostaje dyrektorem sportowym w klubie z niższej ligi.',
  'Robi kurs trenerski. Mówi, że chce iść Twoją drogą, tylko lepiej.',
  'Zakłada kanał na YouTube o przygotowaniu fizycznym.',
  'Wraca do rodzinnej miejscowości i gra jeszcze sezon w okręgówce, dla przyjemności.',
  'Zostaje skautem. Twierdzi, że widzi talenty, których nikt nie widzi.',
  'Zostaje asystentem trenera w reprezentacji młodzieżowej.',
]

function agePlayers(rng: Rng, s: GameState): string[] {
  const notes: string[] = []
  const level = club(s)?.level ?? 0
  for (const p of s.squad) {
    p.age++
    if (p.age >= 31) {
      const drop = p.age >= 34 ? rng.int(1, 3) : rng.int(0, 2)
      p.skill = Math.max(5, p.skill - (p.traits.includes('weteran') ? Math.max(0, drop - 1) : drop))
    }
    // potencjał młodych nieco się weryfikuje
    if (p.age <= 22 && rng.chance(0.25)) p.potential = clamp(p.potential + rng.int(-3, 3), p.skill, 95)
    p.potential = Math.max(p.potential, p.skill)
    p.goals = 0
    p.assists = 0
    p.apps = 0
    p.ratingSum = 0
    p.yellows = 0
    p.suspendedFor = 0
    p.benchStreak = 0
    p.value = playerValue(p)
  }
  // kończą głównie ci, którym wygasa umowa
  const retiring = s.squad.filter(
    (p) => p.age >= 39 || (p.age >= 35 && rng.chance((p.contract ?? 1) <= 1 ? 0.6 : 0.25)) || (p.age >= 33 && (p.contract ?? 1) <= 1 && rng.chance(0.2)),
  )
  for (const p of retiring) notes.push(`${playerName(p)} (${p.age} l.) kończy karierę. ${rng.pick(level >= 6 ? AFTER_CAREER_PRO : AFTER_CAREER_AMATEUR)}`)
  s.squad = s.squad.filter((p) => !retiring.includes(p))
  for (let i = 0; i < 2; i++) {
    const pos = rng.pick(['OBR', 'POM', 'NAP', 'POM', 'BR'] as Position[])
    const j = generatePlayer(rng, s, level, pos, { age: rng.int(16, 18), skillOffset: -2 })
    j.wage = Math.round(wageFor(j.skill) * 0.5)
    j.contract = 3
    if (s.squad.length < 28) {
      s.squad.push(j)
      notes.push(`Z juniorów awansuje ${playerName(j)} (${j.age} l., ${j.pos}).`)
    }
  }
  s.lineup.xi = s.lineup.xi.filter((id) => s.squad.some((p) => p.id === id))
  s.lineup.bench = s.lineup.bench.filter((id) => s.squad.some((p) => p.id === id))
  return notes
}

export function endSeason(s: GameState): void {
  const summary: string[] = []
  let backTo: number | undefined
  withRng(s, (rng) => {
    for (const lg of s.leagues) for (const round of lg.rounds) for (const f of round) if (f.hg === undefined) playAiFixture(rng, s, f)
    for (const cup of cupsOf(s))
      for (let i = 0; i < cup.schedule.length; i++)
        if (cup.rounds[i] && cup.winner === undefined && !cup.rounds[i].every((t) => t.winner !== undefined)) playCupRound(rng, s, cup, i)
    finishPlayoffs(rng, s)
  })
  // zwycięzca etapu wojewódzkiego gra w przyszłym sezonie w etapie centralnym
  if (s.regionalCup) s.cupQualifier = s.regionalCup.winner
  const t = club(s)
  const tables = new Map(s.leagues.map((lg) => [lg, computeTable(lg)] as const))
  const plan = promotionPlan(s, tables)
  let fired = false
  if (t) {
    const lg = clubLeague(s)!
    const table = tables.get(lg)!
    const pos = table.findIndex((r) => r.teamId === t.id) + 1
    const size = lg.teamIds.length
    const promoted = plan.up.has(t.id)
    // przy barażach awans to awans, a nie samo miejsce w tabeli
    const met =
      s.goal === 'awans' && hasPlayoffs(s, lg.level) ? promoted : goalMet(s.goal, pos, size, lg.level, promotionSlots(s, lg.level), relegationSlots(s, lg))
    const relegated = plan.down.has(t.id)
    let outcome = `${pos}. miejsce`
    if (pos === 1) {
      s.trophies.push(lg.level === 9 ? `Mistrzostwo Polski (sezon ${s.season})` : `Mistrzostwo: ${lg.name} (sezon ${s.season})`)
      outcome += ', mistrzostwo'
    }
    const po = s.playoffs?.find((x) => x.level === lg.level && x.seeds.includes(t.id))
    if (po) outcome += po.winner === t.id ? ', baraże wygrane' : ', baraże przegrane'
    if (promoted) outcome += ', awans'
    if (relegated) outcome += ', spadek'
    const cupText = cupsOf(s)
      .map((cup) => {
        const inCup = cup.rounds.some((r) => r.some((x) => x.home === t.id || x.away === t.id)) || cup.byes?.includes(t.id)
        if (!inCup) return ''
        const stage = cup === s.cup ? 'centralny' : 'wojewódzki'
        if (cup.winner === t.id) return `${stage}: zwycięstwo`
        return cup.eliminatedAt !== undefined ? `${stage}: ${roundName(cup, cup.eliminatedAt)}` : ''
      })
      .filter(Boolean)
      .join(', ') || 'nie grał'
    summary.push(`${t.name}: ${outcome} (${lg.name}). Cel: ${goalLabel(s.goal, lg.level).toLowerCase()}, ${met ? 'wykonany' : 'niewykonany'}.`)
    const repGain = (met ? 4 : -4) + (promoted ? 3 + Math.round(lg.level / 2) : 0) + (pos === 1 ? 2 + Math.round(lg.level / 2) : 0) - (relegated ? 6 : 0)
    adjustCoach(s, { reputation: repGain, stress: met ? -15 : 10 })
    adjustTrust(s, { board: met ? 15 : -20, fans: promoted ? 20 : relegated ? -20 : 0 })
    if (wageBill(s) > s.wageLimit) {
      adjustTrust(s, { board: -8 })
      summary.push('Zarząd jest zły, że pensje przekraczają limit.')
    }
    // mistrza i beniaminka z awansem nikt nie zwalnia, chyba że relacje z prezesem są tragiczne
    if ((s.trust.board < 30 && !met && !promoted && pos !== 1) || s.trust.board < 10) fired = true
    if (s.interim) {
      if (met && s.trust.board >= 10) {
        summary.push('Zastępstwo zdane: zarząd zostawia Cię na stałe w pierwszej drużynie.')
        s.interim = undefined
      } else if (!met) {
        // nie wyszło: wracasz do rezerw zamiast na bruk
        backTo = s.interim.reserveId
        fired = false
      }
    }
    s.history.push({ season: s.season, clubName: t.name, level: lg.level, leagueName: lg.name, position: pos, outcome, cup: cupText, fired })
    for (const p of s.squad) if (!s.bestPlayer || p.skill > s.bestPlayer.skill) s.bestPlayer = { name: playerName(p), skill: p.skill }
    const top = [...s.squad].sort((a, b) => b.goals - a.goals)[0]
    if (top && top.goals > 0) summary.push(`Król strzelców drużyny: ${playerName(top)} (${top.goals} goli).`)
    const bestAvg = [...s.squad].filter((p) => p.apps >= 8).sort((a, b) => b.ratingSum / b.apps - a.ratingSum / a.apps)[0]
    if (bestAvg) summary.push(`Najwyższa średnia ocen: ${playerName(bestAvg)} (${(bestAvg.ratingSum / bestAvg.apps).toFixed(2)}).`)
  } else if (s.onLeave) summary.push('Sezon urlopu: działka, ryby i zero telefonów od prezesów. Ciśnienie wreszcie w normie.')
  else summary.push('Sezon spędzony w roli eksperta w lokalnym radiu. Słuchalność: 37 osób.')
  seasonCoolDown(s)
  const wasOnLeave = !!s.onLeave
  if (!t) {
    s.burnout = 0
    if (s.onLeave) s.coach.stress = Math.min(s.coach.stress, 10)
    s.onLeave = undefined
  }

  for (const po of s.playoffs ?? [])
    if (po.winner !== undefined) summary.push(`${po.title}: wygrywa ${s.teams[po.winner].name}.`)
  s.lastPlayoffs = s.playoffs

  // awanse i spadki we wszystkich ligach i grupach
  for (const m of plan.moves) m.lg.teamIds = m.lg.teamIds.filter((id) => !m.out.includes(id)).concat(m.in)
  withRng(s, (rng) => {
    for (const n of plan.newcomers) n.lg.teamIds.push(...newcomerTeams(rng, s, n.lg, n.count))
  })
  for (const id of plan.up) {
    s.teams[id].level++
    s.teams[id].strength += 2
  }
  for (const id of plan.down) {
    s.teams[id].level--
    s.teams[id].strength -= 2
  }
  withRng(s, (rng) => {
    for (const team of Object.values(s.teams)) {
      const base = LEVELS[team.level].base
      team.strength = Math.round(team.strength + (base + (team.id % 7) - 3 - team.strength) * 0.2 + rng.normal(0, 2.5))
    }
    if (t) {
      summary.push(...returnSentDown(s))
      summary.push(...agePlayers(rng, s))
      summary.push(...seasonContracts(s))
      const last = s.history[s.history.length - 1]
      const lg = clubLeague(s)
      if (lg && last?.position !== undefined && last.position <= 2) {
        const rivals = lg.teamIds.filter((id) => id !== t.id).sort((a, b) => s.teams[b].strength - s.teams[a].strength).slice(0, 3)
        for (const id of rivals) s.teams[id].strength += rng.int(1, 3)
        summary.push(`${s.teams[rivals[0]].name} ogłasza wielkie zakupy. „Nie oddamy wam tej ligi” – mówi ich prezes.`)
      }
    }
  })

  s.coach.age++
  s.coach.savings += t ? s.salary : 2_000
  if (s.coach.courseLeft > 1) {
    s.coach.courseLeft--
    summary.push('Kurs trenerski trwa. Jeszcze jeden sezon zjazdów w weekendy.')
  } else if (s.coach.courseLeft > 0) {
    s.coach.courseLeft = 0
    const next = LICENSES[licenseIndex(s.coach.license) + 1]
    if (next) {
      s.coach.license = next
      summary.push(`Ukończyłeś kurs. Masz licencję ${next}! Zdjęcie z dyplomem trafia na Facebooka klubu.`)
    }
  }

  s.lastSeasonSummary = summary
  if (s.coach.age >= 70) {
    endCareer(s, retirementEnding(s))
    return
  }
  if (backTo !== undefined && (!s.teams[backTo] || !leagueOf(s, backTo))) {
    // rezerw już nie ma w grze (spadły poza nią): po nieudanym zastępstwie nie ma dokąd wracać
    backTo = undefined
    fired = true
  }
  if (t && !fired && backTo === undefined && plan.gone.has(t.id)) {
    // klub spadł do okręgówki, której nie ma w grze
    s.clubId = null
    s.squad = []
    s.reserveSquad = undefined
    s.interim = undefined
    s.hiringNote = `${t.name} spada do okręgówki. Prezes mówi, że na tym szczeblu wystarczy im trener z sąsiedztwa, i oddaje Ci kluczyki do szatni.`
    s.offers = generateOffers(s, t.level + 1, false, t.id)
  } else if (t && fired) {
    s.totalStats.firedCount++
    adjustCoach(s, { reputation: -5 })
    s.clubId = null
    s.squad = []
    s.hiringNote = `Zarząd ${t.name} podziękował Ci za współpracę. Na pożegnanie dostałeś szalik i kosz owocowy.`
    s.offers = generateOffers(s, t.level, true, t.id)
  } else if (t && backTo !== undefined) {
    const res = s.teams[backTo]
    const rlg = leagueOf(s, backTo)!
    takeJob(s, { teamId: backTo, teamName: res.name, level: res.level, leagueName: rlg.name, goal: 'środek', salary: Math.round((s.salary * 0.6) / 1000) * 1000, note: '' })
    s.lastSeasonSummary = [...summary, `${t.name} nie osiągnęła celu. Wracasz do ${res.name}, w rezerwach czekają z kawą.`]
    s.offers = generateOffers(s, res.level, false, res.id)
  } else if (t) s.offers = generateOffers(s, t.level, false, t.id)
  else {
    // bez pracy: oferty z okolic ostatniego klubu, coraz rzadsze z każdym sezonem przerwy
    const lastLevel = s.history[s.history.length - 1]?.level ?? bottomLevel(s)
    s.offers = generateOffers(s, lastLevel, true)
    if (!wasOnLeave && (s.seasonsUnemployed >= 3 || (s.seasonsUnemployed >= 2 && !s.offers.length))) {
      endCareer(s, unemployedEnding(s))
      return
    }
    s.hiringNote = wasOnLeave
      ? 'Wracasz wypoczęty. Prezesi pamiętają, że zniknąłeś, ale niektórzy i tak dzwonią.'
      : s.offers.length
        ? `Sezon bez pracy (${s.seasonsUnemployed}). Ktoś jednak zadzwonił.`
        : `Telefon milczy. Jeszcze ${s.seasonsUnemployed >= 2 ? 'jedna taka cisza' : 'kilka miesięcy ciszy'} i zostaje Ci sklep wędkarski.`
  }
  startNewSeasonWorld(s)
  s.phase = 'seasonEnd'
}

function startNewSeasonWorld(s: GameState): void {
  s.asksThisSeason = 0
  s.season++
  s.round = 0
  s.winterWindowDone = false
  s.modifiers = []
  s.streak = []
  withRng(s, (rng) => {
    for (const lg of s.leagues) lg.rounds = makeFixtures(rng, lg.teamIds)
  })
  drawCups(s)
  s.playoffs = []
  s.reports = []
}

export function stayAtClub(s: GameState): void {
  const t = club(s)
  if (!t) return
  if (!licenseStatus(s)!.canStay) return
  const lg = clubLeague(s)!
  s.goal = goalFromRank(rankByStrength(s, lg, t.id), lg.teamIds.length)
  // beniaminek nie dostaje od razu budżetu jak ligowi wyjadacze: sponsorzy i kibice muszą dopiero dorosnąć do nowej ligi
  const last = s.history[s.history.length - 1]
  const promoted = !!last && last.clubName === t.name && last.outcome.includes('awans')
  const factor = promoted ? 0.5 : 0.8 + s.trust.board / 250
  s.budget = Math.round(LEVELS[t.level].budget * factor) + Math.round(Math.max(0, s.budget) * 0.3)
  s.salary = Math.round(Math.max(s.salary, LEVELS[t.level].salary * (0.8 + s.coach.reputation / 200)) / 1000) * 1000
  // limit pensji rośnie stopniowo, żeby po awansie nie dało się od razu kupić nowej drużyny
  s.wageLimit = promoted ? Math.max(s.wageLimit, Math.min(wageLimitFor(t), Math.round((s.wageLimit * 1.35) / 100) * 100)) : Math.max(s.wageLimit, wageLimitFor(t))
  if (promoted) news(s, `Beniaminek ${LEVELS[t.level].name}: budżet ${formatMoney(s.budget)}, limit pensji ${formatMoney(s.wageLimit)}/mies. Sponsorzy jeszcze się rozglądają.`)
  s.trust.board = clamp(s.trust.board, 45, 80)
  s.offers = []
  const lic = licenseStatus(s)!
  if (lic.ok) s.figurant = 0
  else if (lic.studying) news(s, `Ta liga wymaga licencji ${lic.need}. Związek wydaje zgodę warunkową, bo jesteś na kursie. Byle zdać.`)
  else {
    s.figurant = (s.figurant ?? 0) + 1
    s.budget -= lic.cost
    adjustTrust(s, { board: -6 })
    news(
      s,
      `Ta liga wymaga licencji ${lic.need}. Klub zgłasza do rozgrywek trenera z licencją „na papierze” (${formatMoney(lic.cost)} z budżetu), a Ty oficjalnie jesteś asystentem. Zapisz się na kurs, bo drugi taki sezon związek nie przepuści.`,
    )
  }
  refreshReserves(s)
  openWindow(s)
  news(s, `Sezon ${s.season}: zostajesz w ${t.name}. Cel: ${goalLabel(s.goal, t.level).toLowerCase()}.`)
}

export function acceptOffer(s: GameState, teamId: number): void {
  const offer = s.offers.find((o) => o.teamId === teamId)
  if (offer) takeJob(s, offer)
}

/** zarząd przy dobrych relacjach opłaca kurs, gdy po awansie liga wymaga wyższej licencji */
export const BOARD_PAYS_COURSE = 60

export function boardPaysCourse(s: GameState): boolean {
  const lic = licenseStatus(s)
  return !!lic && !lic.ok && !lic.studying && s.coach.courseLeft === 0 && s.trust.board >= BOARD_PAYS_COURSE && !!LICENSES[licenseIndex(s.coach.license) + 1]
}

export function startLicenseCourse(s: GameState, sponsored = false): string {
  const next = LICENSES[licenseIndex(s.coach.license) + 1]
  if (!next) return 'Masz już najwyższą licencję.'
  const course = LICENSE_COURSES[next]!
  if (s.coach.courseLeft > 0) return 'Już jesteś na kursie.'
  if (sponsored && boardPaysCourse(s)) {
    // klub płaci i załatwia miejsce na kursie, więc reputacja nie gra roli
    adjustTrust(s, { board: -3 })
    s.coach.courseLeft = next === 'UEFA A' || next === 'UEFA Pro' ? 2 : 1
    const msg = `Prezes płaci za kurs ${next} (${formatMoney(course.cost)}). „Awansowaliśmy razem, to i papiery zrobimy razem”. Dyplom po ${s.coach.courseLeft === 1 ? 'zakończeniu sezonu' : 'dwóch sezonach'}.`
    news(s, msg)
    return msg
  }
  if (s.coach.reputation < course.rep) return `Na kurs ${next} potrzebujesz reputacji ${course.rep}.`
  if (s.coach.savings < course.cost) return `Kurs ${next} kosztuje ${formatMoney(course.cost)}. Nie stać Cię.`
  s.coach.savings -= course.cost
  // UEFA A i Pro trwają dwa sezony, jak w prawdziwej szkole trenerów
  s.coach.courseLeft = next === 'UEFA A' || next === 'UEFA Pro' ? 2 : 1
  return `Zapisałeś się na kurs ${next}. Dyplom po ${s.coach.courseLeft === 1 ? 'zakończeniu sezonu' : 'dwóch sezonach'}.`
}

export function endCareer(s: GameState, ending: CareerEnding): void {
  s.ending = ending
  s.retireReason = ending.text
  s.pendingEvent = undefined
  s.resumePhase = undefined
  s.phase = 'retired'
}

/** trener sam kończy karierę */
export function retire(s: GameState, reason: string): void {
  endCareer(s, choiceEnding(s, reason))
}

export function careerCard(s: GameState) {
  const best = [...s.history].sort((a, b) => b.level - a.level || (a.position ?? 99) - (b.position ?? 99))[0]
  const total = s.totalStats.w + s.totalStats.d + s.totalStats.l
  return {
    name: `${s.coach.firstName} ${s.coach.lastName}`,
    firstName: s.coach.firstName,
    lastName: s.coach.lastName,
    age: s.coach.age,
    region: s.coach.region,
    license: s.coach.license,
    reputation: s.coach.reputation,
    seasons: s.history.length,
    clubs: [...new Set(s.history.map((h) => h.clubName))],
    peak: best ? `${best.leagueName} (${best.clubName})` : 'brak',
    trophies: s.trophies,
    // przy aferze w gazecie to ona jest aferą kariery
    scandal: s.ending?.headline ?? s.scandals[s.scandals.length - 1],
    bestPlayer: s.bestPlayer,
    record: `${s.totalStats.w}Z ${s.totalStats.d}R ${s.totalStats.l}P`,
    winPct: total ? Math.round((s.totalStats.w / total) * 100) : 0,
    fired: s.totalStats.firedCount,
    press: pressQuote(s),
    path: s.history.map((h) => h.level),
    reason: s.retireReason ?? '',
    ending: s.ending,
    lastWord: s.ending?.lastWord,
  }
}

