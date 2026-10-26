import { describe, expect, it } from 'vitest'
import { LEVELS } from './data'
import { finishTransfers, newGame, playNext, resolveEvent } from './engine'
import { acceptBid, counterBid, foreignInterest, generateBids, haggleFee, makeForeignBid, rejectBid } from './market'
import { EURO_CLUBS } from './euroClubs'
import { Rng } from './rng'
import { teamsAtLevel } from './world'
import type { GameState } from './types'

/** start w n-tym najmocniejszym klubie danej ligi */
function startAt(seed: number, level: number, rank = 0): GameState {
  const probe = newGame({ firstName: 'A', lastName: 'B', age: 40, region: 'mazowieckie', seed })
  const id = [...teamsAtLevel(probe, level)].sort((a, b) => probe.teams[b].strength - probe.teams[a].strength)[rank]
  return newGame({ firstName: 'Test', lastName: 'Rynek', age: 40, region: 'mazowieckie', seed, license: 'UEFA Pro', teamId: id })
}

describe('transfery', () => {
  it('zagranica płaci wyraźnie powyżej wartości i wybiera klub na miarę zawodnika', () => {
    const s = startAt(3, 9)
    const p = [...s.squad].sort((a, b) => b.skill - a.skill)[0]
    p.ratingSum = 7.6 * 20
    p.apps = 20
    expect(foreignInterest(p)).toBeGreaterThan(0.2)
    const rng = new Rng(11)
    for (let i = 0; i < 30; i++) {
      const b = makeForeignBid(rng, p)!
      expect(b.abroad).toBeDefined()
      expect(b.fee).toBeGreaterThan(p.value)
      const c = EURO_CLUBS.find((x) => x.name === b.abroad!.name)!
      expect(c.strength).toBeGreaterThanOrEqual(p.skill + 2)
    }
  })

  it('słaby zawodnik z niższej ligi nie dostaje ofert z zagranicy', () => {
    const s = startAt(4, 5)
    for (const p of s.squad) if (p.skill < 55 && p.potential < 60) expect(foreignInterest(p)).toBe(0)
  })

  it('w Ekstraklasie zagranica regularnie się zgłasza, oferty mieszczą się w budżetach kupców', () => {
    let abroad = 0
    let domestic = 0
    for (let seed = 1; seed <= 20; seed++) {
      const s = startAt(seed, 9, seed % 4)
      for (const p of s.squad) p.lastRating = 6.4 + (p.skill - 65) * 0.05
      generateBids(s)
      for (const b of s.bids) {
        if (b.abroad) abroad++
        else {
          domestic++
          expect(b.fee).toBeLessThanOrEqual(LEVELS[s.teams[b.teamId].level].budget * 0.8)
        }
      }
      expect(new Set(s.bids.map((b) => b.playerId)).size).toBe(s.bids.length)
    }
    expect(abroad).toBeGreaterThan(5)
    expect(domestic).toBeGreaterThan(0)
  })

  it('sprzedaż za granicę zasila budżet, odrzucenie psuje humor', () => {
    const s = startAt(5, 9)
    const [p, q] = [...s.squad].sort((a, b) => b.skill - a.skill)
    const rng = new Rng(2)
    s.bids = [makeForeignBid(rng, p)!, makeForeignBid(rng, q)!]
    const budget = s.budget
    const fee = s.bids[0].fee
    expect(acceptBid(s, p.id)).toContain('wyjeżdża')
    expect(s.budget).toBe(budget + fee)
    expect(s.squad.some((x) => x.id === p.id)).toBe(false)
    const morale = q.morale
    rejectBid(s, q.id)
    expect(q.morale).toBeLessThan(morale)
    expect(s.bids).toHaveLength(0)
  })

  it('kontroferta albo podbija o 30%, albo kończy rozmowy', () => {
    const s = startAt(6, 9)
    const p = [...s.squad].sort((a, b) => b.skill - a.skill)[0]
    s.bids = [makeForeignBid(new Rng(1), p)!]
    const fee = s.bids[0].fee
    counterBid(s, p.id)
    if (s.bids.length) expect(s.bids[0].fee).toBeGreaterThanOrEqual(fee * 1.29)
  })

  it('cenę na rynku można zbić tylko raz', () => {
    const s = startAt(7, 7)
    const t = s.transferList.find((x) => x.fee > 0)!
    const fee = t.fee
    expect(haggleFee(s, t.player.id)).not.toBe('')
    expect(t.fee === fee || t.fee < fee).toBe(true)
    expect(haggleFee(s, t.player.id)).toBe('')
  })

  it('po sezonie zawodnicy pamiętają średnią ocen', () => {
    const s = startAt(8, 9)
    let guard = 0
    while (s.season === 1 && guard++ < 600) {
      if (s.phase === 'transfer') finishTransfers(s)
      else if (s.phase === 'event') resolveEvent(s, 0)
      else if (s.phase === 'season') playNext(s)
      else break
    }
    if (s.clubId !== null && s.squad.length) expect(s.squad.some((p) => p.lastRating !== undefined)).toBe(true)
  })
})
