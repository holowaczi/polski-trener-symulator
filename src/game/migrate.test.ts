import { describe, expect, it } from 'vitest'
import LZString from 'lz-string'
import { SAVE_VERSION } from './engine'
import { MIGRATIONS, MIN_SAVE_VERSION, migrateSave } from './migrate'
import { botCareer, playCareer } from './bot'
import { exportSave, importSave } from '../ui/save'
import save090 from './fixtures/save-0.9.0.txt?raw'

/**
 * Zapisy z wydanych wersji: każdy musi się wczytać i grać dalej.
 * Przy każdej wersji z nowym kształtem zapisu dorzuć tu plik z kariery w trakcie sezonu.
 */
const FIXTURES: Record<string, string> = { '0.9.0': save090 }

const parse = (txt: string) => JSON.parse(LZString.decompressFromBase64(txt.trim())!)

describe('migracje zapisu', () => {
  it('każda wersja od najstarszej obsługiwanej ma swoją migrację', () => {
    for (let v = MIN_SAVE_VERSION; v < SAVE_VERSION; v++) expect(MIGRATIONS[v], `brak migracji ${v} → ${v + 1}`).toBeTypeOf('function')
  })

  for (const [ver, txt] of Object.entries(FIXTURES))
    it(`zapis z ${ver} wczytuje się i gra dalej`, () => {
      const r = migrateSave(parse(txt))
      if (!r.ok) throw new Error(r.problem)
      expect(r.state.version).toBe(SAVE_VERSION)
      const season = r.state.season
      playCareer(r.state, season + 1)
      expect(r.state.season > season + 1 || r.state.phase === 'retired').toBe(true)
    }, 60000)

  it('odrzuca zapisy spoza zakresu i śmieci, nie rzucając wyjątkiem', () => {
    const s = parse(save090)
    expect(migrateSave({ ...s, version: SAVE_VERSION + 1 }).ok).toBe(false)
    expect(migrateSave({ ...s, version: MIN_SAVE_VERSION - 1 }).ok).toBe(false)
    expect(migrateSave(null).ok).toBe(false)
    expect(migrateSave({ version: 4 }).ok).toBe(false)
    expect(migrateSave('kiełbasa').ok).toBe(false)
  })
})

describe('kopia w pliku', () => {
  it('eksport i import dają tę samą karierę', () => {
    const s = botCareer(3, 'pomorskie', 2)
    const r = importSave(exportSave(s))
    expect(r.state).toEqual(JSON.parse(JSON.stringify(s)))
  }, 60000)

  it('zły plik kończy się komunikatem', () => {
    expect(importSave('to nie json').problem).toBeTruthy()
    expect(importSave(JSON.stringify({ gra: 'polski-trener-symulator', dane: 'xxx' })).problem).toBeTruthy()
  })
})
