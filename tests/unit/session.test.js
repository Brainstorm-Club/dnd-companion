/**
 * Il tracker di sessione.  ── Lotto G ──
 *
 * Sono i quattro comportamenti dichiarati in `contratti.test.js` più quelli che
 * il piano (§ 5.6) dà per scontati e che al tavolo si notano subito: il riposo
 * breve che non tira, gli slot che non scendono sotto zero, i temporanei che
 * una cura non ridà.
 */
import { describe, it, expect } from 'vitest'
import {
  applyDamage, heal, useSlot, restoreSlot, toggleCondition, modifica,
  shortRest, longRest, slotsMassimi,
  aggiungiOggetto, togliOggetto, cambiaMonete, MAX_OGGETTO, MAX_OGGETTI,
} from '../../src/domain/session.js'

/** @returns {import('../../src/storage.js').PlayState} */
function stato(extra = {}) {
  return {
    hp: { cur: 20, temp: 0 },
    hitDice: { spent: 0 },
    slots: {},
    conditions: [],
    inspiration: false,
    coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
    uses: {},
    xp: 0,
    deaths: { succ: 0, fail: 0 },
    notes: '',
    ...extra,
  }
}

describe('punti ferita', () => {
  it('il danno consuma prima i PF temporanei', () => {
    const p = stato({ hp: { cur: 20, temp: 5 } })
    expect(applyDamage(p, 3, 20).hp).toEqual({ cur: 20, temp: 2 })
  })

  it('il danno che sfonda i temporanei prosegue sui punti ferita', () => {
    const p = stato({ hp: { cur: 20, temp: 5 } })
    expect(applyDamage(p, 8, 20).hp).toEqual({ cur: 17, temp: 0 })
  })

  it('i punti ferita non scendono sotto zero', () => {
    const p = stato({ hp: { cur: 4, temp: 2 } })
    expect(applyDamage(p, 100, 20).hp).toEqual({ cur: 0, temp: 0 })
  })

  it('un danno nullo o negativo non fa niente', () => {
    const p = stato({ hp: { cur: 12, temp: 3 } })
    expect(applyDamage(p, 0, 20).hp).toEqual({ cur: 12, temp: 3 })
    expect(applyDamage(p, -5, 20).hp).toEqual({ cur: 12, temp: 3 })
  })

  it('la cura non supera i PF massimi', () => {
    const p = stato({ hp: { cur: 18, temp: 0 } })
    expect(heal(p, 10, 20).hp.cur).toBe(20)
  })

  it('la cura non ripristina i temporanei', () => {
    const p = stato({ hp: { cur: 10, temp: 0 } })
    expect(heal(p, 5, 20).hp).toEqual({ cur: 15, temp: 0 })
  })

  it('chi risale sopra zero smette di essere morente', () => {
    const p = stato({ hp: { cur: 0, temp: 0 }, deaths: { succ: 2, fail: 1 } })
    expect(heal(p, 1, 20).deaths).toEqual({ succ: 0, fail: 0 })
  })

  it('una cura a chi è già sopra il massimo non lo abbassa', () => {
    const p = stato({ hp: { cur: 25, temp: 0 } })
    expect(heal(p, 3, 20).hp.cur).toBe(25)
  })
})

describe('slot', () => {
  it('consumare uno slot lo segna usato', () => {
    const p = stato({ slots: { 1: { used: 0 }, 2: { used: 1 } } })
    expect(useSlot(p, 2).slots['2']).toEqual({ used: 2 })
  })

  it('non consuma uno slot di un livello che il personaggio non ha', () => {
    const p = stato({ slots: { 1: { used: 0 } } })
    const dopo = useSlot(p, 9)
    expect(dopo.slots['9']).toBeUndefined()
    expect(dopo.slots).toEqual({ 1: { used: 0 } })
  })

  it('un tap su uno slot consumato lo restituisce, e non va sotto zero', () => {
    const p = stato({ slots: { 3: { used: 1 } } })
    expect(restoreSlot(p, 3).slots['3']).toEqual({ used: 0 })
    expect(restoreSlot(restoreSlot(p, 3), 3).slots['3']).toEqual({ used: 0 })
  })
})

describe('condizioni', () => {
  it('si accendono e si spengono, una volta sola', () => {
    const p = stato()
    const con = toggleCondition(p, 'prone')
    expect(con.conditions).toEqual(['prone'])
    expect(toggleCondition(con, 'prone').conditions).toEqual([])
  })
})

describe('riposo breve', () => {
  it('spende i dadi vita che gli si dicono, e non tira da sé', () => {
    const p = stato({ hp: { cur: 5, temp: 0 }, hitDice: { spent: 1 } })
    const dopo = shortRest(p, { dadiSpesi: 2, tiri: [6, 4], pfMax: 20 }, null)
    expect(dopo.hitDice.spent).toBe(3)
    expect(dopo.hp.cur).toBe(15)
  })

  it('la cura del riposo breve si ferma ai PF massimi', () => {
    const p = stato({ hp: { cur: 18, temp: 0 } })
    expect(shortRest(p, { dadiSpesi: 1, tiri: [9], pfMax: 20 }, null).hp.cur).toBe(20)
  })

  it('senza dadi spesi non cura e non cambia nulla', () => {
    const p = stato({ hp: { cur: 7, temp: 3 } })
    expect(shortRest(p, { dadiSpesi: 0, tiri: [], pfMax: 20 }, null)).toEqual(p)
  })

  it('recupera solo ciò che il pacchetto dichiara recuperabile a riposo breve', () => {
    const p = stato({ uses: { 'second-wind': 1, 'rage': 2 } })
    const rules = { recupero: { breve: ['second-wind'] } }
    expect(shortRest(p, { dadiSpesi: 0, tiri: [] }, rules).uses).toEqual({ rage: 2 })
  })

  it('legge la dichiarazione anche dal singolo privilegio del pacchetto', () => {
    const p = stato({ uses: { 'second-wind': 1, 'rage': 2 } })
    const rules = {
      classes: { fighter: { features: [{ id: 'second-wind', recupero: 'breve' }] } },
    }
    expect(shortRest(p, { dadiSpesi: 0, tiri: [] }, rules).uses).toEqual({ rage: 2 })
  })

  it('un pacchetto che non dichiara niente non restituisce niente', () => {
    const p = stato({ uses: { 'rage': 2 } })
    expect(shortRest(p, { dadiSpesi: 1, tiri: [5] }, {}).uses).toEqual({ rage: 2 })
  })
})

describe('riposo lungo', () => {
  it('riempie PF e slot e restituisce metà dei dadi vita', () => {
    const p = stato({
      hp: { cur: 3, temp: 7 },
      hitDice: { spent: 8 },
      slots: { 1: { used: 4 }, 2: { used: 3 } },
      uses: { 'rage': 2 },
    })
    const dopo = longRest(p, { pfMax: 42, dadiVitaTotali: 9 }, null)
    expect(dopo.hp).toEqual({ cur: 42, temp: 0 })
    expect(dopo.hitDice.spent).toBe(4)          // 9 / 2 = 4,5 → 4
    expect(dopo.slots).toEqual({ 1: { used: 0 }, 2: { used: 0 } })
    expect(dopo.uses).toEqual({})
  })

  it('al 1° livello restituisce comunque un dado vita', () => {
    const p = stato({ hitDice: { spent: 1 } })
    expect(longRest(p, { pfMax: 8, dadiVitaTotali: 1 }, null).hitDice.spent).toBe(0)
  })

  it('non restituisce più dadi vita di quanti se ne fossero spesi', () => {
    const p = stato({ hitDice: { spent: 1 } })
    expect(longRest(p, { pfMax: 60, dadiVitaTotali: 12 }, null).hitDice.spent).toBe(0)
  })

  it('azzera i tiri contro morte ma non tocca le condizioni', () => {
    const p = stato({ deaths: { succ: 1, fail: 2 }, conditions: ['exhaustion'] })
    const dopo = longRest(p, { pfMax: 20, dadiVitaTotali: 4 }, null)
    expect(dopo.deaths).toEqual({ succ: 0, fail: 0 })
    expect(dopo.conditions).toEqual(['exhaustion'])
  })
})

describe('purezza', () => {
  /** Lo stato di partenza, e tutto ciò che ci sta dentro, non deve cambiare. */
  it('ogni funzione è pura: lo stato di partenza non viene toccato', () => {
    const p = stato({
      hp: { cur: 10, temp: 4 },
      hitDice: { spent: 2 },
      slots: { 1: { used: 1 } },
      conditions: ['prone'],
      uses: { 'rage': 1 },
      deaths: { succ: 1, fail: 1 },
    })
    const prima = structuredClone(p)

    applyDamage(p, 7, 20)
    heal(p, 7, 20)
    useSlot(p, 1)
    restoreSlot(p, 1)
    toggleCondition(p, 'prone')
    modifica(p, s => { s.inspiration = true; s.coins['gp'] = 999 })
    shortRest(p, { dadiSpesi: 1, tiri: [6], pfMax: 20 }, { recupero: { breve: ['rage'] } })
    longRest(p, { pfMax: 20, dadiVitaTotali: 4 }, null)

    expect(p).toEqual(prima)
  })

  it('lo stato restituito non condivide strutture con quello di partenza', () => {
    const p = stato({ slots: { 1: { used: 0 } }, conditions: ['prone'] })
    const dopo = useSlot(p, 1)
    expect(dopo.slots['1']).not.toBe(p.slots['1'])
    expect(dopo.conditions).not.toBe(p.conditions)
    expect(dopo.coins).not.toBe(p.coins)
    expect(dopo.uses).not.toBe(p.uses)
    expect(dopo.deaths).not.toBe(p.deaths)
  })

  it('modifica() copia prima di far mutare', () => {
    const p = stato()
    const dopo = modifica(p, s => { s.inspiration = true })
    expect(dopo.inspiration).toBe(true)
    expect(p.inspiration).toBe(false)
  })
})

describe('slotsMassimi', () => {
  const rules = {
    classes: { cleric: { casterType: 'full' }, warlock: { casterType: 'pact' }, barbarian: { casterType: null } },
    spellSlots: {
      full: [[2], [3], [4, 2], [4, 3]],
      pact: [{ slotLevel: 1, slots: 1 }, { slotLevel: 1, slots: 2 }, { slotLevel: 2, slots: 2 }],
    },
  }

  it('legge la tabella del pacchetto per il livello del personaggio', () => {
    expect(slotsMassimi(rules, { className: 'cleric', level: 3 })).toEqual([4, 2])
  })

  it('appiattisce il patto del warlock nella stessa forma degli altri', () => {
    expect(slotsMassimi(rules, { className: 'warlock', level: 3 })).toEqual([0, 2])
  })

  it('chi non è incantatore non ha slot', () => {
    expect(slotsMassimi(rules, { className: 'barbarian', level: 3 })).toEqual([])
    expect(slotsMassimi(rules, { className: 'ignoto', level: 3 })).toEqual([])
  })

  it('senza pacchetto non inventa niente', () => {
    expect(slotsMassimi(null, { className: 'cleric', level: 3 })).toEqual([])
  })
})

describe('zaino', () => {
  /** Uno stato di partenza minimo, con solo ciò che serve qui. */
  const vuoto = () => ({
    hp: { cur: 10, temp: 0 }, hitDice: { spent: 0 }, slots: {}, conditions: [],
    inspiration: false, coins: { gp: 5 }, uses: {}, xp: 0,
    deaths: { succ: 0, fail: 0 }, notes: '',
  })

  it('aggiunge un oggetto raccolto, senza toccare lo stato di partenza', () => {
    const prima = vuoto()
    const dopo = aggiungiOggetto(prima, 'tre torce')
    expect(dopo.oggetti).toEqual(['tre torce'])
    expect(prima.oggetti).toBeUndefined()
  })

  it('accumula nell\'ordine in cui le cose sono state raccolte', () => {
    let p = aggiungiOggetto(vuoto(), 'corda')
    p = aggiungiOggetto(p, 'un teschio')
    expect(p.oggetti).toEqual(['corda', 'un teschio'])
  })

  it('ignora righe vuote e taglia quelle chilometriche', () => {
    expect(aggiungiOggetto(vuoto(), '   ').oggetti).toBeUndefined()
    const lungo = aggiungiOggetto(vuoto(), 'x'.repeat(500)).oggetti?.[0] ?? ''
    expect(lungo.length).toBe(MAX_OGGETTO)
  })

  it('non cresce oltre il tetto', () => {
    let p = vuoto()
    for (let i = 0; i < MAX_OGGETTI + 10; i++) p = aggiungiOggetto(p, `oggetto ${i}`)
    expect(p.oggetti).toHaveLength(MAX_OGGETTI)
  })

  it('toglie quello giusto, e un indice sbagliato non cancella niente', () => {
    let p = aggiungiOggetto(aggiungiOggetto(aggiungiOggetto(vuoto(), 'a'), 'b'), 'c')
    expect(togliOggetto(p, 1).oggetti).toEqual(['a', 'c'])
    expect(togliOggetto(p, 9).oggetti).toEqual(['a', 'b', 'c'])
    expect(togliOggetto(p, -1).oggetti).toEqual(['a', 'b', 'c'])
  })

  it('somma e sottrae monete, senza scendere sotto zero', () => {
    const p = vuoto()
    expect(cambiaMonete(p, 'gp', 3).coins.gp).toBe(8)
    expect(cambiaMonete(p, 'gp', -100).coins.gp).toBe(0)
    expect(cambiaMonete(p, 'cp', 7).coins.cp).toBe(7)
  })

  it('non conosce tagli che non esistono, e non converte fra tagli', () => {
    const p = cambiaMonete(vuoto(), 'lire', 10)
    expect(p.coins).toEqual({ gp: 5 })
    // dieci argenti restano dieci argenti: il cambio non è uguale a ogni tavolo
    expect(cambiaMonete(vuoto(), 'sp', 10).coins).toEqual({ gp: 5, sp: 10 })
  })
})

describe('slot che non esistevano ancora', () => {
  const vuoto = () => ({
    hp: { cur: 10, temp: 0 }, hitDice: { spent: 0 }, slots: {}, conditions: [],
    inspiration: false, coins: {}, uses: {}, xp: 0,
    deaths: { succ: 0, fail: 0 }, notes: '',
  })

  it('il primo incantesimo della partita consuma davvero', () => {
    // Lo stato appena importato ha la mappa vuota: se `useSlot` pretendesse una
    // voce già presente, il primo lancio non consumerebbe niente e non lo direbbe.
    const dopo = useSlot(vuoto(), 1, 4)
    expect(dopo.slots['1']).toEqual({ used: 1 })
  })

  it('ma solo se a quel livello gli slot ci sono', () => {
    expect(useSlot(vuoto(), 9, 0).slots['9']).toBeUndefined()
    expect(useSlot(vuoto(), 9).slots['9']).toBeUndefined()
  })

  it('non si spende più di quanto se ne ha', () => {
    let p = vuoto()
    for (let i = 0; i < 10; i++) p = useSlot(p, 1, 2)
    expect(p.slots['1']).toEqual({ used: 2 })
  })

  it('livelli senza senso non creano niente', () => {
    expect(useSlot(vuoto(), 0, 4).slots['0']).toBeUndefined()
    expect(useSlot(vuoto(), -1, 4).slots['-1']).toBeUndefined()
  })
})
