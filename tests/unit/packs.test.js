import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { packForVariant, missingPackMessage } from '../../src/domain/packs.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

describe('registro dei pacchetti', () => {
  it('spedisce cinque pacchetti, tutti inclusi', () => {
    expect(registro.packs.map(p => p.id)).toEqual([
      'srd-2014', 'srd-2024', 'brancalonia', 'apocalisse', 'brancalonia-brainstorm',
    ])
    expect(registro.packs.every(p => p.incluso)).toBe(true)
  })

  it('il grimorio poggia su Brancalonia, e non lo si becca per deduzione', () => {
    const g = registro.packs.find(p => p.id === 'brancalonia-brainstorm')
    expect(g.base).toBe('brancalonia')
    // Nessuna variante: il builder non sa che questo pacchetto esiste. Ci si
    // finisce scegliendolo, scheda per scheda, non importando un personaggio.
    expect(g.varianti).toEqual([])
    expect(packForVariant(registro, 'brancalonia')?.id).toBe('brancalonia')
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
      expect(p.attribuzione).toMatch(/non è distribuito sotto licenza Creative Commons/i)
    }
  })

  it('e dicono ciascuno il vero su quel che spedisce', () => {
    // I due pacchetti Acheron non sono più uguali: di Brancalonia i testi ci
    // sono, di Apocalisse no. L'attribuzione è la sola cosa che l'utente legge
    // su questo, e ognuna delle due deve dire come stanno le cose per sé.
    const branca = registro.packs.find(x => x.id === 'brancalonia')
    expect(branca.attribuzione).toMatch(/I testi di regole riportati/)
    expect(branca.attribuzione).toMatch(/Manuale di Ambientazione.+Macaronicon.+Impero Randella Ancora/)
    expect(branca.attribuzione).not.toMatch(/[Nn]essun testo/)

    const apo = registro.packs.find(x => x.id === 'apocalisse')
    expect(apo.attribuzione).toMatch(/[Nn]essun testo di regole è incluso/)
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
