/**
 * Prove, tiri salvezza, contrapposti.  ── Lotto H ──
 *
 * Il test che conta più di tutti è il primo: il 20 naturale in una prova non è
 * successo automatico. È il difetto più facile da introdurre — sembra una
 * gentilezza verso chi gioca — e il più difficile da notare, perché si
 * manifesta una volta su venti e sempre in un momento in cui nessuno controlla.
 */
import { describe, it, expect } from 'vitest'
import { check, opposed, MAX_RIPETIZIONI } from '../../src/domain/check.js'
import { seededRng } from '../../src/domain/rng.js'

/**
 * Un RNG che restituisce i valori dati, in ordine. I numeri sono **facce
 * volute**: `dado(20)` dà un 20 naturale, non un `int()` da tradurre a mente.
 * @param {number[]} facce
 * @returns {import('../../src/domain/rng.js').Rng}
 */
function dadiTruccati(facce) {
  let i = 0
  return {
    int(max) {
      const v = facce[i++] ?? 1
      return Math.min(Math.max(v, 1), max) - 1
    },
  }
}

/** Un RNG degenere: dà sempre la stessa faccia. @param {number} faccia */
function dadoFisso(faccia) {
  return { int: (/** @type {number} */ max) => Math.min(faccia, max) - 1 }
}

describe('prova di caratteristica', () => {
  it('il 20 naturale in una prova NON è successo automatico', () => {
    const r = check({ bonus: 0, cd: 25, rng: dadiTruccati([20]) })
    expect(r.naturale).toBe(20)
    expect(r.totale).toBe(20)
    expect(r.venti, 'il 20 si segnala').toBe(true)
    expect(r.riuscita, '…ma 20 contro CD 25 resta un fallimento').toBe(false)
    expect(r.margine).toBe(-5)
  })

  it('e l\'1 naturale non è fallimento automatico', () => {
    const r = check({ bonus: 12, cd: 10, rng: dadiTruccati([1]) })
    expect(r.naturale).toBe(1)
    expect(r.uno).toBe(true)
    expect(r.totale).toBe(13)
    expect(r.riuscita, '1 + 12 = 13 supera la CD 10, e tanto basta').toBe(true)
  })

  it('riporta il margine rispetto alla CD', () => {
    // L'esempio del piano: «18 contro CD 14 — riuscita di 4».
    const r = check({ bonus: 5, cd: 14, rng: dadiTruccati([13]) })
    expect(r.totale).toBe(18)
    expect(r.riuscita).toBe(true)
    expect(r.margine).toBe(4)

    const male = check({ bonus: 1, cd: 15, rng: dadiTruccati([7]) })
    expect(male.totale).toBe(8)
    expect(male.riuscita).toBe(false)
    expect(male.margine, 'il margine negativo dice di quanto si è mancato').toBe(-7)
  })

  it('pareggiare la CD è riuscire', () => {
    const r = check({ bonus: 2, cd: 12, rng: dadiTruccati([10]) })
    expect(r.totale).toBe(12)
    expect(r.riuscita).toBe(true)
    expect(r.margine).toBe(0)
  })

  it('senza CD non c\'è esito da dare: solo il numero', () => {
    const r = check({ bonus: 3, rng: dadiTruccati([11]) })
    expect(r.totale).toBe(14)
    expect(r.cd).toBeNull()
    expect(r.riuscita).toBeNull()
    expect(r.margine).toBeNull()
  })

  it('il vantaggio tiene il più alto, lo svantaggio il più basso', () => {
    const facce = [4, 17]
    const su = check({ bonus: 0, advantage: 'vantaggio', rng: dadiTruccati(facce) })
    const giu = check({ bonus: 0, advantage: 'svantaggio', rng: dadiTruccati(facce) })
    expect(su.naturale).toBe(17)
    expect(su.totale).toBe(17)
    expect(giu.naturale).toBe(4)
    expect(giu.totale).toBe(4)

    // Il dado scartato resta nel tiro: al tavolo si vede sul feltro.
    const dadi = su.roll.groups[0]?.dice ?? []
    expect(dadi).toHaveLength(2)
    expect(dadi.filter(d => d.dropped)).toHaveLength(1)
  })

  it('il naturale è il dado tenuto, non quello scartato', () => {
    // Con lo svantaggio esce anche un 20, ma non è il risultato della prova.
    const r = check({ bonus: 0, advantage: 'svantaggio', rng: dadiTruccati([20, 3]) })
    expect(r.naturale).toBe(3)
    expect(r.venti, 'un 20 scartato non è un 20 naturale').toBe(false)
  })

  it('il bonus negativo si sottrae davvero', () => {
    const r = check({ bonus: -2, cd: 10, rng: dadiTruccati([11]) })
    expect(r.totale).toBe(9)
    expect(r.riuscita).toBe(false)
  })

  it('l\'etichetta arriva fino al tiro, che è ciò che finisce nello storico', () => {
    const r = check({ bonus: 4, rng: seededRng(7), label: 'Percezione' })
    expect(r.roll.label).toBe('Percezione')
    expect(r.roll.groups[0]?.source, 'la notazione è quella che si legge nello storico').toBe('1d20+4')
  })

  it('mille tiri restano dentro la forbice, e nessuno inventa un 21', () => {
    const rng = seededRng(20260823)
    for (let i = 0; i < 1000; i++) {
      const r = check({ bonus: 3, cd: 15, rng })
      expect(r.naturale).toBeGreaterThanOrEqual(1)
      expect(r.naturale).toBeLessThanOrEqual(20)
      expect(r.totale).toBe(r.naturale + 3)
      expect(r.riuscita).toBe(r.totale >= 15)
    }
  })
})

describe('tiro contrapposto', () => {
  it('il contrapposto dichiara il vincitore', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0 },
      b: { nome: 'Guardia', bonus: 0 },
      rng: dadiTruccati([15, 6]),
    })
    expect(r.vincitore).toBe('a')
    expect(r.a.totale).toBe(15)
    expect(r.b.totale).toBe(6)
    expect(r.ripetizioni).toBe(0)
    expect(r.a.roll.label, 'ogni lato porta il proprio nome nello storico').toBe('Ladra')
    expect(r.b.roll.label).toBe('Guardia')
  })

  it('i bonus contano: il dado più basso può vincere lo stesso', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 9 },
      b: { nome: 'Guardia', bonus: 0 },
      rng: dadiTruccati([5, 12]),
    })
    expect(r.a.totale).toBe(14)
    expect(r.b.totale).toBe(12)
    expect(r.vincitore).toBe('a')
  })

  it('ogni lato ha il proprio vantaggio o svantaggio', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0, advantage: 'vantaggio' },
      b: { nome: 'Guardia', bonus: 0, advantage: 'svantaggio' },
      rng: dadiTruccati([2, 18, 11, 4]),
    })
    expect(r.a.totale, 'A tiene il più alto dei suoi due').toBe(18)
    expect(r.b.totale, 'B tiene il più basso dei suoi').toBe(4)
    expect(r.vincitore).toBe('a')
  })

  it('con la regola «nessuno» il pareggio resta un pareggio', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0 },
      b: { nome: 'Guardia', bonus: 0 },
      rng: dadiTruccati([11, 11]),
      pareggio: 'nessuno',
    })
    expect(r.vincitore).toBeNull()
    expect(r.ripetizioni).toBe(0)
  })

  it('con la regola «ripeti» si ritira, e le ripetizioni si contano', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0 },
      b: { nome: 'Guardia', bonus: 0 },
      rng: dadiTruccati([11, 11, 7, 7, 19, 3]),
      pareggio: 'ripeti',
    })
    expect(r.ripetizioni, 'due pareggi prima di sbrogliarla').toBe(2)
    expect(r.vincitore).toBe('a')
    expect(r.a.totale, 'si tiene l\'ultimo tiro, non il primo').toBe(19)
    expect(r.b.totale).toBe(3)
  })

  it('un RNG degenere non manda in stallo il tiro', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0 },
      b: { nome: 'Guardia', bonus: 0 },
      rng: dadoFisso(10),           // pareggia sempre: senza tetto sarebbe un ciclo infinito
      pareggio: 'ripeti',
    })
    expect(r.ripetizioni).toBe(MAX_RIPETIZIONI)
    expect(r.vincitore, 'dopo il tetto si dichiara pareggio, non un vincitore inventato').toBeNull()
  })

  it('nel contrapposto non c\'è CD, quindi non c\'è esito', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 2 },
      b: { nome: 'Guardia', bonus: 1 },
      rng: seededRng(3),
    })
    expect(r.a.cd).toBeNull()
    expect(r.a.riuscita).toBeNull()
    expect(r.b.margine).toBeNull()
  })

  it('il 20 naturale non vince il contrapposto da solo', () => {
    const r = opposed({
      a: { nome: 'Ladra', bonus: 0 },
      b: { nome: 'Golem', bonus: 9 },
      rng: dadiTruccati([20, 15]),
    })
    expect(r.a.venti).toBe(true)
    expect(r.a.totale).toBe(20)
    expect(r.b.totale).toBe(24)
    expect(r.vincitore).toBe('b')
  })
})
