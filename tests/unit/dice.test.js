/**
 * Lotto A — dadi. I comportamenti elencati in `contratti.test.js`, resi veri.
 *
 * Tutto qui dentro gira su `seededRng`: un test che dipende da `crypto` è un
 * test che prima o poi fallisce di venerdì sera senza spiegare perché.
 */
import { describe, it, expect } from 'vitest'
import { seededRng } from '../../src/domain/rng.js'
import {
  ALLOWED_FACES,
  MAX_DICE_PER_TERM,
  MAX_GROUPS,
  bounds,
  parse,
  roll,
  rollNotation,
} from '../../src/domain/dice.js'

/** @param {string} s */
const gruppi = (s) => parse(s).groups

describe('lotto A — dadi', () => {
  it('analizza 1d20+5, 4d12, 4d6dl1, 2d20kh1+3, 1d8+1d6+2, 1d100, 3d3', () => {
    expect(gruppi('1d20+5')[0].terms).toEqual([
      { count: 1, faces: 20, sign: 1 },
      { value: 5, sign: 1 },
    ])
    expect(gruppi('4d12')[0].terms).toEqual([{ count: 4, faces: 12, sign: 1 }])
    expect(gruppi('4d6dl1')[0].terms).toEqual([
      { count: 4, faces: 6, sign: 1, keep: { mode: 'dl', n: 1 } },
    ])
    expect(gruppi('2d20kh1+3')[0].terms).toEqual([
      { count: 2, faces: 20, sign: 1, keep: { mode: 'kh', n: 1 } },
      { value: 3, sign: 1 },
    ])
    expect(gruppi('1d8+1d6+2')[0].terms).toEqual([
      { count: 1, faces: 8, sign: 1 },
      { count: 1, faces: 6, sign: 1 },
      { value: 2, sign: 1 },
    ])
    expect(gruppi('1d100')[0].terms).toEqual([{ count: 1, faces: 100, sign: 1 }])
    expect(gruppi('3d3')[0].terms).toEqual([{ count: 3, faces: 3, sign: 1 }])
  })

  it('accetta le forme di contorno: d20 senza N, maiuscole, spazi, sottrazione, r1', () => {
    expect(gruppi('d20')[0].terms).toEqual([{ count: 1, faces: 20, sign: 1 }])
    expect(gruppi('1D20 + 5')[0].terms).toEqual(gruppi('1d20+5')[0].terms)
    expect(gruppi('1d20-2')[0].terms).toEqual([
      { count: 1, faces: 20, sign: 1 },
      { value: 2, sign: -1 },
    ])
    expect(gruppi('-1d4+10')[0].terms).toEqual([
      { count: 1, faces: 4, sign: -1 },
      { value: 10, sign: 1 },
    ])
    expect(gruppi('4d6r1')[0].terms).toEqual([{ count: 4, faces: 6, sign: 1, reroll1: true }])
  })

  it('tratta «2d6 e 3d20» come due gruppi indipendenti, non come una somma', () => {
    const n = parse('2d6 e 3d20')
    expect(n.groups).toHaveLength(2)
    expect(n.groups[0].terms).toEqual([{ count: 2, faces: 6, sign: 1 }])
    expect(n.groups[1].terms).toEqual([{ count: 3, faces: 20, sign: 1 }])

    const r = roll(n, seededRng(7))
    expect(r.groups).toHaveLength(2)
    // Ogni gruppo ha il proprio totale, e sta nella propria forbice: se fossero
    // sommati in un termine solo, 2d6 potrebbe valere più di 12.
    expect(r.groups[0].total).toBeGreaterThanOrEqual(2)
    expect(r.groups[0].total).toBeLessThanOrEqual(12)
    expect(r.groups[1].total).toBeGreaterThanOrEqual(3)
    expect(r.groups[1].total).toBeLessThanOrEqual(60)
    expect(r.groups[0].dice).toHaveLength(2)
    expect(r.groups[1].dice).toHaveLength(3)
  })

  it('accetta la virgola e il punto e virgola come separatori di gruppo', () => {
    expect(parse('1d20, 1d6; 1d4').groups).toHaveLength(3)
  })

  it('accetta solo le facce d2 d3 d4 d6 d8 d10 d12 d20 d100', () => {
    expect([...ALLOWED_FACES]).toEqual([2, 3, 4, 6, 8, 10, 12, 20, 100])
    for (const f of ALLOWED_FACES) {
      expect(gruppi(`1d${f}`)[0].terms).toEqual([{ count: 1, faces: f, sign: 1 }])
    }
    for (const f of [1, 5, 7, 9, 11, 13, 16, 30, 50, 99, 1000]) {
      expect(() => parse(`1d${f}`)).toThrow()
    }
  })

  it('rifiuta d7 con un messaggio che elenca i dadi ammessi, non «parse error»', () => {
    let messaggio = ''
    try { parse('1d7') } catch (e) { messaggio = e instanceof Error ? e.message : String(e) }
    expect(messaggio).toContain('d7')
    expect(messaggio).toContain('non esiste')
    expect(messaggio).not.toMatch(/parse error/i)
    for (const f of ALLOWED_FACES) expect(messaggio).toContain(`d${f}`)
  })

  it('espande vantaggio in 2d20kh1 e svantaggio in 2d20kl1', () => {
    const kh = [{ count: 2, faces: 20, sign: 1, keep: { mode: 'kh', n: 1 } }]
    const kl = [{ count: 2, faces: 20, sign: 1, keep: { mode: 'kl', n: 1 } }]
    for (const s of ['vantaggio', 'adv', 'VANTAGGIO']) expect(gruppi(s)[0].terms).toEqual(kh)
    for (const s of ['svantaggio', 'dis', 'Svantaggio']) expect(gruppi(s)[0].terms).toEqual(kl)
    // «svantaggio» non deve inciampare nella «vantaggio» che contiene
    expect(gruppi('svantaggio')[0].terms).not.toEqual(kh)
    // e la scorciatoia si compone col resto dell'espressione
    expect(gruppi('vantaggio+3')[0].terms).toEqual([...kh, { value: 3, sign: 1 }])
    // il testo digitato resta visibile, la formula è quella espansa
    const r = roll(parse('vantaggio+3'), seededRng(1))
    expect(r.groups[0].source).toBe('vantaggio+3')
    expect(r.groups[0].formula).toBe('2d20kh1 + 3')
  })

  it('rifiuta più di 100 dadi per termine e più di 10 gruppi', () => {
    expect(() => parse(`${MAX_DICE_PER_TERM}d6`)).not.toThrow()
    expect(() => parse(`${MAX_DICE_PER_TERM + 1}d6`)).toThrow(/al massimo 100/)
    expect(() => parse('999d100')).toThrow(/al massimo 100/)

    const dieci = Array.from({ length: MAX_GROUPS }, () => '1d6').join(', ')
    expect(parse(dieci).groups).toHaveLength(MAX_GROUPS)
    expect(() => parse(`${dieci}, 1d6`)).toThrow(/al massimo 10/)
  })

  it('rifiuta il resto con un messaggio, non con un crash', () => {
    for (const s of ['', '   ', 'x', '1d20+', '+', '1d6kh1kl1', '0d6', '1d6kh0', '1d20,,1d6']) {
      expect(() => parse(s), s).toThrow(Error)
    }
  })

  it('mille espressioni casuali: nessuna lancia, ogni totale sta fra min e max teorici', () => {
    const gen = seededRng(20240823)
    /** @param {number} n */
    const fino = (n) => gen.int(n) + 1
    /** @type {string[]} */
    const visti = []

    for (let i = 0; i < 1000; i++) {
      const quantiGruppi = fino(MAX_GROUPS)
      /** @type {string[]} */
      const g = []
      for (let k = 0; k < quantiGruppi; k++) {
        /** @type {string[]} */
        const termini = []
        const quantiTermini = fino(4)
        for (let j = 0; j < quantiTermini; j++) {
          if (gen.int(5) === 0) {
            termini.push(String(gen.int(20)))
            continue
          }
          const count = fino(MAX_DICE_PER_TERM)
          const faces = ALLOWED_FACES[gen.int(ALLOWED_FACES.length)]
          let mod = ''
          switch (gen.int(6)) {
            case 0: mod = `kh${fino(count)}`; break
            case 1: mod = `kl${fino(count)}`; break
            case 2: mod = `dh${fino(count)}`; break
            case 3: mod = `dl${fino(count)}`; break
            case 4: mod = 'r1'; break
            default: mod = ''
          }
          termini.push(`${count}d${faces}${mod}`)
        }
        g.push(termini.map((t, j) => (j === 0 ? t : `${gen.int(2) ? '+' : '-'}${t}`)).join(''))
      }
      const espressione = g.join([', ', '; ', ' e '][gen.int(3)])
      visti.push(espressione)

      const n = parse(espressione)
      const b = bounds(n)
      const r = roll(n, gen)
      expect(r.total, espressione).toBeGreaterThanOrEqual(b.min)
      expect(r.total, espressione).toBeLessThanOrEqual(b.max)
      // e ogni gruppo, preso da solo, sta nella *sua* forbice
      n.groups.forEach((gr, idx) => {
        const bg = bounds({ groups: [gr] })
        expect(r.groups[idx].total, gr.source).toBeGreaterThanOrEqual(bg.min)
        expect(r.groups[idx].total, gr.source).toBeLessThanOrEqual(bg.max)
      })
    }
    expect(new Set(visti).size).toBeGreaterThan(900)  // generate davvero diverse
  })

  it('bounds tiene conto di tieni/scarta e dei termini negativi', () => {
    expect(bounds(parse('4d6dl1'))).toEqual({ min: 3, max: 18 })
    expect(bounds(parse('2d20kh1'))).toEqual({ min: 1, max: 20 })
    expect(bounds(parse('2d20kl1+3'))).toEqual({ min: 4, max: 23 })
    expect(bounds(parse('1d20-2'))).toEqual({ min: -1, max: 18 })
    expect(bounds(parse('-1d4+10'))).toEqual({ min: 6, max: 9 })
    // «tieni cinque» su tre dadi tiene i tre che ci sono, non ne inventa due
    expect(bounds(parse('3d6kh5'))).toEqual({ min: 3, max: 18 })
    expect(bounds(parse('3d6dh5'))).toEqual({ min: 0, max: 0 })
    // i gruppi indipendenti: la forbice del totale è la somma delle loro
    expect(bounds(parse('2d6 e 3d20'))).toEqual({ min: 5, max: 72 })
  })

  it('con RNG a seme fisso il tiro è riproducibile', () => {
    const espressione = '4d6dl1 e 2d20kh1+3, 1d100'
    const a = roll(parse(espressione), seededRng(99))
    const b = roll(parse(espressione), seededRng(99))
    expect(b).toEqual(a)
    const c = roll(parse(espressione), seededRng(100))
    expect(c).not.toEqual(a)
    // e rollNotation è davvero parse + roll
    expect(rollNotation(espressione, seededRng(99))).toEqual(a)
    expect(rollNotation(espressione, seededRng(99), 'Furtività').label).toBe('Furtività')
    expect(a.label).toBeUndefined()
  })

  it('segnala i naturali 20 e 1 sui d20', () => {
    // Cento d20 con un seme fisso: il 20 e l'1 ci sono di sicuro, e ogni dado
    // porta con sé le facce, che è ciò che rende riconoscibile il «naturale».
    const r = roll(parse('100d20'), seededRng(3))
    expect(r.groups[0].dice.every(d => d.faces === 20)).toBe(true)
    const naturali20 = r.groups[0].dice.filter(d => d.faces === 20 && d.value === 20)
    const naturali1 = r.groups[0].dice.filter(d => d.faces === 20 && d.value === 1)
    expect(naturali20.length).toBeGreaterThan(0)
    expect(naturali1.length).toBeGreaterThan(0)
    // un 1 su un d6 non è un fallimento naturale: la faccia distingue
    const d6 = roll(parse('100d6'), seededRng(3))
    expect(d6.groups[0].dice.every(d => d.faces === 6)).toBe(true)
    expect(d6.groups[0].dice.some(d => d.value === 1)).toBe(true)
    expect(d6.groups[0].dice.some(d => d.faces === 20)).toBe(false)
  })

  it('mostra i dadi scartati invece di nasconderli', () => {
    const r = roll(parse('4d6dl1'), seededRng(11))
    const g = r.groups[0]
    expect(g.dice).toHaveLength(4)                       // tutti e quattro restano
    const scartati = g.dice.filter(d => d.dropped)
    expect(scartati).toHaveLength(1)
    // e quello scartato è davvero il più basso
    const minimo = Math.min(...g.dice.map(d => d.value))
    expect(scartati[0].value).toBe(minimo)
    // il totale conta solo i tenuti
    expect(g.total).toBe(g.dice.filter(d => !d.dropped).reduce((n, d) => n + d.value, 0))

    const kh = roll(parse('2d20kh1'), seededRng(11)).groups[0]
    expect(kh.dice).toHaveLength(2)
    expect(kh.dice.filter(d => d.dropped)).toHaveLength(1)
    expect(kh.total).toBe(Math.max(...kh.dice.map(d => d.value)))

    const kl = roll(parse('2d20kl1'), seededRng(11)).groups[0]
    expect(kl.total).toBe(Math.min(...kl.dice.map(d => d.value)))

    const dh = roll(parse('3d6dh1'), seededRng(11)).groups[0]
    expect(dh.dice.filter(d => d.dropped)).toHaveLength(1)
    expect(dh.dice.find(d => d.dropped)?.value).toBe(Math.max(...dh.dice.map(d => d.value)))
  })

  it('r1 ritira gli 1 una volta sola e lo dichiara', () => {
    const r = roll(parse('100d6r1'), seededRng(5))
    const dadi = r.groups[0].dice
    expect(dadi.some(d => d.rerolled)).toBe(true)
    // ritirati o no, restano nell'intervallo del dado: r1 non alza il minimo
    expect(dadi.every(d => d.value >= 1 && d.value <= 6)).toBe(true)
    expect(bounds(parse('1d6r1'))).toEqual({ min: 1, max: 6 })
  })

  it('la formula in chiaro rende leggibile ciò che è stato tirato', () => {
    const r = roll(parse('4d6dl1+2 e vantaggio'), seededRng(1))
    expect(r.groups[0].formula).toBe('4d6dl1 + 2')
    expect(r.groups[0].source).toBe('4d6dl1+2')
    expect(r.groups[1].formula).toBe('2d20kh1')
    expect(r.total).toBe(r.groups.reduce((n, g) => n + g.total, 0))
  })

  it('non usa Math.random: il tiro dipende solo dall\'Rng ricevuto', () => {
    const originale = Math.random
    Math.random = () => { throw new Error('Math.random vietato nei dadi') }
    try {
      expect(() => rollNotation('10d20kh3+1d6r1, 4d6dl1', seededRng(2))).not.toThrow()
    } finally {
      Math.random = originale
    }
  })
})
