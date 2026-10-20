import { describe, expect, it } from 'vitest'
import { acceptOffer, cupsOf, finishTransfers, newGame, playNext, resolveEvent, stayAtClub } from './engine'
import { roundName } from './cup'
import type { MatchReport } from './types'

describe('Puchar Polski', () => {
  for (const region of ['śląskie', 'podlaskie', 'mazowieckie']) {
    it(`etap wojewódzki i centralny (${region})`, () => {
      const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region, seed: 11 })
      const reg = s.regionalCup!
      const entrants = new Set([...reg.rounds[0].flatMap((t) => [t.home, t.away]), ...(reg.byes ?? [])])
      // IV liga cała, drużyny tylko z województwa (najwyżej III liga)
      for (const id of s.leagues.filter((l) => l.level === 5 && l.region === region).flatMap((l) => l.teamIds)) expect(entrants.has(id)).toBe(true)
      for (const id of entrants) if (s.teams[id].level <= 5) expect(s.teams[id].region).toBe(region)
      for (const id of entrants) expect(s.teams[id].level).toBeLessThanOrEqual(6)
      // liczba drużyn w drugiej rundzie to potęga dwójki
      const second = reg.rounds[0].length + (reg.byes?.length ?? 0)
      if (reg.byes) expect(Math.log2(second) % 1).toBe(0)
      expect(roundName(reg, reg.schedule.length - 1)).toBe('Finał')
      // etap centralny: 24 w rundzie wstępnej, 52 czeka w 1/32
      expect(s.cup.rounds[0]).toHaveLength(12)
      expect(s.cup.byes).toHaveLength(52)
      expect(s.cup.byes).toContain(s.cupQualifier)
      // tygodnie obu etapów się nie pokrywają
      expect(reg.schedule.some((w) => s.cup.schedule.includes(w))).toBe(false)
    })
  }

  it('cały sezon: oba etapy mają zwycięzcę, a zwycięzca wojewódzki przechodzi dalej', () => {
    const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region: 'opolskie', seed: 4 })
    // przyjmij pierwszą ofertę i graj do końca sezonu
    let guard = 0
    while (s.season === 1 && guard++ < 500) {
      if (s.phase === 'hiring') acceptOffer(s, s.offers[0].teamId)
      else if (s.phase === 'transfer') finishTransfers(s)
      else if (s.phase === 'event') resolveEvent(s, 0)
      else if (s.phase === 'season') playNext(s)
      else if (s.phase === 'seasonEnd') stayAtClub(s)
      else break
    }
    expect(s.season).toBe(2)
    const [reg, central] = cupsOf(s)
    expect(reg.rounds[0].length).toBeGreaterThan(0)
    expect(central.byes).toContain(s.cupQualifier)
  })

  it('w finale raport mówi, kto zdobywa puchar, a nie kto przechodzi dalej', () => {
    const finals: MatchReport[] = []
    for (let seed = 1; seed <= 12 && !finals.length; seed++) {
      const probe = newGame({ firstName: 'a', lastName: 'b', age: 30, region: 'opolskie', seed })
      // najmocniejszy klub IV ligi: zwykle dochodzi daleko w pucharze wojewódzkim
      const best = probe.leagues.filter((l) => l.level === 5 && l.region === 'opolskie').flatMap((l) => l.teamIds).sort((a, b) => probe.teams[b].strength - probe.teams[a].strength)[0]
      const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region: 'opolskie', seed, license: 'UEFA B', teamId: best })
      // finał bywa ostatnim meczem sezonu, a raporty znikają razem z sezonem: łapiemy je w locie
      const seen = (reps: MatchReport[]) => {
        const orig = reps.unshift.bind(reps)
        reps.unshift = (...r: MatchReport[]) => (finals.push(...r.filter((x) => x.cupName?.endsWith('Finał'))), orig(...r))
      }
      seen(s.reports)
      let guard = 0
      while (s.season === 1 && guard++ < 500) {
        if (s.phase === 'transfer') finishTransfers(s)
        else if (s.phase === 'event') resolveEvent(s, 0)
        else if (s.phase === 'season') playNext(s)
        else break
      }
      expect(s.news.some((n) => n.includes('awans dalej! (Finał)'))).toBe(false)
    }
    expect(finals.length).toBeGreaterThan(0)
    for (const r of finals) expect(r.trophy).toBe(r.cupName!.split(' · ')[0])
  })
})
