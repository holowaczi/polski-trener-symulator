import { it } from 'vitest'
import { careerScore } from './score'
import { acceptBid, buyPlayer } from './market'
import { acceptOffer, finishTransfers, newGame, playNext, resolveEvent, retire, stayAtClub, startLicenseCourse } from './engine'
import type { GameState } from './types'
import { previewStrength, teamBonus } from './match'

type Agg = Record<string, number[]>
const push = (a: Agg, k: string, v: number) => (a[k] ??= []).push(v)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

/** pomiar balansu na wielu karierach: BALANCE=1 npx vitest run src/game/balance.test.ts */
it.runIf((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BALANCE)('balance', () => {
  const A: Agg = {}
  const careers: string[] = []
  for (let seed = 1; seed <= 16; seed++) {
    const s = newGame({ firstName: 'T', lastName: 'B', age: 35, region: ['mazowieckie', 'śląskie', 'pomorskie', 'lubelskie'][seed % 4], seed })
    let guard = 0
    let lastRep = s.reports[0]
    const skillAt = new Map<number, { age: number; skill: number; pot: number }>()
    while (s.phase !== 'retired' && s.season <= 10 && guard++ < 20000) {
      switch (s.phase) {
        case 'hiring': {
          const best = [...s.offers].sort((a, b) => b.level - a.level)[0]
          acceptOffer(s, best.teamId)
          calib(s, A)
          for (const p of s.squad) skillAt.set(p.id, { age: p.age, skill: p.skill, pot: p.potential })
          break
        }
        case 'transfer': {
          const target = s.transferList.filter((t) => t.fee <= s.budget).sort((a, b) => b.player.skill - a.player.skill)[0]
          if (target && s.squad.length < 24) {
            const lvl = s.teams[s.clubId!].level
            push(A, 'buy_skill_minus_base', target.player.skill - [24, 31, 38, 45, 51, 57, 63, 69][lvl])
            buyPlayer(s, target.player.id)
          }
          if (s.bids[0] && guard % 2) acceptBid(s, s.bids[0].playerId)
          finishTransfers(s)
          break
        }
        case 'event':
          resolveEvent(s, guard % s.pendingEvent!.options.length)
          break
        case 'season': {
          const refs = s.leagues.map((l) => ({ level: l.level, rounds: l.rounds, teamIds: [...l.teamIds] }))
          playNext(s)
          const rep = s.reports[0]
          if (rep && rep !== lastRep) {
            lastRep = rep
            const lvl = s.clubId !== null ? s.teams[s.clubId].level : -1
            const mine = rep.home === s.clubId ? rep.hg - rep.ag : rep.ag - rep.hg
            push(A, `my_res_L${lvl}`, mine > 0 ? 1 : mine === 0 ? 0.5 : 0)
            push(A, 'my_goals', rep.hg + rep.ag)
            for (const r of rep.ratings) { push(A, 'rating', r.rating); push(A, 'rating_ge85', r.rating >= 8.5 ? 1 : 0); push(A, 'rating_le45', r.rating <= 4.5 ? 1 : 0) }
            push(A, 'my_str_minus_opp', (rep.myStrength.att + rep.myStrength.def) / 2 - rep.oppStrength)
          }
          if ((s.phase as string) === 'seasonEnd') leagueStats(s, A, refs)
          const h = s.history[s.history.length - 1]
          if ((s.phase as string) === 'hiring' && h?.fired && (h.position ?? 99) <= 4) push(A, 'fired_in_top4', 1)
          break
        }
        case 'seasonEnd': {
          if (s.history[s.history.length - 1]) {
            const h = s.history[s.history.length - 1]!
            const pv = previewStrength(s)
            push(A, `end_players_minus_base_L${h.level}`, pv.overall - teamBonus(s, pv.xi).total - [24, 31, 38, 45, 51, 57, 63, 69][h.level])
          }
          // rozwój zawodników przez sezon
          for (const p of s.squad) {
            const b = skillAt.get(p.id)
            if (b) push(A, `dev_age${b.age <= 19 ? '≤19' : b.age <= 22 ? '20-22' : b.age <= 26 ? '23-26' : b.age <= 30 ? '27-30' : '31+'}`, p.skill - b.skill)
          }
          skillAt.clear()
          startLicenseCourse(s)
          const better = s.offers.filter((o) => o.level > (s.clubId ? s.teams[s.clubId].level : -1))
          if (better.length) acceptOffer(s, better[0].teamId)
          else if (s.clubId !== null) stayAtClub(s)
          else acceptOffer(s, s.offers[0].teamId)
          calib(s, A)
          for (const p of s.squad) skillAt.set(p.id, { age: p.age, skill: p.skill, pot: p.potential })
          break
        }
      }
    }
    careers.push(`[${careerScore(s)} pkt] ` + s.history.map((h) => `${h.level}${h.fired ? 'F' : ''}:${h.position ?? '-'}`).join(' '))
    if (s.phase !== 'retired') retire(s, 'x')
  }
  const out: string[] = []
  for (const k of Object.keys(A).sort()) {
    const xs = A[k]
    out.push(`${k.padEnd(22)} n=${String(xs.length).padStart(5)} mean=${mean(xs).toFixed(3)} min=${xs.reduce((a, b) => Math.min(a, b), Infinity).toFixed(2)} max=${xs.reduce((a, b) => Math.max(a, b), -Infinity).toFixed(2)}`)
  }
  console.log(out.join('\n'))
  console.log(careers.join('\n'))
}, 120000)

function leagueStats(s: GameState, A: Agg, refs: { level: number; rounds: GameState['leagues'][0]['rounds']; teamIds: number[] }[]) {
  for (const lg of refs) {
    const pts = new Map<number, number>()
    let n = 0
    for (const r of lg.rounds)
      for (const f of r) {
        if (f.hg === undefined || f.ag === undefined) continue
        n++
        push(A, `goals_L${lg.level}`, f.hg + f.ag)
        push(A, `home_L${lg.level}`, f.hg > f.ag ? 1 : 0)
        push(A, `draw_L${lg.level}`, f.hg === f.ag ? 1 : 0)
        pts.set(f.home, (pts.get(f.home) ?? 0) + (f.hg > f.ag ? 3 : f.hg === f.ag ? 1 : 0))
        pts.set(f.away, (pts.get(f.away) ?? 0) + (f.ag > f.hg ? 3 : f.hg === f.ag ? 1 : 0))
      }
    if (!n) continue
    const games = (2 * n) / pts.size
    const sorted = [...pts.values()].sort((a, b) => b - a)
    push(A, `ppg_top_L${lg.level}`, sorted[0] / games)
    push(A, `ppg_last_L${lg.level}`, sorted[sorted.length - 1] / games)
    const str = lg.teamIds.map((id) => s.teams[id].strength)
    push(A, `str_spread_L${lg.level}`, Math.max(...str) - Math.min(...str))
    push(A, `str_mean_L${lg.level}`, mean(str))
  }
}

function calib(s: GameState, A: Agg) {
  if (s.clubId === null) return
  const t = s.teams[s.clubId]
  const pv = previewStrength(s)
  const b = teamBonus(s, pv.xi).total
  push(A, 'calib_players_minus_team', pv.overall - b - t.strength)
  push(A, 'calib_bonus', b)
  push(A, 'calib_level_jump', t.level - (s.history[s.history.length - 1]?.level ?? 0))
}
