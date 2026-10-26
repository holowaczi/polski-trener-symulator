export type Position = 'BR' | 'OBR' | 'POM' | 'NAP'

export type TraitId =
  | 'imprezowicz'
  | 'szklany'
  | 'lider'
  | 'syn_prezesa'
  | 'weteran'
  | 'talent'
  | 'leniwy'
  | 'pracus'
  | 'krol_strzalow'
  | 'kibic_z_mlyna'
  | 'narwany'

export interface Player {
  id: number
  firstName: string
  lastName: string
  nickname?: string
  /** narodowość, np. „Polska”; brak w starych zapisach (wtedy zgadujemy z nazwiska) */
  nation?: string
  age: number
  pos: Position
  skill: number
  potential: number
  /** -3..3, wyliczana z ostatnich ocen meczowych */
  form: number
  /** 0..100 */
  morale: number
  traits: TraitId[]
  /** kontuzja: liczba meczów przerwy */
  injuredFor: number
  /** zawieszenie: liczba meczów */
  suspendedFor: number
  yellows: number
  goals: number
  assists: number
  apps: number
  /** ostatnie oceny meczowe (najnowsza na końcu) */
  ratings: number[]
  ratingSum: number
  /** ułamkowy postęp umiejętności, przy ±1 zmienia się skill */
  progress: number
  /** mecze z rzędu bez gry, mimo że był zdrowy */
  benchStreak: number
  /** wartość rynkowa w zł */
  value: number
  /** pensja miesięczna w zł */
  wage: number
  /** sezony do końca umowy (0 = umowa wygasła, trzeba negocjować w oknie) */
  contract?: number
  /** żądanie po nieudanym targowaniu: kolejna próba zrywa rozmowy */
  haggled?: number
  /** zawodnik zerwał rozmowy o nowej umowie */
  talksOver?: boolean
  /** zawodnik pierwszej drużyny zesłany do rezerw */
  sentDown?: boolean
  /** młody zawodnik zbiera minuty w rezerwach i szybciej się rozwija */
  minutesBoost?: number
  /** kupiony w tym oknie: o nowej umowie można rozmawiać najwcześniej w kolejnym */
  newSigning?: boolean
  /** średnia ocen z poprzedniego sezonu: latem na jej podstawie kluby szukają zawodników */
  lastRating?: number
}

export type Formation = '4-4-2' | '4-3-3' | '5-3-2' | '4-5-1' | '3-5-2'
export type Mentality = 'obrona' | 'balans' | 'atak'
export type Style = 'laga' | 'pressing' | 'posiadanie' | 'kontra'

export interface Tactic {
  formation: Formation
  mentality: Mentality
  style: Style
}

export interface Lineup {
  /** automatyczny wybór przed każdym meczem */
  auto: boolean
  xi: number[]
  bench: number[]
}

export interface Team {
  id: number
  name: string
  town: string
  level: number
  /** siła drużyn sterowanych przez komputer */
  strength: number
  /** prawdziwy klub z bieżącego sezonu */
  real?: boolean
  /** drużyna rezerw, nie awansuje wyżej niż II liga */
  reserve?: boolean
  /** województwo klubu */
  region?: string
  /** gość etapu centralnego Pucharu Polski spoza województwa gracza (opis do drabinki) */
  guest?: string
  /** forma z ostatnich wyników (-3..3), dodawana do siły w meczu */
  form?: number
  /** rywal z europejskich pucharów: kraj klubu */
  country?: string
}

export interface Fixture {
  home: number
  away: number
  hg?: number
  ag?: number
}

export interface League {
  level: number
  name: string
  /** nazwa grupy, gdy na poziomie jest kilka lig */
  group?: string
  /** województwo (IV liga i niżej) */
  region?: string
  teamIds: number[]
  rounds: Fixture[][]
}

export interface TableRow {
  teamId: number
  p: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  pts: number
}

export interface CupTie {
  home: number
  away: number
  hg?: number
  ag?: number
  pens?: string
  winner?: number
}

export interface Cup {
  title?: string
  /** nazwy rund, np. „Runda wstępna”, „1/32 finału” */
  names?: string[]
  /** drużyny, które wchodzą do drabinki dopiero w drugiej rundzie */
  byes?: number[]
  rounds: CupTie[][]
  /** tygodnie, w których rozgrywana jest dana runda */
  schedule: number[]
  eliminatedAt?: number
  winner?: number
}

/** baraże o awans: drabinka jak w pucharze, rozstawiona według tabeli */
export interface Playoff extends Cup {
  level: number
  /** drużyny według miejsca w tabeli, od najlepszej */
  seeds: number[]
}

/** Liga Mistrzów, Liga Europy, Liga Konferencji */
export type EuroComp = 'LM' | 'LE' | 'LKE'
/** rundy eliminacji (Q2, Q3, PO) i fazy pucharowej (KPO = baraże o 1/8) */
export type EuroStage = 'Q2' | 'Q3' | 'PO' | 'KPO' | 'R16' | 'QF' | 'SF' | 'F'

/** dwumecz (albo finał) klubu gracza w europejskich pucharach */
export interface EuroTie {
  stage: EuroStage
  comp: EuroComp
  opp: number
  /** tygodnie meczów: dwa przy dwumeczu, jeden w finale */
  weeks: number[]
  legs: Fixture[]
  /** karne po rewanżu, jako wynik gospodarzy rewanżu do gości */
  pens?: string
  won?: boolean
}

/** faza ligowa: 36 drużyn, każda gra 8 meczów (w Lidze Konferencji 6) z różnymi rywalami, jedna wspólna tabela */
export interface EuroLeague {
  comp: EuroComp
  teamIds: number[]
  /** kolejki fazy ligowej: mecze wszystkich drużyn */
  rounds: Fixture[][]
  /** tydzień sezonu każdej kolejki */
  weeks: number[]
  /** miejsce klubu gracza po ostatniej kolejce */
  rank?: number
  /** gracz widział już okienko z wynikiem */
  shown?: boolean
}

/** przygoda klubu gracza z europejskimi pucharami w jednym sezonie */
export interface EuroRun {
  teamId: number
  season: number
  /** rozgrywki, w których klub gra teraz (po odpadnięciu z eliminacji może spaść niżej) */
  comp: EuroComp
  ties: EuroTie[]
  league?: EuroLeague
  done?: boolean
  champion?: boolean
  /** jak się skończyło, np. „Liga Konferencji: ćwierćfinał” */
  result?: string
  /** najdalszy etap: 0 eliminacje, 1 faza ligowa, 2 baraże o 1/8, 3 1/8, 4 ćwierćfinał, 5 półfinał, 6 finał, 7 zwycięstwo */
  reached: number
}

export type License = 'brak' | 'UEFA C' | 'UEFA B' | 'UEFA A' | 'UEFA Pro'

export interface Coach {
  firstName: string
  lastName: string
  age: number
  region: string
  license: License
  /** 0..100 */
  reputation: number
  /** 0..100: wysoki stres osłabia drużynę i rodzi kłopoty */
  stress: number
  savings: number
  courseLeft: number
}

export interface Trust {
  board: number
  squad: number
  fans: number
}

export type GoalType = 'awans' | 'czołówka' | 'środek' | 'utrzymanie'

export interface PlayerRating {
  id: number
  name: string
  pos: Position
  rating: number
  sub?: boolean
  /** szczegóły występu (brak w starych zapisach) */
  minutes?: number
  goals?: number
  assists?: number
  yellow?: number
  red?: boolean
  injured?: boolean
}

export interface MatchReport {
  round: number
  cup?: boolean
  /** np. „Puchar wojewódzki · 1/8 finału” */
  cupName?: string
  /** mecz barażowy */
  playoff?: boolean
  /** finał pucharu: nazwa trofeum, o które grano */
  trophy?: string
  /** mecz w europejskich pucharach */
  euro?: boolean
  /** wynik dwumeczu po rewanżu, np. „Dwumecz: Legia 3:2 Dinamo Split” */
  agg?: string
  /** które europejskie rozgrywki: od nich zależy kolor raportu */
  comp?: EuroComp
  /** etap wojewódzki Pucharu Polski */
  regional?: boolean
  /** numer kolejny meczu trenera w karierze */
  seq?: number
  /** klub trenera w tym meczu (po zwolnieniu klubId już go nie wskazuje) */
  me?: number
  /** wynik rzutów karnych (gospodarze:goście) po remisie w pucharze albo barażu */
  pens?: string
  home: number
  away: number
  hg: number
  ag: number
  lines: string[]
  /** chronologiczne wydarzenia meczu */
  events: string[]
  ratings: PlayerRating[]
  myStrength: { att: number; def: number }
  oppStrength: number
}

/** efekt czasowy: zmienia siłę drużyny przez kilka meczów */
export interface Modifier {
  label: string
  amount: number
  matches: number
}

export interface SeasonRecord {
  season: number
  clubName: string
  level: number
  leagueName: string
  position?: number
  outcome: string
  cup: string
  fired?: boolean
  /** europejskie puchary w tym sezonie: rozgrywki i najdalszy etap (EuroRun.reached) */
  euro?: { comp: EuroComp; reached: number }
}

export interface JobOffer {
  teamId: number
  teamName: string
  level: number
  leagueName: string
  goal: GoalType
  salary: number
  note: string
}

export interface PendingEvent {
  eventId: string
  playerId?: number
  /** dodatkowe dane zdarzenia, np. oferta za zawodnika */
  data?: Record<string, number>
  text: string
  options: { label: string }[]
}

export type Phase = 'hiring' | 'season' | 'transfer' | 'event' | 'seasonEnd' | 'retired'

export interface TransferTarget {
  player: Player
  fee: number
  from: string
  /** czy już próbowano zbić cenę */
  haggled?: boolean
}

export interface Bid {
  playerId: number
  /** klub z naszej piramidy; -1 przy klubie z zagranicy */
  teamId: number
  fee: number
  /** czy już raz negocjowano */
  countered?: boolean
  /** klub z zagranicy (z listy klubów europejskich) */
  abroad?: { name: string; country: string }
}

export interface GameState {
  version: number
  seed: number
  rng: number
  nextId: number
  coach: Coach
  teams: Record<number, Team>
  leagues: League[]
  /** Puchar Polski, etap centralny */
  cup: Cup
  /** Puchar Polski, etap wojewódzki w województwie gracza */
  regionalCup?: Cup
  /** zwycięzca etapu wojewódzkiego z poprzedniego sezonu, gra w etapie centralnym */
  cupQualifier?: number
  playoffs?: Playoff[]
  /** zawodnicy kupieni w tym oknie transferowym */
  signings?: number
  /** zaplecze pierwszej drużyny: zawodnicy drużyny rezerw */
  reserveSquad?: Player[]
  /** trener prowadzi pierwszą drużynę na zastępstwo; po sezonie zostaje albo wraca do rezerw */
  interim?: { reserveId: number; season: number }
  /** baraże zakończonego sezonu, do podsumowania */
  lastPlayoffs?: Playoff[]
  clubId: number | null
  squad: Player[]
  lineup: Lineup
  tactic: Tactic
  trust: Trust
  goal: GoalType
  budget: number
  /** miesięczny limit pensji klubu */
  wageLimit: number
  salary: number
  season: number
  round: number
  phase: Phase
  resumePhase?: Phase
  pendingEvent?: PendingEvent
  transferList: TransferTarget[]
  bids: Bid[]
  modifiers: Modifier[]
  /** pamięć zdarzeń do łańcuchów i warunków */
  flags: Record<string, number>
  /** ostatnie wyniki drużyny: W, D, L */
  streak: string[]
  reports: MatchReport[]
  news: string[]
  history: SeasonRecord[]
  trophies: string[]
  scandals: string[]
  bestPlayer?: { name: string; skill: number }
  offers: JobOffer[]
  seasonsUnemployed: number
  totalStats: { w: number; d: number; l: number; firedCount: number }
  usedEvents: string[]
  lastSeasonSummary?: string[]
  winterWindowDone: boolean
  hiringNote?: string
  retireReason?: string
  /** ostatnia prośba do prezesa o pieniądze */
  lastAsk?: { season: number; round: number }
  asksThisSeason?: number
  /** sezony, w których klub zgłaszał do rozgrywek „trenera na papierze”, bo trener nie miał wymaganej licencji */
  figurant?: number
  /** wybrany start kariery: od niego zależy mnożnik punktów */
  start?: StartInfo
  /** wypalenie: rośnie, gdy trener długo gra pod bardzo wysokim stresem */
  burnout?: number
  /** „brudy”: afery i obietnice bez pokrycia, które dziennikarze zbierają do teczki */
  dirt?: number
  /** trener wziął urlop: sezon przerwy po wypaleniu, nie liczy się jako bezrobocie */
  onLeave?: boolean
  /** jak skończyła się kariera */
  ending?: CareerEnding
  /** ostatni mecz trenera: pokazujemy go, nawet gdy zaraz po nim otwiera się okno albo kończy sezon */
  lastReport?: MatchReport
  /** po ostatnim meczu przed oknem albo końcem sezonu: gra czeka, aż gracz sam przejdzie dalej */
  breakPending?: 'okno' | 'koniec'
  /** ostatnie raporty poprzedniego sezonu: lista meczów zostaje widoczna, dopóki gracz nie przejdzie do podsumowania */
  prevReports?: MatchReport[]
  /** europejskie puchary klubu gracza w bieżącym sezonie */
  euro?: EuroRun
  /** kto gra w Europie w kolejnym sezonie: miejsca 1–3 Ekstraklasy i zdobywca Pucharu Polski */
  euroSpots?: { teamId: number; comp: EuroComp }[]
}

export type EndingKind = 'decyzja' | 'emerytura' | 'wypalenie' | 'skandal' | 'bezrobocie'

export interface CareerEnding {
  kind: EndingKind
  /** krótki tytuł zakończenia, np. „Wypalenie” */
  title: string
  /** opis, jak to się skończyło */
  text: string
  /** „Ostatnie słowo” trenera na karcie */
  lastWord?: string
  /** nagłówek z gazety: „Afera kariery” przy skandalu */
  headline?: string
}

export interface StartInfo {
  license: License
  /** klub wybrany na start; brak = zwykłe oferty z najniższej klasy */
  teamId?: number
  daily?: boolean
  multiplier: number
}
