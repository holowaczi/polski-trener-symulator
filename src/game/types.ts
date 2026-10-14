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

export interface Player {
  id: number
  firstName: string
  lastName: string
  nickname?: string
  age: number
  pos: Position
  skill: number
  potential: number
  /** -3..3 */
  form: number
  /** 0..100 */
  morale: number
  traits: TraitId[]
  injuredFor: number
  goals: number
  apps: number
  /** wartość rynkowa w zł */
  value: number
}

export type Formation = '4-4-2' | '4-3-3' | '5-3-2' | '4-5-1' | '3-5-2'
export type Mentality = 'obrona' | 'balans' | 'atak'
export type Style = 'laga' | 'pressing' | 'posiadanie' | 'kontra'

export interface Tactic {
  formation: Formation
  mentality: Mentality
  style: Style
}

export interface Team {
  id: number
  name: string
  town: string
  level: number
  /** siła drużyn sterowanych przez komputer */
  strength: number
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
  /** rounds[kolejka] = mecze */
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
  /** rundy pucharu, każda to lista par */
  rounds: CupTie[][]
  /** kolejki ligowe, po których rozgrywana jest dana runda */
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
  savings: number
  /** kurs licencyjny w trakcie: ile rund do końca */
  courseLeft: number
}

export interface Trust {
  board: number
  squad: number
  fans: number
}

export type GoalType = 'awans' | 'czołówka' | 'środek' | 'utrzymanie'

export interface MatchReport {
  round: number
  cup?: boolean
  home: number
  away: number
  hg: number
  ag: number
  lines: string[]
  scorers: string[]
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
  text: string
  options: { label: string }[]
}

export type Phase = 'hiring' | 'season' | 'transfer' | 'event' | 'seasonEnd' | 'retired'

export interface TransferTarget {
  player: Player
  fee: number
  from: string
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
  tactic: Tactic
  trust: Trust
  goal: GoalType
  budget: number
  salary: number
  season: number
  round: number
  phase: Phase
  /** faza, do której wracamy po zdarzeniu */
  resumePhase?: Phase
  pendingEvent?: PendingEvent
  transferList: TransferTarget[]
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
  /** komunikat na ekranie wyboru pracy */
  hiringNote?: string
  retireReason?: string
}
