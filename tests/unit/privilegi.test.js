import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { privilegiDiClasse, classiDelPacchetto } from '../../src/domain/privilegi.js'

const r2014 = JSON.parse(readFileSync('data/rules/2014.json', 'utf8'))
const r2024 = JSON.parse(readFileSync('data/rules/2024.json', 'utf8'))

describe('privilegi di classe', () => {
  it('mette insieme quelli della classe e quelli delle sottoclassi', () => {
    const tutti = privilegiDiClasse(r2014, 'barbarian')
    expect(tutti.some(p => p.nome === 'Ira' && p.sottoclasse === null)).toBe(true)
    // «Frenesia» è del Berserker, non del barbaro in generale
    const frenesia = tutti.find(p => /frenesia/i.test(p.nome))
    expect(frenesia?.sottoclasse).toBeTruthy()
  })

  it('sa restare su una sottoclasse sola', () => {
    // L'SRD spedisce **una** sottoclasse per classe, quindi chiedere quella che
    // c'è non toglie niente: il filtro si prova chiedendone una che non c'è.
    const tutte = privilegiDiClasse(r2014, 'cleric')
    const conLa = privilegiDiClasse(r2014, 'cleric', 'life')
    const senza = privilegiDiClasse(r2014, 'cleric', 'dominio-che-non-esiste')

    expect(conLa).toHaveLength(tutte.length)
    expect(senza.length).toBeLessThan(tutte.length)
    expect(senza.every(p => p.sottoclasse === null)).toBe(true)
    expect(conLa.some(p => p.sottoclasse === 'Vita')).toBe(true)
  })

  it('ordina per livello: è l\'ordine in cui si ottengono', () => {
    const p = privilegiDiClasse(r2024, 'fighter')
    const livelli = p.map(v => v.livello)
    expect(livelli).toEqual([...livelli].sort((a, b) => a - b))
  })

  it('dove la fonte non ha il testo dice null, non stringa vuota', () => {
    // Venti privilegi di sottoclasse del 2014 non hanno traduzione italiana:
    // `null` distingue «non c'è» da «c'è ed è vuoto», e la scheda lo dichiara.
    const tutti = [
      ...classiDelPacchetto(r2014).flatMap(c => privilegiDiClasse(r2014, c.id)),
    ]
    const senza = tutti.filter(p => p.testo === null)
    expect(senza.length).toBeGreaterThan(0)
    expect(tutti.every(p => p.testo === null || p.testo.length > 0)).toBe(true)
  })

  it('ogni voce sa da quale classe viene', () => {
    const p = privilegiDiClasse(r2024, 'wizard')
    expect(p.every(v => v.classeId === 'wizard')).toBe(true)
    expect(new Set(p.map(v => v.classe)).size).toBe(1)
  })

  it('una classe che non esiste dà un elenco vuoto, non un errore', () => {
    expect(privilegiDiClasse(r2014, 'bardo-immaginario')).toEqual([])
    expect(privilegiDiClasse(null, 'cleric')).toEqual([])
    expect(privilegiDiClasse(undefined, 'cleric')).toEqual([])
  })

  it('regge dati malformati senza lanciare', () => {
    const rotto = { classes: { x: { name: 'X', features: [null, {}, { name: 'Buono' }], subclasses: 3 } } }
    const p = privilegiDiClasse(rotto, 'x')
    expect(p.map(v => v.nome)).toEqual(['Buono'])
  })
})

describe('le classi del pacchetto', () => {
  it('sono dodici per edizione, in ordine alfabetico italiano', () => {
    for (const r of [r2014, r2024]) {
      const c = classiDelPacchetto(r)
      expect(c).toHaveLength(12)
      expect(c.map(v => v.nome)).toEqual([...c.map(v => v.nome)].sort((a, b) => a.localeCompare(b, 'it')))
    }
  })

  it('senza pacchetto non inventa niente', () => {
    expect(classiDelPacchetto(null)).toEqual([])
  })
})
