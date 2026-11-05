import { describe, expect, it } from 'vitest'
import { playCareer } from './bot'
import { acceptOffer, newGame } from './engine'
import { allCandidates, autoCallUps, callUpCandidate, CANDIDATE_COUNT, eventFor, isTournamentSeason, nationalOffer, nationsLeagueName, polandTeam, REACHED_LABEL, SQUAD_SIZE } from './national'
import { releasePlayer } from './market'
import { previewStrength } from './match'
import type { GameState, NationalSide } from './types'
import { withRng } from './util'

/** kariera, w której PZPN dzwoni od razu po pierwszym sezonie */
function nationalCareer(seed: number, side: NationalSide): GameState {
  const s = newGame({ firstName: 'Kadra', lastName: 'Tester', age: 45, region: 'mazowieckie', seed })
  s.coach.license = 'UEFA Pro'
  s.coach.reputation = side === 'A' ? 95 : 80
  playCareer(s, 1, (g) => g.phase === 'seasonEnd')
  const teamId = polandTeam(s, side)
  let offer = undefined
  for (let i = 0; i < 50 && !offer?.national; i++) offer = withRng(s, (rng) => nationalOffer(rng, s))
  expect(offer?.national).toBeDefined()
  s.offers = [{ ...offer!, national: side, teamId, teamName: side === 'A' ? 'Reprezentacja Polski' : 'Reprezentacja Polski U21' }]
  acceptOffer(s, teamId)
  return s
}

describe('reprezentacja', () => {
  for (const side of ['A', 'U21'] as const)
    it(`selekcjoner ${side}: kilka sezonów eliminacji i turniejów bez błędu`, () => {
      const s = nationalCareer(side === 'A' ? 501 : 502, side)
      expect(s.national?.side).toBe(side)
      expect(s.phase).toBe('season')
      expect(s.squad.length).toBe(26)
      // Polska to mocny średniak: słabsza od faworytów, mocniejsza od słabeuszy
      const str = previewStrength(s)
      const mine = (str.att + str.def) / 2
      const base = side === 'A' ? 86 : 75
      console.log(side, 'siła', mine.toFixed(1))
      expect(Math.abs(mine - base), `siła Polski ${mine.toFixed(1)}`).toBeLessThan(5)
      playCareer(s, 6, (g) => !g.national && g.phase !== 'event')
      const nat = s.history.filter((h) => h.national)
      expect(nat.length).toBeGreaterThan(0)
      for (const h of nat) expect(REACHED_LABEL[h.national!.reached]).toBeDefined()
      // raporty z meczów kadry są opisane jako mecze reprezentacji
      expect(s.history.some((h) => h.clubName.startsWith('Reprezentacja'))).toBe(true)
    }, 60000)

  it('kalendarz: Euro i mundial co cztery lata z przesunięciem, młodzieżówka w latach nieparzystych', () => {
    // sezon 1 kończy się latem 2027
    expect([1, 2, 3, 4, 5, 6].map((x) => eventFor('A', x))).toEqual([
      'Mistrzostwa Europy 2028',
      'Mistrzostwa Europy 2028',
      'Mistrzostwa Świata 2030',
      'Mistrzostwa Świata 2030',
      'Mistrzostwa Europy 2032',
      'Mistrzostwa Europy 2032',
    ])
    expect([1, 2, 3, 4].map((x) => isTournamentSeason('A', x))).toEqual([false, true, false, true])
    expect([1, 2, 3, 4].map((x) => isTournamentSeason('U21', x))).toEqual([true, false, true, false])
    expect(eventFor('U21', 2)).toBe('Mistrzostwa Europy U21 2029')
    expect(nationsLeagueName(3)).toBe('Liga Narodów 2028/29')
  })

  it('eliminacje trwają dwa sezony, a w sezonie bez turnieju jest Liga Narodów', () => {
    const s = nationalCareer(701, 'A')
    // sezon 2 (lato 2028) to sezon Euro: poprzednik rozegrał już wiosenne mecze eliminacji
    expect(s.national!.tournSeason).toBe(true)
    expect(s.national!.nl).toBeUndefined()
    const before = s.national!.qual.rounds.slice(0, 4).flat()
    expect(before.every((f) => f.hg !== undefined)).toBe(true)
    playCareer(s, 3, (g) => g.season === 3 && g.phase === 'season')
    if (!s.national) return
    // sezon 3: Liga Narodów jesienią i początek eliminacji mundialu wiosną
    expect(s.national.tournSeason).toBe(false)
    expect(s.national.nl?.group.teamIds).toHaveLength(4)
    expect(s.national.event).toBe('Mistrzostwa Świata 2030')
    const qual = s.national.qual
    playCareer(s, 4, (g) => g.season === 4 && g.phase === 'season')
    if (!s.national) return
    // ta sama grupa eliminacyjna gra dalej
    expect(s.national.qual).toEqual(expect.objectContaining({ name: qual.name }))
    expect(s.national.qual.rounds.slice(0, 4).flat().every((f) => f.hg !== undefined)).toBe(true)
    expect(s.national.nl).toBeUndefined()
  }, 60000)

  it('rozkład wyników: zwykle awans, czasem daleko, rzadko złoto', () => {
    const reached: number[] = []
    const nl: number[] = []
    for (let i = 0; i < 10; i++) {
      const s = nationalCareer(600 + i, 'A')
      playCareer(s, 6, (g) => !g.national && g.phase !== 'event')
      for (const h of s.history) {
        if (!h.national || h.fired) continue
        if (h.national.between) nl.push(h.national.nl ?? 0)
        else reached.push(h.national.reached)
      }
    }
    console.log('turnieje', reached.join(','), '· Liga Narodów', nl.join(','))
    expect(reached.length).toBeGreaterThanOrEqual(10)
    expect(reached.filter((r) => r >= 1).length / reached.length).toBeGreaterThan(0.4)
    expect(reached.filter((r) => r === 6).length / reached.length).toBeLessThan(0.25)
    expect(nl.length).toBeGreaterThan(3)
  }, 180000)
})

describe('powołania', () => {
  it('50 kandydatów gra w klubach, rozwija się, a selekcjoner powołuje i odsyła', () => {
    const s = nationalCareer(801, 'A')
    expect(s.squad.length + s.national!.pool!.length).toBe(CANDIDATE_COUNT)
    expect(s.squad).toHaveLength(SQUAD_SIZE)
    const clubs0 = new Map(allCandidates(s).map((p) => [p.id, p.club]))
    const skill0 = new Map(allCandidates(s).map((p) => [p.id, p.skill]))
    playCareer(s, 2, (g) => g.round >= 20 && g.phase === 'season')
    // minuty i forma z klubów
    const all = allCandidates(s)
    expect(all.filter((p) => (p.clubMins ?? 0) > 0).length).toBeGreaterThan(35)
    expect(new Set(all.map((p) => p.form)).size).toBeGreaterThan(2)
    // powołanie z listy i odesłanie do klubu
    const out = s.squad[s.squad.length - 1]
    releasePlayer(s, out.id)
    expect(s.national!.pool!.some((p) => p.id === out.id)).toBe(true)
    const inn = s.national!.pool![0]
    callUpCandidate(s, inn.id)
    expect(s.squad.some((p) => p.id === inn.id)).toBe(true)
    expect(callUpCandidate(s, s.national!.pool![0].id)).toMatch(/najwyżej/)
    autoCallUps(s)
    expect(s.squad).toHaveLength(SQUAD_SIZE)
    // po sezonie: transfery, rozwój młodych, nowe nazwiska, ciągle 50
    playCareer(s, 3, (g) => g.season === 3 && g.phase === 'season')
    if (!s.national) return
    const later = allCandidates(s)
    expect(later.length).toBe(CANDIDATE_COUNT)
    expect(later.filter((p) => clubs0.has(p.id) && clubs0.get(p.id) !== p.club).length).toBeGreaterThan(0)
    expect(later.filter((p) => !skill0.has(p.id)).length).toBeGreaterThan(0)
    expect(later.some((p) => skill0.has(p.id) && p.skill > skill0.get(p.id)!)).toBe(true)
  }, 60000)
})
