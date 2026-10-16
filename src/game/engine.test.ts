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
  licenseStatus,
  boardPaysCourse,
  stayAtClub,
  startLicenseCourse,
  takeJob,
} from './engine'
import { callUp, parentTeam, returnSentDown, sendDown } from './reserves'
import { wageBill } from './util'
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
        // bez wymaganej licencji nie da się zostać: bierzemy pierwszą ofertę
        if ((s.phase as string) === 'seasonEnd') acceptOffer(s, s.offers[0].teamId)
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
      else if (s.phase === 'seasonEnd') { stayAtClub(s); if ((s.phase as string) === 'seasonEnd') acceptOffer(s, s.offers[0].teamId) }
      else if (s.phase === 'hiring') acceptOffer(s, s.offers[0].teamId)
      const msg = simulateToBreak(s)
      expect(msg).toMatch(/^Przesymulowano/)
      expect(['transfer', 'seasonEnd', 'hiring']).toContain(s.phase)
      expect(s.pendingEvent).toBeUndefined()
    }
  })
})

describe('mecz po meczu', () => {
  it('każde kliknięcie rozgrywa dokładnie jeden mecz klubu, także w tygodniu z ligą i pucharem', () => {
    let cupsSeen = 0
    for (const seed of [3, 11, 21]) {
      const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'śląskie', seed })
      acceptOffer(s, s.offers[0].teamId)
      finishTransfers(s)
      let guard = 0
      while (s.season === 1 && guard++ < 200) {
        if (s.phase === 'event') resolveEvent(s, 0)
        else if (s.phase === 'transfer') finishTransfers(s)
        else if (s.phase === 'season') {
          const before = s.reports.length
          const first = s.reports[0]
          playNext(s)
          const added = s.reports[0] === first ? 0 : s.reports.length === 40 ? 1 : s.reports.length - before
          expect(added).toBeLessThanOrEqual(1)
          if (s.reports[0] !== first && s.reports[0]?.cup) cupsSeen++
        } else break
      }
    }
    expect(cupsSeen).toBeGreaterThan(0)
  })
})

describe('licencja po awansie', () => {
  it('bez licencji: jeden sezon z trenerem na papierze, potem trzeba się zapisać na kurs', () => {
    const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'mazowieckie', seed: 5 })
    acceptOffer(s, s.offers[0].teamId)
    const t = s.teams[s.clubId!]
    // udajemy awans do IV ligi, która wymaga UEFA B
    t.level = 5
    s.phase = 'seasonEnd'
    const lic = licenseStatus(s)!
    expect(lic.ok).toBe(false)
    expect(lic.figurant).toBe(true)
    expect(lic.canStay).toBe(true)
    const budget = s.budget
    stayAtClub(s)
    expect(s.phase).toBe('transfer')
    expect(s.figurant).toBe(1)
    expect(s.budget).toBeLessThan(budget + 50_000)
    // drugi sezon bez kursu: zostać się nie da
    s.phase = 'seasonEnd'
    expect(licenseStatus(s)!.canStay).toBe(false)
    stayAtClub(s)
    expect(s.phase).toBe('seasonEnd')
    // na kursie związek daje zgodę warunkową
    s.coach.courseLeft = 1
    expect(licenseStatus(s)!.canStay).toBe(true)
    expect(licenseStatus(s)!.studying).toBe(true)
  })
})

describe('kurs na koszt klubu', () => {
  it('przy dobrych relacjach zarząd płaci za kurs po awansie, bez sprawdzania reputacji', () => {
    const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'mazowieckie', seed: 9 })
    acceptOffer(s, s.offers[0].teamId)
    s.teams[s.clubId!].level = 5
    s.coach.reputation = 0
    const savings = s.coach.savings
    s.trust.board = 40
    expect(boardPaysCourse(s)).toBe(false)
    s.trust.board = 70
    expect(boardPaysCourse(s)).toBe(true)
    startLicenseCourse(s, true)
    expect(s.coach.courseLeft).toBe(1)
    expect(s.coach.savings).toBe(savings)
    expect(licenseStatus(s)!.studying).toBe(true)
  })
})

describe('baraże', () => {
  it('w I i II lidze miejsca 3–6 grają baraże, a zwycięzca awansuje', () => {
    const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'śląskie', seed: 13 })
    acceptOffer(s, s.offers[0].teamId)
    const levelsBefore = new Map(Object.values(s.teams).map((t) => [t.id, t.level]))
    let guard = 0
    while (s.phase !== 'seasonEnd' && guard++ < 50) {
      if (s.phase === 'transfer') finishTransfers(s)
      else if (s.phase === 'hiring') acceptOffer(s, s.offers[0].teamId)
      else simulateToBreak(s)
    }
    expect(s.lastPlayoffs?.length).toBe(2)
    for (const po of s.lastPlayoffs!) {
      expect(po.seeds).toHaveLength(4)
      expect(po.rounds[1]).toHaveLength(1)
      expect(po.winner).toBeDefined()
      expect(s.teams[po.winner!].level).toBe(levelsBefore.get(po.winner!)! + 1)
      const final = po.rounds[1][0]
      // finał u lepszego z tabeli
      expect(po.seeds.indexOf(final.home)).toBeLessThan(po.seeds.indexOf(final.away))
    }
  })
})

describe('rezerwy', () => {
  function withReserves() {
    const s = newGame({ firstName: 'Test', lastName: 'Bot', age: 30, region: 'mazowieckie', seed: 5 })
    const res = Object.values(s.teams).find((t) => t.reserve && parentTeam(s, t.id))!
    const parent = parentTeam(s, res.id)!
    return { s, res, parent }
  }

  it('zesłany młody gra w rezerwach, wraca po sezonie lepszy, a nowy z rezerw kosztuje pensję', () => {
    const { s, parent } = withReserves()
    const lg = s.leagues.find((l) => l.teamIds.includes(parent.id))!
    takeJob(s, { teamId: parent.id, teamName: parent.name, level: parent.level, leagueName: lg.name, goal: 'utrzymanie', salary: 1000, note: '' })
    expect(s.reserveSquad?.length).toBe(8)
    const kid = s.squad[0]
    kid.age = 19
    kid.potential = kid.skill + 10
    const skill = kid.skill
    const before = s.squad.length
    sendDown(s, kid.id)
    expect(s.squad).toHaveLength(before - 1)
    expect(s.reserveSquad!.find((p) => p.id === kid.id)?.sentDown).toBe(true)
    // pensja zesłanego dalej się liczy
    expect(wageBill(s)).toBeGreaterThanOrEqual(kid.wage)
    const notes = returnSentDown(s)
    expect(notes.length).toBe(2)
    expect(s.squad.find((p) => p.id === kid.id)?.skill).toBe(skill + 2)

    const prospect = s.reserveSquad!.find((p) => !p.sentDown)!
    s.wageLimit = wageBill(s)
    expect(callUp(s, prospect.id)).toMatch(/limit/)
    s.wageLimit += prospect.wage
    callUp(s, prospect.id)
    expect(s.squad.some((p) => p.id === prospect.id)).toBe(true)
  })

  it('zastępstwo w pierwszej drużynie: przyjęcie zmienia klub na klub macierzysty', () => {
    const { s, res, parent } = withReserves()
    const lg = s.leagues.find((l) => l.teamIds.includes(res.id))!
    takeJob(s, { teamId: res.id, teamName: res.name, level: res.level, leagueName: lg.name, goal: 'środek', salary: 1000, note: '' })
    s.phase = 'event'
    s.resumePhase = 'season'
    s.pendingEvent = { eventId: 'zastepstwo', data: { teamId: parent.id, fee: 0 }, text: '', options: [{ label: 'a' }, { label: 'b' }] }
    resolveEvent(s, 0)
    expect(s.clubId).toBe(parent.id)
    expect(s.interim?.reserveId).toBe(res.id)
    expect(s.goal).toBe('utrzymanie')
    let guard = 0
    while ((s.phase as string) !== 'seasonEnd' && guard++ < 50) {
      if (s.phase === 'event') resolveEvent(s, 0)
      else if (s.phase === 'transfer') finishTransfers(s)
      else simulateToBreak(s)
    }
    const last = s.history[s.history.length - 1]
    // utrzymana pierwsza drużyna zostaje u Ciebie, nieutrzymana: wracasz do rezerw
    if (last.outcome.includes('spad')) expect(s.clubId).toBe(res.id)
    else expect(s.clubId).toBe(parent.id)
    expect(s.interim).toBeUndefined()
  })
})
