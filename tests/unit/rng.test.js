import { describe, it, expect } from 'vitest'
import { seededRng, cryptoRng } from '../../src/domain/rng.js'

describe('numeri casuali', () => {
  it('lo stesso seme dà la stessa sequenza', () => {
    const a = seededRng(42), b = seededRng(42)
    const sa = Array.from({ length: 20 }, () => a.int(20))
    const sb = Array.from({ length: 20 }, () => b.int(20))
    expect(sa).toEqual(sb)
  })

  it('semi diversi divergono', () => {
    const a = seededRng(1), b = seededRng(2)
    const sa = Array.from({ length: 20 }, () => a.int(100))
    const sb = Array.from({ length: 20 }, () => b.int(100))
    expect(sa).not.toEqual(sb)
  })

  it('resta dentro [0, max)', () => {
    const r = seededRng(7)
    for (let i = 0; i < 2000; i++) {
      const v = r.int(20)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(20)
    }
  })

  it('rifiuta un max insensato', () => {
    const r = seededRng(1)
    expect(() => r.int(0)).toThrow(RangeError)
    expect(() => r.int(-3)).toThrow(RangeError)
    expect(() => r.int(2.5)).toThrow(RangeError)
  })

  it('il generatore crittografico è ragionevolmente uniforme sui venti', () => {
    /** Il chi quadro di una tornata di tiri. */
    const prova = () => {
      const r = cryptoRng()
      const conta = new Array(20).fill(0)
      const N = 40_000
      for (let i = 0; i < N; i++) conta[r.int(20)]++
      const atteso = N / 20
      return conta.reduce((s, c) => s + (c - atteso) ** 2 / atteso, 0)
    }

    // 43.8 è il 99,9° percentile del chi quadro con 19 gradi di libertà: un
    // generatore **onesto** lo supera una volta su mille, e questa suite gira
    // molte volte al giorno. Tre tornate: un generatore storto le fallisce
    // tutte e tre, uno onesto le fallisce tutte e tre una volta su un
    // miliardo. La soglia non si è alzata — si è tolto il caso.
    const tornate = [prova(), prova(), prova()]
    expect(Math.min(...tornate)).toBeLessThan(43.8)
  })
})
