import { CLUB_PREFIXES, FIRST_NAMES, FOREIGN_NAMES, LAST_NAMES, LEVELS, TOWNS } from './data'
import { EKSTRAKLASA, III_LIGA, II_LIGA, I_LIGA, REGION_GROUP, REGION_TOWNS, type RealClub } from './realData'
import { LOWER_LEAGUES } from './lowerData'
import type { Rng } from './rng'
import type { Cup, CupTie, Fixture, GameState, League, Player, Position, Team, TraitId } from './types'

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** prawdziwa grupa ligowa dla poziomów 0–3 (IV liga i niżej), jeśli ją mamy */
function lowerGroup(level: number, region: string) {
  const g = LOWER_LEAGUES[region]?.[3 - level]
  return g && g.clubs.length ? g : undefined
}

export function leagueName(level: number, region: string): string {
  if (level === 4) return `III liga (gr. ${REGION_GROUP[region] ?? 'I'})`
  const g = level <= 3 ? lowerGroup(level, region) : undefined
  if (g) return g.group === g.tier ? `${g.tier} · ${region}` : `${g.tier} · ${g.group}`
  if (level <= 3) return `${LEVELS[level].name} · ${region}`
  return LEVELS[level].name
}

function villageName(rng: Rng): string {
  return `${rng.pick(TOWNS.villageA)} ${rng.pick(TOWNS.villageB)}`
}

/** Świat gry: prawdziwe ligi od Ekstraklasy do B-klasy w regionie gracza; brakujące miejsca dopełniają fikcyjne kluby z prawdziwych miejscowości. */
export function generateWorld(rng: Rng, state: Pick<GameState, 'teams' | 'leagues' | 'nextId'>, region: string): void {
  const used = new Set<string>()
  const towns = rng.shuffle([...(REGION_TOWNS[region] ?? TOWNS.small)])
  let townIdx = 0
  const nextTown = () => towns[townIdx++ % towns.length]

  const addReal = (level: number, clubs: RealClub[]) => {
    const ids: number[] = []
    for (const c of clubs) {
      const id = state.nextId++
      state.teams[id] = { id, name: c.name, town: c.town, level, strength: c.strength, real: true, reserve: c.reserve }
      used.add(c.name)
      ids.push(id)
    }
    return ids
  }

  for (let level = 0; level < LEVELS.length; level++) {
    const lv = LEVELS[level]
    let ids: number[]
    if (level === 7) ids = addReal(level, EKSTRAKLASA)
    else if (level === 6) ids = addReal(level, I_LIGA)
    else if (level === 5) ids = addReal(level, II_LIGA)
    else if (level === 4) ids = addReal(level, III_LIGA[REGION_GROUP[region] ?? 'I'])
    else {
      ids = []
      // prawdziwe kluby z grupy w regionie, w losowej kolejności; brakujące miejsca dopełniamy fikcyjnymi
      const real = rng.shuffle([...(lowerGroup(level, region)?.clubs ?? [])]).filter((c) => !used.has(c.name))
      for (let i = 0; i < lv.size; i++) {
        let name = ''
        let town = ''
        const reserve = real[i]?.reserve
        if (real[i]) {
          name = real[i].name
          town = real[i].town
        } else for (let tries = 0; tries < 50; tries++) {
          town = level >= 2 ? nextTown() : villageName(rng)
          name = `${rng.pick(CLUB_PREFIXES)} ${town}`
          if (!used.has(name)) break
        }
        used.add(name)
        const id = state.nextId++
        // w każdej lidze jest kilku faworytów i kilku outsiderów
        const tier = i < 2 ? 5 : i >= lv.size - 3 ? -4 : 0
        state.teams[id] = { id, name, town, level, strength: Math.round(rng.normal(lv.base + tier, 3.5)), real: real[i] ? true : undefined, reserve }
        ids.push(id)
      }
    }
    state.leagues.push({ level, name: leagueName(level, region), teamIds: ids, rounds: [] })
  }
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

/** pensja miesięczna: w B-klasie zwrot za paliwo, w Ekstraklasie dziesiątki tysięcy */
export function wageFor(skill: number): number {
  const raw = 300 * Math.pow(1.1, skill - 20)
  if (raw < 1000) return Math.max(100, Math.round(raw / 50) * 50)
  if (raw < 20_000) return Math.round(raw / 100) * 100
  return Math.round(raw / 1000) * 1000
}

const TRAIT_POOL: TraitId[] = [
  'imprezowicz', 'szklany', 'lider', 'weteran', 'talent', 'leniwy', 'pracus', 'krol_strzalow', 'kibic_z_mlyna', 'narwany',
]

export function newPlayer(
  state: Pick<GameState, 'nextId'>,
  p: Pick<Player, 'firstName' | 'lastName' | 'age' | 'pos' | 'skill' | 'potential'> & Partial<Player>,
): Player {
  const full: Player = {
    id: state.nextId++,
    form: 0,
    morale: 60,
    traits: [],
    injuredFor: 0,
    suspendedFor: 0,
    yellows: 0,
    goals: 0,
    assists: 0,
    apps: 0,
    ratings: [],
    ratingSum: 0,
    progress: 0,
    benchStreak: 0,
    value: 0,
    wage: 0,
    ...p,
  }
  full.value = playerValue(full)
  full.wage = wageFor(full.skill)
  return full
}

export function generatePlayer(
  rng: Rng,
  state: Pick<GameState, 'nextId'>,
  level: number,
  pos: Position,
  opts: { age?: number; skillOffset?: number; foreign?: boolean } = {},
): Player {
  const age = opts.age ?? rng.int(17, 34)
  const base = LEVELS[level].base + (opts.skillOffset ?? 0)
  let skill = Math.round(rng.normal(base, 5))
  if (age < 20) skill -= rng.int(3, 8)
  if (age > 32) skill -= rng.int(0, 4)
  skill = clamp(skill, 8, 95)
  // potencjał: młodzi mają zapas, ale rzadko ogromny
  const growth = age < 20 ? rng.int(4, 18) : age < 23 ? rng.int(2, 10) : age < 27 ? rng.int(0, 4) : 0
  const potential = clamp(skill + growth, skill, 95)
  const traits: TraitId[] = []
  if (rng.chance(0.4)) {
    let t = rng.pick(TRAIT_POOL)
    if (t === 'weteran' && age < 30) t = 'pracus'
    if (t === 'talent' && age > 23) t = 'krol_strzalow'
    if (t === 'krol_strzalow' && pos === 'BR') t = 'lider'
    traits.push(t)
  }
  const country = opts.foreign ? rng.pick(FOREIGN_NAMES) : undefined
  const [firstName, lastName] = country ? [rng.pick(country.first), rng.pick(country.last)] : [rng.pick(FIRST_NAMES), rng.pick(LAST_NAMES)]
  return newPlayer(state, {
    firstName,
    lastName,
    age,
    pos,
    skill,
    potential,
    traits,
  })
}

export function generateSquad(rng: Rng, state: Pick<GameState, 'nextId'>, level: number, skillOffset = 0): Player[] {
  const layout: [Position, number][] = [
    ['BR', 3],
    ['OBR', 7],
    ['POM', 7],
    ['NAP', 4],
  ]
  const squad: Player[] = []
  for (const [pos, count] of layout) {
    for (let i = 0; i < count; i++) {
      // pierwsza jedenastka trochę mocniejsza od zmienników
      const starterBonus = i < (pos === 'BR' ? 1 : pos === 'NAP' ? 2 : 4) ? 2 : -2
      const p = generatePlayer(rng, state, level, pos, { skillOffset: skillOffset + starterBonus, foreign: level >= 5 && rng.chance(0.25) })
      // w jednej kadrze bez powtórzonych nazwisk, żeby relacja z meczu była czytelna
      for (let tries = 0; tries < 8 && FIRST_NAMES.includes(p.firstName) && squad.some((x) => x.lastName === p.lastName); tries++) p.lastName = rng.pick(LAST_NAMES)
      squad.push(p)
    }
  }
  return squad
}

export function playerName(p: Player): string {
  return `${p.firstName} ${p.lastName}`
}

export function shortName(p: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${p.firstName[0]}. ${p.lastName}`
}

const CUP_ROUND_NAMES = ['1/16 finału', '1/8 finału', 'Ćwierćfinał', 'Półfinał', 'Finał']
export function cupRoundName(i: number): string {
  return CUP_ROUND_NAMES[i] ?? `Runda ${i + 1}`
}

/** losowanie Pucharu Polski: 32 drużyny z różnych poziomów, klub gracza zawsze w drabince */
export function drawCup(rng: Rng, state: GameState, weeks: number): Cup {
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
  const schedule = [0.12, 0.3, 0.5, 0.7, 0.9].map((f) => Math.max(1, Math.round(weeks * f)))
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

export function leagueOf(state: Pick<GameState, 'leagues'>, teamId: number): League | undefined {
  return state.leagues.find((l) => l.teamIds.includes(teamId))
}
