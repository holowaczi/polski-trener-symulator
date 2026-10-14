import { Rng } from './rng'
import type { GameState, League, Player, Team } from './types'
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

export function wageBill(s: GameState): number {
  return s.squad.reduce((a, p) => a + p.wage, 0)
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
