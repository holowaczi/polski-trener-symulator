import { describe, expect, it } from 'vitest'
import { playCareer } from './bot'
import { acceptOffer, newGame } from './engine'
import { nationalOffer, polandTeam, REACHED_LABEL } from './national'
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

  it('rozkład wyników: zwykle awans, czasem daleko, rzadko złoto', () => {
    const reached: number[] = []
    for (let i = 0; i < 12; i++) {
      const s = nationalCareer(600 + i, 'A')
      playCareer(s, 2, (g) => g.season > 1 && g.phase === 'seasonEnd')
      const h = s.history.find((x) => x.national)
      if (h) reached.push(h.national!.reached)
    }
    console.log('reached', reached.join(','))
    expect(reached.length).toBe(12)
    expect(reached.filter((r) => r >= 1).length).toBeGreaterThanOrEqual(5)
    expect(reached.filter((r) => r === 5).length).toBeLessThanOrEqual(4)
  }, 120000)
})
