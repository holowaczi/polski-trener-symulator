import { LEVELS } from './data'
import type { Rng } from './rng'
import type { Bid, GameState, Player, Position, Team } from './types'
import { adjustTrust, avgRating, club, formatMoney, news, setMorale, wageBill, withRng } from './util'
import { generatePlayer, playerName, teamsAtLevel, wageFor } from './world'

export const MAX_SQUAD = 28
export const MIN_SQUAD = 16

/** miesięczny limit pensji: zależy od ligi i zamożności klubu */
export function wageLimitFor(team: Team): number {
  const base = LEVELS[team.level].base
  const rich = 1.1 + (team.strength - base) / 40
  return Math.round((22 * wageFor(base + 1) * rich) / 100) * 100
}

export function refreshTransferList(s: GameState): void {
  const t = club(s)
  if (!t) return
  s.transferList = withRng(s, (rng) => {
    const list = []
    const positions: Position[] = ['BR', 'OBR', 'OBR', 'OBR', 'POM', 'POM', 'POM', 'NAP', 'NAP', 'NAP', 'POM', 'OBR']
    for (const pos of positions) {
      const free = rng.chance(0.3)
      const p = generatePlayer(rng, s, t.level, pos, {
        skillOffset: free ? -4 : rng.int(-3, 4),
        foreign: rng.chance(t.level >= 6 ? 0.25 : 0.05),
      })
      // gwiazdy z niższych lig chcą więcej
      p.wage = Math.round((p.wage * (free ? 0.9 : 1 + rng.next() * 0.3)) / 100) * 100
      const fee = free ? 0 : Math.round((p.value * (1 + rng.next() * 0.8)) / 100) * 100
      const from = free ? 'wolny zawodnik' : s.teams[rng.pick(teamsAtLevel(s, t.level).filter((x) => x !== t.id))].name
      list.push({ player: p, fee, from })
    }
    return list
  })
}

export function buyPlayer(s: GameState, playerId: number): string {
  const idx = s.transferList.findIndex((x) => x.player.id === playerId)
  if (idx < 0) return ''
  const tt = s.transferList[idx]
  if (tt.fee > s.budget) return 'Brakuje pieniędzy. Prezes proponuje zapłacić w ziemniakach, ale klub sprzedający odmawia.'
  if (wageBill(s) + tt.player.wage > s.wageLimit)
    return `Przekroczysz limit pensji (${formatMoney(s.wageLimit)}/mies.). Najpierw kogoś sprzedaj.`
  if (s.squad.length >= MAX_SQUAD) return `Kadra jest pełna (${MAX_SQUAD}). Najpierw kogoś zwolnij.`
  s.budget -= tt.fee
  tt.player.morale = 70
  s.squad.push(tt.player)
  s.transferList.splice(idx, 1)
  const msg = `${playerName(tt.player)} dołącza do ${club(s)!.name}${tt.fee ? ` za ${formatMoney(tt.fee)}` : ' za darmo'}.`
  news(s, msg)
  return msg
}

/** skutki odejścia zawodnika dla szatni, zarządu i kibiców */
export function departureEffects(s: GameState, p: Player): string {
  let extra = ''
  if (p.traits.includes('syn_prezesa')) {
    adjustTrust(s, { board: -20 })
    extra += ' Prezes nie odbiera telefonów.'
  }
  if (p.traits.includes('kibic_z_mlyna')) {
    adjustTrust(s, { fans: -10 })
    extra += ' Na trybunach gwizdy.'
  }
  if (p.traits.includes('lider')) {
    adjustTrust(s, { squad: -6 })
    extra += ' Szatnia straciła lidera.'
  }
  s.lineup.xi = s.lineup.xi.filter((id) => id !== p.id)
  s.lineup.bench = s.lineup.bench.filter((id) => id !== p.id)
  s.squad = s.squad.filter((x) => x.id !== p.id)
  s.bids = s.bids.filter((b) => b.playerId !== p.id)
  return extra
}

export function sellPlayer(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return ''
  if (s.squad.length <= MIN_SQUAD) return `Kadra nie może mieć mniej niż ${MIN_SQUAD} zawodników.`
  const price = Math.round((p.value * 0.7) / 100) * 100
  s.budget += price
  const extra = departureEffects(s, p)
  const msg = `${playerName(p)} sprzedany za ${formatMoney(price)}.${extra}`
  news(s, msg)
  return msg
}

export function releasePlayer(s: GameState, playerId: number): string {
  const p = s.squad.find((x) => x.id === playerId)
  if (!p) return ''
  if (s.squad.length <= MIN_SQUAD) return `Kadra nie może mieć mniej niż ${MIN_SQUAD} zawodników.`
  // rozwiązanie kontraktu kosztuje trzy pensje
  const cost = p.wage * 3
  s.budget -= cost
  adjustTrust(s, { squad: -2 })
  const extra = departureEffects(s, p)
  const msg = `${playerName(p)} odchodzi za porozumieniem stron. Odprawa: ${formatMoney(cost)}.${extra}`
  news(s, msg)
  return msg
}

// ---------- oferty za naszych zawodników ----------

function bidChance(p: Player): number {
  const r = avgRating(p) ?? 6.3
  return Math.min(0.6, 0.08 + Math.max(0, r - 6.3) * 0.25 + (p.potential - p.skill) * 0.01)
}

export function makeBid(rng: Rng, s: GameState, p: Player): Bid | undefined {
  const t = club(s)!
  // kupują kluby z tej samej albo wyższej ligi, którym ten zawodnik by się przydał
  const levels = [t.level, Math.min(9, t.level + 1), Math.min(9, t.level + 2)]
  const level = rng.pick(levels)
  if (p.skill < LEVELS[level].base - 4) return undefined
  const teamId = rng.pick(teamsAtLevel(s, level).filter((id) => id !== t.id))
  const fee = Math.round((p.value * (0.8 + rng.next() * 0.7)) / 100) * 100
  return { playerId: p.id, teamId, fee }
}

/** na otwarcie okna: kilka ofert za najlepiej grających */
export function generateBids(s: GameState): void {
  if (!club(s)) return
  s.bids = withRng(s, (rng) => {
    const bids: Bid[] = []
    const cands = [...s.squad].sort((a, b) => (avgRating(b) ?? 6) - (avgRating(a) ?? 6) || b.value - a.value)
    for (const p of cands.slice(0, 10)) {
      if (bids.length >= 3) break
      if (!rng.chance(bidChance(p))) continue
      const b = makeBid(rng, s, p)
      if (b) bids.push(b)
    }
    return bids
  })
}

export function acceptBid(s: GameState, playerId: number): string {
  const b = s.bids.find((x) => x.playerId === playerId)
  const p = s.squad.find((x) => x.id === playerId)
  if (!b || !p) return ''
  if (s.squad.length <= MIN_SQUAD) return `Kadra nie może mieć mniej niż ${MIN_SQUAD} zawodników.`
  s.budget += b.fee
  const buyer = s.teams[b.teamId]
  const extra = departureEffects(s, p)
  // awans sportowy zawodnika cieszy szatnię, wyprzedaż najlepszych niepokoi kibiców
  if (buyer.level > club(s)!.level) adjustTrust(s, { squad: 1 })
  if ((avgRating(p) ?? 6) >= 7) adjustTrust(s, { fans: -4 })
  const msg = `${playerName(p)} przechodzi do ${buyer.name} za ${formatMoney(b.fee)}.${extra}`
  news(s, msg)
  return msg
}

export function rejectBid(s: GameState, playerId: number): string {
  const b = s.bids.find((x) => x.playerId === playerId)
  const p = s.squad.find((x) => x.id === playerId)
  if (!b || !p) return ''
  s.bids = s.bids.filter((x) => x !== b)
  const buyer = s.teams[b.teamId]
  const t = club(s)!
  if (buyer.level > t.level) {
    setMorale(p, -15)
    if (p.morale < 30) p.form = Math.max(-3, p.form - 1)
    const msg = `Odrzucasz ofertę ${buyer.name}. ${playerName(p)} marzył o wyższej lidze i jest wyraźnie zawiedziony.`
    news(s, msg)
    return msg
  }
  adjustTrust(s, { fans: 1 })
  const msg = `Odrzucasz ofertę ${buyer.name} za ${playerName(p)}. Kibice doceniają.`
  news(s, msg)
  return msg
}

/** negocjacje: żądasz +40%; kupiec się zgodzi albo odejdzie */
export function counterBid(s: GameState, playerId: number): string {
  const b = s.bids.find((x) => x.playerId === playerId)
  const p = s.squad.find((x) => x.id === playerId)
  if (!b || !p || b.countered) return ''
  const buyer = s.teams[b.teamId]
  return withRng(s, (rng) => {
    if (rng.chance(0.5)) {
      b.fee = Math.round((b.fee * 1.4) / 100) * 100
      b.countered = true
      return `${buyer.name} podbija ofertę do ${formatMoney(b.fee)}. Ostatnie słowo.`
    }
    s.bids = s.bids.filter((x) => x !== b)
    if (buyer.level > club(s)!.level) setMorale(p, -10)
    return `${buyer.name} wycofuje się z rozmów. „Za drogo jak na ten poziom” – mówi ich dyrektor.`
  })
}

/** przedłużenie kontraktów po sezonie: lepsi gracze chcą więcej */
export function renewWages(s: GameState): string[] {
  const notes: string[] = []
  for (const p of s.squad) {
    const fair = wageFor(p.skill)
    if (fair > p.wage * 1.15) {
      p.wage = fair
      notes.push(`${playerName(p)} wywalczył podwyżkę do ${formatMoney(fair)}/mies.`)
    }
  }
  return notes.slice(0, 4)
}
