import { Rng } from './rng'
import type { GameState, League, Player, TableRow, Team } from './types'
import { clamp, leagueOf } from './world'

/** Uruchamia funkcję z generatorem, którego stan zapisywany jest z powrotem w grze. */
export function withRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(s.rng)
  const out = fn(rng)
  s.rng = rng.state
  return out
}

export function news(s: GameState, text: string): void {
  s.news.unshift(`S${s.season} T${s.round}: ${text}`)
  if (s.news.length > 80) s.news.length = 80
}

export function adjustTrust(s: GameState, d: { board?: number; squad?: number; fans?: number }): void {
  s.trust.board = clamp(Math.round(s.trust.board + (d.board ?? 0)), 0, 100)
  s.trust.squad = clamp(Math.round(s.trust.squad + (d.squad ?? 0)), 0, 100)
  s.trust.fans = clamp(Math.round(s.trust.fans + (d.fans ?? 0)), 0, 100)
}

export function adjustCoach(s: GameState, d: { stress?: number; reputation?: number; savings?: number }): void {
  s.coach.stress = clamp(Math.round(s.coach.stress + (d.stress ?? 0)), 0, 100)
  s.coach.reputation = clamp(Math.round(s.coach.reputation + (d.reputation ?? 0)), 0, 100)
  s.coach.savings = Math.max(0, Math.round(s.coach.savings + (d.savings ?? 0)))
}

export function addModifier(s: GameState, label: string, amount: number, matches: number): void {
  const existing = s.modifiers.find((m) => m.label === label)
  if (existing) {
    existing.amount = amount
    existing.matches = Math.max(existing.matches, matches)
  } else s.modifiers.push({ label, amount, matches })
}

export function club(s: GameState): Team | undefined {
  return s.clubId === null ? undefined : s.teams[s.clubId]
}

export function clubLeague(s: GameState): League | undefined {
  return s.clubId === null ? undefined : leagueOf(s, s.clubId)
}

export function formatMoney(v: number): string {
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')} mln zł`
  if (a >= 1000) return `${sign}${Math.round(a / 1000)} tys. zł`
  return `${sign}${a} zł`
}

/** pensje pierwszej drużyny; zesłani do rezerw dalej są na liście płac klubu */
export function wageBill(s: GameState): number {
  const down = s.reserveSquad?.filter((p) => p.sentDown).reduce((a, p) => a + p.wage, 0) ?? 0
  return s.squad.reduce((a, p) => a + p.wage, 0) + down
}

export function isAvailable(p: Player): boolean {
  return p.injuredFor === 0 && p.suspendedFor === 0
}

export function avgRating(p: Player): number | undefined {
  return p.apps ? p.ratingSum / p.apps : undefined
}

export function setMorale(p: Player, delta: number): void {
  p.morale = clamp(Math.round(p.morale + delta), 0, 100)
}

export function setForm(p: Player, delta: number): void {
  p.form = clamp(Math.round(p.form + delta), -3, 3)
}

/** forma liczy się z ostatnich ocen, więc zdarzenia przesuwają te oceny i efekt trwa kilka meczów */
export function nudgeForm(p: Player, delta: number): void {
  if (!p.ratings.length) p.ratings = [6.4]
  p.ratings = p.ratings.map((r) => clamp(r + delta * 0.45, 3, 10))
  const recent = p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length
  p.form = clamp(Math.round((recent - 6.4) * 1.6), -3, 3)
}

/** siła drużyny komputera w meczu: stała siła plus forma z ostatnich wyników */
export function teamPower(t: Team): number {
  return t.strength + (t.form ?? 0)
}

/** forma drużyny komputera: zwycięstwa ją podnoszą, porażki obniżają, z czasem wraca do zera (jak u zawodników gracza) */
export function updateTeamForm(t: Team | undefined, goalDiff: number): void {
  if (!t) return
  const result = goalDiff > 0 ? 0.8 : goalDiff < 0 ? -0.8 : 0
  t.form = clamp(Math.round(((t.form ?? 0) * 0.75 + result) * 10) / 10, -3, 3)
}

/** tabela z rozegranych meczów: punkty, bilans bramek, bramki zdobyte */
export function computeTable(lg: Pick<League, 'teamIds' | 'rounds'>): TableRow[] {
  const rows = new Map<number, TableRow>()
  for (const id of lg.teamIds) rows.set(id, { teamId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })
  for (const round of lg.rounds) {
    for (const f of round) {
      if (f.hg === undefined || f.ag === undefined) continue
      const h = rows.get(f.home)
      const a = rows.get(f.away)
      if (!h || !a) continue
      h.p++
      a.p++
      h.gf += f.hg
      h.ga += f.ag
      a.gf += f.ag
      a.ga += f.hg
      if (f.hg > f.ag) {
        h.w++
        h.pts += 3
        a.l++
      } else if (f.hg < f.ag) {
        a.w++
        a.pts += 3
        h.l++
      } else {
        h.d++
        a.d++
        h.pts++
        a.pts++
      }
    }
  }
  return [...rows.values()].sort(
    (x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.teamId - y.teamId,
  )
}
