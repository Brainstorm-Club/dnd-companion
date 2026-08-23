import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { packForVariant, missingPackMessage } from '../../src/domain/packs.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

describe('registro dei pacchetti', () => {
  it('la v1 spedisce i due pacchetti SRD, entrambi inclusi', () => {
    expect(registro.packs.map(p => p.id)).toEqual(['srd-2014', 'srd-2024'])
    expect(registro.packs.every(p => p.incluso)).toBe(true)
    expect(registro.packs.every(p => p.licenza === 'CC-BY-4.0')).toBe(true)
  })

  it('ogni pacchetto porta la sua attribuzione, verbatim', () => {
    for (const p of registro.packs) {
      expect(p.attribuzione).toMatch(/Creative Commons/)
      expect(p.attribuzione.length).toBeGreaterThan(120)
    }
  })

  it('associa le varianti del builder al pacchetto giusto', () => {
    expect(packForVariant(registro, 'dnd5e')?.edizione).toBe('2014')
    expect(packForVariant(registro, 'dnd2024')?.edizione).toBe('2024')
  })

  it('Brancalonia non è coperta dalla v1', () => {
    expect(packForVariant(registro, 'brancalonia')).toBeNull()
  })

  it('e il messaggio lo spiega invece di dare errore', () => {
    const m = missingPackMessage('brancalonia')
    expect(m).toContain('Brancalonia')
    expect(m).toContain('prossima versione')
    expect(m).not.toMatch(/errore|error/i)
  })

  it('anche per una variante mai vista', () => {
    expect(missingPackMessage('pippo')).toContain('«pippo»')
  })
})
