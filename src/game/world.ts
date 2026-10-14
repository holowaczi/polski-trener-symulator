import { CLUB_PREFIXES, FIRST_NAMES, FOREIGN_NAMES, LAST_NAMES, LEVELS, NICKNAMES, TOWNS } from './data'
import type { Rng } from './rng'
import type { Cup, CupTie, Fixture, GameState, League, Player, Position, Team, TraitId } from './types'

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function townFor(rng: Rng, level: number): string {
  if (level <= 2) return `${rng.pick(TOWNS.villageA)} ${rng.pick(TOWNS.villageB)}`
  if (level <= 5) return rng.pick(TOWNS.small)
  return rng.pick(TOWNS.cities)
}

export function makeTeamName(rng: Rng, level: number, used: Set<string>): { name: string; town: string } {
  for (let i = 0; i < 200; i++) {
    const town = townFor(rng, level)
    const name = `${rng.pick(CLUB_PREFIXES)} ${town}`
    if (!used.has(name)) {
      used.add(name)
      return { name, town }
    }
  }
  const town = townFor(rng, level)
  const name = `${rng.pick(CLUB_PREFIXES)} ${town} II`
  used.add(name)
  return { name, town }
}

export function generateWorld(rng: Rng, state: Pick<GameState, 'teams' | 'leagues' | 'nextId'>): void {
  const used = new Set<string>()
  LEVELS.forEach((lv, level) => {
    const ids: number[] = []
    for (let i = 0; i < lv.size; i++) {
      const { name, town } = makeTeamName(rng, level, used)
      const id = state.nextId++
      // w każdej lidze jest kilku faworytów i kilku outsiderów
      const giant = i < 2 ? 6 : i >= lv.size - 3 ? -4 : 0
      state.teams[id] = { id, name, town, level, strength: Math.round(rng.normal(lv.base + giant, 3.5)) }
      ids.push(id)
    }
    state.leagues.push({ level, name: lv.name, teamIds: ids, rounds: [] })
  })
}

/** terminarz każdy z każdym, mecz i rewanż (metoda kołowa) */
export function makeFixtures(rng: Rng, teamIds: number[]): Fixture[][] {
  const ids = rng.shuffle([...teamIds])
  if (ids.length % 2) ids.push(-1)
  const n = ids.length
  const half: Fixture[][] = []
  for (let r = 0; r < n - 1; r++) {
    const round: Fixture[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]
      const b = ids[n - 1 - i]
      if (a === -1 || b === -1) continue
      round.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a })
    }
    half.push(round)
    ids.splice(1, 0, ids.pop()!)
  }
  const second = half.map((round) => round.map((f) => ({ home: f.away, away: f.home })))
  return [...half, ...second]
}

export function playerValue(p: Pick<Player, 'skill' | 'age' | 'potential'>): number {
  const ageFactor = p.age < 22 ? 1.5 : p.age < 27 ? 1.2 : p.age < 31 ? 1 : 0.5
  const potBonus = Math.max(0, p.potential - p.skill) * 0.03 + 1
  const raw = Math.pow(1.13, p.skill - 20) * 400 * ageFactor * potBonus
  if (raw < 1000) return Math.round(raw / 100) * 100
  if (raw < 100_000) return Math.round(raw / 1000) * 1000
  return Math.round(raw / 10_000) * 10_000
}

const TRAIT_POOL: TraitId[] = [
  'imprezowicz', 'szklany', 'lider', 'weteran', 'talent', 'leniwy', 'pracus', 'krol_strzalow', 'kibic_z_mlyna',
]

export function generatePlayer(
  rng: Rng,
  state: Pick<GameState, 'nextId'>,
  level: number,
  pos: Position,
  opts: { age?: number; skillOffset?: number; foreign?: boolean } = {},
): Player {
  const age = opts.age ?? rng.int(17, 34)
  const base = LEVELS[level].base + (opts.skillOffset ?? 0)
  let skill = Math.round(rng.normal(base, 6))
  if (age < 20) skill -= rng.int(3, 8)
  if (age > 32) skill -= rng.int(0, 4)
  skill = clamp(skill, 8, 95)
  const growth = age < 20 ? rng.int(5, 25) : age < 24 ? rng.int(2, 14) : age < 28 ? rng.int(0, 5) : 0
  const potential = clamp(skill + growth, skill, 97)
  const traits: TraitId[] = []
  if (rng.chance(0.4)) {
    let t = rng.pick(TRAIT_POOL)
    if (t === 'weteran' && age < 30) t = 'pracus'
    if (t === 'talent' && age > 23) t = 'krol_strzalow'
    traits.push(t)
  }
  const [firstName, lastName] = opts.foreign ? rng.pick(FOREIGN_NAMES) : [rng.pick(FIRST_NAMES), rng.pick(LAST_NAMES)]
  const p: Player = {
    id: state.nextId++,
    firstName,
    lastName,
    nickname: level <= 3 && rng.chance(0.15) ? rng.pick(NICKNAMES) : undefined,
    age,
    pos,
    skill,
    potential,
    form: 0,
    morale: 60,
    traits,
    injuredFor: 0,
    goals: 0,
    apps: 0,
    value: 0,
  }
  p.value = playerValue(p)
  return p
}

export function generateSquad(rng: Rng, state: Pick<GameState, 'nextId'>, level: number, skillOffset = 0): Player[] {
  const layout: [Position, number][] = [
    ['BR', 2],
    ['OBR', 6],
    ['POM', 6],
    ['NAP', 4],
  ]
  const squad: Player[] = []
  for (const [pos, count] of layout) {
    for (let i = 0; i < count; i++) {
      squad.push(generatePlayer(rng, state, level, pos, { skillOffset, foreign: level >= 5 && rng.chance(0.2) }))
    }
  }
  return squad
}

export function playerName(p: Player): string {
  return p.nickname ? `${p.firstName} „${p.nickname}” ${p.lastName}` : `${p.firstName} ${p.lastName}`
}

export function shortName(p: Player): string {
  return `${p.firstName[0]}. ${p.lastName}`
}

const CUP_ROUND_NAMES = ['1/16 finału', '1/8 finału', 'Ćwierćfinał', 'Półfinał', 'Finał']
export function cupRoundName(i: number): string {
  return CUP_ROUND_NAMES[i] ?? `Runda ${i + 1}`
}

/** losowanie Pucharu Polski: 32 drużyny z różnych poziomów, klub gracza zawsze w drabince */
export function drawCup(rng: Rng, state: GameState): Cup {
  const quota = [2, 2, 3, 3, 4, 4, 6, 8]
  const picked: number[] = []
  state.leagues.forEach((lg) => {
    const pool = rng.shuffle(lg.teamIds.filter((id) => id !== state.clubId))
    picked.push(...pool.slice(0, quota[lg.level]))
  })
  if (state.clubId !== null) {
    picked.pop()
    picked.push(state.clubId)
  }
  const ties = pairUp(rng, state.teams, picked)
  const total = state.leagues.find((l) => l.teamIds.includes(state.clubId ?? -1))?.rounds.length ?? 30
  const schedule = [0.15, 0.35, 0.55, 0.75, 0.95].map((f) => Math.max(1, Math.round(total * f)))
  return { rounds: [ties], schedule }
}

export function pairUp(rng: Rng, teams: Record<number, Team>, ids: number[]): CupTie[] {
  const pool = rng.shuffle([...ids])
  const ties: CupTie[] = []
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const a = teams[pool[i]]
    const b = teams[pool[i + 1]]
    // w Pucharze Polski gospodarzem jest drużyna z niższej ligi
    ties.push(a.level <= b.level ? { home: a.id, away: b.id } : { home: b.id, away: a.id })
  }
  return ties
}

export function leagueOf(state: GameState, teamId: number): League | undefined {
  return state.leagues.find((l) => l.teamIds.includes(teamId))
}
