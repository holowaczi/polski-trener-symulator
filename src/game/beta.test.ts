import { describe, expect, it } from 'vitest'
import { playCareer } from './bot'
import { LEVELS } from './data'
import { newGame } from './engine'
import { teamRegion, thirdGroupOf } from './regions'
import type { GameState } from './types'

/**
 * Kryteria przejścia z bety na 1.0: długie kariery w różnych województwach bez błędu,
 * z sensownymi finansami i bez klubów w złych grupach.
 * Domyślnie 4 kariery; pełny pomiar (16 karier): LONG=1 npx vitest run src/game/beta.test.ts
 */
const LONG = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LONG
const REGIONS = ['mazowieckie', 'śląskie', 'pomorskie', 'lubelskie', 'małopolskie', 'wielkopolskie', 'dolnośląskie', 'podlaskie']
const CAREERS = LONG ? 16 : 4
const SEASONS = 20

function checkWorld(s: GameState, where: string): void {
  const seen = new Set<number>()
  for (const lg of s.leagues) {
    for (const id of lg.teamIds) {
      expect(seen.has(id), `${where}: ${s.teams[id].name} w dwóch ligach`).toBe(false)
      seen.add(id)
      expect(s.teams[id].level, `${where}: ${s.teams[id].name} na złym poziomie`).toBe(lg.level)
      if (lg.level === 6) expect(thirdGroupOf(teamRegion(s, id)), `${where}: ${s.teams[id].name} w złej grupie III ligi`).toBe(lg.group)
      if (lg.level <= 5) expect(teamRegion(s, id), `${where}: ${s.teams[id].name} w IV lidze innego województwa`).toBe(lg.region)
    }
  }
}

describe('kryteria bety', () => {
  for (let i = 0; i < CAREERS; i++) {
    const region = REGIONS[i % REGIONS.length]
    it(`kariera ${i + 1}: ${SEASONS} sezonów w województwie ${region}`, () => {
      const s = newGame({ firstName: 'Beta', lastName: 'Tester', age: 28, region, seed: 1000 + i })
      let season = 0
      let maxBudgetRatio = 0
      let maxWageRatio = 0
      let patches = 0
      let lastNews = ''
      playCareer(s, SEASONS, (g) => {
        for (const n of g.news) {
          if (n === lastNews) break
          if (n.includes('łata dziurę')) patches++
        }
        lastNews = g.news[0] ?? ''
        expect(g.budget, 'budżet pod kreską').toBeGreaterThanOrEqual(0)
        expect(g.coach.savings, 'oszczędności pod kreską').toBeGreaterThanOrEqual(0)
        if (g.clubId !== null) {
          const lv = LEVELS[g.teams[g.clubId].level]
          maxBudgetRatio = Math.max(maxBudgetRatio, g.budget / lv.budget)
          maxWageRatio = Math.max(maxWageRatio, g.wageLimit / lv.salary)
        }
        if (g.season !== season) {
          season = g.season
          checkWorld(g, `${region}, sezon ${season}`)
        }
        return false
      })
      // trener dożył końca albo zakończył karierę po swojemu, ale gra się nie zawiesiła
      expect(s.season > SEASONS || s.phase === 'retired').toBe(true)
      // finanse bez eksplozji: budżet i limit pensji w rozsądnym stosunku do poziomu ligi
      // bot wydaje mało, a w Ekstraklasie zbiera premie z Europy i sprzedaże za granicę, stąd zapas w progu
      expect(maxBudgetRatio, 'budżet wybuchł').toBeLessThan(8)
      expect(maxWageRatio, 'limit pensji wybuchł').toBeLessThan(4)
      // prezes nie łata dziur co chwilę
      if (LONG) console.log(region, `sezony ${s.history.length}`, `budżet ×${maxBudgetRatio.toFixed(2)}`, `pensje ×${maxWageRatio.toFixed(2)}`, `łatanie ${patches}`)
      expect(patches, 'prezes ciągle łata budżet').toBeLessThan(SEASONS)
    }, 120000)
  }
})
