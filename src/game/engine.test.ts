import { describe, expect, it } from 'vitest'
import { LEVELS } from './data'
import {
  acceptOffer,
  buyPlayer,
  computeTable,
  finishTransfers,
  newGame,
  playNext,
  resolveEvent,
  retire,
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
        const target = s.transferList.filter((t) => t.fee <= s.budget).sort((a, b) => b.player.skill - a.player.skill)[0]
        if (target && s.squad.length < 24) buyPlayer(s, target.player.id)
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
      s.leagues.forEach((lg, i) => {
        expect(lg.teamIds).toHaveLength(LEVELS[i].size)
        expect(new Set(lg.teamIds).size).toBe(LEVELS[i].size)
        for (const id of lg.teamIds) expect(s.teams[id].level).toBe(i)
      })
      for (const p of s.squad) {
        expect(Number.isFinite(p.skill)).toBe(true)
        expect(p.morale).toBeGreaterThanOrEqual(0)
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
