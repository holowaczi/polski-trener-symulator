import { CLUB_PREFIXES, FIRST_NAMES, FOREIGN_NAMES, LAST_NAMES, LEVELS, POLAND, TOWNS } from './data'
import { EKSTRAKLASA, III_LIGA, II_LIGA, I_LIGA, REGION_GROUP, REGION_TOWNS, type RealClub } from './realData'
import { LOWER_LEAGUES } from './lowerData'
import type { Rng } from './rng'
import type { Fixture, GameState, League, Player, Position, TraitId } from './types'
import { regionOfTown } from './regions'

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** prawdziwe grupy dla poziomów 0–3 (IV liga i niżej), od IV ligi w dół */
function lowerTier(level: number, region: string) {
  return LOWER_LEAGUES[region]?.[5 - level]
}

/** domyślna liczba grup, gdy nie mamy danych: im niżej, tym więcej grup */
const DEFAULT_GROUPS = [0, 0, 4, 3, 2, 1]

export function leagueName(level: number, region: string): string {
  if (level === 6) return `III liga (gr. ${REGION_GROUP[region] ?? 'I'})`
  if (level <= 5) return `${lowerTier(level, region)?.tier ?? LEVELS[level].name} · ${region}`
  return LEVELS[level].name
}

const TIER_SHORT: Record<string, string> = {
  'IV liga': 'IV',
  'V liga': 'V',
  'Klasa okręgowa': 'Okr.',
  'Liga okręgowa': 'Okr.',
  'Klasa A': 'A',
  'Klasa B': 'B',
  'Klasa C': 'C',
}

/** krótka nazwa poziomu na oś wykresu, według lig w województwie; brak = takiego poziomu tam nie ma */
export function levelShort(level: number, region: string): string | undefined {
  if (level >= 6) return ['III', 'II', 'I', 'Ekstraklasa'][level - 6]
  const tier = lowerTier(level, region)?.tier
  return tier ? (TIER_SHORT[tier] ?? tier) : undefined
}

/** najniższy poziom, który istnieje w województwie */
export function lowestLevel(region: string): number {
  let lv = 5
  while (lv > 0 && levelShort(lv - 1, region)) lv--
  return lv
}

/** wszystkie drużyny na danym poziomie, ze wszystkich grup */
export function teamsAtLevel(state: Pick<GameState, 'leagues'>, level: number): number[] {
  return state.leagues.filter((l) => l.level === level).flatMap((l) => l.teamIds)
}

/** najniższy poziom rozgrywek w województwie gracza */
export function bottomLevel(state: Pick<GameState, 'leagues'>): number {
  return state.leagues.reduce((m, l) => Math.min(m, l.level), LEVELS.length - 1)
}

function villageName(rng: Rng): string {
  return `${rng.pick(TOWNS.villageA)} ${rng.pick(TOWNS.villageB)}`
}

/**
 * Świat gry: prawdziwe ligi centralne, wszystkie cztery grupy III ligi i IV ligi wszystkich województw.
 * Niżej (okręgówka, klasy A, B, C) gramy tylko w województwie gracza.
 * Brakujące miejsca dopełniają fikcyjne kluby z prawdziwych miejscowości.
 */
export function generateWorld(rng: Rng, state: Pick<GameState, 'teams' | 'leagues' | 'nextId'>, region: string): void {
  const used = new Set<string>()
  const townsOf = new Map<string, { list: string[]; i: number }>()
  const nextTown = (r: string) => {
    let t = townsOf.get(r)
    if (!t) townsOf.set(r, (t = { list: rng.shuffle([...(REGION_TOWNS[r] ?? TOWNS.small)]), i: 0 }))
    return t.list[t.i++ % t.list.length]
  }

  const addReal = (level: number, clubs: RealClub[]) => {
    const ids: number[] = []
    for (const c of clubs) {
      const id = state.nextId++
      state.teams[id] = { id, name: c.name, town: c.town, level, strength: c.strength, real: true, reserve: c.reserve, region: regionOfTown(c.town) }
      used.add(c.name)
      ids.push(id)
    }
    return ids
  }

  /** grupy jednego poziomu w jednym województwie */
  const addRegional = (level: number, r: string) => {
    const lv = LEVELS[level]
    const tier = lowerTier(level, r)
    const realGroups = tier?.groups.filter((g) => g.clubs.length) ?? []
    const groups = realGroups.length
      ? realGroups
      : Array.from({ length: tier ? 1 : DEFAULT_GROUPS[level] }, (_, i) => ({ name: `gr. ${i + 1}`, clubs: [] }))
    const tierName = tier?.groups.length ? tier.tier : LEVELS[level].name
    for (const g of groups) {
      const real = rng.shuffle([...g.clubs]).filter((c) => !used.has(c.name))
      // rozmiar grupy jak w rzeczywistości (8–18), przy niepełnych danych standardowy
      const size = real.length >= 8 ? Math.min(real.length, 18) : lv.size
      const gids: number[] = []
      for (let i = 0; i < size; i++) {
        let name = ''
        let town = ''
        const reserve = real[i]?.reserve
        if (real[i]) {
          name = real[i].name
          town = real[i].town
        } else
          for (let tries = 0; tries < 50; tries++) {
            town = level >= 4 ? nextTown(r) : villageName(rng)
            name = `${rng.pick(CLUB_PREFIXES)} ${town}`
            if (!used.has(name)) break
          }
        used.add(name)
        const id = state.nextId++
        // w każdej grupie jest kilku faworytów i kilku outsiderów
        const bump = i < 2 ? 5 : i >= size - 3 ? -4 : 0
        state.teams[id] = { id, name, town, level, strength: Math.round(rng.normal(lv.base + bump, 3.5)), real: real[i] ? true : undefined, reserve, region: r }
        gids.push(id)
      }
      const name = groups.length === 1 ? `${tierName} · ${r}` : `${tierName} · ${g.name}`
      state.leagues.push({ level, name, group: g.name, region: r, teamIds: gids, rounds: [] })
    }
  }

  state.leagues.push({ level: 9, name: LEVELS[9].name, teamIds: addReal(9, EKSTRAKLASA), rounds: [] })
  state.leagues.push({ level: 8, name: LEVELS[8].name, teamIds: addReal(8, I_LIGA), rounds: [] })
  state.leagues.push({ level: 7, name: LEVELS[7].name, teamIds: addReal(7, II_LIGA), rounds: [] })
  // III liga: grupa gracza pierwsza, potem pozostałe
  const mine = REGION_GROUP[region] ?? 'I'
  for (const grp of [mine, ...(Object.keys(III_LIGA) as (keyof typeof III_LIGA)[]).filter((x) => x !== mine)])
    state.leagues.push({ level: 6, name: `III liga (gr. ${grp})`, group: grp, teamIds: addReal(6, III_LIGA[grp as keyof typeof III_LIGA]), rounds: [] })
  // IV liga wszędzie, ale województwo gracza ma też niższe ligi
  addRegional(5, region)
  for (let level = 4; level >= 0; level--) addRegional(level, region)
  for (const r of Object.keys(LOWER_LEAGUES).sort((a, b) => a.localeCompare(b, 'pl'))) if (r !== region) addRegional(5, r)
}

/**
 * Nowe drużyny w grupie spoza świata gry: do IV ligi innego województwa wchodzą kluby z jego okręgówki
 * (najpierw ci, którzy kiedyś z niej spadli), do najniższej klasy nowe kluby ze wsi.
 */
export function newcomerTeams(rng: Rng, s: Pick<GameState, 'teams' | 'leagues' | 'nextId' | 'coach'>, lg: League, count: number): number[] {
  const region = lg.region ?? s.coach.region
  const inLeague = new Set(s.leagues.flatMap((l) => l.teamIds))
  const names = new Set(Object.values(s.teams).map((t) => t.name))
  const level = lg.level
  const ids: number[] = []
  const returning = rng.shuffle(
    Object.values(s.teams).filter((t) => !inLeague.has(t.id) && !t.guest && t.region === region && t.level === level - 1),
  )
  const fresh = level === 5 ? rng.shuffle(lowerTier(4, region)?.groups.flatMap((g) => g.clubs) ?? []).filter((c) => !names.has(c.name) && !c.reserve) : []
  for (let i = 0; i < count; i++) {
    const back = level === 5 && rng.chance(0.5) ? returning.pop() : undefined
    if (back) {
      back.level = level
      back.strength = Math.round(rng.normal(LEVELS[level].base + 2, 3))
      ids.push(back.id)
      continue
    }
    const c = fresh.pop()
    let name = c?.name ?? ''
    let town = c?.town ?? ''
    if (!c)
      for (let tries = 0; tries < 50; tries++) {
        town = level >= 4 ? rng.pick(REGION_TOWNS[region] ?? TOWNS.small) : villageName(rng)
        name = `${rng.pick(CLUB_PREFIXES)} ${town}`
        if (!names.has(name)) break
      }
    names.add(name)
    const id = s.nextId++
    s.teams[id] = { id, name, town, level, strength: Math.round(rng.normal(LEVELS[level].base + (level === 5 ? 2 : -2), 3)), real: c ? true : undefined, region }
    ids.push(id)
  }
  return ids
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
  // długość umowy bez losowania, żeby nie zmieniać przebiegu świata: 1–3 sezony
  if (full.contract === undefined) full.contract = 1 + ((full.id * 7 + full.age) % 3)
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
    nation: country?.country ?? POLAND.country,
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
      const p = generatePlayer(rng, state, level, pos, { skillOffset: skillOffset + starterBonus, foreign: level >= 7 && rng.chance(0.25) })
      // w jednej kadrze bez powtórzonych nazwisk, żeby relacja z meczu była czytelna
      for (let tries = 0; tries < 8 && FIRST_NAMES.includes(p.firstName) && squad.some((x) => x.lastName === p.lastName); tries++) p.lastName = rng.pick(LAST_NAMES)
      squad.push(p)
    }
  }
  return squad
}

/** kraj zawodnika; stare zapisy nie mają narodowości, więc zgadujemy ją z nazwiska */
export function nationOf(p: Pick<Player, 'nation' | 'lastName'>): string {
  return p.nation ?? FOREIGN_NAMES.find((c) => c.last.includes(p.lastName))?.country ?? POLAND.country
}

/** czy zawodnik może grać w reprezentacji Polski */
export function isPolish(p: Pick<Player, 'nation' | 'lastName'>): boolean {
  return nationOf(p) === POLAND.country
}

/** dane kraju: flaga i dopełniacz („reprezentacji Chorwacji”) */
export function nationInfo(nation: string): { country: string; gen: string; flag: string } {
  return FOREIGN_NAMES.find((c) => c.country === nation) ?? POLAND
}

export function playerName(p: Player): string {
  return `${p.firstName} ${p.lastName}`
}

export function shortName(p: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${p.firstName[0]}. ${p.lastName}`
}

export function leagueOf(state: Pick<GameState, 'leagues'>, teamId: number): League | undefined {
  return state.leagues.find((l) => l.teamIds.includes(teamId))
}
