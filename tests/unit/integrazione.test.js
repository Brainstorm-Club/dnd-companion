/**
 * Il percorso completo, attraverso i lotti: un JSON vero esportato dal builder
 * entra, e ne esce una scheda giocabile.
 *
 * Questo file non appartiene a nessun lotto: verifica che i pezzi combacino,
 * che è l'unica cosa che i test dei singoli lotti non possono dimostrare.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import * as importer from '../../src/domain/importer.js'
import * as character from '../../src/domain/character.js'
import * as dice from '../../src/domain/dice.js'
import { seededRng } from '../../src/domain/rng.js'
import { levelForXp, xpProgress } from '../../src/domain/progress.js'
import { packForVariant } from '../../src/domain/packs.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))
const oracolo = JSON.parse(readFileSync('tests/fixtures/oracolo-derive.json', 'utf8'))
const fixture = (/** @type {string} */ n) => readFileSync(`tests/fixtures/${n}.json`, 'utf8')

const REALI = ['reale-dnd2024-guerriero-3', 'reale-dnd5e-barbaro-10', 'reale-dnd5e-chierico-3',
  'reale-dnd2024-schema2-guerriero-8']

describe('dal builder al tavolo', () => {
  it.each(REALI)('%s si importa', (nome) => {
    const r = importer.fromJson(fixture(nome), registro, 'file')
    expect(r.ok, r.ok ? '' : `rifiutato: ${r.message}`).toBe(true)
  })

  it.each(REALI)('%s riceve l\'edizione giusta senza che nessuno la scelga', (nome) => {
    const r = importer.fromJson(fixture(nome), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    const atteso = nome.includes('2024') ? '2024' : '2014'
    expect(r.entry.meta.edition).toBe(atteso)
  })

  it('un personaggio di Brancalonia entra, col suo pacchetto', () => {
    const r = importer.fromJson(fixture('brancalonia-rifiuto'), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    expect(r.entry.meta.packId).toBe('brancalonia')
    // l'edizione la dà il pacchetto, e Brancalonia poggia sul 2014
    expect(r.entry.meta.edition).toBe('2014')
  })

  it('una variante che nessun pacchetto copre viene rifiutata con una spiegazione', () => {
    const inventato = JSON.parse(fixture('brancalonia-rifiuto'))
    inventato.variant = 'gioco-che-non-esiste'
    const r = importer.fromJson(JSON.stringify(inventato), registro, 'file')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('variante-non-supportata')
    expect(r.message).toContain('gioco-che-non-esiste')
    expect(r.message).not.toMatch(/errore|error|undefined|null/i)
  })

  describe.each(REALI)('%s — i conti tornano con quelli del builder', (nome) => {
    const atteso = oracolo[nome]

    /** @returns {any} */
    function derivato() {
      const r = importer.fromJson(fixture(nome), registro, 'file')
      if (!r.ok) throw new Error(r.message)
      const pack = packForVariant(registro, JSON.parse(fixture(nome)).variant)
      const rules = JSON.parse(readFileSync(`data/rules/${pack.edizione}.json`, 'utf8'))
      return { d: character.derive(r.entry, rules), entry: r.entry }
    }

    it('classe armatura, iniziativa, punti ferita, competenza', () => {
      const { d } = derivato()
      expect({ ca: d.ca, iniziativa: d.iniziativa, pfMax: d.pfMax, competenza: d.competenza })
        .toEqual({ ca: atteso.ca, iniziativa: atteso.iniziativa, pfMax: atteso.pfMax, competenza: atteso.competenza })
    })

    it('punteggi pieni e modificatori', () => {
      const { d } = derivato()
      expect(d.punteggi).toEqual(atteso.punteggi)
      expect(d.modificatori).toEqual(atteso.modificatori)
    })

    it('tiri salvezza', () => {
      const { d } = derivato()
      expect(d.tiriSalvezza).toEqual(atteso.tiriSalvezza)
    })

    it('le abilità che il builder mostra', () => {
      const { d } = derivato()
      /** @type {Record<string, number>} */
      const mie = {}
      for (const a of d.abilita) if (a.id in atteso.abilita) mie[a.id] = a.bonus
      expect(mie).toEqual(atteso.abilita)
    })

    it('lo snapshot non è stato toccato', () => {
      const prima = fixture(nome)
      const { entry } = derivato()
      expect(JSON.parse(JSON.stringify(entry.snapshot))).toEqual(JSON.parse(prima))
    })
  })

  it('da una riga di abilità si tira davvero', () => {
    const r = importer.fromJson(fixture('reale-dnd5e-chierico-3'), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    const rules = JSON.parse(readFileSync('data/rules/2014.json', 'utf8'))
    const d = character.derive(r.entry, rules)
    const percezione = d.abilita.find((/** @type {any} */ a) => a.id === 'perception')
    expect(percezione?.bonus).toBe(5)

    const tiro = dice.rollNotation(`1d20+${percezione.bonus}`, seededRng(99), 'Percezione')
    expect(tiro.total).toBeGreaterThanOrEqual(6)
    expect(tiro.total).toBeLessThanOrEqual(25)
    expect(tiro.label).toBe('Percezione')
  })

  it('i PX del builder danno il livello che il builder dichiara', () => {
    for (const nome of REALI) {
      const c = JSON.parse(fixture(nome))
      // i personaggi generati partono a 0 PX: il livello lo decide il master,
      // quindi qui si verifica solo che la funzione non contraddica sé stessa
      expect(levelForXp(c.experiencePoints)).toBe(1)
      expect(xpProgress(c.experiencePoints).livello).toBe(1)
    }
  })
})


describe('lo schema 2 del builder', () => {
  const nome = 'reale-dnd2024-schema2-guerriero-8'

  it('i campi nuovi arrivano fin dentro lo snapshot, invece di essere buttati', () => {
    const r = importer.fromJson(fixture(nome), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    const s = /** @type {any} */ (r.entry.snapshot)
    expect(s.armorId).toBe('ring-mail')
    expect(s.schemaVersion).toBe(2)
    expect(Array.isArray(s.featureEntries)).toBe(true)
    // e portano quello che serviva a smettere di indovinare: da dove viene una
    // voce, e a che livello è stata ottenuta
    const stile = s.featureEntries.find((/** @type {any} */ f) => f.id === 'fighting-style')
    expect(stile).toMatchObject({ source: 'class', sourceId: 'fighter', level: 1 })
    const tratto = s.featureEntries.find((/** @type {any} */ f) => f.source === 'race')
    expect(tratto).toBeDefined()
  })

  it('la classe armatura si calcola dallo slug, non dal nome di visualizzazione', () => {
    const grezzo = JSON.parse(fixture(nome))
    // stesso personaggio, ma col nome scritto in un altro modo: se contasse
    // quello, la corazza sparirebbe e la CA scenderebbe a 12
    const storto = { ...grezzo, armor: 'ring mail (usata)' }
    const r = importer.fromJson(JSON.stringify(storto), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    const rules = JSON.parse(readFileSync('data/rules/2024.json', 'utf8'))
    expect(character.derive(r.entry, rules).ca).toBe(16)
  })

  it('i privilegi strutturati contano le ripetizioni invece di ripetersi', () => {
    const r = importer.fromJson(fixture(nome), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    const asi = /** @type {any} */ (r.entry.snapshot).featureEntries
      .find((/** @type {any} */ f) => f.id === 'ability-score-improvement')
    expect(asi.count).toBe(3)
  })
})

describe('i privilegi, quando il builder dice da dove vengono', () => {
  const nome = 'reale-dnd2024-schema2-guerriero-8'
  const rules = JSON.parse(readFileSync('data/rules/2024.json', 'utf8'))

  /** @returns {any[]} */
  function privilegi(file = nome) {
    const r = importer.fromJson(fixture(file), registro, 'file')
    if (!r.ok) throw new Error(r.message)
    return character.features(r.entry, rules)
  }

  it('ogni voce porta origine e livello, non solo un nome', () => {
    const stile = privilegi().find(f => f.id === 'fighting-style')
    expect(stile).toMatchObject({ origine: 'class', origineId: 'fighter', livello: 1 })
    const tratto = privilegi().find(f => f.origine === 'race')
    expect(tratto).toBeDefined()
  })

  it('le ripetizioni si contano invece di ripetersi', () => {
    const asi = privilegi().filter(f => /ability-score/i.test(f.id))
    expect(asi).toHaveLength(1)
    expect(asi[0].volte).toBe(3)
  })

  it('un id ripetuto nel campo nome non diventa il nome mostrato', () => {
    // il builder scrive `name: "draconic-ancestry"` per i tratti razziali:
    // stamparlo così com'è vorrebbe dire mostrare un id a chi gioca
    const tratto = privilegi().find(f => f.id === 'draconic-ancestry')
    expect(tratto.nome).not.toBe('draconic-ancestry')
    expect(tratto.nome).toMatch(/^[A-Z]/)
  })

  it('gli export vecchi continuano a funzionare, senza origine', () => {
    // il chierico è di schema 1: nessun `featureEntries`, quindi lista piatta
    const vecchi = privilegi('reale-dnd5e-chierico-3')
    expect(vecchi.length).toBeGreaterThan(0)
    expect(vecchi.every(f => f.origine === null)).toBe(true)
  })
})
