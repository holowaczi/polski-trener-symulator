import { describe, expect, it } from 'vitest'
import { EVENTS } from './events'
import { euroSpotsFor } from './europe'
import { finishTransfers, newGame, playNext, resolveEvent, stayAtClub } from './engine'
import { roleIfSigned } from './market'
import { generatePlayer, isPolish, nationOf, teamsAtLevel } from './world'
import { Rng } from './rng'
import type { GameState } from './types'

/** start w najmocniejszym (albo n-tym) klubie Ekstraklasy, który gra w Europie od pierwszego sezonu */
function europeanStart(seed: number, rank = 0): GameState {
  const probe = newGame({ firstName: 'A', lastName: 'B', age: 40, region: 'mazowieckie', seed })
  const id = [...teamsAtLevel(probe, 9)].sort((a, b) => probe.teams[b].strength - probe.teams[a].strength)[rank]
  return newGame({ firstName: 'Test', lastName: 'Europa', age: 40, region: 'mazowieckie', seed, license: 'UEFA Pro', teamId: id })
}

/** rozgrywa sezon do końca, zdarzenia rozstrzyga pierwszą opcją */
function playSeason(s: GameState): void {
  const season = s.season
  let guard = 0
  while (s.season === season && guard++ < 500) {
    if (s.phase === 'transfer') finishTransfers(s)
    else if (s.phase === 'event') resolveEvent(s, 0)
    else if (s.phase === 'season') playNext(s)
    else break
  }
}

describe('europejskie puchary', () => {
  it('mistrz do Ligi Mistrzów, zdobywca pucharu do Ligi Europy, dalej Liga Konferencji', () => {
    expect(euroSpotsFor([1, 2, 3, 4], 9)).toEqual([
      { teamId: 1, comp: 'LM' },
      { teamId: 9, comp: 'LE' },
      { teamId: 2, comp: 'LKE' },
      { teamId: 3, comp: 'LKE' },
    ])
    // zdobywca pucharu jest mistrzem: Liga Europy dla drugiego, Liga Konferencji dla trzeciego i czwartego
    expect(euroSpotsFor([1, 2, 3, 4], 1).map((x) => x.comp)).toEqual(['LM', 'LE', 'LKE', 'LKE'])
    expect(euroSpotsFor([1, 2, 3, 4], 1).map((x) => x.teamId)).toEqual([1, 2, 3, 4])
    // zdobywca pucharu z czołówki: jego miejsce w Lidze Konferencji przechodzi na czwartego
    expect(euroSpotsFor([1, 2, 3, 4], 2).map((x) => x.teamId)).toEqual([1, 2, 3, 4])
  })

  it('najmocniejszy klub Ekstraklasy zaczyna od eliminacji Ligi Mistrzów', () => {
    const s = europeanStart(5)
    expect(s.euro?.comp).toBe('LM')
    expect(s.euro?.ties[0].stage).toBe('Q2')
    expect(s.euro?.ties[0].legs).toHaveLength(2)
    const opp = s.teams[s.euro!.ties[0].opp]
    expect(opp.country).toBeTruthy()
  })

  it('sezon z Europą przechodzi bez błędów i trafia do historii', () => {
    for (const seed of [1, 7, 99, 2026]) {
      const s = europeanStart(seed, seed % 4)
      expect(s.euro).toBeDefined()
      playSeason(s)
      expect(s.phase === 'seasonEnd' || s.phase === 'hiring' || s.phase === 'retired').toBe(true)
      const last = s.history[s.history.length - 1]
      expect(last.euro).toBeDefined()
      expect(last.cup).toMatch(/Liga (Mistrzów|Europy|Konferencji)/)
      // mecze europejskie mają raporty z dwumeczem
      expect(s.euro?.done).toBe(true)
    }
  })

  it('zostając w klubie z miejscem w Europie, losujemy nowego rywala', () => {
    const s = europeanStart(3)
    playSeason(s)
    if (s.phase !== 'seasonEnd' || s.clubId === null) return
    const qualified = s.euroSpots?.some((x) => x.teamId === s.clubId)
    stayAtClub(s)
    expect(!!s.euro && s.euro.season === s.season).toBe(!!qualified)
    // rywale z poprzedniego sezonu zniknęli
    const foreign = Object.values(s.teams).filter((t) => t.country)
    expect(foreign.length).toBe(qualified ? 1 : 0)
  })

  it('mecze europejskie mają własne raporty', () => {
    const s = europeanStart(11)
    let euroMatches = 0
    let guard = 0
    while (s.phase !== 'seasonEnd' && s.phase !== 'hiring' && guard++ < 500) {
      if (s.phase === 'transfer') finishTransfers(s)
      else if (s.phase === 'event') resolveEvent(s, 0)
      else {
        playNext(s)
        if (s.lastReport?.euro && s.reports[0] === s.lastReport) euroMatches++
      }
    }
    expect(euroMatches).toBeGreaterThanOrEqual(2)
  })

  it('pomiar: jak daleko zachodzą polskie kluby', () => {
    const reached: number[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const s = europeanStart(seed, seed % 4)
      playSeason(s)
      const h = s.history[s.history.length - 1]
      if (h?.euro) reached.push(h.euro.reached)
    }
    const dist = [0, 1, 2, 3, 4, 5, 6, 7].map((r) => reached.filter((x) => x === r).length)
    console.log('europa: najdalszy etap (eliminacje, faza ligowa, baraże, 1/8, 1/4, 1/2, finał, zwycięstwo):', dist.join(' / '))
    // ktoś przechodzi eliminacje, ale wygrywanie pucharu to rzadkość
    expect(reached.filter((x) => x >= 1).length).toBeGreaterThan(5)
    expect(reached.filter((x) => x === 7).length).toBeLessThan(8)
  })
})

describe('narodowość', () => {
  it('każdy wylosowany zawodnik ma kraj, obcokrajowcy nie są Polakami', () => {
    const rng = new Rng(4)
    const st = { nextId: 1 }
    const pl = generatePlayer(rng, st, 7, 'POM')
    const foreign = generatePlayer(rng, st, 7, 'POM', { foreign: true })
    expect(pl.nation).toBe('Polska')
    expect(isPolish(pl)).toBe(true)
    expect(foreign.nation).not.toBe('Polska')
    expect(isPolish(foreign)).toBe(false)
    // stary zapis bez narodowości: zgadujemy z nazwiska
    expect(nationOf({ lastName: 'Horvat' })).toBe('Chorwacja')
    expect(nationOf({ lastName: 'Kowalski' })).toBe('Polska')
  })

  it('PZPN powołuje do młodzieżówki tylko Polaków', () => {
    const ev = EVENTS.find((e) => e.id === 'kontuzja_kadra_mlodziezowa')!
    const rng = new Rng(8)
    const st = { nextId: 1 }
    const young = { ...generatePlayer(rng, st, 6, 'NAP', { age: 19 }), apps: 5 }
    const foreign = { ...generatePlayer(rng, st, 6, 'NAP', { age: 19, foreign: true }), apps: 5 }
    const s = newGame({ firstName: 'A', lastName: 'B', age: 40, region: 'mazowieckie', seed: 1 })
    const check = ev.player as (p: typeof young, s: GameState) => boolean
    expect(check(young, s)).toBe(true)
    expect(check(foreign, s)).toBe(false)
  })
})

describe('miejsce w składzie przy transferze', () => {
  it('gwiazda wchodzi do pierwszej jedenastki, słabeusz ląduje w rezerwach', () => {
    const s = europeanStart(2)
    const rng = new Rng(3)
    const star = generatePlayer(rng, s, 9, 'NAP', { skillOffset: 30, age: 26 })
    const weak = generatePlayer(rng, s, 0, 'NAP', { age: 26 })
    const a = roleIfSigned(s, star)
    expect(a.role).toBe('xi')
    expect(a.replaces).toBeDefined()
    expect(roleIfSigned(s, weak).role).toBe('out')
  })
})
