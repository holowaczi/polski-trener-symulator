import { describe, expect, it } from 'vitest'
import { LEVELS } from './data'
import { LOWER_LEAGUES } from './lowerData'
import { teamsAtLevel } from './world'
import { acceptBid, buyPlayer } from './market'
import { acceptDemand, canNegotiate } from './contracts'
import {
  acceptOffer,
  computeTable,
  finishTransfers,
  newGame,
  playNext,
  resolveEvent,
  retire,
  simulateToBreak,
  stayAtClub,
  startLicenseCourse,
} from './engine'
import { makeFixtures } from './world'
import { Rng } from './rng'
import type { GameState } from './types'

/** prosty bot: gra całą karierę, żeby sprawdzić, że nic się nie sypie */
function botCareer(seed: number, seasons: number): GameState {
  const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'mazowieckie', seed })
  let guard = 0
  while (s.phase !== 'retired' && s.season <= seasons && guard++ < 20000) {
    switch (s.phase) {
      case 'hiring': {
        const best = [...s.offers].sort((a, b) => b.level - a.level)[0]
        acceptOffer(s, best.teamId)
        break
      }
      case 'transfer': {
        for (const pl of [...s.squad].sort((x, y) => y.skill - x.skill)) if (canNegotiate(pl) && pl.age < 34) acceptDemand(s, pl.id)
        const target = s.transferList.filter((t) => t.fee <= s.budget).sort((a, b) => b.player.skill - a.player.skill)[0]
        if (target && s.squad.length < 24) buyPlayer(s, target.player.id)
        if (s.bids[0] && guard % 2) acceptBid(s, s.bids[0].playerId)
        finishTransfers(s)
        break
      }
      case 'event':
        resolveEvent(s, guard % s.pendingEvent!.options.length)
        break
      case 'season':
        playNext(s)
        break
      case 'seasonEnd': {
        startLicenseCourse(s)
        const better = s.offers.filter((o) => o.level > (s.clubId ? s.teams[s.clubId].level : -1))
        if (better.length) acceptOffer(s, better[0].teamId)
        else if (s.clubId !== null) stayAtClub(s)
        else acceptOffer(s, s.offers[0].teamId)
        break
      }
    }
  }
  if (s.phase !== 'retired') retire(s, 'koniec testu')
  return s
}

describe('terminarz', () => {
  it('każdy z każdym dwa razy', () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1)
    const rounds = makeFixtures(new Rng(1), ids)
    expect(rounds).toHaveLength(22)
    const pairs = new Map<string, number>()
    for (const r of rounds) {
      expect(r).toHaveLength(6)
      for (const f of r) pairs.set(`${f.home}-${f.away}`, (pairs.get(`${f.home}-${f.away}`) ?? 0) + 1)
    }
    expect(pairs.size).toBe(132)
  })
})

describe('kariera', () => {
  for (const seed of [1, 42, 2026, 777]) {
    it(`przechodzi 12 sezonów bez błędów (seed ${seed})`, () => {
      const s = botCareer(seed, 12)
      expect(s.history.length).toBeGreaterThan(5)
      for (const lg of s.leagues) {
        const i = lg.level
        if (i >= 6) expect(lg.teamIds).toHaveLength(LEVELS[i].size)
        else {
          expect(lg.teamIds.length).toBeGreaterThanOrEqual(8)
          expect(lg.teamIds.length).toBeLessThanOrEqual(18)
        }
        expect(new Set(lg.teamIds).size).toBe(lg.teamIds.length)
        for (const id of lg.teamIds) expect(s.teams[id].level).toBe(i)
        if (i > 7) for (const id of lg.teamIds) expect(s.teams[id].reserve).toBeFalsy()
      }
      // liczba drużyn w grupach się nie zmienia między sezonami
      const start = newGame({ firstName: 'a', lastName: 'b', age: 30, region: s.coach.region, seed })
      expect(s.leagues.map((l) => l.teamIds.length)).toEqual(start.leagues.map((l) => l.teamIds.length))
      for (const p of s.squad) {
        expect(Number.isFinite(p.skill)).toBe(true)
        expect(p.skill).toBeLessThanOrEqual(Math.max(p.potential, 95))
        expect(p.morale).toBeGreaterThanOrEqual(0)
        expect(p.injuredFor).toBeGreaterThanOrEqual(0)
      }
      expect(Number.isFinite(s.budget)).toBe(true)
    })
  }

  it('ta sama seed daje tę samą karierę', () => {
    const a = botCareer(99, 4)
    const b = botCareer(99, 4)
    expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history))
  })

  it('tabela sumuje się do rozegranych meczów', () => {
    const s = botCareer(5, 2)
    for (const lg of s.leagues) {
      const t = computeTable(lg)
      const played = t.reduce((a, r) => a + r.p, 0)
      const fixtures = lg.rounds.flat().filter((f) => f.hg !== undefined).length
      expect(played).toBe(fixtures * 2)
    }
  })
})

describe('prawdziwe ligi', () => {
  it('Ekstraklasa i III liga z regionu gracza', () => {
    const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region: 'małopolskie', seed: 1 })
    const names = (lvl: number) => teamsAtLevel(s, lvl).map((id) => s.teams[id].name)
    expect(names(9)).toContain('Legia Warszawa')
    expect(names(9)).toHaveLength(18)
    expect(names(6)).toContain('Wisłoka Dębica')
  })

  it('niższe ligi: wszystkie grupy z prawdziwymi klubami regionu', () => {
    for (const region of Object.keys(LOWER_LEAGUES)) {
      const s = newGame({ firstName: 'a', lastName: 'b', age: 30, region, seed: 3 })
      const all = new Set<string>()
      for (let level = 0; level <= 5; level++) {
        const tier = LOWER_LEAGUES[region][5 - level]
        const groups = s.leagues.filter((l) => l.level === level)
        if (!tier && level < 2) {
          expect(groups).toHaveLength(0)
          continue
        }
        expect(groups.length).toBeGreaterThan(0)
        const real = tier?.groups.filter((g) => g.clubs.length) ?? []
        if (real.length) expect(groups).toHaveLength(real.length)
        for (const lg of groups) {
          expect(lg.teamIds.length).toBeGreaterThanOrEqual(8)
          expect(lg.teamIds.length).toBeLessThanOrEqual(18)
          for (const id of lg.teamIds) {
            expect(all.has(s.teams[id].name)).toBe(false)
            all.add(s.teams[id].name)
          }
        }
        for (const g of real) {
          const lg = groups.find((l) => l.group === g.name)!
          expect(lg.name.startsWith(tier.tier)).toBe(true)
          const hits = lg.teamIds.filter((id) => g.clubs.some((c) => c.name === s.teams[id].name)).length
          expect(hits).toBeGreaterThanOrEqual(Math.min(8, g.clubs.length) - 2)
        }
      }
    }
  })

})

describe('szybka symulacja', () => {
  it('gra do okna, końca sezonu albo zwolnienia i sama rozstrzyga zdarzenia', () => {
    const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'śląskie', seed: 7 })
    acceptOffer(s, s.offers[0].teamId)
    for (let i = 0; i < 6; i++) {
      if (s.phase === 'transfer') finishTransfers(s)
      else if (s.phase === 'seasonEnd') stayAtClub(s)
      else if (s.phase === 'hiring') acceptOffer(s, s.offers[0].teamId)
      const msg = simulateToBreak(s)
      expect(msg).toMatch(/^Przesymulowano/)
      expect(['transfer', 'seasonEnd', 'hiring']).toContain(s.phase)
      expect(s.pendingEvent).toBeUndefined()
    }
  })
})
