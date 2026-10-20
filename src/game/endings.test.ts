import { describe, expect, it } from 'vitest'
import { acceptOffer, careerCard, finishTransfers, newGame, playNext, resolveEvent, retire, simulateToBreak, waitForOffers } from './engine'
import { BURNOUT_END, BURNOUT_WARN, DIRT_END, DIRT_WARN } from './endings'
import type { GameState } from './types'

function inSeason(seed = 3): GameState {
  const s = newGame({ firstName: 'Test', lastName: 'Trener', age: 40, region: 'mazowieckie', seed })
  acceptOffer(s, s.offers[0].teamId)
  finishTransfers(s)
  return s
}

/** gra mecze, aż coś przerwie sezon */
function playUntil(s: GameState, stop: (s: GameState) => boolean) {
  let guard = 0
  while (!stop(s) && s.phase === 'season' && guard++ < 60) playNext(s)
}

describe('zakończenia kariery', () => {
  it('wypalenie kończy karierę po meczu', () => {
    const s = inSeason()
    s.burnout = BURNOUT_END
    s.coach.stress = 95
    s.flags.lekarz = 2
    playNext(s)
    expect(s.phase).toBe('retired')
    expect(s.ending?.kind).toBe('wypalenie')
    expect(s.ending?.text).toContain('piłka albo serce')
    expect(s.history[s.history.length - 1].outcome).toBe('wypalenie w trakcie sezonu')
    expect(careerCard(s).lastWord).toBeTruthy()
  })

  it('lekarz ostrzega, a urlop daje sezon przerwy bez wypalenia', () => {
    const s = inSeason()
    s.burnout = BURNOUT_WARN
    s.coach.stress = 70
    playUntil(s, (g) => g.phase === 'event')
    expect(s.pendingEvent?.eventId).toBe('lekarz')
    const rep = s.coach.reputation
    resolveEvent(s, 0)
    expect(s.phase).toBe('seasonEnd')
    expect(s.clubId).toBeNull()
    expect(s.burnout).toBe(0)
    expect(s.onLeave).toBeUndefined()
    expect(s.seasonsUnemployed).toBe(0)
    expect(s.coach.reputation).toBeLessThan(rep)
  })

  it('asystent nie bierze urlopu za trenera', () => {
    const s = inSeason()
    s.burnout = BURNOUT_WARN
    s.coach.stress = 70
    s.coach.savings = 50_000
    simulateToBreak(s)
    expect(s.onLeave).toBeUndefined()
    expect(s.news.some((n) => n.includes('Ciechocinku'))).toBe(true)
  })

  it('pełna teczka kończy karierę aferą w gazecie', () => {
    const s = inSeason()
    s.scandals.push('Prezes na ławce trenerskiej')
    s.dirt = DIRT_END
    playNext(s)
    expect(s.ending?.kind).toBe('skandal')
    expect(s.ending?.headline).toBeTruthy()
    expect(careerCard(s).scandal).toBe(s.ending?.headline)
    expect(s.ending?.text).toContain('prezes na ławce trenerskiej')
  })

  it('dziennikarz dzwoni, zanim teczka pójdzie do druku', () => {
    const s = inSeason()
    s.dirt = DIRT_WARN
    playUntil(s, (g) => g.phase === 'event')
    expect(s.pendingEvent?.eventId).toBe('dziennikarz')
    resolveEvent(s, 1)
    expect(s.dirt).toBeLessThan(DIRT_WARN)
  })

  it('za długo bez pracy: sklep wędkarski', () => {
    const s = inSeason()
    s.clubId = null
    s.squad = []
    s.phase = 'hiring'
    s.seasonsUnemployed = 2
    waitForOffers(s)
    expect(s.phase).toBe('retired')
    expect(s.ending?.kind).toBe('bezrobocie')
    expect(s.ending?.title).toBe('Sklep wędkarski')
  })

  it('trener może skończyć sam, karta ma cytat z prasy', () => {
    const s = newGame({ firstName: 'A', lastName: 'B', age: 30, region: 'mazowieckie', seed: 1 })
    retire(s, 'Wolę działkę.')
    const card = careerCard(s)
    expect(card.ending?.kind).toBe('decyzja')
    expect(card.reason).toBe('Wolę działkę.')
    expect(card.press.source).toBe('Forum kibiców')
  })
})

describe('oś wykresu kariery', () => {
  it('nazwy poziomów według lig województwa', async () => {
    const { levelShort, lowestLevel } = await import('./world')
    expect([1, 2, 3, 4, 5].map((lv) => levelShort(lv, 'mazowieckie'))).toEqual(['B', 'A', 'Okr.', 'V', 'IV'])
    expect(lowestLevel('mazowieckie')).toBe(1)
    expect(levelShort(0, 'mazowieckie')).toBeUndefined()
    expect([2, 3, 4, 5].map((lv) => levelShort(lv, 'łódzkie'))).toEqual(['B', 'A', 'Okr.', 'IV'])
    expect(lowestLevel('śląskie')).toBe(0)
    expect(levelShort(9, 'śląskie')).toBe('Ekstraklasa')
  })
})

describe('trofea na karcie', () => {
  it('grupuje mistrzostwa po poziomie ligi i zaczyna od najważniejszych', async () => {
    const { trophyLines } = await import('./endings')
    const lines = trophyLines([
      'Mistrzostwo: Klasa B · Siedlce I (sezon 1)',
      'Mistrzostwo: III liga (gr. I) (sezon 7)',
      'Puchar Polski na szczeblu wojewódzkim (sezon 8)',
      'Mistrzostwo Polski (sezon 20)',
      'Mistrzostwo: III liga (gr. IV) (sezon 9)',
      'Mistrzostwo Polski (sezon 21)',
      'Mistrzostwo Polski (sezon 24)',
      'Puchar Polski (sezon 22)',
    ])
    expect(lines).toEqual([
      { label: 'Mistrzostwo Polski', count: 3 },
      { label: 'Puchar Polski', count: 1 },
      { label: 'Mistrzostwo: III liga', count: 2 },
      { label: 'Puchar wojewódzki', count: 1 },
      { label: 'Mistrzostwo: Klasa B', count: 1 },
    ])
  })
})

describe('nowy nabytek', () => {
  it('umowę kupionego zawodnika przedłużysz dopiero w kolejnym oknie', async () => {
    const { buyPlayer } = await import('./market')
    const { canNegotiate } = await import('./contracts')
    const s = newGame({ firstName: 'A', lastName: 'B', age: 30, region: 'mazowieckie', seed: 9 })
    acceptOffer(s, s.offers[0].teamId)
    expect(s.phase).toBe('transfer')
    s.budget = 10_000_000
    s.wageLimit = 10_000_000
    const target = s.transferList[0]
    target.player.contract = 1
    buyPlayer(s, target.player.id)
    const p = s.squad.find((x) => x.id === target.player.id)!
    expect(canNegotiate(p)).toBe(false)
    finishTransfers(s)
    expect(canNegotiate(p)).toBe(true)
  })
})
