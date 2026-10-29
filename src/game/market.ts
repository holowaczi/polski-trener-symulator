import { LEVELS } from './data'
import type { Rng } from './rng'
import type { Bid, GameState, Player, Position, Team } from './types'
import { adjustCoach, adjustTrust, avgRating, club, formatMoney, news, setMorale, wageBill, withRng } from './util'
import { generatePlayer, isPolish, nationOf, playerName, teamsAtLevel, wageFor } from './world'
import { countryFlag, EURO_CLUBS, type EuroClub } from './euroClubs'
import { autoLineup } from './match'

export const MAX_SQUAD = 28
export const MIN_SQUAD = 16

/** ilu nowych zawodników zarząd pozwala ściągnąć w jednym oknie: szatnia musi się zgrać */
export function signingLimit(s: GameState): number {
  return s.winterWindowDone ? 2 : 4
}

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
      const abroad = free || isPolish(p) ? undefined : foreignSeller(rng, p)
      // klub z zagranicy liczy sobie więcej, bo zawodnik musi się jeszcze przeprowadzić
      const fee = free ? 0 : roundFee(p.value * (0.9 + rng.next() * 0.6) * (abroad ? 1.2 : 1))
      const from = free ? 'wolny zawodnik' : abroad ? `${abroad.name} ${countryFlag(abroad.country)}` : s.teams[rng.pick(teamsAtLevel(s, t.level).filter((x) => x !== t.id))].name
      list.push({ player: p, fee, from })
    }
    return list
  })
}

/** obcokrajowiec z rynku gra w klubie ze swojego kraju, o ile znamy taki na jego poziomie */
function foreignSeller(rng: Rng, p: Player): EuroClub | undefined {
  const home = EURO_CLUBS.filter((c) => c.country === nationOf(p) && c.strength >= p.skill - 4 && c.strength <= p.skill + 8)
  return home.length ? rng.pick(home) : undefined
}

/** zbijanie ceny: raz na zawodnika, im dłużej leży na rynku i im słabszy klub, tym łatwiej */
export function haggleFee(s: GameState, playerId: number): string {
  const tt = s.transferList.find((x) => x.player.id === playerId)
  if (!tt || !tt.fee || tt.haggled) return ''
  tt.haggled = true
  return withRng(s, (rng) => {
    if (rng.chance(0.5)) {
      tt.fee = roundFee(tt.fee * 0.8)
      return `${tt.from} schodzi do ${formatMoney(tt.fee)}. „Ale tylko dlatego, że lubimy Pana krawat”.`
    }
    return `${tt.from} nie schodzi z ceny. „Za ${formatMoney(tt.fee)} albo wcale”.`
  })
}

export type SquadRole = 'xi' | 'bench' | 'out'

export const ROLE_LABEL: Record<SquadRole, string> = { xi: 'Pierwsza 11', bench: 'Ławka', out: 'Rezerwy' }

/** na potrzeby podpowiedzi wszyscy zdrowi i bez kartek: liczy się miejsce w hierarchii, nie dzisiejszy uraz */
const healthy = (p: Player): Player => ({ ...p, injuredFor: 0, suspendedFor: 0 })

/** miejsce zawodnika w kadrze przy obecnym ustawieniu: pierwsza jedenastka, ławka albo poza kadrą meczową */
export function squadRoles(s: GameState): Map<number, SquadRole> {
  const { xi, bench } = autoLineup(s.squad.map(healthy), s.tactic.formation)
  const roles = new Map<number, SquadRole>(s.squad.map((p) => [p.id, 'out']))
  for (const p of bench) roles.set(p.id, 'bench')
  for (const p of xi) roles.set(p.id, 'xi')
  return roles
}

/** gdzie trafiłby zawodnik z rynku, gdyby dziś podpisał umowę, i kogo wypchnąłby ze składu */
export function roleIfSigned(s: GameState, p: Player): { role: SquadRole; replaces?: Player } {
  const squad = s.squad.map(healthy)
  const before = autoLineup(squad, s.tactic.formation)
  // nowy zawodnik przychodzi z morale jak po podpisaniu umowy
  const after = autoLineup([...squad, { ...healthy(p), morale: 70 }], s.tactic.formation)
  if (after.xi.some((x) => x.id === p.id)) {
    const out = before.xi.find((x) => !after.xi.some((y) => y.id === x.id))
    return { role: 'xi', replaces: out && s.squad.find((x) => x.id === out.id) }
  }
  return { role: after.bench.some((x) => x.id === p.id) ? 'bench' : 'out' }
}

export function buyPlayer(s: GameState, playerId: number): string {
  const idx = s.transferList.findIndex((x) => x.player.id === playerId)
  if (idx < 0) return ''
  const tt = s.transferList[idx]
  if (tt.fee > s.budget) return 'Brakuje pieniędzy. Prezes proponuje zapłacić w ziemniakach, ale klub sprzedający odmawia.'
  if (wageBill(s) + tt.player.wage > s.wageLimit)
    return `Przekroczysz limit pensji (${formatMoney(s.wageLimit)}/mies.). Najpierw kogoś sprzedaj.`
  if (s.squad.length >= MAX_SQUAD) return `Kadra jest pełna (${MAX_SQUAD}). Najpierw kogoś zwolnij.`
  if ((s.signings ?? 0) >= signingLimit(s))
    return `Prezes: „${signingLimit(s)} nowych w jednym oknie wystarczy. Nie będziemy wymieniać całej szatni”.`
  s.signings = (s.signings ?? 0) + 1
  s.budget -= tt.fee
  tt.player.morale = 70
  // świeżo podpisana umowa: przedłużenie dopiero w kolejnym oknie
  tt.player.newSigning = true
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
  // w ostatnim roku umowy zawodnik jest wart dużo mniej
  const price = Math.round((p.value * ((p.contract ?? 1) <= 1 ? 0.45 : 0.7)) / 100) * 100
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
  if (cost > s.budget) return `Odprawa kosztuje ${formatMoney(cost)}, a w kasie jest ${formatMoney(Math.max(0, s.budget))}. Księgowa kręci głową.`
  s.budget -= cost
  adjustTrust(s, { squad: -2 })
  const extra = departureEffects(s, p)
  const msg = `${playerName(p)} odchodzi za porozumieniem stron. Odprawa: ${formatMoney(cost)}.${extra}`
  news(s, msg)
  return msg
}

// ---------- oferty za naszych zawodników ----------

/** ocena, po której kluby oceniają zawodnika: bieżący sezon, a latem poprzedni */
export function scoutRating(p: Player): number {
  const now = avgRating(p)
  if (now !== undefined && p.apps >= 3) return now
  return p.lastRating ?? now ?? 6.3
}

/** umiejętności „na papierze” skautów: młody z zapasem potencjału liczy się wyżej */
function scoutSkill(p: Player): number {
  return p.skill + (p.age <= 23 ? Math.max(0, p.potential - p.skill) / 2 : 0)
}

/** ile najwyżej zapłaci klub z danej ligi: III liga nie wyda miliona */
function maxFeeAt(level: number): number {
  return LEVELS[level].budget * 0.8
}

/** pozostała umowa: im krótsza, tym taniej, bo za rok zawodnik odejdzie za darmo */
function contractFactor(p: Player): number {
  const left = p.contract ?? 1
  return left <= 1 ? 0.6 : left === 2 ? 0.95 : 1.15
}

function bidChance(p: Player): number {
  const r = scoutRating(p)
  return Math.min(0.6, 0.06 + Math.max(0, r - 6.3) * 0.25 + (p.potential - p.skill) * 0.01)
}

/** oferta z naszej piramidy: najwyższa liga, w której zawodnik by się przydał, i tyle, na ile ją stać */
export function makeBid(rng: Rng, s: GameState, p: Player): Bid | undefined {
  const t = club(s)!
  const sk = scoutSkill(p)
  const levels = [t.level, Math.min(9, t.level + 1), Math.min(9, t.level + 2)].filter((l) => sk >= LEVELS[l].base - 3)
  if (!levels.length) return undefined
  // częściej dzwonią z najwyższej ligi, w której by grał
  const level = rng.chance(0.6) ? levels[levels.length - 1] : rng.pick(levels)
  const teamId = rng.pick(teamsAtLevel(s, level).filter((id) => id !== t.id))
  const ratingBonus = 1 + Math.max(-0.1, Math.min(0.3, (scoutRating(p) - 6.5) * 0.3))
  let fee = p.value * (0.8 + rng.next() * 0.5) * contractFactor(p) * ratingBonus
  fee = Math.min(fee, maxFeeAt(level) * (0.6 + rng.next() * 0.4))
  // klub z niższej półki nie da nawet połowy wartości: wtedy nie dzwoni
  if (fee < p.value * 0.5 * contractFactor(p)) return undefined
  return { playerId: p.id, teamId, fee: roundFee(fee) }
}

function roundFee(fee: number): number {
  const step = fee >= 1_000_000 ? 50_000 : fee >= 100_000 ? 5_000 : fee >= 10_000 ? 500 : 100
  return Math.max(step, Math.round(fee / step) * step)
}

/** czy kluby z zagranicy w ogóle się nim interesują: dobra liga, dobre oceny, a młodym wystarczy talent */
export function foreignInterest(p: Player): number {
  const sk = scoutSkill(p)
  if (sk < 58 || p.age > 31) return 0
  const r = scoutRating(p)
  // dobre oceny liczą się tym bardziej, im lepszy zawodnik: gwiazdę II ligi mało kto ogląda
  const form = Math.max(0, r - 6.6) * 0.3 * Math.min(1, (sk - 56) / 12)
  const talent = p.age <= 23 ? Math.max(0, p.potential - p.skill) * 0.012 : 0
  return Math.min(0.45, 0.02 + (sk - 58) * 0.005 + form + talent)
}

/** oferta z zagranicy: klub trochę mocniejszy od zawodnika, płaci wyraźnie powyżej wartości */
export function makeForeignBid(rng: Rng, p: Player): Bid | undefined {
  const sk = scoutSkill(p)
  const fits = EURO_CLUBS.filter((c) => c.strength >= sk + 2 && c.strength <= sk + 14)
  if (!fits.length) return undefined
  // im wyżej, tym rzadziej: Bayern nie dzwoni co okno
  const pool = rng.chance(0.75) ? fits.filter((c) => c.strength <= sk + 9) : fits
  const buyer = rng.pick(pool.length ? pool : fits)
  // bogate ligi płacą więcej, a ostatni rok umowy obniża cenę mniej niż u nas, bo zagranica i tak kusi
  const rich = 1 + Math.max(0, buyer.strength - 80) * 0.04
  const left = p.contract ?? 1
  const contract = left <= 1 ? 0.75 : left === 2 ? 1 : 1.15
  const fee = p.value * (1.25 + rng.next() * 0.6) * rich * contract
  return { playerId: p.id, teamId: -1, fee: roundFee(fee), abroad: { name: buyer.name, country: buyer.country } }
}

export function bidderName(s: GameState, b: Bid): string {
  return b.abroad ? b.abroad.name : (s.teams[b.teamId]?.name ?? '?')
}

/** zawodnik chce odejść: do mocniejszej ligi albo za granicę */
export function bidTempts(s: GameState, b: Bid): boolean {
  return !!b.abroad || (s.teams[b.teamId]?.level ?? 0) > (club(s)?.level ?? 0)
}

/** na otwarcie okna: kilka ofert za najlepiej grających, latem więcej niż zimą */
export function generateBids(s: GameState): void {
  if (!club(s)) return
  s.bids = withRng(s, (rng) => {
    const bids: Bid[] = []
    const winter = s.winterWindowDone
    const max = winter ? 2 : 4
    const cands = [...s.squad].sort((a, b) => scoutRating(b) - scoutRating(a) || b.value - a.value)
    // najpierw zagranica: patrzy na najlepszych, niezależnie od tego, gdzie grają; zimą rzadziej
    for (const p of cands.slice(0, 8)) {
      if (winter && rng.chance(0.4)) continue
      if (bids.filter((b) => b.abroad).length >= (winter ? 1 : 2)) break
      if (!rng.chance(foreignInterest(p))) continue
      const b = makeForeignBid(rng, p)
      if (b) bids.push(b)
    }
    for (const p of cands.slice(0, 10)) {
      if (bids.length >= max) break
      if (bids.some((b) => b.playerId === p.id)) continue
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
  const extra = departureEffects(s, p)
  // awans sportowy zawodnika cieszy szatnię, wyprzedaż najlepszych niepokoi kibiców
  if (bidTempts(s, b)) adjustTrust(s, { squad: 1 })
  if (scoutRating(p) >= 7) adjustTrust(s, { fans: -4 })
  if (b.abroad) {
    // sprzedaż za granicę to reklama dla trenera i klubu
    adjustCoach(s, { reputation: 1 })
    if (b.fee >= LEVELS[club(s)!.level].budget * 0.5) adjustTrust(s, { board: 3 })
    const msg = `${playerName(p)} wyjeżdża do ${b.abroad.name} ${countryFlag(b.abroad.country)} za ${formatMoney(b.fee)}. Księgowa otwiera szampana, kibice kupują kanał z ligą ${countryGen(b.abroad.country)}.${extra}`
    news(s, msg)
    return msg
  }
  const msg = `${playerName(p)} przechodzi do ${bidderName(s, b)} za ${formatMoney(b.fee)}.${extra}`
  news(s, msg)
  return msg
}

/** dopełniacz kraju do żartu o kanale z ligą; gdy nie znamy, wystarczy „zagraniczną” */
function countryGen(country: string): string {
  return COUNTRY_GEN[country] ?? 'zagraniczną'
}

const COUNTRY_GEN: Record<string, string> = {
  Anglia: 'angielską',
  Hiszpania: 'hiszpańską',
  Niemcy: 'niemiecką',
  Włochy: 'włoską',
  Francja: 'francuską',
  Portugalia: 'portugalską',
  Holandia: 'holenderską',
  Belgia: 'belgijską',
  Turcja: 'turecką',
  Szkocja: 'szkocką',
  Austria: 'austriacką',
  Szwajcaria: 'szwajcarską',
  Czechy: 'czeską',
  Grecja: 'grecką',
  Dania: 'duńską',
  Norwegia: 'norweską',
  Szwecja: 'szwedzką',
  Cypr: 'cypryjską',
  Chorwacja: 'chorwacką',
  Serbia: 'serbską',
  Ukraina: 'ukraińską',
  Węgry: 'węgierską',
  Rumunia: 'rumuńską',
  Bułgaria: 'bułgarską',
  Słowacja: 'słowacką',
  Izrael: 'izraelską',
}

export function rejectBid(s: GameState, playerId: number): string {
  const b = s.bids.find((x) => x.playerId === playerId)
  const p = s.squad.find((x) => x.id === playerId)
  if (!b || !p) return ''
  s.bids = s.bids.filter((x) => x !== b)
  const name = bidderName(s, b)
  if (b.abroad) {
    setMorale(p, -20)
    if (p.morale < 30) p.form = Math.max(-3, p.form - 1)
    const msg = `Odrzucasz ofertę ${name}. ${playerName(p)} już oglądał mieszkania w ${b.abroad.country === 'Anglia' ? 'Londynie' : 'nowym mieście'} i teraz nie odbiera od Ciebie telefonu.`
    news(s, msg)
    return msg
  }
  if (bidTempts(s, b)) {
    setMorale(p, -15)
    if (p.morale < 30) p.form = Math.max(-3, p.form - 1)
    const msg = `Odrzucasz ofertę ${name}. ${playerName(p)} marzył o wyższej lidze i jest wyraźnie zawiedziony.`
    news(s, msg)
    return msg
  }
  adjustTrust(s, { fans: 1 })
  const msg = `Odrzucasz ofertę ${name} za ${playerName(p)}. Kibice doceniają.`
  news(s, msg)
  return msg
}

/** negocjacje: żądasz +30%; bogaty kupiec częściej się zgodzi, biedniejszy odpada, gdy go nie stać */
export function counterBid(s: GameState, playerId: number): string {
  const b = s.bids.find((x) => x.playerId === playerId)
  const p = s.squad.find((x) => x.id === playerId)
  if (!b || !p || b.countered) return ''
  const name = bidderName(s, b)
  const want = roundFee(b.fee * 1.3)
  const affordable = b.abroad || want <= maxFeeAt(s.teams[b.teamId].level)
  return withRng(s, (rng) => {
    if (affordable && rng.chance(b.abroad ? 0.65 : 0.45)) {
      b.fee = want
      b.countered = true
      return `${name} podbija ofertę do ${formatMoney(b.fee)}. Ostatnie słowo.`
    }
    s.bids = s.bids.filter((x) => x !== b)
    if (bidTempts(s, b)) setMorale(p, b.abroad ? -15 : -10)
    return affordable
      ? `${name} wycofuje się z rozmów. „Za drogo jak na ten poziom” – mówi ich dyrektor.`
      : `${name} wycofuje się z rozmów. Prezes sprawdził konto i wyszło, że tyle nie mają nawet na stadion.`
  })
}

/** przedłużenie kontraktów po sezonie: lepsi gracze chcą więcej */
