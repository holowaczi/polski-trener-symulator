import { LEVELS } from './data'
import { MAX_SQUAD, MIN_SQUAD, departureEffects } from './market'
import type { Rng } from './rng'
import type { GameState, Player, Position, Team } from './types'
import { adjustTrust, club, formatMoney, news, setMorale, wageBill, withRng } from './util'
import { generatePlayer, playerName } from './world'

/**
 * Drużyny rezerw: „Klub II” gra w niższej lidze niż „Klub”.
 * Trener pierwszej drużyny może zsyłać zawodników do rezerw i powoływać stamtąd młodych.
 * Trener rezerw musi się liczyć z tym, że pierwsza drużyna zabierze mu najlepszych,
 * a gdy tam zwolnią trenera, może dostać szansę na zastępstwo.
 */

const RESERVE_TOKEN = /\s+(II|III)(?=\s|$)/

/** klub macierzysty drużyny rezerw */
export function parentTeam(s: Pick<GameState, 'teams'>, teamId: number): Team | undefined {
  const t = s.teams[teamId]
  if (!t?.reserve) return undefined
  const name = t.name.replace(RESERVE_TOKEN, '')
  return Object.values(s.teams).find((x) => x.name === name && !x.reserve)
}

/** drużyny rezerw danego klubu, od najwyższej */
export function reserveTeamsOf(s: Pick<GameState, 'teams'>, teamId: number): Team[] {
  const t = s.teams[teamId]
  if (!t || t.reserve) return []
  return Object.values(s.teams)
    .filter((x) => x.reserve && x.name.replace(RESERVE_TOKEN, '') === t.name)
    .sort((a, b) => b.level - a.level)
}

/** zaplecze klubu: kilku młodych i paru doświadczonych z drużyny rezerw */
export function refreshReserves(s: GameState): void {
  const t = club(s)
  const res = t ? reserveTeamsOf(s, t.id)[0] : undefined
  if (!t || !res) {
    s.reserveSquad = undefined
    return
  }
  const offset = res.strength - LEVELS[res.level].base
  const kept = (s.reserveSquad ?? []).filter((p) => p.sentDown)
  s.reserveSquad = withRng(s, (rng) => {
    const list: Player[] = [...kept]
    const positions: Position[] = ['BR', 'OBR', 'OBR', 'POM', 'POM', 'NAP', 'OBR', 'POM']
    for (const [i, pos] of positions.entries()) {
      const young = i < 6
      const p = generatePlayer(rng, s, res.level, pos, { age: young ? rng.int(17, 21) : rng.int(27, 33), skillOffset: offset + (young ? 2 : 0) })
      p.contract = 2
      p.wage = Math.max(100, Math.round((p.wage * 0.6) / 50) * 50)
      list.push(p)
    }
    return list
  })
}

export function reserveTeamName(s: GameState): string | undefined {
  const t = club(s)
  return t ? reserveTeamsOf(s, t.id)[0]?.name : undefined
}

/** zawodnik idzie grać do rezerw: młodym to służy, starszym nie bardzo */
export function sendDown(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  const res = reserveTeamName(s)
  if (!p || !res) return ''
  if (s.squad.length <= MIN_SQUAD) return `W pierwszej drużynie musi zostać co najmniej ${MIN_SQUAD} zawodników.`
  s.squad = s.squad.filter((x) => x.id !== p.id)
  s.lineup.xi = s.lineup.xi.filter((id) => id !== p.id)
  s.lineup.bench = s.lineup.bench.filter((id) => id !== p.id)
  s.bids = s.bids.filter((b) => b.playerId !== p.id)
  if (p.traits.includes('syn_prezesa')) adjustTrust(s, { board: -8 })
  p.sentDown = true
  if (p.age <= 21) {
    setMorale(p, 4)
    p.minutesBoost = (p.minutesBoost ?? 0) + 1
  } else setMorale(p, -12)
  ;(s.reserveSquad ??= []).unshift(p)
  const msg =
    p.age <= 21
      ? `${playerName(p)} idzie do ${res} po minuty. „Wrócę silniejszy” – mówi i zabiera korki.`
      : `${playerName(p)} zesłany do ${res}. Na treningu rezerw ćwiczy głównie minę obrażonego.`
  news(s, msg)
  return msg
}

/** powołanie z rezerw do pierwszej drużyny */
export function callUp(s: GameState, playerId: number): string {
  const p = s.reserveSquad?.find((x) => x.id === playerId)
  if (!p) return ''
  if (s.squad.length >= MAX_SQUAD) return `Kadra pierwszej drużyny jest pełna (${MAX_SQUAD}).`
  // zesłani już są na liście płac, nowi z rezerw dostają kontrakt pierwszej drużyny
  if (!p.sentDown && wageBill(s) + p.wage > s.wageLimit) return `Po powołaniu pensje przekroczą limit (${formatMoney(s.wageLimit)}/mies.).`
  s.reserveSquad = s.reserveSquad!.filter((x) => x.id !== p.id)
  const back = p.sentDown
  p.sentDown = undefined
  setMorale(p, back ? 8 : 15)
  s.squad.push(p)
  const msg = back ? `${playerName(p)} wraca z rezerw. Obiecuje, że już nie będzie się obrażał.` : `${playerName(p)} (${p.age} l.) dostaje powołanie z rezerw. Mama już dzwoni do całej rodziny.`
  news(s, msg)
  return msg
}

/** koniec sezonu: zesłani wracają na okres przygotowawczy, reszta zaplecza się zmienia */
export function returnSentDown(s: GameState): string[] {
  const back = (s.reserveSquad ?? []).filter((p) => p.sentDown)
  if (!back.length) return []
  const grew: string[] = []
  for (const p of back) {
    p.sentDown = undefined
    // regularna gra w rezerwach daje młodym więcej niż ławka w pierwszej drużynie
    if (p.minutesBoost && p.skill < p.potential) {
      p.skill = Math.min(p.potential, p.skill + 2)
      grew.push(playerName(p))
    }
    p.minutesBoost = undefined
  }
  s.squad.push(...back)
  s.reserveSquad = (s.reserveSquad ?? []).filter((p) => !back.includes(p))
  const notes = [`Z rezerw na okres przygotowawczy wracają: ${back.map(playerName).join(', ')}.`]
  if (grew.length) notes.push(`Minuty w rezerwach zrobiły swoje: ${grew.join(', ')} wyraźnie się rozwinęli.`)
  return notes
}

/**
 * Trener rezerw: na otwarcie okna pierwsza drużyna czasem zabiera najlepszego młodego
 * i w zamian odsyła kogoś, kto u nich nie gra.
 */
export function parentRaid(rng: Rng, s: GameState): void {
  const t = club(s)
  const parent = t ? parentTeam(s, t.id) : undefined
  if (!t || !parent || !rng.chance(0.45)) return
  const best = [...s.squad].filter((p) => p.age <= 23).sort((a, b) => b.skill - a.skill)[0]
  if (!best || best.skill < LEVELS[t.level].base + 3 || s.squad.length <= MIN_SQUAD) return
  departureEffects(s, best)
  const vet = generatePlayer(rng, s, t.level, best.pos, { age: rng.int(28, 33), skillOffset: 3 })
  vet.morale = 40
  vet.contract = 1
  s.squad.push(vet)
  adjustTrust(s, { squad: -2 })
  news(
    s,
    `${parent.name} zabiera do pierwszej drużyny ${playerName(best)}. W zamian przysyłają ${playerName(vet)} (${vet.age} l.), który „potrzebuje minut”. Tak działa piramida.`,
  )
}
