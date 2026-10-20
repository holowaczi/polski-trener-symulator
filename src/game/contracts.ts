import { LEVELS } from './data'
import type { Rng } from './rng'
import type { GameState, Player } from './types'
import { adjustTrust, avgRating, club, formatMoney, news, setMorale, wageBill } from './util'
import { playerName, wageFor } from './world'
import { departureEffects } from './market'

/**
 * Kontrakty: każdy zawodnik ma umowę na określoną liczbę sezonów.
 * Pensja nie rośnie sama z siebie: o podwyżce decydują negocjacje, kiedy umowa się kończy.
 * Zawodnik w ostatnim roku umowy może zostać przedłużony w każdym oknie transferowym,
 * a ten, któremu umowa wygasła, odchodzi za darmo, jeśli nie podpisze nowej przed zamknięciem okna.
 */

/** sezony do końca umowy; stare zapisy nie miały kontraktów */
export function contractOf(p: Player): number {
  return p.contract ?? 1
}

/** czy z zawodnikiem można rozmawiać o nowej umowie */
export function canNegotiate(p: Player): boolean {
  return contractOf(p) <= 1 && !p.talksOver && !p.newSigning
}

/** ile lat umowy chce zawodnik: młodzi długo, weterani też, bo boją się końca kariery */
export function wantedYears(p: Player): number {
  if (p.age <= 23) return 3
  if (p.age >= 32) return 2
  return p.potential - p.skill >= 4 ? 3 : 2
}

/** żądanie płacowe zawodnika przy nowej umowie */
export function wageDemand(s: GameState, p: Player): number {
  const t = club(s)
  let w = wageFor(p.skill)
  const r = avgRating(p)
  if (r !== undefined) w *= 1 + Math.max(-0.1, Math.min(0.35, (r - 6.4) * 0.25))
  if (p.age <= 23 && p.potential - p.skill >= 6) w *= 1.15
  if (p.age >= 33) w *= 0.85
  if (p.morale < 40) w *= 1.2
  if (p.traits.includes('lider')) w *= 1.1
  if (p.traits.includes('talent')) w *= 1.15
  if (p.traits.includes('weteran')) w *= 0.9
  if (p.traits.includes('syn_prezesa')) w *= 0.8
  // za dobry na tę ligę: chce, żeby mu to wynagrodzić
  if (t && p.skill > LEVELS[t.level].base + 8 && p.age < 30) w *= 1.3
  // nikt nie podpisze umowy na gorszych warunkach niż obecne, chyba że to weteran
  const floor = p.age >= 33 ? p.wage * 0.85 : p.wage
  w = Math.max(w, floor)
  return roundWage(w)
}

function roundWage(w: number): number {
  return w < 1000 ? Math.max(100, Math.round(w / 50) * 50) : Math.round(w / 100) * 100
}

function sign(s: GameState, p: Player, wage: number, years: number): string {
  const others = wageBill(s) - p.wage
  if (others + wage > s.wageLimit)
    return `Po podpisaniu pensje przekroczą limit (${formatMoney(s.wageLimit)}/mies.). Poproś prezesa o większy limit albo kogoś sprzedaj.`
  const raise = wage - p.wage
  p.wage = wage
  p.contract = years
  p.talksOver = undefined
  p.haggled = undefined
  setMorale(p, raise > 0 ? 8 : 2)
  const msg = `${playerName(p)} podpisuje nową umowę na ${years} ${years === 1 ? 'sezon' : 'sezony'} za ${formatMoney(wage)}/mies.`
  news(s, msg)
  return msg
}

/** przyjęcie warunków zawodnika */
export function acceptDemand(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p || !canNegotiate(p)) return ''
  return sign(s, p, p.haggled ?? wageDemand(s, p), wantedYears(p))
}

/** próba zbicia ceny o 15 procent: szansa zależy od morale, minut na boisku i ambicji zawodnika */
export function haggle(rng: Rng, s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p || !canNegotiate(p)) return ''
  const demand = p.haggled ?? wageDemand(s, p)
  if (p.haggled !== undefined) {
    // drugie targowanie to obraza
    p.talksOver = true
    setMorale(p, -15)
    return `${playerName(p)}: „To ja już podziękuję”. Agent zamyka rozmowy. Zawodnik odejdzie, gdy wygaśnie umowa.`
  }
  const t = club(s)!
  const r = avgRating(p) ?? 6.3
  const plays = p.benchStreak < 3 ? 0.15 : -0.15
  const loyal = (p.traits.includes('weteran') ? 0.15 : 0) + (p.traits.includes('lider') ? 0.05 : 0)
  const ambitious = p.skill > LEVELS[t.level].base + 6 && p.age < 30 ? -0.2 : 0
  const chance = 0.4 + (p.morale - 55) / 150 + plays + loyal + ambitious - Math.max(0, r - 6.8) * 0.3
  if (rng.chance(Math.max(0.05, Math.min(0.9, chance)))) return sign(s, p, roundWage(demand * 0.85), wantedYears(p))
  p.haggled = demand
  setMorale(p, -8)
  return `${playerName(p)} nie schodzi z ${formatMoney(demand)}/mies. Kolejna próba targowania może skończyć rozmowy.`
}

/** pożegnanie: zawodnik odchodzi od razu, bez odprawy */
export function letGo(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return ''
  const extra = departureEffects(s, p)
  const msg = `${playerName(p)} żegna się z klubem. Dostaje pamiątkową koszulkę z podpisami.${extra}`
  news(s, msg)
  return msg
}

/** koniec okna: zawodnicy bez ważnej umowy odchodzą za darmo */
export function expireContracts(s: GameState): string[] {
  const notes: string[] = []
  for (const p of [...s.squad]) {
    if (contractOf(p) > 0) continue
    const extra = departureEffects(s, p)
    notes.push(`${playerName(p)} odchodzi na zasadzie wolnego transferu.${extra}`)
  }
  if (notes.length) adjustTrust(s, { squad: -Math.min(6, notes.length) })
  for (const n of notes) news(s, n)
  return notes
}

/** koniec sezonu: umowy skracają się o rok, niedopłaceni zawodnicy marudzą */
export function seasonContracts(s: GameState): string[] {
  const notes: string[] = []
  for (const p of s.squad) {
    p.contract = contractOf(p) - 1
    p.talksOver = undefined
    p.haggled = undefined
    if (p.contract > 0 && wageFor(p.skill) > p.wage * 1.3) {
      setMorale(p, -6)
      if (notes.length < 3) notes.push(`${playerName(p)} uważa, że zarabia za mało. Wróci do tematu, gdy będzie się kończyć umowa.`)
    }
  }
  const expiring = s.squad.filter((p) => p.contract === 0).length
  if (expiring) notes.unshift(`Kończą się umowy ${expiring} zawodnikom. Negocjacje w oknie transferowym, inaczej odejdą za darmo.`)
  return notes
}
