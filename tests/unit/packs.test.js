import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { packForVariant, missingPackMessage } from '../../src/domain/packs.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

describe('registro dei pacchetti', () => {
  it('spedisce quattro pacchetti, tutti inclusi', () => {
    expect(registro.packs.map(p => p.id)).toEqual(['srd-2014', 'srd-2024', 'brancalonia', 'apocalisse'])
    expect(registro.packs.every(p => p.incluso)).toBe(true)
  })

  it('i due SRD sono CC-BY e indipendenti; gli altri due derivano dal 2014', () => {
    const srd = registro.packs.filter(p => p.licenza === 'CC-BY-4.0')
    expect(srd.map(p => p.id)).toEqual(['srd-2014', 'srd-2024'])
    expect(srd.every(p => !p.base)).toBe(true)

    for (const id of ['brancalonia', 'apocalisse']) {
      const p = registro.packs.find(x => x.id === id)
      expect(p.base).toBe('srd-2014')
      expect(p.edizione).toBe('2014')
    }
  })

  it('ogni pacchetto porta la sua attribuzione, verbatim', () => {
    for (const p of registro.packs) {
      expect(p.attribuzione.length).toBeGreaterThan(120)
    }
  })

  it('i pacchetti Acheron dichiarano di non essere liberi', () => {
    // L'attribuzione dei due SRD dice sotto quale licenza si può ripubblicare
    // il testo. Quella di Brancalonia e Apocalisse deve dire il contrario, e
    // dirlo prima che qualcuno dia per scontato che sia materiale come l'altro.
    for (const id of ['brancalonia', 'apocalisse']) {
      const p = registro.packs.find(x => x.id === id)
      expect(p.licenza).not.toBe('CC-BY-4.0')
      expect(p.attribuzione).toMatch(/non è materiale SRD/i)
      expect(p.attribuzione).toMatch(/Acheron Games/)
      expect(p.attribuzione).toMatch(/[Nn]essun testo/)
    }
  })

  it('associa le varianti del builder al pacchetto giusto', () => {
    expect(packForVariant(registro, 'dnd5e')?.edizione).toBe('2014')
    expect(packForVariant(registro, 'dnd2024')?.edizione).toBe('2024')
  })

  it('Brancalonia e Apocalisse ora sono coperte', () => {
    expect(packForVariant(registro, 'brancalonia')?.id).toBe('brancalonia')
    expect(packForVariant(registro, 'apocalisse')?.id).toBe('apocalisse')
  })

  it('per una variante mai vista resta la frase, non un errore', () => {
    const m = missingPackMessage('pippo')
    expect(m).toContain('«pippo»')
    expect(m).not.toMatch(/errore|error/i)
  })
})
