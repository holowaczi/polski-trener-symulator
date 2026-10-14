import { COACH_QUOTES, LEVELS, LICENSES, LICENSE_COURSES, RESERVE_MAX_LEVEL, SWAPS } from './data'
import { EVENTS, type GameEvent } from './events'
import { departureEffects, generateBids, makeBid, refreshTransferList, renewWages, wageLimitFor } from './market'
import { aiStrength, autoLineup, playClubMatch, previewStrength, simulateScore } from './match'
import type { Rng } from './rng'
import type { CupTie, Fixture, GameState, GoalType, JobOffer, League, Player, Position, TableRow } from './types'
import { adjustCoach, adjustTrust, club, clubLeague, formatMoney, news, setMorale, wageBill, withRng } from './util'
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
  wageFor,
} from './world'

export { club, clubLeague, formatMoney } from './util'

export const SAVE_VERSION = 2
/** najdłuższa liga ma 34 kolejki; krótsze kończą wcześniej */
export const SEASON_WEEKS = 34

// ---------- cele i licencje ----------

export function goalLabel(goal: GoalType, level: number): string {
  if (goal === 'awans') return level === 7 ? 'Mistrzostwo Polski' : 'Awans'
  if (goal === 'czołówka') return 'Czołowa czwórka'
  if (goal === 'środek') return 'Górna połowa tabeli'
  return 'Utrzymanie'
}

export function goalMet(goal: GoalType, pos: number, size: number, level: number): boolean {
  if (goal === 'awans') return level === 7 ? pos === 1 : pos <= (SWAPS[level] ?? 2)
  if (goal === 'czołówka') return pos <= 4
  if (goal === 'środek') return pos <= Math.ceil(size / 2)
  return pos <= size - (SWAPS[level - 1] ?? 2)
}

const REP_NEEDED = [0, 6, 14, 24, 35, 48, 62, 76]

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
  s.cup = withRng(s, (rng) => drawCup(rng, s, SEASON_WEEKS))
  const bklasa = s.leagues[0]
  const picks = withRng(s, (rng) => rng.shuffle([...bklasa.teamIds]).slice(0, 3))
  s.offers = picks.map((id) => makeOffer(s, id, 'Szukają trenera od zaraz. Poprzedni wyjechał do Holandii na szparagi.'))
  s.hiringNote = `Masz ${input.age} lat, licencję UEFA C i kontakty w województwie ${input.region}. Trzy kluby z najniższej ligi dzwonią.`
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
  s.modifiers = []
  s.streak = []
  s.bids = []
  const offset = team.strength - LEVELS[team.level].base
  s.squad = withRng(s, (rng) => {
    const sq = generateSquad(rng, s, team.level, offset - 2)
    // syn prezesa to tradycja klubowa
    if (team.level <= 4 && !team.reserve && rng.chance(0.7)) {
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
  s.tactic = { formation: '4-4-2', mentality: 'balans', style: team.level <= 2 ? 'laga' : 'kontra' }
  s.lineup = { auto: true, xi: [], bench: [] }
  fillLineupFromAuto(s)
  refreshTransferList(s)
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
  return cupTieForWeek(s, week) !== undefined
}

function cupTieForWeek(s: GameState, week: number): CupTie | undefined {
  const idx = s.cup.schedule.indexOf(week)
  if (idx < 0) return undefined
  return s.cup.rounds[idx]?.find((t) => t.home === s.clubId || t.away === s.clubId)
}

export function playWeek(s: GameState): void {
  if (s.phase !== 'season') return
  const week = s.round
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
    const mine = s.clubId !== null && (t.home === s.clubId || t.away === s.clubId)
    if (mine) {
      const rep = playClubMatch(rng, s, t, true)
      t.hg = rep.hg
      t.ag = rep.ag
      s.reports.unshift(rep)
    } else playAiFixture(rng, s, t, true)
    if (t.hg! > t.ag!) t.winner = t.home
    else if (t.hg! < t.ag!) t.winner = t.away
    else {
      const homeWins = rng.chance(0.5)
      const a = rng.int(3, 5)
      const b = Math.max(0, a - 1 - (rng.chance(0.3) ? 1 : 0))
      t.pens = homeWins ? `${a}:${b}` : `${b}:${a}`
      t.winner = homeWins ? t.home : t.away
    }
    winners.push(t.winner)
    if (mine) {
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
      adjustCoach(s, { reputation: 10, stress: -20 })
      news(s, 'PUCHAR POLSKI JEST NASZ! Kibice wnoszą trenera do autobusu.')
    } else news(s, `Puchar Polski zdobywa ${s.teams[winners[0]].name}.`)
  } else s.cup.rounds[idx + 1] = pairUp(rng, s.teams, winners)
}

function afterWeek(s: GameState): void {
  if (s.clubId === null) return
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
  if (isSeasonOver(s)) {
    endSeason(s)
    return
  }
  // maks. jedno wydarzenie na mecz: tylko po tygodniu, w którym klub grał
  if (hasClubMatch(s, s.round - 1)) maybeEvent(s)
}

function openWindow(s: GameState): void {
  refreshTransferList(s)
  generateBids(s)
  s.phase = 'transfer'
}

export function isSeasonOver(s: GameState): boolean {
  for (let w = s.round; w < SEASON_WEEKS; w++) if (hasClubMatch(s, w)) return false
  return true
}

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
  let guard = 0
  while (s.phase === 'season' && guard++ < 40) playNext(s)
}

// ---------- zdarzenia ----------

function pickEvent(rng: Rng, s: GameState): { ev: GameEvent; player?: Player } | undefined {
  const level = club(s)!.level
  const pool: { ev: GameEvent; players?: Player[] }[] = []
  for (const e of EVENTS) {
    if ((e.minLevel ?? 0) > level || (e.maxLevel ?? 7) < level) continue
    if (e.once && s.usedEvents.includes(e.id)) continue
    if (s.usedEvents.slice(-14).includes(e.id)) continue
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

function maybeEvent(s: GameState): void {
  if (s.phase !== 'season') return
  withRng(s, (rng) => {
    // w trakcie sezonu czasem przychodzi oferta za zawodnika (np. z zagranicy)
    if (rng.chance(0.06)) {
      const star = [...s.squad].filter((p) => p.apps >= 3).sort((a, b) => b.ratingSum / b.apps - a.ratingSum / a.apps)[0]
      if (star && star.ratingSum / star.apps >= 6.9) {
        const bid = makeBid(rng, s, star)
        if (bid) {
          const foreign = rng.chance(0.35)
          const fee = foreign ? Math.round(bid.fee * 1.3) : bid.fee
          const fIdx = rng.int(0, FOREIGN_CLUBS.length - 1)
          const buyer = foreign ? FOREIGN_CLUBS[fIdx] : s.teams[bid.teamId].name
          s.pendingEvent = {
            eventId: 'bid',
            playerId: star.id,
            data: { fee, teamId: foreign ? -1 - fIdx : bid.teamId },
            text: `${buyer} składa ofertę za ${playerName(star)}: ${formatMoney(fee)}. Zawodnik ma średnią ocen ${(star.ratingSum / star.apps).toFixed(2)} i wyraźnie się ekscytuje.`,
            options: [{ label: 'Sprzedaj' }, { label: 'Odrzuć ofertę' }, { label: 'Żądaj więcej' }],
          }
          s.resumePhase = 'season'
          s.phase = 'event'
          return
        }
      }
    }
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
  if (pe.eventId === 'bid') text = resolveSeasonBid(s, pe.playerId!, pe.data!.fee, pe.data!.teamId, optionIndex)
  else {
    const ev = EVENTS.find((e) => e.id === pe.eventId)!
    const player = s.squad.find((p) => p.id === pe.playerId)
    const result = withRng(s, (rng) => ev.options[optionIndex].apply({ s, rng, p: player }))
    text = fillText(s, result, player)
  }
  news(s, text)
  s.pendingEvent = undefined
  s.phase = s.resumePhase ?? 'season'
  s.resumePhase = undefined
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

export function finishTransfers(s: GameState): void {
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
  s.clubId = null
  s.squad = []
  s.transferList = []
  s.bids = []
  s.modifiers = []
  s.pendingEvent = undefined
  s.hiringNote = `${why} Kilka klubów i tak dzwoni, bo trenerów jest mniej niż boisk.`
  s.offers = generateOffers(s, t.level, true, t.id)
  s.phase = 'hiring'
}

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
  adjustCoach(s, { stress: -25 })
  endSeason(s)
}

function generateOffers(s: GameState, aroundLevel: number, afterFiring: boolean, excludeId?: number): JobOffer[] {
  return withRng(s, (rng) => {
    const offers: JobOffer[] = []
    const rep = s.coach.reputation
    const minL = Math.max(0, aroundLevel - (afterFiring ? 2 : 1))
    // najwyżej szczebel wyżej: prezesi z wyższych lig rzadko ryzykują trenera prosto z dołu
    const maxL = Math.min(7, aroundLevel + (afterFiring ? 0 : 1))
    for (let level = maxL; level >= minL; level--) {
      if (!licenseAllows(s, level)) continue
      const lg = s.leagues[level]
      const cands = lg.teamIds.filter((x) => x !== s.clubId && x !== excludeId)
      // wielkie kluby wymagają większej reputacji
      const id = rng.pick(cands)
      const need = REP_NEEDED[level] + Math.max(0, s.teams[id].strength - LEVELS[level].base) * 1.5
      const p = rep >= need + 8 ? 0.9 : rep >= need ? 0.6 : rep >= need - 6 ? 0.25 : 0
      if (!rng.chance(p)) continue
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

// ---------- koniec sezonu ----------

/** po sezonie: wiek, spadek formy fizycznej u starszych, emerytury, juniorzy */
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
  const retiring = s.squad.filter((p) => (p.age >= 35 && rng.chance(0.5)) || p.age >= 39)
  for (const p of retiring) notes.push(`${playerName(p)} (${p.age} l.) kończy karierę. Otwiera warsztat samochodowy.`)
  s.squad = s.squad.filter((p) => !retiring.includes(p))
  for (let i = 0; i < 2; i++) {
    const pos = rng.pick(['OBR', 'POM', 'NAP', 'POM', 'BR'] as Position[])
    const j = generatePlayer(rng, s, level, pos, { age: rng.int(16, 18), skillOffset: -2 })
    j.wage = Math.round(wageFor(j.skill) * 0.5)
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
  withRng(s, (rng) => {
    for (const lg of s.leagues) for (const round of lg.rounds) for (const f of round) if (f.hg === undefined) playAiFixture(rng, s, f)
    for (let i = 0; i < s.cup.schedule.length; i++)
      if (s.cup.rounds[i] && s.cup.winner === undefined && !s.cup.rounds[i].every((t) => t.winner !== undefined)) playCupRound(rng, s, i)
  })
  const t = club(s)
  const tables = s.leagues.map((lg) => computeTable(lg))
  let fired = false
  if (t) {
    const lg = clubLeague(s)!
    const table = tables[lg.level]
    const pos = table.findIndex((r) => r.teamId === t.id) + 1
    const size = lg.teamIds.length
    const met = goalMet(s.goal, pos, size, lg.level)
    const promoted = lg.level < 7 && pos <= SWAPS[lg.level] && !(t.reserve && lg.level >= RESERVE_MAX_LEVEL)
    const relegated = lg.level > 0 && pos > size - SWAPS[lg.level - 1]
    let outcome = `${pos}. miejsce`
    if (pos === 1) {
      s.trophies.push(lg.level === 7 ? `Mistrzostwo Polski (sezon ${s.season})` : `Mistrzostwo: ${lg.name} (sezon ${s.season})`)
      outcome += ', mistrzostwo'
    }
    if (promoted) outcome += ', awans'
    if (relegated) outcome += ', spadek'
    const cupText =
      s.cup.winner === t.id
        ? 'zwycięstwo'
        : s.cup.eliminatedAt !== undefined
          ? `odpadł: ${cupRoundName(s.cup.eliminatedAt)}`
          : 'nie grał'
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
    s.history.push({ season: s.season, clubName: t.name, level: lg.level, leagueName: lg.name, position: pos, outcome, cup: cupText, fired })
    for (const p of s.squad) if (!s.bestPlayer || p.skill > s.bestPlayer.skill) s.bestPlayer = { name: playerName(p), skill: p.skill }
    const top = [...s.squad].sort((a, b) => b.goals - a.goals)[0]
    if (top && top.goals > 0) summary.push(`Król strzelców drużyny: ${playerName(top)} (${top.goals} goli).`)
    const bestAvg = [...s.squad].filter((p) => p.apps >= 8).sort((a, b) => b.ratingSum / b.apps - a.ratingSum / a.apps)[0]
    if (bestAvg) summary.push(`Najwyższa średnia ocen: ${playerName(bestAvg)} (${(bestAvg.ratingSum / bestAvg.apps).toFixed(2)}).`)
  } else summary.push('Sezon spędzony w roli eksperta w lokalnym radiu. Słuchalność: 37 osób.')

  // awanse i spadki we wszystkich ligach
  for (let level = 0; level < 7; level++) {
    const n = SWAPS[level]
    const lower = s.leagues[level]
    const upper = s.leagues[level + 1]
    const eligible = tables[level].filter((r) => !(s.teams[r.teamId].reserve && level + 1 > RESERVE_MAX_LEVEL))
    const up = eligible.slice(0, n).map((r) => r.teamId)
    const down = tables[level + 1].slice(-n).map((r) => r.teamId)
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
      team.strength = Math.round(team.strength + (base + (team.id % 7) - 3 - team.strength) * 0.2 + rng.normal(0, 2.5))
    }
    if (t) {
      summary.push(...agePlayers(rng, s))
      summary.push(...renewWages(s))
      const last = s.history[s.history.length - 1]
      if (last?.position !== undefined && last.position <= 2) {
        const lg = clubLeague(s)!
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
    retire(s, 'Siedemdziesiątka na karku. Czas na działkę i komentowanie meczów z pilotem w ręku.')
    return
  }
  if (t && fired) {
    s.totalStats.firedCount++
    adjustCoach(s, { reputation: -5 })
    s.clubId = null
    s.squad = []
    s.hiringNote = `Zarząd ${t.name} podziękował Ci za współpracę. Na pożegnanie dostałeś szalik i kosz owocowy.`
    s.offers = generateOffers(s, t.level, true, t.id)
  } else s.offers = generateOffers(s, t ? t.level : 1, false, t?.id)
  startNewSeasonWorld(s)
  s.phase = 'seasonEnd'
}

function startNewSeasonWorld(s: GameState): void {
  s.season++
  s.round = 0
  s.winterWindowDone = false
  s.modifiers = []
  s.streak = []
  withRng(s, (rng) => {
    for (const lg of s.leagues) lg.rounds = makeFixtures(rng, lg.teamIds)
  })
  s.cup = withRng(s, (rng) => drawCup(rng, s, SEASON_WEEKS))
  s.reports = []
}

export function stayAtClub(s: GameState): void {
  const t = club(s)
  if (!t) return
  const lg = clubLeague(s)!
  s.goal = goalFromRank(rankByStrength(s, lg, t.id), lg.teamIds.length)
  s.budget = Math.round(LEVELS[t.level].budget * (0.8 + s.trust.board / 250)) + Math.round(Math.max(0, s.budget) * 0.3)
  s.salary = Math.round(Math.max(s.salary, LEVELS[t.level].salary * (0.8 + s.coach.reputation / 200)) / 1000) * 1000
  s.wageLimit = Math.max(s.wageLimit, wageLimitFor(t))
  s.trust.board = clamp(s.trust.board, 45, 80)
  s.offers = []
  openWindow(s)
  news(s, `Sezon ${s.season}: zostajesz w ${t.name}. Cel: ${goalLabel(s.goal, t.level).toLowerCase()}.`)
}

export function acceptOffer(s: GameState, teamId: number): void {
  const offer = s.offers.find((o) => o.teamId === teamId)
  if (offer) takeJob(s, offer)
}

export function startLicenseCourse(s: GameState): string {
  const next = LICENSES[licenseIndex(s.coach.license) + 1]
  if (!next) return 'Masz już najwyższą licencję.'
  const course = LICENSE_COURSES[next]!
  if (s.coach.courseLeft > 0) return 'Już jesteś na kursie.'
  if (s.coach.reputation < course.rep) return `Na kurs ${next} potrzebujesz reputacji ${course.rep}.`
  if (s.coach.savings < course.cost) return `Kurs ${next} kosztuje ${formatMoney(course.cost)}. Nie stać Cię.`
  s.coach.savings -= course.cost
  // UEFA A i Pro trwają dwa sezony, jak w prawdziwej szkole trenerów
  s.coach.courseLeft = next === 'UEFA A' || next === 'UEFA Pro' ? 2 : 1
  return `Zapisałeś się na kurs ${next}. Dyplom po ${s.coach.courseLeft === 1 ? 'zakończeniu sezonu' : 'dwóch sezonach'}.`
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

