import { describe, expect, it } from 'vitest'
import { acceptOffer, cupsOf, finishTransfers, newGame, playNext, resolveEvent, stayAtClub } from './engine'
import { roundName } from './cup'
import { teamsAtLevel } from './world'

describe('Puchar Polski', () => {
  for (const region of ['śląskie', 'podlaskie', 'mazowieckie']) {
    it(`etap wojewódzki i centralny (${region})`, () => {
      const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region, seed: 11 })
      const reg = s.regionalCup!
      const entrants = new Set([...reg.rounds[0].flatMap((t) => [t.home, t.away]), ...(reg.byes ?? [])])
      // IV liga cała, drużyny tylko z województwa (najwyżej III liga)
      for (const id of teamsAtLevel(s, 5)) expect(entrants.has(id)).toBe(true)
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
})
