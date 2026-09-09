import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { trattiDiRazza, razzeDelPacchetto } from '../../src/domain/razze.js'
import { mergeRules } from '../../src/domain/rules.js'

const r2014 = JSON.parse(readFileSync('data/rules/2014.json', 'utf8'))
const r2024 = JSON.parse(readFileSync('data/rules/2024.json', 'utf8'))
const branca = JSON.parse(readFileSync('data/rules/brancalonia.json', 'utf8'))

describe('tratti di razza', () => {
  it('mette insieme quelli della razza e quelli delle sottorazze', () => {
    const tutti = trattiDiRazza(r2014, 'elf')
    expect(tutti.some(t => t.nome === 'Scurovisione' && t.sottorazza === null)).toBe(true)
    // «Magia Drow» è dell'elfo scuro, non dell'elfo in generale
    const drow = tutti.find(t => /magia drow/i.test(t.nome))
    expect(drow?.sottorazza).toMatch(/^Elfo Scuro/)
    expect(drow?.sottorazzaId).toBe('dark-elf')
  })

  it('sa restare su una sottorazza sola', () => {
    const tutte = trattiDiRazza(r2014, 'elf')
    const solo = trattiDiRazza(r2014, 'elf', 'wood-elf')
    const nessuna = trattiDiRazza(r2014, 'elf', 'sottorazza-che-non-esiste')

    expect(solo.length).toBeLessThan(tutte.length)
    expect(solo.some(t => /boschi/i.test(t.sottorazza ?? ''))).toBe(true)
    expect(solo.some(t => /scuro/i.test(t.sottorazza ?? ''))).toBe(false)
    // i tratti della razza restano comunque: sono quelli che si hanno sempre
    expect(nessuna.length).toBeGreaterThan(0)
    expect(nessuna.every(t => t.sottorazza === null)).toBe(true)
  })

  it('i tratti della razza vengono prima di quelli delle sottorazze', () => {
    // È l'ordine in cui si acquisiscono, ed è quello in cui la vista li
    // raggruppa: se si mescolassero, le intestazioni si ripeterebbero.
    const t = trattiDiRazza(r2024, 'dragonborn')
    const primaSotto = t.findIndex(x => x.sottorazza !== null)
    expect(primaSotto).toBeGreaterThan(0)
    expect(t.slice(0, primaSotto).every(x => x.sottorazza === null)).toBe(true)
  })

  it('non riordina i tratti: l\'ordine è quello del manuale', () => {
    const attesi = r2014.races.elf.traits.map((/** @type {any} */ x) => x.name)
    const avuti = trattiDiRazza(r2014, 'elf').filter(t => !t.sottorazza).map(t => t.nome)
    expect(avuti).toEqual(attesi)
  })

  it('dove la fonte non ha il testo dice null, non stringa vuota', () => {
    // Oggi nessun pacchetto porta le descrizioni dei tratti di razza. Quando
    // arriveranno, `null` deve restare la forma dell'assenza — e le viste
    // continuano a distinguerla dalla stringa vuota.
    const tutti = razzeDelPacchetto(r2024).flatMap(r => trattiDiRazza(r2024, r.id))
    expect(tutti.length).toBeGreaterThan(0)
    expect(tutti.every(t => t.testo === null || t.testo.length > 0)).toBe(true)
  })

  it('ogni voce sa da quale razza viene', () => {
    const t = trattiDiRazza(r2014, 'dwarf')
    expect(t.every(x => x.razzaId === 'dwarf')).toBe(true)
    expect(new Set(t.map(x => x.razza))).toEqual(new Set(['Nano']))
  })

  it('una razza che non esiste dà un elenco vuoto, non un errore', () => {
    expect(trattiDiRazza(r2014, 'hobbit-immaginario')).toEqual([])
    expect(trattiDiRazza(null, 'elf')).toEqual([])
    expect(trattiDiRazza(undefined, 'elf')).toEqual([])
  })

  it('regge dati malformati senza lanciare', () => {
    const rotto = { races: { x: { name: 'X', traits: [null, {}, { name: 'Buono' }], subraces: 7 } } }
    const t = trattiDiRazza(rotto, 'x')
    expect(t.map(v => v.nome)).toEqual(['Buono'])
  })
})

describe('elenco delle razze', () => {
  it('le ordina per nome, con le loro sottorazze', () => {
    const razze = razzeDelPacchetto(r2014)
    expect(razze.map(r => r.nome)).toEqual([...razze.map(r => r.nome)].sort((a, b) => a.localeCompare(b, 'it')))
    const elfo = razze.find(r => r.id === 'elf')
    expect(elfo?.sottorazze.map(s => s.id).sort()).toEqual(['dark-elf', 'high-elf', 'wood-elf'])
    // metà delle razze non ha sottorazze: l'elenco è vuoto, non assente
    expect(razze.find(r => r.id === 'human')?.sottorazze).toEqual([])
  })

  it('un pacchetto senza razze dà un elenco vuoto', () => {
    expect(razzeDelPacchetto({})).toEqual([])
    expect(razzeDelPacchetto(null)).toEqual([])
  })
})

describe('una variante trova le proprie razze', () => {
  // Il compendio legge le regole **fuse**, non il solo file della variante:
  // è quello che fa `loadRules`, ed è la ragione per cui un personaggio di
  // Brancalonia trova sia il Malebranche sia il nano dell'SRD.
  const fuse = mergeRules(r2014, branca)

  it('vede le sue e quelle del pacchetto base', () => {
    const ids = razzeDelPacchetto(fuse).map(r => r.id)
    expect(ids).toContain('malebranche')
    expect(ids).toContain('dwarf')
    expect(ids.length).toBeGreaterThan(razzeDelPacchetto(r2014).length)
  })

  it('porta i tratti con il loro testo, preso dal manuale', () => {
    const t = trattiDiRazza(fuse, 'malebranche')
    expect(t.map(x => x.nome)).toContain('Malitratti Infernali')
    const malitratti = t.find(x => x.nome === 'Malitratti Infernali')
    expect(malitratti?.testo).toMatch(/malitratti/i)
  })

  it('una razza che la variante ridefinisce non perde i tratti del base', () => {
    // «Umano» esiste in tutti e due i pacchetti: la fusione per id somma, non
    // sostituisce, ed è il motivo per cui il figlio non può togliere niente.
    const umano = trattiDiRazza(fuse, 'human')
    expect(umano.length).toBeGreaterThanOrEqual(trattiDiRazza(r2014, 'human').length)
  })
})
