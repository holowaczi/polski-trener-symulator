import { describe, expect, it } from 'vitest'
import { botCareer } from './bot'
import { assistantSpeech, fireThreshold, isDerby, PRESIDENT_INFO, presidentOf, rivalId, speechEffect } from './character'

describe('charakter sezonu', () => {
  it('rywal jest z tej samej ligi, nie jest nami ani naszymi rezerwami i nie zmienia się w trakcie sezonu', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = botCareer(seed, ['mazowieckie', 'śląskie', 'pomorskie', 'lubelskie'][seed - 1], 2)
      if (s.clubId === null) continue
      const r = rivalId(s)
      expect(r).toBeDefined()
      expect(r).not.toBe(s.clubId)
      expect(s.leagues.find((l) => l.teamIds.includes(s.clubId!))!.teamIds).toContain(r)
      expect(isDerby(s, r!)).toBe(true)
      expect(rivalId(structuredClone(s))).toBe(r)
    }
  }, 60000)

  it('każdy klub ma prezesa, a próg zwolnienia zależy od jego charakteru', () => {
    const s = botCareer(5, 'małopolskie', 2)
    const p = presidentOf(s)!
    expect(p.teamId).toBe(s.clubId)
    expect(fireThreshold(s)).toBe(PRESIDENT_INFO[p.type].fireAt)
  }, 60000)

  it('przemowa: wściekłość pomaga odrabiać, spokój broni prowadzenia', () => {
    expect(assistantSpeech(-1)).toBe('wscieklosc')
    expect(assistantSpeech(2)).toBe('spokojnie')
    expect(speechEffect('wscieklosc', -1).att).toBeGreaterThan(speechEffect('wscieklosc', 1).att)
    expect(speechEffect('spokojnie', 1).def).toBeGreaterThan(speechEffect('spokojnie', -1).def)
  })

  it('raporty z meczów mają nagłówek z prasy', () => {
    const s = botCareer(6, 'wielkopolskie', 1)
    expect(s.reports.length + (s.prevReports?.length ?? 0)).toBeGreaterThan(0)
    for (const r of [...s.reports, ...(s.prevReports ?? [])]) if (!r.euro) expect(r.headline).toMatch(/: /)
  }, 60000)
})
