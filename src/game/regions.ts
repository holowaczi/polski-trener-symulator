import { LOWER_LEAGUES } from './lowerData'
import { REGION_GROUP, REGION_TOWNS, TOWN_REGION } from './realData'
import type { GameState, League } from './types'

/**
 * Województwa w świecie gry: każdy klub ma swoje, żeby spadkowicz z II ligi trafiał
 * do właściwej grupy III ligi, a spadkowicz z III ligi do IV ligi swojego województwa.
 */

const townRegion = new Map<string, string>(Object.entries(TOWN_REGION))
for (const [region, towns] of Object.entries(REGION_TOWNS)) for (const t of towns) if (!townRegion.has(t)) townRegion.set(t, region)
for (const [region, tiers] of Object.entries(LOWER_LEAGUES))
  for (const tier of tiers) for (const g of tier.groups) for (const c of g.clubs) if (!townRegion.has(c.town)) townRegion.set(c.town, region)

/** województwo klubu po miejscowości; undefined, gdy nie wiemy */
export function regionOfTown(town: string): string | undefined {
  return townRegion.get(town)
}

/** województwo drużyny; stare zapisy nie mają go zapisanego, więc zgadujemy po miejscowości */
export function teamRegion(s: Pick<GameState, 'teams' | 'coach'>, id: number): string {
  const t = s.teams[id]
  return t?.region ?? (t ? regionOfTown(t.town) : undefined) ?? s.coach.region
}

/** województwo ligi (IV liga i niżej); ligi centralne i III liga nie mają jednego województwa */
export function leagueRegion(s: Pick<GameState, 'coach'>, lg: League): string | undefined {
  return lg.level <= 5 ? (lg.region ?? s.coach.region) : undefined
}

/** grupa III ligi województwa */
export function thirdGroupOf(region: string): string {
  return REGION_GROUP[region] ?? 'I'
}
