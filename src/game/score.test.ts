import { describe, expect, it } from 'vitest'
import { newGame } from './engine'
import { careerScore, startMultiplier } from './score'
import { bottomLevel, teamsAtLevel } from './world'

const base = { firstName: 'a', lastName: 'b', age: 30, region: 'mazowieckie', seed: 5 }

describe('start i punkty kariery', () => {
  it('zwykły start i wyzwanie dnia mają mnożnik 1', () => {
    expect(newGame(base).start?.multiplier).toBe(1)
    const daily = newGame({ ...base, daily: true, license: 'UEFA Pro', teamId: 1 })
    expect(daily.start?.multiplier).toBe(1)
    expect(daily.coach.license).toBe('UEFA C')
    expect(daily.phase).toBe('hiring')
  })

  it('wybrany klub: start od razu w klubie, im wyżej, tym mniejszy mnożnik', () => {
    const w = newGame(base)
    const ekstra = teamsAtLevel(w, 9)[0]
    const bottom = teamsAtLevel(w, bottomLevel(w))[0]
    const s = newGame({ ...base, license: 'UEFA Pro', teamId: ekstra })
    expect(s.clubId).toBe(ekstra)
    expect(s.phase).not.toBe('hiring')
    expect(s.start!.multiplier).toBeLessThan(0.2)
    expect(startMultiplier(w, 'UEFA C', bottom)).toBeGreaterThan(startMultiplier(w, 'UEFA B', bottom))
    expect(startMultiplier(w, 'UEFA C', bottom)).toBeGreaterThan(0.8)
  })

  it('licencja musi pozwalać na wybrany poziom', () => {
    const w = newGame(base)
    const ekstra = teamsAtLevel(w, 9)[0]
    const s = newGame({ ...base, license: 'UEFA C', teamId: ekstra })
    expect(s.clubId).toBeNull()
    expect(s.start!.teamId).toBeUndefined()
    expect(s.start!.multiplier).toBe(1)
  })

  it('punkty rosną z historią i są skalowane mnożnikiem', () => {
    const s = newGame(base)
    expect(careerScore(s)).toBe(0)
    s.history.push({ season: 1, clubName: 'X', level: 3, leagueName: 'L', position: 1, outcome: '1. miejsce, mistrzostwo, awans', cup: '' })
    const full = careerScore(s)
    expect(full).toBeGreaterThan(0)
    s.start = { license: 'UEFA B', multiplier: 0.5 }
    expect(careerScore(s)).toBe(Math.round(full * 0.5))
  })
})
