/**
 * Il pacchetto «brancalonia-brainstorm»: il Grimorio di Bassa Lega.
 *
 * È la prima catena a tre del registro — brainstorm poggia su Brancalonia, che
 * poggia sull'SRD 5.1 — e la prima variante che non arriva da un manuale ma da
 * un tavolo. Quello che si verifica qui non è che i dati esistano: è che
 * **combacino** con il pacchetto su cui poggiano, perché il compendio
 * sovrappone per id e un id sbagliato non dà un errore, dà due incantesimi.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const REGOLE = JSON.parse(readFileSync('data/rules/brancalonia-brainstorm.json', 'utf8'))
const INDICE = JSON.parse(readFileSync('data/spells/brancalonia-brainstorm/index.json', 'utf8'))
const BASE = JSON.parse(readFileSync('data/spells/brancalonia/index.json', 'utf8'))

/** Tutti gli incantesimi coi loro campi, dai file di livello. @returns {any[]} */
function completi() {
  return readdirSync('data/spells/brancalonia-brainstorm')
    .filter(f => /^l\d\.json$/.test(f))
    .flatMap(f => JSON.parse(readFileSync(`data/spells/brancalonia-brainstorm/${f}`, 'utf8')))
}

describe('il pacchetto', () => {
  it('poggia su Brancalonia, che poggia sull\'SRD: è una catena a tre', () => {
    expect(REGOLE.base).toBe('brancalonia')
    expect(REGOLE.variante).toBe('brancalonia-brainstorm')
    expect(REGOLE.edizione).toBe('2014')

    const brancalonia = JSON.parse(readFileSync('data/rules/brancalonia.json', 'utf8'))
    expect(brancalonia.base).toBe('srd-2014')
  })

  it('dice da dove viene', () => {
    expect(REGOLE.fonte).toMatch(/Grimorio di Bassa Lega/)
  })
})

describe('gli incantesimi del Regno', () => {
  it('ci sono tutti quelli dell\'appendice', () => {
    expect(INDICE.length).toBe(20)
  })

  it('ognuno ha livello, scuola e almeno una classe o una nota', () => {
    for (const s of INDICE) {
      expect(typeof s.livello, s.nome).toBe('number')
      expect(s.scuola, s.nome).toBeTruthy()
      expect(s.classi.length > 0 || !!s.notaClassi, `${s.nome}: né classi né nota`).toBe(true)
    }
  })

  it('ognuno porta il testo, che è il motivo per cui questo pacchetto esiste', () => {
    const senza = completi().filter(s => !s.testo).map(s => s.nome)
    expect(senza).toEqual([])
  })

  it('e i dati di lancio, che al tavolo servono più della prosa', () => {
    for (const s of completi()) {
      expect(s.tempoDiLancio, s.nome).toBeTruthy()
      expect(s.gittata, s.nome).toBeTruthy()
      expect(s.durata, s.nome).toBeTruthy()
    }
  })

  it('la concentrazione si legge dalla durata, non si inventa', () => {
    for (const s of completi()) {
      expect(s.concentrazione, s.nome).toBe(/concentrazione/i.test(s.durata))
    }
  })

  /**
   * Il punto delicato di tutto il lotto.
   *
   * Il grimorio traduce gli incantesimi a modo suo — «Dito della Sorte» dove
   * il pacchetto base dice «Dito del Fato» — e il compendio sovrappone per id.
   * Se l'appaiamento sbagliasse, in elenco comparirebbero due volte lo stesso
   * incantesimo con due nomi, e al tavolo si litigherebbe su quale vale.
   */
  it('chi esiste anche nel pacchetto base ne prende l\'id, invece di sdoppiarsi', () => {
    const idBase = new Set(BASE.map((/** @type {any} */ s) => s.id))
    const ripresi = INDICE.filter((/** @type {any} */ s) => idBase.has(s.id))
    // dei 14 del base, tutti devono essere stati riconosciuti
    expect(ripresi.length).toBe(BASE.length)
  })

  it('e chi il base non ha resta con l\'id suo, senza rubarne uno', () => {
    const idBase = new Set(BASE.map((/** @type {any} */ s) => s.id))
    const nuovi = INDICE.filter((/** @type {any} */ s) => !idBase.has(s.id))
    expect(nuovi.length).toBe(INDICE.length - BASE.length)
    // sono gli incantesimi da cuocomante dell'Atlante, più «Spada nella Chioccia»
    expect(nuovi.map((/** @type {any} */ s) => s.id)).toContain('spada-nella-chioccia')
  })

  /**
   * Il contratto del compendio, che non è scritto da nessuna parte se non nel
   * codice che lo legge: `voce.cambiamenti.includes(...)` non chiede permesso,
   * e una voce senza quel campo fa cadere la scheda **quando la si apre** —
   * non quando si genera, non quando si elenca. Il difetto è uscito cliccando.
   */
  it('le voci hanno gli stessi campi di quelle del pacchetto base', () => {
    const mie = JSON.parse(readFileSync('data/spells/brancalonia-brainstorm/l0.json', 'utf8'))[0]
    const sue = JSON.parse(readFileSync('data/spells/brancalonia/l0.json', 'utf8'))[0]
    const mancanti = Object.keys(sue).filter(k => !(k in mie))
    expect(mancanti).toEqual([])
  })

  it('nessun id compare due volte', () => {
    const visti = INDICE.map((/** @type {any} */ s) => s.id)
    expect(new Set(visti).size).toBe(visti.length)
  })

  it('appaiati, livello e classi combaciano col pacchetto base', () => {
    // Se un giorno l'appaiamento scivolasse su un altro incantesimo, questo è
    // il test che se ne accorge: stesso id ma dati diversi.
    const perId = new Map(BASE.map((/** @type {any} */ s) => [s.id, s]))
    for (const s of INDICE) {
      const b = perId.get(s.id)
      if (!b) continue
      expect(s.livello, `${s.nome} / ${b.nome}`).toBe(b.livello)
      expect([...s.classi].sort(), `${s.nome} / ${b.nome}`).toEqual([...b.classi].sort())
    }
  })
})

describe('la magia scadente', () => {
  const m = REGOLE.magiaScadente

  it('la soglia di cilecca è due volte il livello più uno', () => {
    // È la regola in una riga, e tutto il resto ci si appoggia: se cambia
    // questa, cambia il gioco.
    expect(m.cilecca.soglie['0']).toBe(2)   // trucchetti: 1–2
    expect(m.cilecca.soglie['1']).toBe(4)
    expect(m.cilecca.soglie['2']).toBe(6)
    expect(m.cilecca.soglie['3']).toBe(8)
    for (let liv = 0; liv <= 9; liv++) expect(m.cilecca.soglie[String(liv)]).toBe(2 * (liv + 1))
  })

  it('si tira sul livello dello slot, non su quello stampato', () => {
    // «Un dardo incantato sparato con uno slot di 2° fa cilecca con 1–6.»
    expect(m.cilecca.suSlot).toBe(true)
  })

  it('rituali, capacità di classe e oggetti magici non tirano', () => {
    expect(m.cilecca.nonTirano).toContain('rituali')
    expect(m.cilecca.nonTirano.join(' ')).toMatch(/oggetti magici/)
  })

  it('il patatrac ha sei voci, scatta sull\'1 e non tocca mai le cure', () => {
    expect(m.patatrac.su).toBe(1)
    expect(m.patatrac.maiSulleCure).toBe(true)
    expect(m.patatrac.voci).toHaveLength(6)
    expect(m.patatrac.voci.map((/** @type {any} */ v) => v.d6)).toEqual([1, 2, 3, 4, 5, 6])
    for (const v of m.patatrac.voci) {
      expect(v.nome, `d6 ${v.d6}`).toBeTruthy()
      expect(v.testo.length, `d6 ${v.d6}`).toBeGreaterThan(20)
    }
  })

  it('gli ingredienti azzerano la cilecca e costano', () => {
    expect(m.ingredienti.azzeraLaCilecca).toBe(true)
    expect(m.ingredienti.maxPerLivello).toBe(3)
    expect(m.ingredienti.costo['1']).toBe(3)
    expect(m.ingredienti.raccoltaCd['3']).toBe(18)
  })

  it('forzare raddoppia la cilecca, e un ingrediente la riporta normale', () => {
    expect(m.forzare.unaVoltaPer).toBe('sessione')
    expect(m.forzare.raddoppiaLaCilecca).toBe(true)
    expect(m.forzare.conIngredienteTornaNormale).toBe(true)
  })

  it('il malocchio raddoppia fino al riposo lungo', () => {
    expect(m.malocchio.raddoppiaLaCilecca).toBe(true)
    expect(m.malocchio.finoA).toBe('riposo lungo')
  })
})

describe('il generatore', () => {
  it('c\'è, ed è rieseguibile', () => {
    expect(existsSync('scripts/build-grimorio.mjs')).toBe(true)
    const src = readFileSync('scripts/build-grimorio.mjs', 'utf8')
    // il percorso del grimorio si può passare: la campagna non è nel repo
    expect(src).toMatch(/--grimorio/)
  })
})
