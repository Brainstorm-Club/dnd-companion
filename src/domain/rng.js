/**
 * Numeri casuali onesti, e sostituibili nei test.
 *
 * `Math.random()` andrebbe benissimo per un gioco, ma il modulo introduce un
 * bias: `getRandomValues() % 20` favorisce i primi valori. Al tavolo non se ne
 * accorgerebbe nessuno; nei test di uniformità sì, ed è il motivo per cui qui
 * si campiona per rifiuto.
 */

/** @typedef {{ int: (max: number) => number }} Rng  intero in [0, max) */

/**
 * RNG crittografico, uniforme, senza bias di modulo.
 * @returns {Rng}
 */
export function cryptoRng() {
  const buf = new Uint32Array(1)
  return {
    int(max) {
      if (!Number.isInteger(max) || max <= 0) throw new RangeError(`max non valido: ${max}`)
      const limite = Math.floor(0x1_0000_0000 / max) * max
      let x = 0
      do {
        crypto.getRandomValues(buf)
        x = buf[0] ?? 0
      } while (x >= limite)
      return x % max
    },
  }
}

/**
 * RNG deterministico (xorshift32) per i test: stesso seme, stessa sequenza.
 * @param {number} seed
 * @returns {Rng}
 */
export function seededRng(seed) {
  let s = seed >>> 0 || 1
  return {
    int(max) {
      if (!Number.isInteger(max) || max <= 0) throw new RangeError(`max non valido: ${max}`)
      s ^= s << 13; s >>>= 0
      s ^= s >>> 17
      s ^= s << 5;  s >>>= 0
      return s % max
    },
  }
}
