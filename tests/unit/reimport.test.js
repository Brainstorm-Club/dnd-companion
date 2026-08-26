/**
 * Ri-importare sopra: la scheda nuova, la partita di prima.
 *
 * Il rischio di questa funzione non è sbagliare un conto: è **sovrascrivere il
 * personaggio sbagliato**, o buttare via una sessione di gioco. I test guardano
 * soprattutto lì.
 */
import { describe, it, expect } from 'vitest'
import { stessoPersonaggio, trovaDaAggiornare, riportaSopra } from '../../src/domain/reimport.js'

/** @param {object} snap @param {object} [play] @returns {any} */
function voce(snap, play = {}) {
  return {
    snapshot: { id: 'x', name: 'Kyra', level: 6, maxHp: 44, ...snap },
    meta: {
      importedAt: '2026-01-01T00:00:00Z', source: 'file', variant: 'dnd2024',
      name: /** @type {any} */ (snap).name ?? 'Kyra', packId: 'srd-2024', edition: '2024',
    },
    play: {
      hp: { cur: 30, temp: 0 }, hitDice: { spent: 2 }, slots: { 1: { used: 2 } },
      conditions: ['prone'], inspiration: true, coins: { go: 12 }, uses: {},
      xp: 14000, deaths: { succ: 0, fail: 0 }, notes: 'il barile è vuoto',
      ...play,
    },
    levels: [{ at: '2026-02-01T00:00:00Z', from: 5, to: 6, diff: {} }],
  }
}

describe('riconoscere lo stesso personaggio', () => {
  it('due export con lo stesso id del builder sono la stessa scheda', () => {
    expect(stessoPersonaggio({ id: 'a1' }, { id: 'a1' })).toBe(true)
  })

  it('anche se nel frattempo è cambiato nome', () => {
    expect(stessoPersonaggio({ id: 'a1', name: 'Kyra' }, { id: 'a1', name: 'Kyra Ombralunga' })).toBe(true)
  })

  it('senza id non si indovina, nemmeno con lo stesso nome', () => {
    // Sovrascrivere il personaggio sbagliato è il danno peggiore che questa
    // funzione possa fare. Un doppione si cancella; una partita persa no.
    expect(stessoPersonaggio({ name: 'Kyra', level: 6 }, { name: 'Kyra', level: 6 })).toBe(false)
    expect(stessoPersonaggio({ id: '' }, { id: '' })).toBe(false)
    expect(stessoPersonaggio({ id: 'a1' }, { name: 'Kyra' })).toBe(false)
  })

  it('nella libreria trova quello giusto, e nessuno se non c\'è', () => {
    const libreria = { uno: voce({ id: 'a1' }), due: voce({ id: 'b2' }) }
    expect(trovaDaAggiornare(libreria, { id: 'b2' })).toBe('due')
    expect(trovaDaAggiornare(libreria, { id: 'c3' })).toBeNull()
    expect(trovaDaAggiornare({}, { id: 'a1' })).toBeNull()
  })
})

describe('la partita sopravvive alla scheda nuova', () => {
  it('punti ferita, slot, condizioni, monete, note e PX restano dov\'erano', () => {
    const vecchia = voce({})
    const nuova = voce({ level: 7, maxHp: 51 })
    const { entry } = riportaSopra(vecchia, nuova)

    expect(entry.play.hp.cur).toBe(30)
    expect(entry.play.slots).toEqual({ 1: { used: 2 } })
    expect(entry.play.conditions).toEqual(['prone'])
    expect(entry.play.coins).toEqual({ go: 12 })
    expect(entry.play.notes).toBe('il barile è vuoto')
    expect(entry.play.xp).toBe(14000)
    expect(entry.play.inspiration).toBe(true)
  })

  it('la scheda invece è quella nuova', () => {
    const { entry } = riportaSopra(voce({}), voce({ level: 7, maxHp: 51 }))
    expect(entry.snapshot['level']).toBe(7)
    expect(entry.snapshot['maxHp']).toBe(51)
  })

  it('e lo storico degli avanzamenti fatti al tavolo non si butta', () => {
    // Racconta cosa è successo qui dentro, e non smette di essere vero perché
    // la scheda arriva aggiornata da fuori.
    const { entry } = riportaSopra(voce({}), voce({ level: 7 }))
    expect(entry.levels).toHaveLength(1)
    expect(entry.levels[0].to).toBe(6)
  })

  it('lo stato di gioco è una copia: toccare quello nuovo non tocca il vecchio', () => {
    const vecchia = voce({})
    const { entry } = riportaSopra(vecchia, voce({ level: 7 }))
    entry.play.hp.cur = 1
    entry.play.conditions.push('stunned')
    expect(vecchia.play.hp.cur).toBe(30)
    expect(vecchia.play.conditions).toEqual(['prone'])
  })
})

describe('quello che non può restare com\'era', () => {
  it('i punti ferita correnti non superano i massimi nuovi', () => {
    const vecchia = voce({ maxHp: 60 }, { hp: { cur: 58, temp: 0 } })
    const { entry, cambiamenti } = riportaSopra(vecchia, voce({ maxHp: 44 }))
    expect(entry.play.hp.cur).toBe(44)
    expect(cambiamenti).toContainEqual({ tipo: 'pf-clampati', da: 58, a: 44 })
  })

  it('ma un personaggio ferito resta ferito, anche salendo di livello', () => {
    // I punti guadagnati salendo li dà l'avanzamento, non l'import: se qui si
    // «regalassero» i PF, salire di livello nel builder curerebbe.
    const { entry, cambiamenti } = riportaSopra(voce({ maxHp: 44 }, { hp: { cur: 6, temp: 0 } }), voce({ maxHp: 51 }))
    expect(entry.play.hp.cur).toBe(6)
    expect(cambiamenti.some(c => c.tipo === 'pf-clampati')).toBe(false)
  })

  it('i dadi vita spesi non superano quelli che si hanno', () => {
    const vecchia = voce({ level: 8 }, { hitDice: { spent: 8 } })
    const { entry } = riportaSopra(vecchia, voce({ level: 5 }))
    expect(entry.play.hitDice.spent).toBe(5)
  })

  it('gli slot spesi restano spesi: salire di livello non è un riposo', () => {
    const { entry, cambiamenti } = riportaSopra(voce({ level: 6 }), voce({ level: 7 }))
    expect(entry.play.slots).toEqual({ 1: { used: 2 } })
    expect(cambiamenti).toContainEqual({ tipo: 'slot-nuovi' })
  })
})

describe('cosa si racconta a chi ha ri-importato', () => {
  it('il livello e i punti ferita massimi, quando cambiano', () => {
    const { cambiamenti } = riportaSopra(voce({ level: 6, maxHp: 44 }), voce({ level: 7, maxHp: 51 }))
    expect(cambiamenti).toContainEqual({ tipo: 'livello', da: 6, a: 7 })
    expect(cambiamenti).toContainEqual({ tipo: 'pf-max', da: 44, a: 51 })
  })

  it('e il nome, che è la cosa che si nota di più', () => {
    const nuova = voce({ name: 'Kyra Ombralunga' })
    nuova.meta.name = 'Kyra Ombralunga'
    const { cambiamenti } = riportaSopra(voce({}), nuova)
    expect(cambiamenti).toContainEqual({ tipo: 'nome', da: 'Kyra', a: 'Kyra Ombralunga' })
  })

  it('se non è cambiato niente, non si racconta niente', () => {
    const { cambiamenti } = riportaSopra(voce({}), voce({}))
    expect(cambiamenti).toEqual([])
  })
})
