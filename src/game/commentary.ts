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
  { text: 'Klubowa transmisja w internecie urwała się w 60. minucie. Sponsor transmisji żąda zwrotu.', effect: 'klub traci pieniądze', budget: -0.1, board: -1 },
  { text: 'Trener rywali wyleciał na trybuny za rzucenie butelką wody w kierunku nikogo.', effect: 'rywal bez dowodzenia, +1,5 do siły', str: 1.5 },
  { text: '{x} przed meczem przeczytał na portalu sportowym, że jest „za wolny na ten poziom”.', effect: '{x} gra ze złością, lepszy występ', day: 0.7 },
  { text: 'Kibice przygotowali oprawę „Nawet w deszczu z wami”. Padało.', effect: 'drużyna niesiona dopingiem, +1 do siły', str: 1, fans: 2 },
  { text: 'Autokar drużyny utknął w korku na autostradzie po wypadku, drużyna dojechała na styk.', effect: 'skrócona rozgrzewka, −1,5 do siły, trener zestresowany', str: -1.5, stress: 4 },
  { text: 'Na trybunie siedział skaut klubu z Ekstraklasy z notesem. Wszyscy wiedzieli, na kogo patrzy.', effect: '{x} chce się pokazać, lepszy występ', day: 0.6 },
  { text: 'Kibice odpalili race w 70. minucie, sędzia przerwał mecz na pięć minut.', effect: 'kara od komisji dyscyplinarnej, zarząd niezadowolony', budget: -0.06, board: -2 },
  { text: 'Analityk w przerwie pokazał na tablecie, że rywal zostawia lukę za prawym obrońcą.', effect: 'korekta w przerwie, +1 do siły', str: 1 },
  { text: 'Lekarz klubowy w przerwie zakładał {x} szwy na łuku brwiowym.', effect: '{x} gra z opatrunkiem i ostrożniej', day: -0.6 },
  { text: 'Mecz pokazywała telewizja, a sponsor dokupił bandy reklamowe wzdłuż całej trybuny.', effect: 'dodatkowe wpływy, zarząd zadowolony', budget: 0.08, board: 1 },
  { text: 'Sztuczna murawa na stadionie rywala była twarda jak parkiet, piłka skakała jak szalona.', effect: 'kontrola piłki leży, −1 do siły', str: -1 },
  { text: 'Delegat związku przed meczem zakwestionował dokumenty zgłoszeniowe. Wyjaśnianie trwało do rozgrzewki.', effect: 'nerwówka w sztabie, −0,5 do siły i stres trenera', str: -0.5, stress: 4 },
  { text: 'Kapitan rywali w przedmeczowym wywiadzie obiecał „lekcję futbolu”. Szatnia to przeczytała.', effect: 'sportowa złość, +1 do siły', str: 1, squad: 1 },
  { text: 'Kamizelki GPS pokazały, że {x} przebiegł w pierwszej połowie o dwa kilometry mniej niż zwykle.', effect: '{x} zmęczony i niezadowolony z rozmowy w przerwie', day: -0.5, morale: -5 },
]

const HIGH_LEVEL: Incident[] = [
  { text: 'VAR analizował sytuację 4 minuty. Nikt nie wie, co sprawdzał.', effect: 'drużyna wybita z rytmu, −1 do siły', str: -1 },
  { text: 'Ekspert w studiu nazwał {x} „przereklamowanym”.', effect: '{x} gra ze złością, lepszy występ', day: 0.7 },
  { text: 'Kibice odpalili race i zasłonili boisko sektorówką.', effect: 'kara od komisji ligi i zły humor zarządu', budget: -0.08, board: -2 },
  { text: '{x} biegał tak dużo, że aplikacja do GPS się zawiesiła.', effect: '{x} świetny dziś, ale przemęczony pauzuje mecz', day: 0.6, injure: 1 },
  { text: 'Prezes przed meczem obiecał w telewizji walkę o puchary.', effect: 'presja na trenera i szatnię, −1 do siły', str: -1, stress: 5 },
  { text: 'Pół szatni rywala złapało grypę żołądkową.', effect: 'osłabiony rywal, +2 do siły', str: 2 },
  { text: 'Sędzia VAR wezwał arbitra do monitora. Po trzech powtórkach wskazał na wapno dla nas.', effect: 'rywal rozbity decyzją, +1,5 do siły', str: 1.5 },
  { text: 'Technologia goal-line potwierdziła: piłka po strzale {x} przekroczyła linię o dwa centymetry.', effect: '{x} pewny siebie, lepszy występ', day: 0.8, morale: 5 },
  { text: 'Półautomatyczny spalony anulował gola {x}. Według linii na powtórce wystawał mu łokieć.', effect: '{x} sfrustrowany, słabszy występ', day: -0.6, morale: -6 },
  { text: 'Lekarz klubowy po zderzeniu głowami wdrożył protokół wstrząśnienia mózgu i zdjął {x} z boiska.', effect: '{x} słabszy dziś i pauzuje następny mecz', day: -0.4, injure: 1 },
  { text: 'Przy minus dwunastu stopniach podgrzewana murawa była jedynym ciepłym miejscem na stadionie. Rywale grali skostniali.', effect: 'rywal bez czucia w nogach, +1 do siły', str: 1 },
  { text: 'Ultrasi przez pierwsze 20 minut milczeli w proteście przeciwko zarządowi, a potem wywiesili transparent.', effect: 'cicha trybuna, −1 do siły, zarząd nerwowy', str: -1, board: -2 },
  { text: 'Nadawca pokazał mecz w otwartym paśmie. Oglądalność rekordowa.', effect: 'premia od nadawcy, zarząd zadowolony', budget: 0.05, board: 2, fans: 1 },
  { text: 'Analitycy na trybunie prasowej co kwadrans przesyłali na tablet asystenta mapy pressingu rywala.', effect: 'trafione korekty w trakcie meczu, +1 do siły', str: 1 },
  { text: 'Kamera telewizyjna złapała, jak {x} kłóci się z asystentem przy zmianie. Klip obiegł internet.', effect: 'zgrzyt w szatni i stres trenera', morale: -6, squad: -2, stress: 3 },
  { text: 'Rywal zwolnił trenera we wtorek. Debiutujący następca dostał od szatni „efekt nowej miotły”.', effect: 'zmobilizowany rywal, −1 do siły', str: -1 },
]

/** zdarzenie na mecz: mniej więcej co trzeci mecz, nigdy więcej niż jedno */
export function pickIncident(rng: Rng, level: number, names: string[]): (Incident & { x: string }) | undefined {
  if (!rng.chance(0.35)) return undefined
  const pool = level <= 4 ? LOW_LEVEL : level <= 7 ? MID_LEVEL : HIGH_LEVEL
  const inc = rng.pick(pool)
  const x = rng.pick(names.length ? names : ['ktoś'])
  return { ...inc, x, text: inc.text.replace(/\{x\}/g, x), effect: inc.effect.replace(/\{x\}/g, x) }
}
