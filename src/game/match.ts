import { FORMATIONS, FIRST_NAMES, LAST_NAMES } from './data'
import { commentary } from './commentary'
import type { Rng } from './rng'
import type { Formation, GameState, MatchReport, Player, PlayerRating, Position } from './types'
import { adjustCoach, adjustTrust, club, isAvailable, news, setMorale } from './util'
import { clamp, playerValue, shortName } from './world'

export const BENCH_SIZE = 7
const MAX_SUBS = 5

// ---------- skład ----------

export function effectiveSkill(p: Player): number {
  return p.skill + p.form * 1.5 + (p.morale - 60) / 20
}

/** najlepsza jedenastka pod ustawienie + 7 rezerwowych */
export function autoLineup(squad: Player[], formation: Formation): { xi: Player[]; bench: Player[] } {
  const need = FORMATIONS[formation]
  const avail = squad.filter(isAvailable)
  const used = new Set<number>()
  const xi: Player[] = []
  let missing = 0
  for (const pos of ['BR', 'OBR', 'POM', 'NAP'] as Position[]) {
    const cands = avail.filter((p) => p.pos === pos).sort((a, b) => effectiveSkill(b) - effectiveSkill(a))
    for (let i = 0; i < need[pos]; i++) {
      if (cands[i]) {
        xi.push(cands[i])
        used.add(cands[i].id)
      } else missing++
    }
  }
  const rest = avail.filter((p) => !used.has(p.id)).sort((a, b) => effectiveSkill(b) - effectiveSkill(a))
  while (missing-- > 0 && rest.length) {
    const p = rest.find((x) => x.pos !== 'BR') ?? rest[0]
    rest.splice(rest.indexOf(p), 1)
    xi.push(p)
  }
  // ławka: zapasowy bramkarz i najlepsi z reszty
  const bench: Player[] = []
  const gk = rest.find((p) => p.pos === 'BR')
  if (gk) bench.push(gk)
  for (const p of rest) {
    if (bench.length >= BENCH_SIZE) break
    if (!bench.includes(p)) bench.push(p)
  }
  return { xi, bench }
}

/** skład na mecz: ręczny, z automatycznym łataniem dziur po kontuzjach i kartkach */
export function resolveLineup(s: GameState): { xi: Player[]; bench: Player[]; notes: string[] } {
  if (s.lineup.auto) return { ...autoLineup(s.squad, s.tactic.formation), notes: [] }
  const byId = new Map(s.squad.map((p) => [p.id, p]))
  const notes: string[] = []
  const xi: Player[] = []
  for (const id of s.lineup.xi) {
    const p = byId.get(id)
    if (!p) continue
    if (!isAvailable(p)) {
      notes.push(`${shortName(p)} nie może zagrać (${p.injuredFor ? 'kontuzja' : 'zawieszenie'}).`)
      continue
    }
    xi.push(p)
  }
  let bench = s.lineup.bench.map((id) => byId.get(id)).filter((p): p is Player => !!p && isAvailable(p) && !xi.includes(p))
  // brakujące miejsca: najpierw z ławki z tej samej pozycji, potem ktokolwiek
  const removed = s.lineup.xi.map((id) => byId.get(id)).filter((p): p is Player => !!p && !xi.includes(p))
  while (xi.length < 11) {
    const wantPos = removed.shift()?.pos
    const pool = [...bench, ...s.squad.filter((p) => isAvailable(p) && !xi.includes(p) && !bench.includes(p))]
    const pick = pool.filter((p) => p.pos === wantPos).sort((a, b) => effectiveSkill(b) - effectiveSkill(a))[0] ??
      pool.sort((a, b) => effectiveSkill(b) - effectiveSkill(a))[0]
    if (!pick) break
    xi.push(pick)
    bench = bench.filter((p) => p !== pick)
    notes.push(`Do składu wskakuje ${shortName(pick)}.`)
  }
  return { xi, bench: bench.slice(0, BENCH_SIZE), notes }
}

export function formationOf(xi: Player[]): string {
  const c = (pos: Position) => xi.filter((p) => p.pos === pos).length
  return `${c('OBR')}-${c('POM')}-${c('NAP')}`
}

// ---------- siła ----------

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** atak i obrona z ułożenia jedenastki; kary za brak bramkarza i dziurawe formacje */
export function lineStrength(xi: { p: Player; v: number }[]): { att: number; def: number } {
  const by = (pos: Position) => xi.filter((x) => x.p.pos === pos).map((x) => x.v)
  const br = by('BR')
  const obr = by('OBR')
  const pom = by('POM')
  const nap = by('NAP')
  const all = xi.map((x) => x.v)
  const mean = avg(all)
  const fwd = nap.length ? avg(nap) : avg(pom) - 4
  const mid = pom.length ? avg(pom) : mean - 4
  const back = obr.length ? avg(obr) : mean - 6
  const keeper = br.length ? Math.max(...br) : mean - 18
  let att = fwd * 0.45 + mid * 0.4 + back * 0.15
  let def = back * 0.45 + mid * 0.25 + keeper * 0.3
  if (obr.length < 3) def -= (3 - obr.length) * 3
  if (obr.length > 5) att -= 2
  if (nap.length === 0) att -= 2
  if (pom.length < 3) {
    att -= 1.5
    def -= 1.5
  }
  // gra w osłabieniu
  const short = 11 - xi.length
  att -= short * 2.5
  def -= short * 2.5
  return { att, def }
}

export function styleFit(s: GameState, xi: Player[], level: number): { value: number; note: string } {
  const mean = avg(xi.map((p) => p.skill))
  const age = avg(xi.map((p) => p.age))
  const midAvg = avg(xi.filter((p) => p.pos === 'POM').map((p) => p.skill))
  switch (s.tactic.style) {
    case 'laga':
      if (level <= 2) return { value: 2, note: 'Laga na tym poziomie to sztuka wojenna.' }
      if (level <= 4) return { value: 1, note: 'Laga jeszcze działa, ale obrońcy zaczynają rozumieć.' }
      return { value: -2, note: 'Na tym poziomie laga to podanie do rywala.' }
    case 'pressing':
      if (age < 25) return { value: 2, note: 'Młoda kadra biega jak nakręcona.' }
      if (age < 27.5) return { value: 1, note: 'Pressing jest, ale do 60. minuty.' }
      return { value: -3, note: 'Weterani pressują głównie sędziego.' }
    case 'posiadanie':
      if (level <= 1) return { value: -2, note: 'Na tej murawie piłka sama zmienia kierunek.' }
      if (midAvg - mean >= 2) return { value: 2, note: 'Pomocnicy klepią jak w Barcelonie.' }
      if (midAvg - mean >= -1) return { value: 1, note: 'Posiadanie jest, strzałów mniej.' }
      return { value: -2, note: 'Pomocnicy nie nadążają za własnym pomysłem.' }
    case 'kontra':
      return { value: 0, note: 'Działa najlepiej przeciw silniejszym rywalom.' }
  }
}

/** wszystko poza samymi zawodnikami: zaufanie szatni, trener, efekty czasowe */
export function teamBonus(s: GameState, xi: Player[]): { total: number; parts: { label: string; value: number }[] } {
  const level = club(s)?.level ?? 0
  const parts: { label: string; value: number }[] = []
  const fit = styleFit(s, xi, level)
  parts.push({ label: `Styl: ${s.tactic.style}`, value: fit.value })
  const leaders = xi.filter((p) => p.traits.includes('lider')).length
  if (leaders) parts.push({ label: 'Lider w składzie', value: Math.min(1, leaders) })
  const squad = Math.round(((s.trust.squad - 50) / 40) * 10) / 10
  if (squad) parts.push({ label: 'Atmosfera w szatni', value: squad })
  if (s.coach.stress >= 70) parts.push({ label: 'Nerwowy trener', value: -1.5 })
  for (const m of s.modifiers) parts.push({ label: `${m.label} (${m.matches} m.)`, value: m.amount })
  const total = parts.reduce((a, p) => a + p.value, 0) + s.coach.reputation / 100
  return { total, parts }
}

/** podgląd siły przed meczem */
export function previewStrength(s: GameState): { att: number; def: number; overall: number; xi: Player[]; bench: Player[] } {
  const { xi, bench } = resolveLineup(s)
  const bonus = teamBonus(s, xi).total
  const ls = lineStrength(xi.map((p) => ({ p, v: effectiveSkill(p) })))
  const att = Math.round((ls.att + bonus) * 10) / 10
  const def = Math.round((ls.def + bonus) * 10) / 10
  return { att, def, overall: Math.round(((att + def) / 2) * 10) / 10, xi, bench }
}

// ---------- mecz AI ----------

export function simulateScore(rng: Rng, hs: number, as: number, level: number): { hg: number; ag: number } {
  const diff = hs + 2.5 - as
  const goalsy = 1 + (7 - level) * 0.045
  const lh = clamp(1.3 * Math.exp(diff / 16) * goalsy, 0.15, 6)
  const la = clamp(1.05 * Math.exp(-diff / 16) * goalsy, 0.15, 6)
  return { hg: rng.poisson(lh), ag: rng.poisson(la) }
}

export function aiStrength(rng: Rng, s: GameState, teamId: number): number {
  return s.teams[teamId].strength + rng.normal(0, 2.5)
}

// ---------- mecz drużyny gracza ----------

interface OnPitch {
  p: Player
  /** dyspozycja dnia: ten sam los wpływa na wynik i na ocenę */
  day: number
  from: number
  to: number
  goals: number
  assists: number
  yellow: number
  red: boolean
  injured: boolean
  sub: boolean
}

const MENTALITY = { obrona: { att: -3, def: 3 }, balans: { att: 0, def: 0 }, atak: { att: 3, def: -3 } }

function randomSurname(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)[0]}. ${rng.pick(LAST_NAMES)}`
}

function weightedPick<T>(rng: Rng, items: T[], w: (t: T) => number): T {
  const ws = items.map(w)
  let r = rng.next() * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

const INJURY_LENGTHS = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 12]

export function playClubMatch(rng: Rng, s: GameState, f: { home: number; away: number }, cup: boolean): MatchReport {
  const me = s.clubId!
  const isHome = f.home === me
  const opp = isHome ? f.away : f.home
  const level = s.teams[me].level
  const unavailableBefore = s.squad.filter((p) => !isAvailable(p))
  const { xi, bench, notes } = resolveLineup(s)
  for (const n of notes) news(s, n)

  const pitch: OnPitch[] = xi.map((p) => ({
    p,
    day: rng.normal(0, 0.55),
    from: 0,
    to: 90,
    goals: 0,
    assists: 0,
    yellow: 0,
    red: false,
    injured: false,
    sub: false,
  }))
  const benchLeft = [...bench]
  let subsUsed = 0
  const events: { minute: number; text: string }[] = []

  let oppStr = s.teams[opp].strength + rng.normal(0, 2)
  if (cup) {
    // magia pucharu: niżej notowany gra z większym sercem
    const d = s.teams[opp].level - level
    if (d < 0) oppStr -= Math.min(3, -d * 1.2)
  }
  const bonus = teamBonus(s, xi).total
  const ment = MENTALITY[s.tactic.mentality]
  let oppRed = 0
  const myGoalsArr: number[] = []
  let oppGoals = 0
  let myGoals = 0

  const active = () => pitch.filter((x) => x.to === 90 && !x.red && !x.injured)
  const strengthNow = () => {
    const ls = lineStrength(active().map((x) => ({ p: x.p, v: effectiveSkill(x.p) + x.day * 2 })))
    let att = ls.att + bonus + ment.att
    const def = ls.def + bonus + ment.def
    if (s.tactic.style === 'kontra' && oppStr > (att + def) / 2 + 2) att += 3
    return { att, def }
  }
  const startStr = strengthNow()

  const substitute = (out: OnPitch, minute: number, reason: string) => {
    if (subsUsed >= MAX_SUBS || !benchLeft.length) return false
    const same = benchLeft.filter((p) => p.pos === out.p.pos)
    const pool = same.length ? same : out.p.pos === 'BR' ? [] : benchLeft.filter((p) => p.pos !== 'BR')
    if (!pool.length) return false
    const inP = pool.sort((a, b) => effectiveSkill(b) - effectiveSkill(a))[0]
    benchLeft.splice(benchLeft.indexOf(inP), 1)
    out.to = minute
    subsUsed++
    pitch.push({ p: inP, day: rng.normal(0, 0.5), from: minute, to: 90, goals: 0, assists: 0, yellow: 0, red: false, injured: false, sub: true })
    events.push({ minute, text: `${minute}' Zmiana${reason}: ${shortName(inP)} za ${shortName(out.p)}` })
    return true
  }

  const goalsy = 1 + (7 - level) * 0.045
  // mecz rozgrywany minuta po minucie, żeby zdarzenia szły po kolei:
  // kto zszedł (czerwień, uraz, zmiana), ten już nic nie strzeli ani nie dostanie kartki
  let lMe = 0
  let lOpp = 0
  for (let minute = 1; minute <= 90; minute++) {
    if ((minute - 1) % 15 === 0) {
      const { att, def } = strengthNow()
      const home = isHome ? 2.5 : -2.5
      const oppA = oppStr - oppRed * 3
      lMe = clamp(((1.1 * Math.exp((att - oppA + home) / 14)) / 90) * goalsy, 0.0007, 0.08)
      lOpp = clamp(((0.95 * Math.exp((oppA - def - home) / 14)) / 90) * goalsy, 0.0007, 0.08)
    }
    if (rng.chance(lMe)) {
      const pool = active()
      if (pool.length) {
        const scorer = weightedPick(rng, pool, (x) => {
          let w = x.p.pos === 'NAP' ? 5 : x.p.pos === 'POM' ? 2 : x.p.pos === 'OBR' ? 0.6 : 0.02
          if (x.p.traits.includes('krol_strzalow')) w *= 1.8
          return w * Math.max(1, effectiveSkill(x.p) + x.day * 4)
        })
        scorer.goals++
        const others = pool.filter((x) => x !== scorer && x.p.pos !== 'BR')
        let assist = ''
        if (others.length && rng.chance(0.7)) {
          const a = weightedPick(rng, others, (x) => (x.p.pos === 'POM' ? 3 : x.p.pos === 'NAP' ? 2 : 1))
          a.assists++
          assist = ` (asysta: ${shortName(a.p)})`
        }
        myGoals++
        myGoalsArr.push(minute)
        events.push({ minute, text: `${minute}' ⚽ ${shortName(scorer.p)}${assist}` })
      }
    }
    if (rng.chance(lOpp)) {
      oppGoals++
      events.push({ minute, text: `${minute}' ⚽ ${randomSurname(rng)} (${s.teams[opp].name})` })
    }
    // kartki i kontuzje: ok. 0,6 żółtej i 0,03 bezpośredniej czerwieni na mecz dla całej drużyny
    for (const x of active()) {
      const narwany = x.p.traits.includes('narwany')
      if (rng.chance(narwany ? 0.0016 : 0.0006)) {
        x.yellow++
        if (x.yellow >= 2) {
          x.red = true
          x.to = minute
          events.push({ minute, text: `${minute}' 🟥 ${shortName(x.p)} – druga żółta, gramy w dziesiątkę` })
        } else events.push({ minute, text: `${minute}' 🟨 ${shortName(x.p)}` })
      } else if (rng.chance(narwany ? 0.0001 : 0.00003)) {
        x.red = true
        x.to = minute
        events.push({ minute, text: `${minute}' 🟥 ${shortName(x.p)} – czerwona kartka bezpośrednio!` })
      }
      if (!x.red && rng.chance(x.p.traits.includes('szklany') ? 0.0007 : 0.0002)) {
        x.injured = true
        x.to = minute
        events.push({ minute, text: `${minute}' 🩹 ${shortName(x.p)} schodzi z urazem` })
        substitute(x, minute, ' wymuszona')
      }
    }
    if (rng.chance(0.0004)) {
      oppRed++
      events.push({ minute, text: `${minute}' 🟥 czerwona kartka dla rywali` })
    }
    // zmiany taktyczne po godzinie gry: schodzą najsłabsi tego dnia
    if (minute === 60 || minute === 75) {
      const tired = active()
        .filter((x) => !x.sub && x.p.pos !== 'BR')
        .sort((a, b) => a.day + a.goals - (b.day + b.goals))
      const count = minute === 60 ? 2 : 1
      for (let i = 0; i < count && tired[i]; i++) if (tired[i].day < 0.2) substitute(tired[i], minute, '')
    }
  }

  events.sort((a, b) => a.minute - b.minute)
  const myStr = (startStr.att + startStr.def) / 2

  // oceny zawodników
  const diff = myGoals - oppGoals
  const ratings: PlayerRating[] = []
  const afterNotes: string[] = []
  for (const x of pitch) {
    const minutes = x.to - x.from
    if (minutes <= 0 && !x.sub) continue
    let r = 6 + x.day + (effectiveSkill(x.p) - oppStr) / 20 + clamp(diff * 0.25, -1, 1)
    r += x.goals * 0.9 + x.assists * 0.5
    if (x.p.pos === 'BR' || x.p.pos === 'OBR') r += oppGoals === 0 ? 0.5 : -oppGoals * (x.p.pos === 'BR' ? 0.25 : 0.12)
    if (x.yellow === 1) r -= 0.2
    if (x.red) r -= 1.5
    if (minutes < 30) r = 6 + (r - 6) * 0.6
    r = clamp(Math.round(r * 10) / 10, 3, 10)
    ratings.push({ id: x.p.id, name: shortName(x.p), pos: x.p.pos, rating: r, sub: x.sub })
    afterNotes.push(...applyMatchToPlayer(rng, s, x, r))
  }
  const played = new Set(pitch.map((x) => x.p.id))
  for (const p of s.squad) {
    if (played.has(p.id)) continue
    if (isAvailable(p)) {
      p.benchStreak++
      if (p.age <= 23 && p.skill < p.potential) p.progress += 0.03
      if (p.benchStreak >= 3 && p.skill >= myStr - 2) setMorale(p, -4)
      else setMorale(p, -1)
      if (p.traits.includes('syn_prezesa')) adjustTrust(s, { board: -1.5 })
    }
  }
  // obietnice z zdarzeń: trener musi ich dotrzymać
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith('obietnica:')) continue
    const p = s.squad.find((x) => x.id === Number(key.slice(10)))
    if (!p) {
      delete s.flags[key]
      continue
    }
    if (played.has(p.id)) delete s.flags[key]
    else if (p.benchStreak >= 2 && isAvailable(p)) {
      delete s.flags[key]
      setMorale(p, -25)
      adjustTrust(s, { squad: -5, board: p.traits.includes('syn_prezesa') ? -10 : 0 })
      news(s, `${shortName(p)} miał obiecane minuty i znowu nie zagrał. W szatni mówią, że trener rzuca słowa na wiatr.`)
    }
  }
  for (const p of unavailableBefore) {
    if (p.injuredFor > 0) p.injuredFor--
    else if (p.suspendedFor > 0) p.suspendedFor--
  }

  // skutki dla drużyny i trenera
  const pts = myGoals > oppGoals ? 3 : myGoals === oppGoals ? 1 : 0
  s.streak.push(pts === 3 ? 'W' : pts === 1 ? 'D' : 'L')
  if (s.streak.length > 10) s.streak.shift()
  if (!cup) {
    if (pts === 3) s.totalStats.w++
    else if (pts === 1) s.totalStats.d++
    else s.totalStats.l++
  }
  const expected = 1 / (1 + Math.exp(-(myStr - oppStr + (isHome ? 2.5 : -2.5)) / 6))
  const actual = pts === 3 ? 1 : pts === 1 ? 0.45 : 0
  const surprise = actual - expected
  adjustTrust(s, {
    board: surprise * 6,
    fans: surprise * 7 + (isHome && pts === 3 ? 1 : 0) + (myGoals >= 4 ? 2 : 0),
    squad: pts === 3 ? 1 : pts === 0 ? -1 : 0,
  })
  adjustCoach(s, { stress: pts === 3 ? -3 : pts === 0 ? 4 + (surprise < -0.5 ? 2 : 0) : 0 })
  const last3 = s.streak.slice(-3).join('')
  if (last3 === 'LLL') {
    adjustTrust(s, { board: -3, fans: -3 })
    adjustCoach(s, { stress: 4 })
  } else if (last3 === 'WWW') {
    adjustTrust(s, { fans: 2 })
    adjustCoach(s, { reputation: 1 })
  }
  if (s.flags.obietnicaWygranej !== undefined) {
    delete s.flags.obietnicaWygranej
    if (pts === 3) adjustTrust(s, { board: 5 })
    else {
      adjustTrust(s, { board: -10 })
      news(s, 'Obiecałeś prezesowi wygraną. Prezes pamięta.')
    }
  }
  for (const m of s.modifiers) m.matches--
  s.modifiers = s.modifiers.filter((m) => m.matches > 0)

  const best = [...ratings].sort((a, b) => b.rating - a.rating)[0]
  const lines = commentary(rng, {
    level,
    myGoals,
    oppGoals,
    myTeam: s.teams[me].name,
    oppTeam: s.teams[opp].name,
    xiNames: xi.map(shortName),
    goals: [],
  })
  if (best) lines.unshift(`Zawodnik meczu: ${best.name} (${best.rating.toFixed(1)}).`)

  return {
    round: s.round,
    cup,
    home: f.home,
    away: f.away,
    hg: isHome ? myGoals : oppGoals,
    ag: isHome ? oppGoals : myGoals,
    lines,
    events: [...events.map((e) => e.text), ...afterNotes],
    ratings,
    myStrength: { att: Math.round(startStr.att * 10) / 10, def: Math.round(startStr.def * 10) / 10 },
    oppStrength: Math.round(oppStr * 10) / 10,
  }
}

/** po meczu: statystyki, forma z ocen, morale, rozwój, kartki i kontuzje */
function applyMatchToPlayer(rng: Rng, s: GameState, x: OnPitch, rating: number): string[] {
  const p = x.p
  p.apps++
  p.goals += x.goals
  p.assists += x.assists
  p.benchStreak = 0
  p.ratings.push(rating)
  if (p.ratings.length > 5) p.ratings.shift()
  p.ratingSum += rating
  // forma = średnia z ostatnich ocen; imprezowicz ma huśtawkę
  const recent = p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length
  let form = (recent - 6.4) * 1.6
  if (p.traits.includes('imprezowicz')) form += rng.normal(0, 0.8)
  p.form = clamp(Math.round(form), -3, 3)
  setMorale(p, (rating - 6.3) * 4)
  developFromMatch(p, rating)

  if (rating >= 8.5) news(s, `${shortName(p)} z oceną ${rating.toFixed(1)}. Lokalna gazeta pisze o nim na pierwszej stronie.`)
  const notes: string[] = []
  if (x.red) {
    const ban = x.yellow >= 2 ? 1 : rng.int(1, 3)
    p.suspendedFor = ban
    p.yellows = 0
    news(s, `${shortName(p)} zawieszony na ${ban} ${ban === 1 ? 'mecz' : 'mecze'} za czerwoną kartkę.`)
    notes.push(`⛔ ${shortName(p)} pauzuje ${ban === 1 ? 'w następnym meczu' : `${ban} mecze`} (czerwona kartka)`)
    adjustTrust(s, { squad: -1 })
  } else if (x.yellow) {
    p.yellows += x.yellow
    if (p.yellows >= 4) {
      p.suspendedFor = 1
      p.yellows = 0
      news(s, `${shortName(p)} pauzuje mecz za nadmiar żółtych kartek.`)
      notes.push(`⛔ ${shortName(p)} pauzuje w następnym meczu (4. żółta kartka)`)
    } else if (p.yellows === 3) notes.push(`⚠️ ${shortName(p)} ma 3 żółte, kolejna oznacza pauzę`)
  }
  if (x.injured) {
    let len = rng.pick(INJURY_LENGTHS)
    if (p.traits.includes('szklany')) len += rng.int(0, 2)
    if (p.age >= 32) len += 1
    p.injuredFor = len
    news(s, `${shortName(p)} kontuzjowany. Przerwa: ${len} ${len === 1 ? 'mecz' : len < 5 ? 'mecze' : 'meczów'}.`)
    notes.push(`🩹 ${shortName(p)} nie zagra przez ${len} ${len === 1 ? 'mecz' : len < 5 ? 'mecze' : 'meczów'}`)
  }
  return notes
}

/**
 * Rozwój w trakcie sezonu: dobre oceny przyspieszają rozwój młodych,
 * starsi powoli tracą. Potencjał to sufit, więc nikt nie rośnie bez końca.
 */
export function developFromMatch(p: Player, rating: number): void {
  const ageFactor = p.age <= 20 ? 1 : p.age <= 23 ? 0.8 : p.age <= 26 ? 0.5 : p.age <= 29 ? 0.25 : 0
  const training = p.age <= 20 ? 0.08 : p.age <= 23 ? 0.06 : p.age <= 26 ? 0.03 : p.age <= 29 ? 0.01 : 0
  let delta = (rating - 6.0) * ageFactor * 0.1 + training
  if (p.traits.includes('talent')) delta *= 1.4
  if (p.traits.includes('pracus')) delta += 0.015
  if (p.traits.includes('leniwy')) delta *= 0.6
  if (p.age >= 30) delta -= p.traits.includes('weteran') ? 0.01 : 0.025
  if (p.skill >= p.potential && delta > 0) delta = 0
  p.progress += delta
  if (p.progress >= 1) {
    p.skill = Math.min(p.potential, p.skill + 1)
    p.progress -= 1
    p.value = playerValue(p)
  } else if (p.progress <= -1) {
    p.skill = Math.max(5, p.skill - 1)
    p.progress += 1
    p.value = playerValue(p)
  }
}
