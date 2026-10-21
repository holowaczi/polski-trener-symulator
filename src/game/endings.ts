import { COACH_QUOTES } from './data'
import type { CareerEnding, GameState, PendingEvent } from './types'
import { adjustCoach, adjustTrust } from './util'

// ---------- wypalenie ----------

/** od tylu punktów wypalenia lekarz pierwszy raz ostrzega */
export const BURNOUT_WARN = 10
/** ostatnie ostrzeżenie */
export const BURNOUT_FINAL = 18
/** przy tylu punktach kariera się kończy */
export const BURNOUT_END = 24

/** po każdym meczu: gra pod bardzo wysokim stresem dokłada do wypalenia, spokojniejsze tygodnie je zmniejszają */
export function trackBurnout(s: GameState): void {
  const st = s.coach.stress
  const d = st >= 95 ? 2 : st >= 80 ? 1 : st < 65 ? -1 : 0
  s.burnout = Math.max(0, (s.burnout ?? 0) + d)
  // po odpoczynku lekarz może ostrzec od nowa
  if (s.burnout < 6) delete s.flags.lekarz
}

// ---------- brudy ----------

/** od tylu „brudów” dziennikarz zaczyna dzwonić */
export const DIRT_WARN = 7
/** przy tylu teczka idzie do druku */
export const DIRT_END = 12
/** tyle brudów dokłada afera ze zdarzenia */
export const DIRT_SCANDAL = 3
/** a tyle obietnica bez pokrycia */
export const DIRT_PROMISE = 1

export function addDirt(s: GameState, n: number): void {
  s.dirt = Math.max(0, (s.dirt ?? 0) + n)
}

/** po sezonie część spraw przycicha, a wypalenie trochę odpuszcza */
export function seasonCoolDown(s: GameState): void {
  s.dirt = Math.max(0, (s.dirt ?? 0) - 1)
  s.burnout = Math.max(0, (s.burnout ?? 0) - 4)
  if (s.burnout < 6) delete s.flags.lekarz
}

// ---------- ostrzeżenia ----------

/** lekarz albo dziennikarz: zdarzenie z decyzją, zanim kariera się skończy */
export function careerWarning(s: GameState): PendingEvent | undefined {
  const b = s.burnout ?? 0
  const warned = s.flags.lekarz ?? 0
  if ((b >= BURNOUT_FINAL && warned < 2) || (b >= BURNOUT_WARN && warned < 1)) {
    const final = b >= BURNOUT_FINAL
    s.flags.lekarz = final ? 2 : 1
    return {
      eventId: 'lekarz',
      text: final
        ? 'Ostatnie ostrzeżenie. Lekarz nie owija w bawełnę: „Ciśnienie jak w doliczonym czasie, tylko że od pół roku. Jeszcze kilka takich tygodni i będzie pan wybierał między piłką a sercem”.'
        : 'Po meczu kręci Ci się w głowie, a lekarz klubowy mierzy ciśnienie dwa razy, bo nie wierzy w wynik. „Trenerze, pan się wypala. Albo odpoczynek, albo będzie źle”.',
      options: [{ label: 'Biorę urlop: sezon przerwy' }, { label: 'Sanatorium w Ciechocinku w wolne dni' }, { label: '„Lekarze się nie znają”' }],
    }
  }
  if ((s.dirt ?? 0) >= DIRT_WARN && s.flags.dziennikarz !== s.season) {
    s.flags.dziennikarz = s.season
    return {
      eventId: 'dziennikarz',
      text: 'Dzwoni dziennikarz śledczy. „Zbieram materiały o panu. Mam już całą teczkę i chętnie dam panu szansę na komentarz, zanim pójdzie do druku”.',
      options: [{ label: 'Zapłać za milczenie' }, { label: 'Szczery wywiad: przyznaj się do wszystkiego' }, { label: 'Zagroź pozwem' }],
    }
  }
  return undefined
}

/** asystent w szybkiej symulacji nie bierze urlopu za trenera i nie płaci z jego kieszeni */
export const ASSISTANT_CHOICE: Record<string, number> = { lekarz: 1, dziennikarz: 2 }

/** opcje 1 i 2 lekarza (urlop obsługuje silnik) */
export function resolveDoctor(s: GameState, option: number): string {
  if (option === 1) {
    const cost = 4_000
    if (s.coach.savings >= cost) {
      adjustCoach(s, { stress: -30, savings: -cost })
      s.burnout = Math.max(0, (s.burnout ?? 0) - 8)
      return 'Tydzień w Ciechocinku: tężnie, borowina i dancing w sanatorium. Wracasz spokojniejszy, choć ze zdjęciem z kuracjuszką na Facebooku.'
    }
    adjustCoach(s, { stress: -15 })
    s.burnout = Math.max(0, (s.burnout ?? 0) - 5)
    return 'Na sanatorium nie starczyło, więc lekarz przepisał spacery i melisę. Trochę pomogło.'
  }
  adjustCoach(s, { stress: 3 })
  return 'Wychodzisz z gabinetu i od razu dzwonisz do asystenta w sprawie składu. Lekarz patrzy za Tobą i kręci głową.'
}

export function resolveJournalist(s: GameState, option: number, roll: number): string {
  if (option === 0) {
    const cost = Math.max(3_000, Math.round(s.coach.savings * 0.3))
    if (s.coach.savings < cost) {
      addDirt(s, 1)
      return 'Nie masz tyle pieniędzy. Dziennikarz śmieje się do słuchawki i dopisuje do teczki, że próbowałeś go przekupić.'
    }
    adjustCoach(s, { savings: -cost })
    addDirt(s, -5)
    return 'Koperta zmienia właściciela przy stoliku w barze mlecznym. Teczka chwilowo trafia do szuflady.'
  }
  if (option === 1) {
    adjustCoach(s, { reputation: -5, stress: 4 })
    adjustTrust(s, { board: -5, fans: 3 })
    addDirt(s, -4)
    return 'Mówisz wszystko, co wiesz, i trochę więcej. Wywiad czyta całe województwo, ale nie ma już czego ujawniać.'
  }
  adjustCoach(s, { stress: 8 })
  if (roll < 0.5) {
    addDirt(s, -3)
    return 'Pismo od kancelarii szwagra działa. Redakcja wycofuje się rakiem, przynajmniej na razie.'
  }
  addDirt(s, 2)
  return 'Groźba pozwu trafia na pierwszą stronę jako osobny tekst. Teczka jest teraz grubsza.'
}

// ---------- teksty zakończeń ----------

const pickBy = <T>(s: GameState, list: T[]): T => list[Math.abs(s.seed + s.season * 7 + s.history.length) % list.length]

const BURNOUT_WORDS = [
  'Ciśnienie miałem jak w doliczonym czasie, tylko że przez cały sezon.',
  'Serce mi powiedziało: trenerze, zmiana. Pierwszy raz kogoś posłuchałem.',
  'Teraz krzyczę tylko na pomidory. Rosną lepiej niż moi skrzydłowi.',
]

const SCANDAL_WORDS = [
  'Wszystko wyrwane z kontekstu. Kontekst też był wyrwany.',
  'Nie czytam gazet. Teraz już na pewno.',
  'Mój prawnik powie więcej, jak tylko go znajdę.',
]

const SHOP_WORDS = [
  'Szczupak przynajmniej nie pyta o wyniki.',
  'Najlepsze ustawienie? Spławik dwa metry od brzegu.',
  'Rynek trenerów jest jak łowisko. Czasem po prostu nie bierze.',
]

/** gazeta, która opisuje trenera: im wyżej doszedł, tym poważniejsze medium */
export function paperFor(peak: number): string {
  if (peak <= 2) return 'Gazeta Gminna'
  if (peak <= 4) return 'Tygodnik Powiatowy'
  if (peak <= 6) return 'Portal Regionalny'
  if (peak <= 8) return 'Kurier Sportowy'
  return 'Sport Wieczorem'
}

const peakOf = (s: GameState) => (s.history.length ? Math.max(...s.history.map((h) => h.level)) : 0)

export function burnoutEnding(s: GameState, clubName?: string): CareerEnding {
  return {
    kind: 'wypalenie',
    title: 'Wypalenie',
    text: `${clubName ? `Po meczu ${clubName} ` : 'Pewnego wieczoru '}trafiłeś na SOR z ciśnieniem 190 na 120. Lekarz kazał wybrać: piłka albo serce. Wybrałeś serce, ale skróty meczów dalej oglądasz po kryjomu w łazience.`,
    lastWord: pickBy(s, BURNOUT_WORDS),
  }
}

export function scandalEnding(s: GameState): CareerEnding {
  const paper = paperFor(peakOf(s))
  const recent = [...new Set(s.scandals)].slice(-3).reverse()
  const name = s.coach.lastName
  const headline = recent.length
    ? `„${paper}”: ${pickBy(s, [`Teczka trenera ${name}. „${recent[0]}” to dopiero początek`, `AFERA! Trener ${name} i ${s.scandals.length} grzechów kariery`, `Trener ${name} bez tajemnic. Kibice: „Wiedzieliśmy”`])}`
    : `„${paper}”: Trener ${name} i obietnice bez pokrycia. Szatnia mówi wszystko`
  const list = recent.length ? recent.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(', ') : 'obietnice dla szatni i prezesa, z których nic nie wyszło'
  return {
    kind: 'skandal',
    title: 'Afera w gazecie',
    headline,
    text: `Dziennikarz złożył wszystko w jedną teczkę: ${list}${s.scandals.length > 3 ? ' i jeszcze kilka rzeczy, których nie wypada drukować' : ''}. Związek zawiesza licencję, prezes udaje, że Cię nie zna, a teściowa kupiła trzy egzemplarze.`,
    lastWord: pickBy(s, SCANDAL_WORDS),
  }
}

export function unemployedEnding(s: GameState): CareerEnding {
  const n = s.seasonsUnemployed
  return {
    kind: 'bezrobocie',
    title: 'Sklep wędkarski',
    text: `Telefon milczy ${n >= 2 ? `od ${n} sezonów` : 'od dawna'}. Przechodzisz do sklepu wędkarskiego „Szczupak” w województwie ${s.coach.region}. Klienci pytają o robaki, a Ty rozrysowujesz im 4-4-2 na paragonie.`,
    lastWord: pickBy(s, SHOP_WORDS),
  }
}

export function retirementEnding(s: GameState): CareerEnding {
  return {
    kind: 'emerytura',
    title: 'Emerytura',
    text: 'Siedemdziesiątka na karku. Czas na działkę i komentowanie meczów z pilotem w ręku.',
    lastWord: pickBy(s, COACH_QUOTES),
  }
}

export function choiceEnding(s: GameState, reason: string): CareerEnding {
  return { kind: 'decyzja', title: 'Koniec z własnej woli', text: reason, lastWord: pickBy(s, COACH_QUOTES) }
}

/** cytat z prasy o całej karierze, bez losowania */
export function pressQuote(s: GameState): { text: string; source: string } {
  const source = paperFor(peakOf(s))
  const seasons = s.history.length
  const promotions = s.history.filter((h) => h.outcome.includes('awans')).length
  const text = (() => {
    if (seasons === 0) return 'Kto to w ogóle był? Pytamy dla znajomego.'
    if (s.ending?.kind === 'skandal') return 'Wiedzieliśmy, że to się tak skończy. Pisaliśmy o tym trzy razy.'
    if (s.trophies.some((t) => /^Liga (Mistrzów|Europy|Konferencji) \(/.test(t))) return 'Europa nauczyła się wymawiać nazwę jego klubu. Prawie poprawnie.'
    if (s.trophies.some((t) => t.startsWith('Mistrzostwo Polski'))) return 'Najlepszy trener w kraju. Bez dyskusji, choć dyskusje były.'
    if (s.trophies.some((t) => t.startsWith('Puchar Polski ('))) return 'Puchar Polski pojechał do szatni, w której nie było ciepłej wody.'
    if (promotions >= 3) return 'Gdzie przyjdzie, tam awans. Prezesi ustawiają się w kolejce.'
    if (s.totalStats.firedCount >= 3) return 'Zwalniany częściej, niż zmienia się rozkład PKS-u.'
    if (s.ending?.kind === 'wypalenie') return 'Dał z siebie wszystko. Dosłownie wszystko.'
    if (seasons <= 2) return 'Przeszedł przez naszą piłkę jak przeciąg. Ktoś zamknie okno?'
    if (seasons >= 20) return 'Pamięta czasy, gdy w szatni był jeden prysznic na trzy drużyny.'
    const total = s.totalStats.w + s.totalStats.d + s.totalStats.l
    return total && s.totalStats.w / total >= 0.5
      ? 'Solidna firma. Wygrywał częściej, niż przepraszał.'
      : 'Wyników mniej, ale konferencje prasowe były legendarne.'
  })()
  return { text, source: seasons === 0 ? 'Forum kibiców' : source }
}

// ---------- trofea na karcie ----------

export interface TrophyLine {
  label: string
  count: number
}

/** ranga ligi z nazwy: im wyżej, tym ważniejsze mistrzostwo */
const TIER_RANK: [RegExp, number][] = [
  [/^I liga/, 80],
  [/^II liga/, 70],
  [/^III liga/, 60],
  [/^IV liga/, 50],
  [/^V liga/, 45],
  [/okręgowa/i, 40],
  [/Klasa A|A-klasa/, 30],
  [/Klasa B|B-klasa/, 20],
  [/Klasa C|C-klasa/, 10],
]

/**
 * Trofea zgrupowane do karty: sam poziom ligi bez grupy i województwa,
 * powtórki w jednej linijce („×3”), najważniejsze na początku.
 */
export function trophyLines(trophies: string[]): TrophyLine[] {
  const lines = new Map<string, { count: number; rank: number }>()
  const add = (label: string, rank: number) => {
    const x = lines.get(label)
    if (x) x.count++
    else lines.set(label, { count: 1, rank })
  }
  for (const t of trophies) {
    if (t.startsWith('Liga Mistrzów (')) add('Liga Mistrzów', 130)
    else if (t.startsWith('Liga Europy (')) add('Liga Europy', 120)
    else if (t.startsWith('Liga Konferencji (')) add('Liga Konferencji', 110)
    else if (t.startsWith('Mistrzostwo Polski')) add('Mistrzostwo Polski', 100)
    else if (t.startsWith('Puchar Polski (')) add('Puchar Polski', 90)
    else if (t.startsWith('Puchar Polski na szczeblu')) add('Puchar wojewódzki', 42)
    else if (t.startsWith('Mistrzostwo: ')) {
      const tier = t
        .slice('Mistrzostwo: '.length)
        .replace(/ \(sezon \d+\)$/, '')
        .split(' · ')[0]
        .replace(/ \(gr\.[^)]*\)$/, '')
      add(`Mistrzostwo: ${tier}`, TIER_RANK.find(([re]) => re.test(tier))?.[1] ?? 0)
    } else add(t, 0)
  }
  return [...lines.entries()].sort((a, b) => b[1].rank - a[1].rank).map(([label, x]) => ({ label, count: x.count }))
}
