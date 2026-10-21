import { playClubMatch, previewStrength, simulateScore } from './match'
import type { Rng } from './rng'
import type { EuroComp, EuroRun, EuroStage, EuroTie, GameState, MatchReport, PendingEvent } from './types'
import { adjustCoach, adjustTrust, formatMoney, news, setMorale } from './util'
import { clamp } from './world'

/**
 * Europejskie puchary w wersji lekkiej: mistrz Polski gra w eliminacjach Ligi Mistrzów, zdobywca Pucharu Polski w Lidze Europy,
 * a 2. i 3. drużyna Ekstraklasy w Lidze Konferencji. Eliminacje i faza pucharowa to dwumecze z fikcyjnymi rywalami o ogólnej sile,
 * a faza ligowa to jeden wynik: bilans i miejsce w tabeli 36 drużyn. Bez tabel z całej Europy.
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

/** tygodnie meczów: eliminacje latem, faza pucharowa wiosną, poza tygodniami Pucharu Polski */
export const STAGE_WEEKS: Record<EuroStage, number[]> = {
  Q2: [0, 1],
  Q3: [2, 4],
  PO: [5, 6],
  KPO: [18, 19],
  R16: [22, 23],
  QF: [24, 25],
  SF: [27, 28],
  F: [32],
}
/** po tym tygodniu rozstrzyga się faza ligowa (przed przerwą zimową) */
export const LEAGUE_WEEK = 15

const FIRST_STAGE: Record<EuroComp, EuroStage> = { LM: 'Q2', LE: 'Q3', LKE: 'Q2' }
const NEXT_STAGE: Partial<Record<EuroStage, EuroStage>> = { Q2: 'Q3', Q3: 'PO', KPO: 'R16', R16: 'QF', QF: 'SF', SF: 'F' }
const QUALIFYING: EuroStage[] = ['Q2', 'Q3', 'PO']
const REACHED: Record<EuroStage, number> = { Q2: 0, Q3: 0, PO: 0, KPO: 2, R16: 3, QF: 4, SF: 5, F: 6 }
/** kto odpadnie z eliminacji, gra dalej w słabszych rozgrywkach */
const LOWER: Partial<Record<EuroComp, EuroComp>> = { LM: 'LE', LE: 'LKE' }

/**
 * Siła rywali: im dalej i im bardziej prestiżowe rozgrywki, tym mocniej.
 * Skala jak w meczach drużyny gracza: czołówka Ekstraklasy gra zwykle na ok. 77–85.
 */
const STAGE_STRENGTH: Record<EuroStage, number> = { Q2: 68, Q3: 71, PO: 74, KPO: 80, R16: 83, QF: 86, SF: 88, F: 90 }
const COMP_BONUS: Record<EuroComp, number> = { LKE: 0, LE: 3, LM: 6 }
const LEAGUE_STRENGTH = 77
const LEAGUE_GAMES: Record<EuroComp, number> = { LM: 8, LE: 8, LKE: 6 }
const LEAGUE_TEAMS = 36

/** premie od UEFA w zł: za wygrany dwumecz w eliminacjach, za fazę ligową i za każdą rundę fazy pucharowej */
const PRIZE = {
  qual: { LM: 300_000, LE: 200_000, LKE: 100_000 },
  league: { LM: 1_500_000, LE: 800_000, LKE: 400_000 },
  ko: { LM: 800_000, LE: 400_000, LKE: 200_000 },
}

// ---------- rywale ----------

interface EuroNation {
  name: string
  flag: string
  /** 0 = eliminacje z Wysp Owczych, 4 = najmocniejsze ligi */
  tier: number
  names: string[]
  towns: string[]
}

const NATIONS: EuroNation[] = [
  { name: 'Islandia', flag: '🇮🇸', tier: 0, names: ['UMF {t}', '{t} FC', 'ÍF {t}'], towns: ['Hafnarfjörður', 'Akureyri', 'Kópavogur', 'Keflavík', 'Selfoss'] },
  { name: 'Wyspy Owcze', flag: '🇫🇴', tier: 0, names: ['{t} ÍF', 'B68 {t}', 'FC {t}'], towns: ['Tórshavn', 'Klaksvík', 'Runavík', 'Vágur', 'Toftir'] },
  { name: 'Malta', flag: '🇲🇹', tier: 0, names: ['{t} FC', '{t} Hotspurs', '{t} Rangers'], towns: ['Birkirkara', 'Ħamrun', 'Marsaxlokk', 'Sliema', 'Żebbuġ'] },
  { name: 'Kazachstan', flag: '🇰🇿', tier: 0, names: ['FK {t}', 'Szachtior {t}', 'Torpedo {t}'], towns: ['Pawłodar', 'Karaganda', 'Szymkent', 'Aktobe', 'Kostanaj'] },
  { name: 'Gruzja', flag: '🇬🇪', tier: 0, names: ['Dinamo {t}', 'FC {t}', 'Torpedo {t}'], towns: ['Kutaisi', 'Batumi', 'Zugdidi', 'Gori', 'Poti'] },
  { name: 'Armenia', flag: '🇦🇲', tier: 0, names: ['Ararat {t}', 'FC {t}', 'Szirak {t}'], towns: ['Giumri', 'Wanadzor', 'Abowian', 'Eczmiadzyn'] },
  { name: 'Łotwa', flag: '🇱🇻', tier: 1, names: ['FK {t}', '{t} Metta', 'Spartaks {t}'], towns: ['Lipawa', 'Dyneburg', 'Jełgawa', 'Windawa'] },
  { name: 'Mołdawia', flag: '🇲🇩', tier: 1, names: ['Zimbru {t}', 'FC {t}', 'Milsami {t}'], towns: ['Bielce', 'Orgiejów', 'Kagul', 'Soroki'] },
  { name: 'Słowacja', flag: '🇸🇰', tier: 1, names: ['Spartak {t}', 'MFK {t}', 'Dukla {t}', 'FK {t}'], towns: ['Żylina', 'Koszyce', 'Nitra', 'Preszów', 'Bańska Bystrzyca'] },
  { name: 'Węgry', flag: '🇭🇺', tier: 1, names: ['{t} FC', 'Vasas {t}', 'Haladás {t}'], towns: ['Debreczyn', 'Győr', 'Pecz', 'Segedyn', 'Kecskemét'] },
  { name: 'Cypr', flag: '🇨🇾', tier: 1, names: ['AEL {t}', 'Omonia {t}', 'Apollon {t}', 'Anorthosis {t}'], towns: ['Larnaka', 'Pafos', 'Limassol', 'Ajia Napa'] },
  { name: 'Bułgaria', flag: '🇧🇬', tier: 1, names: ['Lokomotiw {t}', 'Botew {t}', 'Spartak {t}'], towns: ['Płowdiw', 'Warna', 'Burgas', 'Ruse', 'Stara Zagora'] },
  { name: 'Rumunia', flag: '🇷🇴', tier: 1, names: ['FC {t}', 'Universitatea {t}', 'Rapid {t}', 'CS {t}'], towns: ['Kluż', 'Krajowa', 'Jassy', 'Konstanca', 'Timișoara'] },
  { name: 'Serbia', flag: '🇷🇸', tier: 1, names: ['Radnički {t}', 'FK {t}', 'Vojvodina {t}'], towns: ['Nisz', 'Kragujevac', 'Nowy Sad', 'Subotica'] },
  { name: 'Chorwacja', flag: '🇭🇷', tier: 2, names: ['Hajduk {t}', 'NK {t}', 'Dinamo {t}', 'HNK {t}'], towns: ['Osijek', 'Rijeka', 'Split', 'Zadar', 'Pula'] },
  { name: 'Czechy', flag: '🇨🇿', tier: 2, names: ['Slavia {t}', 'Baník {t}', 'Viktoria {t}', 'Sigma {t}'], towns: ['Ołomuniec', 'Liberec', 'Pilzno', 'Ostrawa', 'Jabłoniec'] },
  { name: 'Austria', flag: '🇦🇹', tier: 2, names: ['SK {t}', 'Austria {t}', 'Rapid {t}', 'Sturm {t}'], towns: ['Graz', 'Linz', 'Salzburg', 'Klagenfurt', 'Innsbruck'] },
  { name: 'Szwajcaria', flag: '🇨🇭', tier: 2, names: ['FC {t}', 'Young Boys {t}', 'Servette {t}'], towns: ['Bazylea', 'Lugano', 'Lucerna', 'St. Gallen', 'Sion'] },
  { name: 'Szkocja', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', tier: 2, names: ['{t} Rangers', '{t} Athletic', '{t} Thistle', '{t} United'], towns: ['Aberdeen', 'Dundee', 'Kilmarnock', 'Motherwell', 'Inverness'] },
  { name: 'Dania', flag: '🇩🇰', tier: 2, names: ['{t} BK', 'FC {t}', '{t} IF'], towns: ['Aarhus', 'Odense', 'Aalborg', 'Esbjerg', 'Randers'] },
  { name: 'Norwegia', flag: '🇳🇴', tier: 2, names: ['{t} IL', '{t} FK', 'Viking {t}'], towns: ['Bodø', 'Molde', 'Tromsø', 'Bergen', 'Stavanger'] },
  { name: 'Szwecja', flag: '🇸🇪', tier: 2, names: ['{t} IF', '{t} FF', '{t} BK'], towns: ['Malmö', 'Göteborg', 'Norrköping', 'Helsingborg', 'Kalmar'] },
  { name: 'Ukraina', flag: '🇺🇦', tier: 2, names: ['Szachtar {t}', 'Dynamo {t}', 'Zoria {t}', 'Worskła {t}'], towns: ['Charków', 'Dniepr', 'Połtawa', 'Lwów', 'Odessa'] },
  { name: 'Grecja', flag: '🇬🇷', tier: 3, names: ['Olympiakos {t}', 'Aris {t}', 'PAOK {t}', 'AEK {t}'], towns: ['Saloniki', 'Patras', 'Larisa', 'Wolos', 'Heraklion'] },
  { name: 'Turcja', flag: '🇹🇷', tier: 3, names: ['{t}spor', '{t} Gençlik', 'Galata {t}'], towns: ['Trabzon', 'Bursa', 'Konya', 'Antalya', 'Izmir'] },
  { name: 'Belgia', flag: '🇧🇪', tier: 3, names: ['Royal {t}', 'Club {t}', 'Sporting {t}', 'KV {t}'], towns: ['Brugia', 'Gandawa', 'Antwerpia', 'Charleroi', 'Liège'] },
  { name: 'Holandia', flag: '🇳🇱', tier: 3, names: ['{t} FC', 'Sparta {t}', 'Go Ahead {t}', 'Vitesse {t}'], towns: ['Eindhoven', 'Alkmaar', 'Utrecht', 'Groningen', 'Enschede'] },
  { name: 'Portugalia', flag: '🇵🇹', tier: 3, names: ['Sporting {t}', 'Vitória {t}', 'Académica {t}', 'FC {t}'], towns: ['Braga', 'Guimarães', 'Porto', 'Coimbra', 'Setúbal'] },
  { name: 'Francja', flag: '🇫🇷', tier: 4, names: ['Olympique {t}', 'Stade {t}', 'AS {t}', 'RC {t}'], towns: ['Lyon', 'Marsylia', 'Rennes', 'Lens', 'Nicea', 'Lille'] },
  { name: 'Niemcy', flag: '🇩🇪', tier: 4, names: ['Borussia {t}', 'Eintracht {t}', 'VfB {t}', 'Fortuna {t}'], towns: ['Dortmund', 'Frankfurt', 'Stuttgart', 'Leverkusen', 'Monachium', 'Kolonia'] },
  { name: 'Włochy', flag: '🇮🇹', tier: 4, names: ['Inter {t}', 'Atalanta {t}', 'AC {t}', 'US {t}'], towns: ['Mediolan', 'Bergamo', 'Turyn', 'Neapol', 'Rzym', 'Bolonia'] },
  { name: 'Hiszpania', flag: '🇪🇸', tier: 4, names: ['Real {t}', 'Atlético {t}', 'Deportivo {t}', 'Racing {t}'], towns: ['Madryt', 'Sewilla', 'Walencja', 'Bilbao', 'Saragossa', 'Villarreal'] },
  { name: 'Anglia', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 4, names: ['{t} United', '{t} City', '{t} Rovers', '{t} Wanderers', '{t} Athletic'], towns: ['Manchester', 'Liverpool', 'Newcastle', 'Birmingham', 'Leeds', 'Londyn'] },
]

/** flaga kraju rywala do drabinki i raportów */
export function countryFlag(country: string): string {
  return NATIONS.find((n) => n.name === country)?.flag ?? '🏳️'
}

/** nowy rywal z kraju, który pasuje siłą do rundy */
function makeOpponent(rng: Rng, s: GameState, strength: number): number {
  const tier = clamp(Math.floor((strength - 66) / 5), 0, 4)
  const pool = NATIONS.filter((n) => n.tier === tier)
  const used = new Set(Object.values(s.teams).map((t) => t.name))
  let nation = rng.pick(pool)
  let town = rng.pick(nation.towns)
  let name = rng.pick(nation.names).replace('{t}', town)
  for (let tries = 0; tries < 20 && used.has(name); tries++) {
    nation = rng.pick(pool)
    town = rng.pick(nation.towns)
    name = rng.pick(nation.names).replace('{t}', town)
  }
  const id = s.nextId++
  s.teams[id] = { id, name, town, level: 9, strength: Math.round(strength), country: nation.name }
  return id
}

function addTie(rng: Rng, s: GameState, run: EuroRun, stage: EuroStage): EuroTie {
  const weeks = STAGE_WEEKS[stage]
  const opp = makeOpponent(rng, s, STAGE_STRENGTH[stage] + COMP_BONUS[run.comp] + rng.normal(0, 2.5))
  const me = run.teamId
  const homeFirst = rng.chance(0.5)
  // finał na neutralnym stadionie, ale ktoś musi być gospodarzem w protokole
  const legs =
    weeks.length === 1
      ? [homeFirst ? { home: me, away: opp } : { home: opp, away: me }]
      : homeFirst
        ? [
            { home: me, away: opp },
            { home: opp, away: me },
          ]
        : [
            { home: opp, away: me },
            { home: me, away: opp },
          ]
  const tie: EuroTie = { stage, comp: run.comp, opp, weeks, legs }
  run.ties.push(tie)
  return tie
}

function oppLabel(s: GameState, id: number): string {
  const t = s.teams[id]
  return t ? `${t.name}${t.country ? ` (${t.country})` : ''}` : 'rywal'
}

const lower = (text: string) => text[0].toLowerCase() + text.slice(1)

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
  // rywale z poprzednich pucharów znikają
  for (const t of Object.values(s.teams)) if (t.country) delete s.teams[t.id]
  s.euro = undefined
  const spot = s.euroSpots?.find((x) => x.teamId === s.clubId)
  if (!spot || s.round !== 0) return
  s.euro = { teamId: spot.teamId, season: s.season, comp: spot.comp, ties: [], reached: 0 }
  const tie = addTie(rng, s, s.euro, FIRST_STAGE[spot.comp])
  news(s, `Europa czeka! ${COMP_NAME[spot.comp]}, ${lower(STAGE_NAME[tie.stage])}: ${oppLabel(s, tie.opp)}. Kierownik drużyny szuka paszportów.`)
}

// ---------- mecze ----------

function currentTie(run: EuroRun): EuroTie | undefined {
  return run.ties.find((t) => t.won === undefined)
}

/** mecz europejski klubu w danym tygodniu (rozegrany albo nie) */
export function euroLegForWeek(s: GameState, week: number): { run: EuroRun; tie: EuroTie; idx: number } | undefined {
  const run = s.euro
  if (!run || run.done || run.teamId !== s.clubId) return undefined
  const tie = currentTie(run)
  const idx = tie ? tie.weeks.indexOf(week) : -1
  return tie && idx >= 0 ? { run, tie, idx } : undefined
}

/** nierozegrany mecz europejski klubu w danym tygodniu */
export function pendingEuroLeg(s: GameState, week: number) {
  const x = euroLegForWeek(s, week)
  return x && x.tie.legs[x.idx].hg === undefined ? x : undefined
}

export function euroLegLabel(tie: EuroTie, idx: number): string {
  const leg = tie.legs.length > 1 ? (idx === 0 ? ' · 1. mecz' : ' · rewanż') : ''
  return `${COMP_NAME[tie.comp]} · ${STAGE_NAME[tie.stage]}${leg}`
}

/** etykieta meczu europejskiego w danym tygodniu, np. „Liga Konferencji · 1/8 finału · rewanż” */
export function euroRoundLabel(s: GameState, week: number): string | undefined {
  const x = euroLegForWeek(s, week)
  return x ? euroLegLabel(x.tie, x.idx) : undefined
}

/** tydzień w Europie: faza ligowa albo mecz klubu gracza; raport trafia do `push` */
export function playEuroForWeek(rng: Rng, s: GameState, week: number, push: (rep: MatchReport) => void): void {
  const run = s.euro
  if (!run || run.done || run.teamId !== s.clubId) return
  if (run.leagueWeek === week && !run.league) {
    playLeaguePhase(rng, s, run)
    return
  }
  const x = pendingEuroLeg(s, week)
  if (!x) return
  const { tie, idx } = x
  const leg = tie.legs[idx]
  const rep = playClubMatch(rng, s, leg, true)
  rep.euro = true
  rep.cupName = euroLegLabel(tie, idx)
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
      enterLeaguePhase(s, run)
      news(s, `Jesteśmy w fazie ligowej ${COMP_GEN[tie.comp]}! UEFA przelewa ${formatMoney(PRIZE.league[tie.comp] + prize)}, a prezes już planuje nową trybunę.`)
      return
    }
    const next = NEXT_STAGE[tie.stage]!
    run.reached = REACHED[next]
    const t = addTie(rng, s, run, next)
    news(s, `${name}: awans! (+${formatMoney(prize)}) ${STAGE_NAME[next]}: ${oppLabel(s, t.opp)}.`)
    return
  }
  const down = LOWER[tie.comp]
  if (qualifying && down) {
    run.comp = down
    if (tie.stage === 'PO') {
      enterLeaguePhase(s, run)
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

function enterLeaguePhase(s: GameState, run: EuroRun): void {
  run.leagueWeek = LEAGUE_WEEK
  run.reached = Math.max(run.reached, 1)
  s.budget += PRIZE.league[run.comp]
  adjustCoach(s, { reputation: 3 })
  adjustTrust(s, { board: 6, fans: 6 })
}

/** cała faza ligowa naraz: nasze mecze i tabela 36 drużyn z ogólnych sił */
function playLeaguePhase(rng: Rng, s: GameState, run: EuroRun): void {
  const comp = run.comp
  const games = LEAGUE_GAMES[comp]
  const avg = LEAGUE_STRENGTH + COMP_BONUS[comp]
  const play = (str: number) => {
    const r = { w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
    for (let i = 0; i < games; i++) {
      const opp = rng.normal(avg, 4)
      const mine = str + rng.normal(0, 1.5)
      const home = i % 2 === 0
      const sc = home ? simulateScore(rng, mine, opp, 9) : simulateScore(rng, opp, mine, 9)
      const gf = home ? sc.hg : sc.ag
      const ga = home ? sc.ag : sc.hg
      r.gf += gf
      r.ga += ga
      if (gf > ga) r.w++
      else if (gf === ga) r.d++
      else r.l++
    }
    r.pts = r.w * 3 + r.d
    return r
  }
  const me = play(previewStrength(s).overall)
  const key = (x: typeof me) => x.pts * 10_000 + (x.gf - x.ga + 100) * 100 + x.gf
  const others = Array.from({ length: LEAGUE_TEAMS - 1 }, () => play(rng.normal(avg, 4)))
  const rank = 1 + others.filter((o) => key(o) > key(me)).length
  run.league = { comp, games, ...me, rank }
  const name = COMP_NAME[comp]
  if (rank <= 8) {
    run.reached = REACHED.R16
    s.budget += PRIZE.ko[comp]
    adjustCoach(s, { reputation: 3 })
    adjustTrust(s, { fans: 8, board: 5 })
    const t = addTie(rng, s, run, 'R16')
    news(s, `${name}: ${rank}. miejsce w fazie ligowej i prosto do 1/8 finału! Rywal: ${oppLabel(s, t.opp)}.`)
  } else if (rank <= 24) {
    run.reached = REACHED.KPO
    adjustCoach(s, { reputation: 1 })
    adjustTrust(s, { fans: 4, board: 2 })
    const t = addTie(rng, s, run, 'KPO')
    news(s, `${name}: ${rank}. miejsce w fazie ligowej. Wiosną baraże o 1/8 finału z ${oppLabel(s, t.opp)}.`)
  } else {
    run.done = true
    run.result = `${name}: faza ligowa (${rank}. miejsce)`
    news(s, `${name}: ${rank}. miejsce w fazie ligowej. To koniec europejskiej przygody, zostają wspomnienia i magnesy na lodówkę.`)
  }
}

/** okienko z wynikiem fazy ligowej, raz po jej rozegraniu */
export function euroLeagueEvent(s: GameState): PendingEvent | undefined {
  const run = s.euro
  const lp = run?.league
  if (!run || !lp || lp.shown || run.teamId !== s.clubId) return undefined
  lp.shown = true
  const next = run.ties.find((t) => t.stage === 'R16' || t.stage === 'KPO')
  const tail = !next
    ? 'To koniec przygody z Europą. Kibice i tak pojadą za rok, jeśli tylko będzie za czym.'
    : next.stage === 'R16'
      ? `Prosto do 1/8 finału! Wiosną zagracie z ${oppLabel(s, next.opp)}.`
      : `Wiosną baraże o 1/8 finału z ${oppLabel(s, next.opp)}.`
  return {
    eventId: 'euro_faza',
    text: `Faza ligowa ${COMP_GEN[lp.comp]} zakończona. Bilans ${lp.w}-${lp.d}-${lp.l}, bramki ${lp.gf}:${lp.ga}, ${lp.pts} pkt i ${lp.rank}. miejsce na ${LEAGUE_TEAMS} drużyn. ${tail}`,
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
