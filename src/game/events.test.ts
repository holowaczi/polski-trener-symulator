import { describe, expect, it } from 'vitest'
import { botCareer } from './bot'
import { fillText } from './engine'
import { EVENTS } from './events'
import { Rng } from './rng'

describe('zdarzenia', () => {
  it('mają unikalne id i co najmniej dwie opcje', () => {
    const ids = EVENTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of EVENTS) expect(e.options.length, e.id).toBeGreaterThanOrEqual(2)
  })

  it('każda opcja działa na prawdziwym stanie gry, nie wpędza w debet i nie zostawia pustych pól w tekście', () => {
    const base = botCareer(11, 'mazowieckie', 1)
    expect(base.clubId).not.toBeNull()
    for (const e of EVENTS) {
      for (let i = 0; i < e.options.length; i++) {
        for (const level of [e.minLevel ?? 0, e.maxLevel ?? 9]) {
          const s = structuredClone(base)
          s.teams[s.clubId!].level = level
          const p = s.squad[0]
          for (let seed = 1; seed <= 3; seed++) {
            const out = fillText(s, e.options[i].apply({ s, rng: new Rng(seed * 97 + i), p }), p)
            expect(out, `${e.id}[${i}]`).not.toMatch(/\{|\}|undefined|NaN/)
            expect(s.budget, `${e.id}[${i}] budżet`).toBeGreaterThanOrEqual(0)
            expect(s.coach.savings, `${e.id}[${i}] oszczędności`).toBeGreaterThanOrEqual(0)
          }
          expect(fillText(s, e.text, p), e.id).not.toMatch(/\{|\}/)
        }
      }
    }
  }, 60000)
})
