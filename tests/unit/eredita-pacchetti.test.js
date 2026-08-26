/**
 * L'ereditarietà fra pacchetti: la catena, la fusione, il caricatore.
 *
 * È il pezzo su cui poggia la promessa dell'architettura — «aggiungere una
 * variante è scrivere una voce nel registro» — ed è anche quello che, se
 * sbaglia in silenzio, dà due schede diverse dello stesso personaggio secondo
 * la vista che le disegna. Quindi si prova su pacchetti finti e minuscoli: qui
 * si misura il motore, non i dati.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { packById, packChain, spellSources, testoSpedibile } from '../../src/domain/packs.js'
import { loadRules, rulesFor, mergeRules, _resetRules } from '../../src/domain/rules.js'

/** @param {Partial<any>} p @returns {any} */
const pacchetto = (p) => ({
  id: 'x', nome: 'X', edizione: '2014', varianti: [], incluso: true,
  licenza: 'CC-BY-4.0', kb: 1, regole: `data/rules/${p.id ?? 'x'}.json`,
  incantesimi: '', attribuzione: '—', ...p,
})

const REGISTRO = {
  v: 1,
  packs: [
    pacchetto({ id: 'base', regole: 'base.json', incantesimi: 'inc/base/' }),
    pacchetto({ id: 'figlio', base: 'base', regole: 'figlio.json', incantesimi: 'inc/figlio/', licenza: 'proprietaria' }),
    pacchetto({ id: 'nipote', base: 'figlio', regole: 'nipote.json', incantesimi: '' }),
    pacchetto({ id: 'orfano', base: 'non-esiste', regole: 'orfano.json' }),
    pacchetto({ id: 'anello-a', base: 'anello-b', regole: 'a.json' }),
    pacchetto({ id: 'anello-b', base: 'anello-a', regole: 'b.json' }),
  ],
}

describe('la catena dei pacchetti', () => {
  it('un pacchetto senza base è una catena di uno', () => {
    expect(packChain(REGISTRO, 'base').map(p => p.id)).toEqual(['base'])
  })

  it('sale dal figlio alla radice, in quest\'ordine', () => {
    expect(packChain(REGISTRO, 'figlio').map(p => p.id)).toEqual(['figlio', 'base'])
    expect(packChain(REGISTRO, 'nipote').map(p => p.id)).toEqual(['nipote', 'figlio', 'base'])
  })

  it('un base che non esiste è il registro che si contraddice, e lo dice', () => {
    // Non è un file che manca: è un dato rotto, e passarlo per un\'assenza
    // vorrebbe dire spedirlo.
    expect(() => packChain(REGISTRO, 'orfano')).toThrow(/orfano.*non-esiste/)
  })

  it('un anello non manda in stallo: si ferma e nomina il giro', () => {
    expect(() => packChain(REGISTRO, 'anello-a')).toThrow(/circolare/)
    expect(() => packChain(REGISTRO, 'anello-a')).toThrow(/anello-a.*anello-b.*anello-a/)
  })

  it('packById non trova ciò che non c\'è, senza lanciare', () => {
    expect(packById(REGISTRO, 'base')?.id).toBe('base')
    expect(packById(REGISTRO, 'mai-visto')).toBeNull()
  })
})

describe('da dove vengono gli incantesimi', () => {
  it('le cartelle della catena, e l\'edizione del pacchetto in cima', () => {
    expect(spellSources(REGISTRO, 'figlio')).toEqual({
      edizione: '2014',
      cartelle: ['inc/figlio/', 'inc/base/'],
    })
  })

  it('chi non ha una cartella propria non la mette', () => {
    expect(spellSources(REGISTRO, 'nipote').cartelle).toEqual(['inc/figlio/', 'inc/base/'])
  })
})

describe('quale testo si può spedire', () => {
  it('CC-BY sì, il resto no', () => {
    expect(testoSpedibile(packById(REGISTRO, 'base'))).toBe(true)
    expect(testoSpedibile(packById(REGISTRO, 'figlio'))).toBe(false)
    expect(testoSpedibile(null)).toBe(false)
    expect(testoSpedibile(undefined)).toBe(false)
  })
})

describe('la fusione', () => {
  it('gli oggetti si fondono in profondità, senza cancellare i fratelli', () => {
    const base = { classes: { barbarian: { hitDie: 12, subclasses: { berserker: { features: [] } } } } }
    const sopra = { classes: { barbarian: { subclasses: { pagano: { features: [] } } } } }
    const out = /** @type {any} */ (mergeRules(base, sopra))
    expect(Object.keys(out.classes.barbarian.subclasses).sort()).toEqual(['berserker', 'pagano'])
    expect(out.classes.barbarian.hitDie).toBe(12)
  })

  it('chi ridefinisce con lo stesso id vince', () => {
    const out = /** @type {any} */ (mergeRules({ a: { n: 1, m: 2 } }, { a: { n: 9 } }))
    expect(out.a).toEqual({ n: 9, m: 2 })
  })

  it('gli elenchi di cose con un id si fondono per id: chi c\'è si aggiorna, chi è nuovo si accoda', () => {
    const base = { features: [{ id: 'ira', name: 'Ira', description: 'testo' }, { id: 'schivata', name: 'Schivata' }] }
    const sopra = { features: [{ id: 'ira', name: 'Ira feroce' }, { id: 'batosta', name: 'Batosta' }] }
    const out = /** @type {any} */ (mergeRules(base, sopra))
    expect(out.features.map((/** @type {any} */ f) => f.id)).toEqual(['ira', 'schivata', 'batosta'])
    expect(out.features[0]).toEqual({ id: 'ira', name: 'Ira feroce', description: 'testo' })
  })

  it('le tabelle si sostituiscono intere, perché sono sequenze posizionali', () => {
    // Concatenarle darebbe una tabella di quaranta livelli; fonderle per indice
    // darebbe una tabella metà di uno e metà dell'altro, che è peggio.
    const base = { xpThresholds: [0, 300, 900], spellSlots: { full: [[2], [3], [4]] } }
    const sopra = { xpThresholds: [0, 100] }
    const out = /** @type {any} */ (mergeRules(base, sopra))
    expect(out.xpThresholds).toEqual([0, 100])
    expect(out.spellSlots.full).toEqual([[2], [3], [4]])
  })

  it('assenza, null e elenco vuoto vogliono dire «non ho niente da dire»', () => {
    // I pacchetti sono generati: un generatore scrive `description: null` per
    // il testo che non può spedire, e non deve per questo cancellare il testo
    // del pacchetto su cui poggia.
    const base = { conditions: [{ id: 'x', description: 'c\'è' }], altro: 'resta' }
    expect(mergeRules(base, { conditions: [] })).toEqual(base)
    expect(mergeRules(base, { conditions: null })).toEqual(base)
    expect(mergeRules(base, {})).toEqual(base)
  })

  it('ma un valore vero sostituisce, anche se è più povero', () => {
    const out = /** @type {any} */ (mergeRules({ a: 'lungo' }, { a: 'x' }))
    expect(out.a).toBe('x')
  })

  it('senza niente sotto o niente sopra, torna l\'altro', () => {
    expect(mergeRules(null, { a: 1 })).toEqual({ a: 1 })
    expect(mergeRules({ a: 1 }, null)).toEqual({ a: 1 })
    expect(mergeRules(undefined, undefined)).toBe(undefined)
  })
})

describe('il caricatore', () => {
  /** @type {string[]} */
  let chiesti = []

  /** @type {Record<string, unknown>} */
  const FILE = {
    'data/packs.json': REGISTRO,
    'base.json': { edizione: '2014', classes: { barbarian: { hitDie: 12, subclasses: { berserker: {} } } }, xpThresholds: [0, 300] },
    'figlio.json': { classes: { barbarian: { subclasses: { pagano: {} } }, burattinaio: { hitDie: 8 } } },
    'nipote.json': { classes: { barbarian: { subclasses: { terzo: {} } } } },
  }

  /** @type {any} */
  const fetcher = async (/** @type {string} */ url) => {
    chiesti.push(url)
    const dato = FILE[url]
    return dato === undefined
      ? { ok: false, status: 404, json: async () => null }
      : { ok: true, status: 200, json: async () => dato }
  }

  beforeEach(async () => {
    chiesti = []
    _resetRules()
    const { _setRegistry } = await import('../../src/domain/packs.js')
    _setRegistry(null)
  })

  it('un pacchetto senza base torna così com\'è', async () => {
    const r = /** @type {any} */ (await loadRules('base', fetcher))
    expect(r.classes.barbarian.hitDie).toBe(12)
    expect(chiesti.filter(u => u.endsWith('.json') && u !== 'data/packs.json')).toEqual(['base.json'])
  })

  it('un pacchetto che eredita vede anche ciò che non ridefinisce', async () => {
    const r = /** @type {any} */ (await loadRules('nipote', fetcher))
    expect(Object.keys(r.classes.barbarian.subclasses).sort()).toEqual(['berserker', 'pagano', 'terzo'])
    expect(r.classes.barbarian.hitDie).toBe(12)      // dalla radice
    expect(r.classes.burattinaio.hitDie).toBe(8)     // dal figlio
    expect(r.xpThresholds).toEqual([0, 300])         // mai ridefinita
  })

  it('si carica una volta sola, e poi si serve dalla memoria', async () => {
    await loadRules('figlio', fetcher)
    const dopoIlPrimo = chiesti.length
    await loadRules('figlio', fetcher)
    expect(chiesti.length).toBe(dopoIlPrimo)
    expect(rulesFor('figlio')).not.toBeNull()
  })

  it('due viste che si disegnano insieme fanno un download solo', async () => {
    const [a, b] = await Promise.all([loadRules('figlio', fetcher), loadRules('figlio', fetcher)])
    expect(a).toBe(b)
    expect(chiesti.filter(u => u === 'figlio.json')).toHaveLength(1)
  })

  it('un pacchetto che non è nel registro dà null, non un\'eccezione', async () => {
    expect(await loadRules('mai-visto', fetcher)).toBeNull()
  })

  it('un file che non si legge dà null: senza rete l\'app resta in piedi', async () => {
    const r = await loadRules('orfano', fetcher).catch(() => 'ha lanciato')
    // `orfano` dichiara un base inesistente: quella è una catena rotta e lancia
    expect(r).toBe('ha lanciato')
  })

  it('prima di caricare, `rulesFor` non inventa niente', () => {
    expect(rulesFor('base')).toBeNull()
  })
})
