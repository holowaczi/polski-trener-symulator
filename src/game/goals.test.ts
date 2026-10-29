import { describe, expect, it } from 'vitest'
import { botCareer, playCareer } from './bot'
import { BADGES, SCENARIOS } from './goals'
import { RESCUE_WEEK, newScenarioGame } from './scenarioStart'
import { computeTable } from './util'

const who = { firstName: 'T', lastName: 'W', age: 35, region: 'śląskie', seed: 42 }

describe('wyzwania-scenariusze', () => {
  it('„Uratuj klub” zaczyna się w strefie spadkowej I ligi na 10 kolejek przed końcem', () => {
    const s = newScenarioGame(who, 'uratuj_klub')
    expect(s.phase).toBe('season')
    expect(s.round).toBe(RESCUE_WEEK)
    const lg = s.leagues.find((l) => l.level === 8)!
    expect(lg.rounds.length - s.round).toBe(10)
    const table = computeTable(lg)
    expect(table.findIndex((r) => r.teamId === s.clubId)).toBeGreaterThanOrEqual(table.length - 4)
    expect(s.squad.length).toBeGreaterThan(11)
  }, 60000)

  it('„Utrzymaj beniaminka” to najsłabszy klub Ekstraklasy z licencją UEFA Pro', () => {
    const s = newScenarioGame(who, 'beniaminek')
    expect(s.teams[s.clubId!].level).toBe(9)
    expect(s.coach.license).toBe('UEFA Pro')
    expect(s.goal).toBe('utrzymanie')
  })

  for (const sc of SCENARIOS)
    it(`${sc.title}: kończy się wynikiem najpóźniej po ${sc.seasons} sezonach`, () => {
      const s = newScenarioGame({ ...who, seed: 7 }, sc.id)
      playCareer(s, sc.seasons + 1, (g) => !!g.scenario?.result)
      expect(s.scenario?.result).toMatch(/won|lost/)
      expect(s.scenario!.at!).toBeLessThanOrEqual(sc.seasons)
    }, 120000)
})

describe('odznaki', () => {
  it('długa kariera zbiera kilka odznak, każdą raz', () => {
    const s = botCareer(3, 'mazowieckie', 12)
    expect(s.badges?.length ?? 0).toBeGreaterThan(1)
    expect(new Set(s.badges).size).toBe(s.badges!.length)
    for (const b of s.badges!) expect(BADGES.some((x) => x.id === b)).toBe(true)
  }, 120000)
})
