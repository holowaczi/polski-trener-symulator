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
  rounds: CupTie[][]
  /** tygodnie, w których rozgrywana jest dana runda */
  schedule: number[]
  eliminatedAt?: number
  winner?: number
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
}

export interface MatchReport {
  round: number
  cup?: boolean
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
}

export interface Bid {
  playerId: number
  teamId: number
  fee: number
  /** czy już raz negocjowano */
  countered?: boolean
}

export interface GameState {
  version: number
  seed: number
  rng: number
  nextId: number
  coach: Coach
  teams: Record<number, Team>
  leagues: League[]
  cup: Cup
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
}
