import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { packForVariant } from '../../src/domain/packs.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))
// Solo i personaggi: in questa cartella vive anche `oracolo-derive.json`, che
// non è una scheda ma i valori attesi con cui confrontarla.
const files = readdirSync('tests/fixtures')
  .filter(f => f.endsWith('.json') && !f.startsWith('oracolo-'))

describe('fixture', () => {
  it('ce n\'è almeno una per edizione, più il caso da rifiutare', () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it.each(files)('%s ha la forma di CharacterData', (f) => {
    const c = JSON.parse(readFileSync(`tests/fixtures/${f}`, 'utf8'))
    for (const k of ['id', 'variant', 'name', 'className', 'level', 'abilityScores', 'maxHp', 'hitDie']) {
      expect(c[k], `manca ${k}`).toBeDefined()
    }
    expect(Object.keys(c.abilityScores).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis'])
    expect(c.level).toBeGreaterThanOrEqual(1)
    expect(c.currentHp).toBeLessThanOrEqual(c.maxHp)
  })

  it('quella di Brancalonia non è coperta da nessun pacchetto della v1', () => {
    const c = JSON.parse(readFileSync('tests/fixtures/brancalonia-rifiuto.json', 'utf8'))
    expect(packForVariant(registro, c.variant)).toBeNull()
  })

  it('le altre lo sono', () => {
    for (const f of files.filter(f => !f.startsWith('brancalonia'))) {
      const c = JSON.parse(readFileSync(`tests/fixtures/${f}`, 'utf8'))
      expect(packForVariant(registro, c.variant), f).not.toBeNull()
    }
  })
})
