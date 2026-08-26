/**
 * Lotto B2 — dalla griglia dei moduli al testo.
 *
 * Le prove che contano sono due QR **veri**, stampati dal builder e riletti
 * qui: versione 35 (Lucian) e versione 33 (Kyra). Sono passati per un encoder
 * che non è quello con cui sono state fabbricate le altre fixture, ed è
 * esattamente il motivo per cui valgono più di dieci codici generati.
 *
 * Il resto è `moduli-casi.json`: 35 casi buoni e 6 malformati, generati con
 * `qrcode-generator` (dipendenza di sviluppo) e con un encoder di servizio
 * verificato modulo per modulo contro la libreria. Le matrici sono impacchettate
 * in base64 — un bit per modulo, riga per riga, MSB per primo — perché in
 * `#`/`.` occuperebbero otto volte tanto per dire la stessa cosa.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { testoDa } from '../../src/domain/qr/moduli.js'

const qui = (nome) => fileURLToPath(new URL(`../fixtures/qr/${nome}`, import.meta.url))

/** @param {string} nome */
function reale(nome) {
  const righe = readFileSync(qui(`${nome}.matrice.txt`), 'utf8').trimEnd().split('\n')
  return {
    matrice: righe.map((r) => [...r].map((c) => c === '#')),
    testo: readFileSync(qui(`${nome}.testo.txt`), 'utf8').replace(/\n$/, ''),
  }
}

/** @param {string} b64 @param {number} n */
function spacchetta(b64, n) {
  const b = Buffer.from(b64, 'base64')
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      const i = r * n + c
      return (((b[i >> 3] ?? 0) >> (7 - (i & 7))) & 1) === 1
    }))
}

const { casi, nulli } = JSON.parse(readFileSync(qui('moduli-casi.json'), 'utf8'))
/** @param {{versione:number, moduli:string}} c */
const griglia = (c) => spacchetta(c.moduli, c.versione * 4 + 17)
/** @param {string} nome */
const caso = (nome) => casi.find((/** @type {{nome:string}} */ c) => c.nome === nome)

/** Un generatore lineare congruenziale: gli stessi errori a ogni esecuzione. */
const rng = (seme) => () => ((seme = (seme * 1664525 + 1013904223) >>> 0) / 4294967296)

/**
 * Gira `quanti` moduli a caso. È il modello grezzo di una foto storta: soglia
 * decisa male qua e là, non un guasto strutturale.
 * @param {boolean[][]} m @param {number} quanti @param {number} seme
 */
function sporca(m, quanti, seme) {
  const n = m.length
  const g = m.map((r) => r.slice())
  const r = rng(seme)
  for (let i = 0; i < quanti; i++) {
    const rr = (r() * n) | 0
    const cc = (r() * n) | 0
    // @ts-ignore fixture quadrata per costruzione
    g[rr][cc] = !g[rr][cc]
  }
  return g
}

describe('lotto B2 — moduli, i due codici veri', () => {
  it('legge il QR versione 35 stampato dal builder (Lucian)', () => {
    const { matrice, testo } = reale('lucian')
    expect(matrice.length).toBe(157)
    expect(testo.length).toBe(1782)
    expect(testoDa(matrice)).toBe(testo)
  })

  it('legge il QR versione 33 stampato dal builder (Kyra)', () => {
    const { matrice, testo } = reale('kyra')
    expect(matrice.length).toBe(149)
    expect(testo.length).toBe(1590)
    expect(testoDa(matrice)).toBe(testo)
  })

  it('regge i moduli sbagliati anche sui codici veri', () => {
    for (const nome of ['lucian', 'kyra']) {
      const { matrice, testo } = reale(nome)
      expect(testoDa(sporca(matrice, 150, 20250823))).toBe(testo)
      expect(testoDa(sporca(matrice, 6000, 20250823))).toBeNull()
    }
  })
})

describe('lotto B2 — moduli, la griglia generata', () => {
  it.each(casi.map((/** @type {{nome:string}} */ c) => [c.nome, c]))('%s', (_nome, c) => {
    expect(testoDa(griglia(c))).toBe(c.testo)
  })

  it('copre tutte e otto le maschere, tutti e quattro i livelli, i tre modi', () => {
    const insieme = (/** @type {(c:any)=>any} */ f) => new Set(casi.flatMap(f))
    expect([...insieme((c) => c.maschera)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect([...insieme((c) => c.livello)].sort()).toEqual(['H', 'L', 'M', 'Q'])
    expect([...insieme((c) => c.modi)].sort()).toEqual(['alfanumerico', 'byte', 'kanji', 'numerico'])
  })

  it('copre versioni piccole, medie e grandi, e i tre scaglioni del conteggio', () => {
    const versioni = casi.map((/** @type {{versione:number}} */ c) => c.versione)
    expect(Math.min(...versioni)).toBe(1)
    expect(Math.max(...versioni)).toBe(40)
    // gli scaglioni dei bit di conteggio: 1-9, 10-26, 27-40
    for (const [da, a] of [[1, 9], [10, 26], [27, 40]]) {
      expect(versioni.some((/** @type {number} */ v) => v >= da && v <= a)).toBe(true)
    }
    // e la versione 32, l'unica irregolarità nel passo dei pattern di allineamento
    expect(versioni).toContain(32)
  })
})

describe('lotto B2 — moduli, i segmenti', () => {
  it('decodifica numerico, alfanumerico e byte in fila nello stesso codice', () => {
    expect(testoDa(griglia(caso('multi-segmento')))).toBe('20241PUNTI FERITA rimasti: 7')
  })

  it('legge come UTF-8 i byte che lo sono, anche senza ECI dichiarato', () => {
    expect(testoDa(griglia(caso('utf8-senza-eci')))).toBe('àèìòù — «Ozymandias» 🐉')
  })

  it('ripiega su ISO-8859-1 quando i byte non sono UTF-8 valido', () => {
    expect(testoDa(griglia(caso('v2-L-accenti-latin1')))).toBe('perché è così: né più né meno')
  })

  it('rispetta ECI 26 (UTF-8) ed ECI 3 (ISO-8859-1)', () => {
    expect(testoDa(griglia(caso('eci-26-utf8')))).toBe('così è: il mago è caduto 🎲')
    expect(testoDa(griglia(caso('eci-3-latin1')))).toBe('perché però città')
  })

  it('unisce i segmenti byte adiacenti prima di decodificare', () => {
    // 'è' sta a cavallo dei due segmenti: decodificarli separatamente darebbe
    // due caratteri di sostituzione al posto di uno solo giusto.
    expect(testoDa(griglia(caso('byte-spezzato')))).toBe('mezzo è mezzo')
  })

  it('restituisce stringa vuota, non null, per un codice senza contenuto', () => {
    expect(testoDa(griglia(caso('vuoto')))).toBe('')
    expect(testoDa(griglia(caso('vuoto-segmento-byte')))).toBe('')
  })

  it('non esplode sul Kanji: consuma i bit e mette un segnaposto per carattere', () => {
    expect(testoDa(griglia(caso('kanji-segnaposto')))).toBe('���')
  })

  it('attraversa append strutturato, FNC1 ed ECI in forma lunga', () => {
    expect(testoDa(griglia(caso('append-strutturato')))).toBe('primo pezzo')
    expect(testoDa(griglia(caso('fnc1-prima-posizione')))).toBe('0110012345678')
    expect(testoDa(griglia(caso('fnc1-seconda-posizione')))).toBe('lotto A1')
    expect(testoDa(griglia(caso('eci-lungo-899')))).toBe('sconosciuto')
  })

  it.each(nulli.map((/** @type {{nome:string}} */ c) => [c.nome, c]))(
    'rifiuta il flusso malformato: %s', (_nome, c) => {
      expect(testoDa(griglia(c))).toBeNull()
    })
})

describe('lotto B2 — moduli, la correzione d’errore', () => {
  it('corregge davvero: entro la capacità il testo esce giusto', () => {
    // Le soglie sono misurate, non dedotte: sotto questi numeri tutti i semi
    // provati tornano il testo esatto.
    for (const [nome, quanti] of [['v1-H-byte', 12], ['maschera-0', 22], ['v10-M-byte', 44], ['v40-H-byte', 400]]) {
      const c = caso(nome)
      const base = griglia(c)
      for (let s = 1; s <= 8; s++) {
        expect(testoDa(sporca(base, Number(quanti), s * 7919))).toBe(c.testo)
      }
    }
  })

  it('oltre la capacità restituisce null, non spazzatura', () => {
    for (const [nome, quanti] of [['v1-H-byte', 60], ['maschera-0', 120], ['v10-M-byte', 400], ['v40-H-byte', 4000]]) {
      const base = griglia(caso(nome))
      for (let s = 1; s <= 8; s++) {
        expect(testoDa(sporca(base, Number(quanti), s * 104729))).toBeNull()
      }
    }
  })

  it('non inventa mai un testo diverso, per quanto sporca sia la griglia', () => {
    // La proprietà che conta davvero: o è il testo giusto, o è null. Mai altro.
    let corretti = 0
    let rifiutati = 0
    for (const c of casi) {
      const n = c.versione * 4 + 17
      if (n > 100) continue // le versioni grandi le prova il caso qui sopra
      const base = griglia(c)
      for (let s = 0; s < 40; s++) {
        // fino al 6% dei moduli: abbastanza da far cadere spesso la correzione,
        // abbastanza poco da farla riuscire spesso. Le due metà servono
        // entrambe, ed è per questo che sotto si contano tutte e due.
        const quanti = 1 + ((rng(s * 31 + n)() * n * n * 0.06) | 0)
        const t = testoDa(sporca(base, quanti, s * 104729 + n))
        if (t === null) rifiutati++
        else {
          expect(t).toBe(c.testo)
          corretti++
        }
      }
    }
    expect(corretti).toBeGreaterThan(50)
    expect(rifiutati).toBeGreaterThan(50)
  })

  it('recupera l’informazione di formato da una copia rovinata usando l’altra', () => {
    const c = caso('v7-L-byte')
    const n = c.versione * 4 + 17
    const base = griglia(c)
    /** @type {[number, number][]} */
    const copia1 = []
    for (let i = 0; i <= 5; i++) copia1.push([i, 8])
    copia1.push([7, 8], [8, 8], [8, 7])
    for (let i = 9; i <= 14; i++) copia1.push([8, 14 - i])
    /** @type {[number, number][]} */
    const copia2 = []
    for (let i = 0; i <= 7; i++) copia2.push([8, n - 1 - i])
    for (let i = 8; i <= 14; i++) copia2.push([n - 15 + i, 8])

    const inverti = (/** @type {[number,number][]} */ celle) => {
      const g = base.map((r) => r.slice())
      for (const [r, cc] of celle) g[r][cc] = !g[r][cc]
      return g
    }
    // una copia distrutta: la correzione BCH fallisce su quella, e si passa
    // all'altra senza che il chiamante se ne accorga
    expect(testoDa(inverti(copia1))).toBe(c.testo)
    expect(testoDa(inverti(copia2))).toBe(c.testo)
    // tutte e due: qui non c'è più niente da fare
    expect(testoDa(inverti([...copia1, ...copia2]))).toBeNull()
  })

  it('crede alla dimensione della griglia, ma non se i 18 bit la smentiscono', () => {
    const c = caso('v7-L-byte')
    const n = c.versione * 4 + 17
    /** @param {number} v */
    const bch = (v) => {
      let r = v << 12
      for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12)
      return ((v << 12) | r) & 0x3ffff
    }
    /** @param {(i:number)=>boolean} valore */
    const riscrivi = (valore) => {
      const g = griglia(c).map((r) => r.slice())
      for (let i = 0; i < 18; i++) {
        const a = n - 11 + (i % 3)
        const b = Math.floor(i / 3)
        g[b][a] = valore(i)
        g[a][b] = valore(i)
      }
      return g
    }
    // illeggibile su tutte e due le copie: la dimensione basta
    expect(testoDa(riscrivi(() => false))).toBe(c.testo)
    // leggibile ma discorde: vuol dire che la griglia non è quella che crediamo
    expect(testoDa(riscrivi((i) => ((bch(12) >> i) & 1) === 1))).toBeNull()
  })
})

describe('lotto B2 — moduli, gli ingressi che non sono un codice', () => {
  it('non lancia mai e restituisce null', () => {
    /** @type {boolean[][][]} */
    const brutti = [
      [],
      [[]],
      [[true, false], [false, true]],
      Array.from({ length: 20 }, () => new Array(20).fill(false)), // 20 non è 4v+17
      Array.from({ length: 21 }, () => new Array(21).fill(false)),
      Array.from({ length: 21 }, () => new Array(21).fill(true)),
      Array.from({ length: 25 }, (_, i) => new Array(i === 3 ? 24 : 25).fill(false)), // riga corta
      Array.from({ length: 177 }, () => new Array(177).fill(false)),
    ]
    for (const m of brutti) {
      expect(() => testoDa(m)).not.toThrow()
      expect(testoDa(m)).toBeNull()
    }
  })

  it('rifiuta il rumore puro invece di leggerci dentro qualcosa', () => {
    for (let s = 0; s < 60; s++) {
      const r = rng(s + 1)
      const n = 25
      const m = Array.from({ length: n }, () => Array.from({ length: n }, () => r() < 0.5))
      expect(testoDa(m)).toBeNull()
    }
  })
})
