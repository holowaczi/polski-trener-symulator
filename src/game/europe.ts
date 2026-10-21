import { EURO_CLUBS, type EuroClub } from './euroClubs'
import { playClubMatch, simulateScore } from './match'
import type { Rng } from './rng'
import type { EuroComp, EuroLeague, EuroRun, EuroStage, EuroTie, Fixture, GameState, MatchReport, PendingEvent } from './types'
import { adjustCoach, adjustTrust, computeTable, formatMoney, news, setMorale } from './util'

export { countryFlag } from './euroClubs'

/**
 * Europejskie puchary: mistrz Polski gra w eliminacjach Ligi Mistrzów, zdobywca Pucharu Polski w Lidze Europy,
 * a 2. i 3. drużyna Ekstraklasy w Lidze Konferencji. Rywale to prawdziwe kluby z całej Europy.
 * Eliminacje i faza pucharowa to dwumecze, faza ligowa to 36 drużyn i jedna tabela, a każdy mecz klubu gracza grany jest osobno.
 */

export const COMP_NAME: Record<EuroComp, string> = { LM: 'Liga Mistrzów', LE: 'Liga Europy', LKE: 'Liga Konferencji' }
/** dopełniacz: „faza ligowa Ligi Europy” */
export const COMP_GEN: Record<EuroComp, string> = { LM: 'Ligi Mistrzów', LE: 'Ligi Europy', LKE: 'Ligi Konferencji' }
export const COMP_ICON: Record<EuroComp, string> = { LM: '⭐', LE: '🟠', LKE: '🟢' }

export const STAGE_NAME: Record<EuroStage, string> = {
  Q2: 'II runda eliminacji',
  Q3: 'III runda eliminacji',
  PO: 'Runda play-off',
  KPO: 'Baraże o 1/8 finału',
  R16: '1/8 finału',
  QF: 'Ćwierćfinał',
  SF: 'Półfinał',
  F: 'Finał',
}

/** tygodnie meczów: eliminacje latem, faza ligowa jesienią i tuż po przerwie zimowej, faza pucharowa wiosną; zawsze poza tygodniami Pucharu Polski */
export const STAGE_WEEKS: Record<EuroStage, number[]> = {
  Q2: [0, 1],
  Q3: [2, 4],
  PO: [5, 6],
  KPO: [19, 20],
  R16: [22, 23],
  QF: [24, 25],
  SF: [27, 28],
  F: [32],
}
/** kolejki fazy ligowej: osiem w Lidze Mistrzów i Lidze Europy, sześć w Lidze Konferencji */
export const LEAGUE_WEEKS: Record<EuroComp, number[]> = {
  LM: [8, 9, 10, 12, 13, 14, 17, 18],
  LE: [8, 9, 10, 12, 13, 14, 17, 18],
  LKE: [8, 9, 10, 12, 13, 14],
}
export const LEAGUE_TEAMS = 36

const FIRST_STAGE: Record<EuroComp, EuroStage> = { LM: 'Q2', LE: 'Q3', LKE: 'Q2' }
const NEXT_STAGE: Partial<Record<EuroStage, EuroStage>> = { Q2: 'Q3', Q3: 'PO', KPO: 'R16', R16: 'QF', QF: 'SF', SF: 'F' }
const QUALIFYING: EuroStage[] = ['Q2', 'Q3', 'PO']
const REACHED: Record<EuroStage, number> = { Q2: 0, Q3: 0, PO: 0, KPO: 2, R16: 3, QF: 4, SF: 5, F: 6 }
/** kto odpadnie z eliminacji, gra dalej w słabszych rozgrywkach */
const LOWER: Partial<Record<EuroComp, EuroComp>> = { LM: 'LE', LE: 'LKE' }

/** siła rywali w eliminacjach (skala meczów drużyny gracza: czołówka Ekstraklasy gra na ok. 77–85) */
const QUAL_STRENGTH: Record<EuroStage, number> = { Q2: 68, Q3: 71, PO: 74, KPO: 0, R16: 0, QF: 0, SF: 0, F: 0 }
const COMP_BONUS: Record<EuroComp, number> = { LKE: 0, LE: 3, LM: 6 }

/** premie od UEFA w zł: za wygrany dwumecz w eliminacjach, za fazę ligową, za zwycięstwo w niej i za każdą rundę fazy pucharowej */
const PRIZE = {
  qual: { LM: 300_000, LE: 200_000, LKE: 100_000 },
  league: { LM: 1_500_000, LE: 800_000, LKE: 400_000 },
  win: { LM: 120_000, LE: 60_000, LKE: 30_000 },
  ko: { LM: 800_000, LE: 400_000, LKE: 200_000 },
}

// ---------- kluby ----------

/** klub z listy jako drużyna w grze; ten sam klub w jednym sezonie to zawsze ta sama drużyna */
function teamFor(rng: Rng, s: GameState, c: EuroClub): number {
  const existing = Object.values(s.teams).find((t) => t.country && t.name === c.name)
  if (existing) return existing.id
  const id = s.nextId++
  // forma sezonu: ten sam klub raz jest mocniejszy, raz słabszy
  s.teams[id] = { id, name: c.name, town: c.name, level: 9, strength: Math.round(c.strength + rng.normal(0, 1.5)), real: true, country: c.country }
  return id
}

/** rywal w eliminacjach: losowo spośród klubów o sile najbliższej docelowej, z którymi jeszcze nie graliśmy */
function qualifyingOpponent(rng: Rng, s: GameState, run: EuroRun, target: number): number {
  const faced = new Set(run.ties.map((t) => s.teams[t.opp]?.name))
  const near = EURO_CLUBS.filter((c) => !faced.has(c.name))
    .sort((a, b) => Math.abs(a.strength - target) - Math.abs(b.strength - target))
    .slice(0, 5)
  return teamFor(rng, s, rng.pick(near))
}

/** uczestnicy fazy ligowej (bez nas): Liga Mistrzów ma całą elitę, Liga Europy mocny środek, Liga Konferencji resztę */
function leagueField(rng: Rng, s: GameState, comp: EuroComp): number[] {
  const sorted = [...EURO_CLUBS].sort((a, b) => b.strength - a.strength)
  let picked: EuroClub[]
  if (comp === 'LM') picked = [...sorted.slice(0, 24), ...rng.shuffle(sorted.slice(24).filter((c) => c.strength >= 78)).slice(0, 11)]
  else {
    const [lo, hi] = comp === 'LE' ? [81, 91] : [73, 86]
    const pool = rng.shuffle(sorted.filter((c) => c.strength >= lo && c.strength <= hi))
    picked = pool.slice(0, LEAGUE_TEAMS - 1)
  }
  return picked.map((c) => teamFor(rng, s, c))
}

// ---------- kwalifikacja i losowanie ----------

/**
 * Miejsca w Europie na kolejny sezon, jak w Polsce: mistrz do Ligi Mistrzów, zdobywca Pucharu Polski do Ligi Europy,
 * 2. i 3. drużyna do Ligi Konferencji. Gdy zdobywca pucharu jest mistrzem, Liga Europy przechodzi na 2. miejsce, a dalej w dół.
 */
export function euroSpotsFor(table: number[], cupWinner?: number): { teamId: number; comp: EuroComp }[] {
  if (!table.length) return []
  const spots: { teamId: number; comp: EuroComp }[] = [{ teamId: table[0], comp: 'LM' }]
  if (cupWinner !== undefined && cupWinner !== table[0]) spots.push({ teamId: cupWinner, comp: 'LE' })
  for (const id of table.slice(1)) {
    if (spots.length >= 4) break
    if (id === cupWinner) continue
    spots.push({ teamId: id, comp: spots.length === 1 ? 'LE' : 'LKE' })
  }
  return spots
}

/** przed sezonem: jeśli klub gracza wywalczył Europę, losujemy pierwszego rywala */
export function drawEuro(rng: Rng, s: GameState): void {
  // już wylosowane dla tego klubu w tym sezonie
  if (s.euro?.season === s.season && s.euro.teamId === s.clubId) return
  // kluby z poprzednich pucharów znikają
  for (const t of Object.values(s.teams)) if (t.country) delete s.teams[t.id]
  s.euro = undefined
  const spot = s.euroSpots?.find((x) => x.teamId === s.clubId)
  if (!spot || s.round !== 0) return
  s.euro = { teamId: spot.teamId, season: s.season, comp: spot.comp, ties: [], reached: 0 }
  const tie = addTie(rng, s, s.euro, FIRST_STAGE[spot.comp])
  news(s, `Europa czeka! ${COMP_NAME[spot.comp]}, ${lower(STAGE_NAME[tie.stage])}: ${oppLabel(s, tie.opp)}. Kierownik drużyny szuka paszportów.`)
}

function legsFor(rng: Rng, me: number, opp: number, single: boolean): Fixture[] {
  const homeFirst = rng.chance(0.5)
  // finał na neutralnym stadionie, ale ktoś musi być gospodarzem w protokole
  if (single) return [homeFirst ? { home: me, away: opp } : { home: opp, away: me }]
  return homeFirst
    ? [
        { home: me, away: opp },
        { home: opp, away: me },
      ]
    : [
        { home: opp, away: me },
        { home: me, away: opp },
      ]
}

function addTie(rng: Rng, s: GameState, run: EuroRun, stage: EuroStage, opp?: number): EuroTie {
  const weeks = STAGE_WEEKS[stage]
  const rival = opp ?? qualifyingOpponent(rng, s, run, QUAL_STRENGTH[stage] + COMP_BONUS[run.comp] + rng.normal(0, 2.5))
  const tie: EuroTie = { stage, comp: run.comp, opp: rival, weeks, legs: legsFor(rng, run.teamId, rival, weeks.length === 1) }
  run.ties.push(tie)
  return tie
}

function oppLabel(s: GameState, id: number): string {
  const t = s.teams[id]
  return t ? `${t.name}${t.country ? ` (${t.country})` : ''}` : 'rywal'
}

const lower = (text: string) => text[0].toLowerCase() + text.slice(1)

// ---------- faza ligowa ----------

/** losowanie fazy ligowej: 36 drużyn, każda kolejka to 18 meczów, nasi rywale się nie powtarzają */
function enterLeaguePhase(rng: Rng, s: GameState, run: EuroRun): void {
  const comp = run.comp
  const me = run.teamId
  const others = leagueField(rng, s, comp)
  const weeks = LEAGUE_WEEKS[comp]
  const rivals = rng.shuffle([...others]).slice(0, weeks.length)
  const homeFirst = rng.chance(0.5)
  const rounds: Fixture[][] = weeks.map((_, i) => {
    const opp = rivals[i]
    const mine = (i % 2 === 0) === homeFirst ? { home: me, away: opp } : { home: opp, away: me }
    const rest = rng.shuffle(others.filter((id) => id !== opp))
    const round: Fixture[] = [mine]
    for (let j = 0; j + 1 < rest.length; j += 2) round.push({ home: rest[j], away: rest[j + 1] })
    return round
  })
  run.league = { comp, teamIds: [me, ...others], rounds, weeks }
  run.reached = Math.max(run.reached, 1)
  s.budget += PRIZE.league[comp]
  adjustCoach(s, { reputation: 3 })
  adjustTrust(s, { board: 6, fans: 6 })
}

/** tabela fazy ligowej */
export function euroTable(lp: EuroLeague) {
  return computeTable(lp)
}

function playLeagueRound(rng: Rng, s: GameState, run: EuroRun, idx: number, push: (rep: MatchReport) => void): void {
  const lp = run.league!
  const comp = lp.comp
  for (const f of lp.rounds[idx]) {
    if (f.hg !== undefined) continue
    if (f.home === run.teamId || f.away === run.teamId) {
      const rep = playClubMatch(rng, s, f, true)
      rep.euro = true
      rep.comp = comp
      rep.cupName = `${COMP_NAME[comp]} · Faza ligowa · ${idx + 1}. kolejka`
      f.hg = rep.hg
      f.ag = rep.ag
      push(rep)
      if (f.hg !== f.ag && (f.hg > f.ag) === (f.home === run.teamId)) s.budget += PRIZE.win[comp]
    } else {
      const sc = simulateScore(rng, s.teams[f.home].strength + rng.normal(0, 2.5), s.teams[f.away].strength + rng.normal(0, 2.5), 9)
      f.hg = sc.hg
      f.ag = sc.ag
    }
  }
  if (idx === lp.rounds.length - 1) finishLeaguePhase(rng, s, run)
}

/** po ostatniej kolejce: miejsca 1–8 do 1/8 finału, 9–24 baraże, reszta odpada */
function finishLeaguePhase(rng: Rng, s: GameState, run: EuroRun): void {
  const lp = run.league!
  const table = euroTable(lp).map((r) => r.teamId)
  const rank = table.indexOf(run.teamId) + 1
  lp.rank = rank
  const name = COMP_NAME[lp.comp]
  const strongest = (ids: number[]) => [...ids].sort((a, b) => s.teams[b].strength - s.teams[a].strength)
  if (rank <= 8) {
    run.reached = REACHED.R16
    s.budget += PRIZE.ko[lp.comp]
    adjustCoach(s, { reputation: 3 })
    adjustTrust(s, { fans: 8, board: 5 })
    // rywal w 1/8: jeden ze zwycięzców baraży, zwykle mocniejszy z nich
    const t = addTie(rng, s, run, 'R16', rng.pick(strongest(table.slice(8, 24)).slice(0, 8)))
    news(s, `${name}: ${rank}. miejsce w fazie ligowej i prosto do 1/8 finału! Rywal: ${oppLabel(s, t.opp)}.`)
  } else if (rank <= 24) {
    run.reached = REACHED.KPO
    adjustCoach(s, { reputation: 1 })
    adjustTrust(s, { fans: 4, board: 2 })
    // baraże: miejsca 9–16 grają z 17–24
    const pool = rank <= 16 ? table.slice(16, 24) : table.slice(8, 16)
    const t = addTie(rng, s, run, 'KPO', rng.pick(pool))
    news(s, `${name}: ${rank}. miejsce w fazie ligowej. Po przerwie baraże o 1/8 finału z ${oppLabel(s, t.opp)}.`)
  } else {
    run.done = true
    run.result = `${name}: faza ligowa (${rank}. miejsce)`
    news(s, `${name}: ${rank}. miejsce w fazie ligowej. To koniec europejskiej przygody, zostają wspomnienia i magnesy na lodówkę.`)
  }
}

/** rywal w dalszej fazie pucharowej: ktoś z czołówki fazy ligowej, z kim jeszcze nie graliśmy w pucharowej */
function knockoutOpponent(rng: Rng, s: GameState, run: EuroRun, stage: EuroStage): number {
  const lp = run.league!
  const table = euroTable(lp).map((r) => r.teamId)
  const faced = new Set(run.ties.map((t) => t.opp))
  const pool = table.slice(0, 16).filter((id) => id !== run.teamId && !faced.has(id))
  // im dalej, tym większa szansa na giganta
  const top = { R16: 10, QF: 8, SF: 6, F: 4 }[stage as 'R16' | 'QF' | 'SF' | 'F'] ?? 10
  const best = pool.sort((a, b) => s.teams[b].strength - s.teams[a].strength).slice(0, top)
  return rng.pick(best.length ? best : table.filter((id) => id !== run.teamId))
}

// ---------- mecze ----------

export interface EuroMatch {
  run: EuroRun
  comp: EuroComp
  fixture: Fixture
  label: string
  /** dwumecz albo finał; brak = kolejka fazy ligowej */
  tie?: EuroTie
  idx: number
}

function currentTie(run: EuroRun): EuroTie | undefined {
  return run.ties.find((t) => t.won === undefined)
}

/** mecz europejski klubu w danym tygodniu (rozegrany albo nie) */
export function euroMatchForWeek(s: GameState, week: number): EuroMatch | undefined {
  const run = s.euro
  if (!run || run.done || run.teamId !== s.clubId) return undefined
  const lp = run.league
  if (lp && lp.rank === undefined) {
    const idx = lp.weeks.indexOf(week)
    if (idx < 0) return undefined
    const fixture = lp.rounds[idx].find((f) => f.home === run.teamId || f.away === run.teamId)!
    return { run, comp: lp.comp, fixture, idx, label: `${COMP_NAME[lp.comp]} · Faza ligowa · ${idx + 1}. kolejka` }
  }
  const tie = currentTie(run)
  const idx = tie ? tie.weeks.indexOf(week) : -1
  if (!tie || idx < 0) return undefined
  return { run, comp: tie.comp, fixture: tie.legs[idx], tie, idx, label: euroLegLabel(tie, idx) }
}

/** nierozegrany mecz europejski klubu w danym tygodniu */
export function pendingEuroMatch(s: GameState, week: number): EuroMatch | undefined {
  const x = euroMatchForWeek(s, week)
  return x && x.fixture.hg === undefined ? x : undefined
}

export function euroLegLabel(tie: EuroTie, idx: number): string {
  const leg = tie.legs.length > 1 ? (idx === 0 ? ' · 1. mecz' : ' · rewanż') : ''
  return `${COMP_NAME[tie.comp]} · ${STAGE_NAME[tie.stage]}${leg}`
}

/** etykieta meczu europejskiego w danym tygodniu, np. „Liga Konferencji · 1/8 finału · rewanż” */
export function euroRoundLabel(s: GameState, week: number): string | undefined {
  return euroMatchForWeek(s, week)?.label
}

/** tydzień w Europie: kolejka fazy ligowej (wszystkie mecze) albo mecz dwumeczu; raporty trafiają do `push` */
export function playEuroForWeek(rng: Rng, s: GameState, week: number, push: (rep: MatchReport) => void): void {
  const x = pendingEuroMatch(s, week)
  if (!x) return
  if (!x.tie) {
    playLeagueRound(rng, s, x.run, x.idx, push)
    return
  }
  const { run, tie, idx } = x
  const leg = x.fixture
  const rep = playClubMatch(rng, s, leg, true)
  rep.euro = true
  rep.comp = tie.comp
  rep.cupName = x.label
  if (tie.stage === 'F') rep.trophy = COMP_NAME[tie.comp]
  leg.hg = rep.hg
  leg.ag = rep.ag
  push(rep)
  if (idx < tie.legs.length - 1) return
  const me = run.teamId
  const forMe = tie.legs.reduce((a, l) => a + (l.home === me ? l.hg! : l.ag!), 0)
  const against = tie.legs.reduce((a, l) => a + (l.home === me ? l.ag! : l.hg!), 0)
  let won = forMe > against
  if (forMe === against) {
    // remis w dwumeczu: karne po rewanżu, bez dogrywki (jak w Pucharze Polski)
    const homeWins = rng.chance(0.5)
    const a = rng.int(3, 5)
    const b = Math.max(0, a - 1 - (rng.chance(0.3) ? 1 : 0))
    tie.pens = homeWins ? `${a}:${b}` : `${b}:${a}`
    rep.pens = tie.pens
    won = (homeWins ? leg.home : leg.away) === me
  }
  if (tie.legs.length > 1) rep.agg = `Dwumecz: ${s.teams[me].name} ${forMe}:${against} ${s.teams[tie.opp].name}`
  tie.won = won
  settleTie(rng, s, run, tie)
}

/** po dwumeczu: premie, awans do kolejnej rundy, spadek do słabszych rozgrywek albo koniec przygody */
function settleTie(rng: Rng, s: GameState, run: EuroRun, tie: EuroTie): void {
  const name = COMP_NAME[tie.comp]
  const qualifying = QUALIFYING.includes(tie.stage)
  if (tie.won) {
    const prize = qualifying ? PRIZE.qual[tie.comp] : PRIZE.ko[tie.comp]
    s.budget += prize
    adjustTrust(s, { fans: 4, board: 3, squad: 2 })
    adjustCoach(s, { reputation: qualifying ? 1 : 2 })
    if (tie.stage === 'F') {
      run.done = true
      run.champion = true
      run.reached = 7
      run.result = `${name}: zwycięstwo`
      s.trophies.push(`${name} (sezon ${s.season})`)
      adjustTrust(s, { fans: 25, board: 20, squad: 10 })
      adjustCoach(s, { reputation: { LKE: 15, LE: 20, LM: 30 }[tie.comp], stress: -25 })
      news(s, `${name.toUpperCase()} DLA POLSKIEGO KLUBU! ${s.teams[run.teamId].name} wraca z pucharem, a na lotnisku czeka pół miasta i jeden wiceminister.`)
      return
    }
    if (tie.stage === 'PO') {
      enterLeaguePhase(rng, s, run)
      news(s, `Jesteśmy w fazie ligowej ${COMP_GEN[tie.comp]}! UEFA przelewa ${formatMoney(PRIZE.league[tie.comp] + prize)}, a prezes już planuje nową trybunę.`)
      return
    }
    const next = NEXT_STAGE[tie.stage]!
    run.reached = REACHED[next]
    const t = addTie(rng, s, run, next, qualifying ? undefined : knockoutOpponent(rng, s, run, next))
    news(s, `${name}: awans! (+${formatMoney(prize)}) ${STAGE_NAME[next]}: ${oppLabel(s, t.opp)}.`)
    return
  }
  const down = LOWER[tie.comp]
  if (qualifying && down) {
    run.comp = down
    if (tie.stage === 'PO') {
      enterLeaguePhase(rng, s, run)
      news(s, `Odpadamy z eliminacji ${COMP_GEN[tie.comp]}, ale jest pocieszenie: faza ligowa ${COMP_GEN[down]} i ${formatMoney(PRIZE.league[down])} od UEFA.`)
    } else {
      const t = addTie(rng, s, run, 'PO')
      news(s, `Odpadamy z eliminacji ${COMP_GEN[tie.comp]}. Gramy dalej w rundzie play-off ${COMP_GEN[down]}: ${oppLabel(s, t.opp)}.`)
    }
    return
  }
  run.done = true
  run.result = `${name}: ${lower(STAGE_NAME[tie.stage])}`
  adjustCoach(s, { stress: 3 })
  news(s, `${name}: odpadamy (${lower(STAGE_NAME[tie.stage])}). Europa się żegna, liga wita z otwartymi ramionami.`)
}

/** okienko z wynikiem fazy ligowej, raz po ostatniej kolejce */
export function euroLeagueEvent(s: GameState): PendingEvent | undefined {
  const run = s.euro
  const lp = run?.league
  if (!run || !lp || lp.rank === undefined || lp.shown || run.teamId !== s.clubId) return undefined
  lp.shown = true
  const row = euroTable(lp).find((r) => r.teamId === run.teamId)!
  const next = run.ties.find((t) => t.stage === 'R16' || t.stage === 'KPO')
  const tail = !next
    ? 'To koniec przygody z Europą. Kibice i tak pojadą za rok, jeśli tylko będzie za czym.'
    : next.stage === 'R16'
      ? `Prosto do 1/8 finału! Wiosną zagracie z ${oppLabel(s, next.opp)}.`
      : `Po przerwie baraże o 1/8 finału z ${oppLabel(s, next.opp)}.`
  return {
    eventId: 'euro_faza',
    text: `Faza ligowa ${COMP_GEN[lp.comp]} zakończona. Bilans ${row.w}-${row.d}-${row.l}, bramki ${row.gf}:${row.ga}, ${row.pts} pkt i ${lp.rank}. miejsce na ${LEAGUE_TEAMS} drużyn. ${tail}`,
    options: next
      ? [{ label: 'Premia dla drużyny z pieniędzy UEFA' }, { label: 'Wszystko zostaje na koncie klubu' }]
      : [{ label: 'Głowa do góry, wracamy do ligi' }, { label: 'Na konferencji obwiń sędziów z UEFA' }],
  }
}

export function resolveEuroLeague(s: GameState, option: number): string {
  const run = s.euro
  const advanced = !!run && !run.done
  if (advanced && option === 0) {
    const bonus = Math.round((PRIZE.league[run.comp] * 0.15) / 1000) * 1000
    s.budget -= bonus
    for (const p of s.squad) setMorale(p, 8)
    adjustTrust(s, { squad: 6 })
    return `Piłkarze dostają ${formatMoney(bonus)} premii. W szatni ktoś śpiewa „Sto lat” po angielsku.`
  }
  if (advanced) {
    adjustTrust(s, { board: 5, squad: -3 })
    return 'Księgowa jest zachwycona. Piłkarze trochę mniej, ale autokar dalej ma klimatyzację.'
  }
  if (option === 0) {
    adjustCoach(s, { stress: -5 })
    adjustTrust(s, { squad: 3 })
    return 'Drużyna wraca do ligi z podniesioną głową i walizką doświadczeń. Głównie z lotnisk.'
  }
  adjustTrust(s, { fans: 4, board: -4 })
  adjustCoach(s, { stress: 2 })
  return 'Konferencja o „układzie w Nyonie” robi furorę na forach. Prezes prosi o więcej dyplomacji.'
}

// ---------- koniec sezonu ----------

/** wynik do historii sezonu, np. „Liga Konferencji: ćwierćfinał” */
export function euroResult(run: EuroRun): string {
  if (run.result) return run.result
  const tie = currentTie(run)
  if (tie) return `${COMP_NAME[tie.comp]}: ${lower(STAGE_NAME[tie.stage])}`
  return `${COMP_NAME[run.comp]}: faza ligowa`
}

/** zamyka przygodę z Europą (koniec sezonu albo odejście trenera) */
export function closeEuro(run: EuroRun): void {
  if (run.done) return
  run.result = euroResult(run)
  run.done = true
}
