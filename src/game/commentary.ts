import type { Rng } from './rng'

/**
 * Zdarzenie meczowe: najwyżej jedno na mecz i zawsze z realnym skutkiem.
 * str/day działają w trakcie meczu, reszta po końcowym gwizdku.
 */
export interface Incident {
  text: string
  /** opis skutku pokazywany w relacji */
  effect: string
  /** do siły całej drużyny */
  str?: number
  /** do dyspozycji dnia zawodnika {x} */
  day?: number
  /** ułamek budżetu ligi (np. 0.05 = 5%) */
  budget?: number
  fans?: number
  board?: number
  squad?: number
  stress?: number
  morale?: number
  /** {x} pauzuje tyle meczów */
  injure?: number
}

const LOW_LEVEL: Incident[] = [
  { text: 'Mecz opóźniony o 20 minut, bo sędzia utknął za kombajnem.', effect: 'zawodnicy wystygli po rozgrzewce, −1 do siły', str: -1 },
  { text: 'W przerwie sprzedano wszystkie kiełbasy. Rekord frekwencji: 112 osób.', effect: 'kasa klubu w górę, kibice zadowoleni', budget: 0.12, fans: 2 },
  { text: 'Pies kibica wbiegł na boisko i przez 10 minut krył {x}.', effect: '{x} wybity z rytmu, słabszy występ', day: -0.7 },
  { text: 'Bramkarz gości grał w kaloszach, bo korki zostały w busie.', effect: 'łatwiej o gola, +1,5 do siły', str: 1.5 },
  { text: 'Sędzia liniowy to wujek {x}. Spalonych jakoś nie widział.', effect: '+1 do siły, ale zarząd się wstydzi', str: 1, board: -2 },
  { text: '{x} grał po nocnej zmianie w zakładzie.', effect: '{x} ledwo stał na nogach', day: -0.9 },
  { text: 'Murawa po deszczu przypominała ryżowe pole.', effect: 'technika się nie liczy, −1 do siły', str: -1 },
  { text: '{x} skręcił kostkę w kretowisku na rozgrzewce, ale zagrał.', effect: '{x} słabszy i pauzuje następny mecz', day: -0.5, injure: 1 },
]

const MID_LEVEL: Incident[] = [
  { text: 'Spiker trzykrotnie przekręcił nazwisko {x}.', effect: '{x} obrażony, słabszy występ i spadek morale', day: -0.5, morale: -8 },
  { text: 'Kibice rywali utknęli w spóźnionym pociągu.', effect: 'rywal bez dopingu, +1 do siły', str: 1 },
  { text: 'Transmisja na Facebooku urwała się w 60. minucie. Sponsor transmisji żąda zwrotu.', effect: 'klub traci pieniądze', budget: -0.1, board: -1 },
  { text: 'Trener rywali wyleciał na trybuny za rzucenie butelką wody w kierunku nikogo.', effect: 'rywal bez dowodzenia, +1,5 do siły', str: 1.5 },
  { text: '{x} przed meczem przeczytał w gazecie, że jest „za wolny”.', effect: '{x} gra ze złością, lepszy występ', day: 0.7 },
  { text: 'Kibice przygotowali oprawę „Nawet w deszczu z wami”. Padało.', effect: 'drużyna niesiona dopingiem, +1 do siły', str: 1, fans: 2 },
  { text: 'Autokar zepsuł się pod Kutnem, drużyna dojechała na styk.', effect: 'brak rozgrzewki, −1,5 do siły, trener zestresowany', str: -1.5, stress: 4 },
]

const HIGH_LEVEL: Incident[] = [
  { text: 'VAR analizował sytuację 4 minuty. Nikt nie wie, co sprawdzał.', effect: 'drużyna wybita z rytmu, −1 do siły', str: -1 },
  { text: 'Ekspert w studiu nazwał {x} „przereklamowanym”.', effect: '{x} gra ze złością, lepszy występ', day: 0.7 },
  { text: 'Kibice odpalili race i zasłonili boisko sektorówką.', effect: 'kara od komisji ligi i zły humor zarządu', budget: -0.08, board: -2 },
  { text: '{x} biegał tak dużo, że aplikacja do GPS się zawiesiła.', effect: '{x} świetny dziś, ale przemęczony pauzuje mecz', day: 0.6, injure: 1 },
  { text: 'Prezes przed meczem obiecał w telewizji walkę o puchary.', effect: 'presja na trenera i szatnię, −1 do siły', str: -1, stress: 5 },
  { text: 'Pół szatni rywala złapało grypę żołądkową.', effect: 'osłabiony rywal, +2 do siły', str: 2 },
]

/** zdarzenie na mecz: mniej więcej co trzeci mecz, nigdy więcej niż jedno */
export function pickIncident(rng: Rng, level: number, names: string[]): (Incident & { x: string }) | undefined {
  if (!rng.chance(0.35)) return undefined
  const pool = level <= 2 ? LOW_LEVEL : level <= 5 ? MID_LEVEL : HIGH_LEVEL
  const inc = rng.pick(pool)
  const x = rng.pick(names.length ? names : ['ktoś'])
  return { ...inc, x, text: inc.text.replace(/\{x\}/g, x), effect: inc.effect.replace(/\{x\}/g, x) }
}
