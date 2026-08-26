/**
 * Immagini di prova per il lettore di QR.
 *
 * Un test che disegna il codice perfetto, dritto e nitido, non dice niente:
 * quel caso funziona sempre. Qui si costruisce il fotogramma come esce da una
 * telecamera — storto, prospettico, sfocato, rumoroso, con poco contrasto,
 * magari bianco su nero e in un angolo dell'inquadratura.
 *
 * Il disegno passa da un'omografia: i quattro angoli del quadrato «codice +
 * quiet zone» si piazzano dove si vuole nel fotogramma, e per ogni pixel si
 * torna indietro a chiedere che modulo c'è. Così rotazione, scala e
 * prospettiva sono lo stesso meccanismo, e l'antialiasing viene gratis dal
 * supercampionamento.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import qrcode from 'qrcode-generator'

const QUI = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(QUI, '..', 'fixtures', 'qr')

/**
 * @param {string} nome  senza estensione, es. 'lucian'
 * @returns {boolean[][]}
 */
export function matriceFixture(nome) {
  const testo = readFileSync(join(FIXTURE, `${nome}.matrice.txt`), 'utf8')
  return daTesto(testo)
}

/**
 * @param {string} testo  righe di `#` e `.`
 * @returns {boolean[][]}
 */
export function daTesto(testo) {
  return testo
    .split('\n')
    .map(r => r.trim())
    .filter(r => r.length > 0)
    .map(r => [...r].map(ch => ch === '#'))
}

/**
 * @param {boolean[][]} m
 * @returns {string}
 */
export function aTesto(m) {
  return m.map(r => r.map(v => (v ? '#' : '.')).join('')).join('\n')
}

/**
 * Una matrice di riferimento a una versione qualsiasi.
 * @param {number} versione  1..40
 * @param {string} contenuto
 * @returns {boolean[][]}
 */
export function matriceGenerata(versione, contenuto) {
  const c = qrcode(versione, 'M')
  c.addData(contenuto)
  c.make()
  const n = c.getModuleCount()
  const out = []
  for (let r = 0; r < n; r++) {
    const riga = []
    for (let k = 0; k < n; k++) riga.push(c.isDark(r, k))
    out.push(riga)
  }
  return out
}

/**
 * @typedef {object} Opzioni
 * @property {number} [scala]        pixel per modulo (default 4)
 * @property {number} [quiet]        moduli di quiet zone (default 4)
 * @property {number} [larghezza]    fotogramma; default = riquadro del codice
 * @property {number} [altezza]
 * @property {number} [x]            angolo alto-sinistra del codice nel fotogramma
 * @property {number} [y]
 * @property {number} [rotazione]    radianti
 * @property {number[]} [prospettiva] otto scarti (TL,TR,BR,BL) in frazioni di lato
 * @property {number} [sfocatura]    sigma in pixel
 * @property {number} [rumore]       deviazione standard in livelli
 * @property {number} [chiaro]       livello del bianco (default 255)
 * @property {number} [scuro]        livello del nero (default 0)
 * @property {boolean} [inverti]     codice chiaro su fondo scuro
 * @property {number} [sfondo]       livello fuori dal codice (default: chiaro)
 * @property {number} [seme]         per il rumore, così il test è ripetibile
 * @property {number} [super]        lato del supercampionamento (default 3)
 */

/**
 * @param {boolean[][]} matrice
 * @param {Opzioni} [opz]
 * @returns {{dati: Uint8ClampedArray, larghezza: number, altezza: number}}
 */
export function disegna(matrice, opz = {}) {
  const n = matrice.length
  const scala = opz.scala ?? 4
  const quiet = opz.quiet ?? 4
  const lato = (n + 2 * quiet) * scala
  const ss = opz.super ?? 3
  const chiaro = opz.chiaro ?? 255
  const scuro = opz.scuro ?? 0

  // i quattro angoli, prima dritti, poi ruotati, poi deformati
  const rot = opz.rotazione ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  /** @type {number[][]} */
  const ang = [[0, 0], [lato, 0], [lato, lato], [0, lato]].map(([px, py]) => {
    const dx = /** @type {number} */ (px) - lato / 2
    const dy = /** @type {number} */ (py) - lato / 2
    return [lato / 2 + dx * cos - dy * sin, lato / 2 + dx * sin + dy * cos]
  })
  const pro = opz.prospettiva
  if (pro) {
    for (let i = 0; i < 4; i++) {
      const a = /** @type {number[]} */ (ang[i])
      a[0] = /** @type {number} */ (a[0]) + (pro[i * 2] ?? 0) * lato
      a[1] = /** @type {number} */ (a[1]) + (pro[i * 2 + 1] ?? 0) * lato
    }
  }

  // riquadro effettivo, per dimensionare il fotogramma quando non è imposto
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const a of ang) {
    minX = Math.min(minX, /** @type {number} */ (a[0]))
    minY = Math.min(minY, /** @type {number} */ (a[1]))
    maxX = Math.max(maxX, /** @type {number} */ (a[0]))
    maxY = Math.max(maxY, /** @type {number} */ (a[1]))
  }
  const larghezza = Math.max(1, Math.round(opz.larghezza ?? Math.ceil(maxX - minX)))
  const altezza = Math.max(1, Math.round(opz.altezza ?? Math.ceil(maxY - minY)))
  const ox = (opz.x ?? 0) - minX
  const oy = (opz.y ?? 0) - minY
  for (const a of ang) {
    a[0] = /** @type {number} */ (a[0]) + ox
    a[1] = /** @type {number} */ (a[1]) + oy
  }

  const h = inversa(quadratoAQuad(ang))
  const grigi = new Float64Array(larghezza * altezza)
  const sfondo = opz.sfondo ?? chiaro
  const passo = 1 / ss
  const mezzo = passo / 2

  for (let py = 0; py < altezza; py++) {
    for (let px = 0; px < larghezza; px++) {
      let somma = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = px + mezzo + sx * passo
          const fy = py + mezzo + sy * passo
          const den = h[6] * fx + h[7] * fy + h[8]
          const u = (h[0] * fx + h[1] * fy + h[2]) / den
          const v = (h[3] * fx + h[4] * fy + h[5]) / den
          if (u < 0 || v < 0 || u >= 1 || v >= 1) { somma += sfondo; continue }
          const col = Math.floor(u * (n + 2 * quiet)) - quiet
          const rig = Math.floor(v * (n + 2 * quiet)) - quiet
          if (col < 0 || rig < 0 || col >= n || rig >= n) { somma += chiaro; continue }
          somma += /** @type {boolean[]} */ (matrice[rig])[col] ? scuro : chiaro
        }
      }
      grigi[py * larghezza + px] = somma / (ss * ss)
    }
  }

  if (opz.sfocatura) sfoca(grigi, larghezza, altezza, opz.sfocatura)
  if (opz.rumore) rumoreggia(grigi, opz.rumore, opz.seme ?? 7)

  const dati = new Uint8ClampedArray(larghezza * altezza * 4)
  const inv = opz.inverti === true
  for (let i = 0, j = 0; i < grigi.length; i++, j += 4) {
    let v = /** @type {number} */ (grigi[i])
    if (inv) v = 255 - v
    dati[j] = v
    dati[j + 1] = v
    dati[j + 2] = v
    dati[j + 3] = 255
  }
  return { dati, larghezza, altezza }
}

/**
 * Un fotogramma senza niente dentro: solo un fondo con del rumore.
 * @param {number} larghezza @param {number} altezza
 * @param {number} [livello] @param {number} [rumore] @param {number} [seme]
 * @returns {{dati: Uint8ClampedArray, larghezza: number, altezza: number}}
 */
export function fotogrammaVuoto(larghezza, altezza, livello = 200, rumore = 12, seme = 3) {
  const grigi = new Float64Array(larghezza * altezza).fill(livello)
  if (rumore) rumoreggia(grigi, rumore, seme)
  const dati = new Uint8ClampedArray(larghezza * altezza * 4)
  for (let i = 0, j = 0; i < grigi.length; i++, j += 4) {
    const v = /** @type {number} */ (grigi[i])
    dati[j] = v
    dati[j + 1] = v
    dati[j + 2] = v
    dati[j + 3] = 255
  }
  return { dati, larghezza, altezza }
}

/**
 * Un fotogramma con dentro qualcosa che *somiglia* a un finder pattern —
 * quadrati concentrici nelle proporzioni giuste — ma non è un QR.
 * @param {number} larghezza @param {number} altezza
 * @param {number} [scala]
 * @returns {{dati: Uint8ClampedArray, larghezza: number, altezza: number}}
 */
export function fintiFinder(larghezza, altezza, scala = 6) {
  const grigi = new Float64Array(larghezza * altezza).fill(255)
  const posti = [[40, 40], [larghezza - 40 - 7 * scala, 40], [40, altezza - 40 - 7 * scala]]
  for (const p of posti) {
    const px = /** @type {number} */ (p[0])
    const py = /** @type {number} */ (p[1])
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const bordo = r === 0 || c === 0 || r === 6 || c === 6
        const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4
        if (!bordo && !centro) continue
        for (let y = 0; y < scala; y++) {
          for (let x = 0; x < scala; x++) {
            const gy = py + r * scala + y
            const gx = px + c * scala + x
            if (gx < 0 || gy < 0 || gx >= larghezza || gy >= altezza) continue
            grigi[gy * larghezza + gx] = 0
          }
        }
      }
    }
  }
  const dati = new Uint8ClampedArray(larghezza * altezza * 4)
  for (let i = 0, j = 0; i < grigi.length; i++, j += 4) {
    const v = /** @type {number} */ (grigi[i])
    dati[j] = v
    dati[j + 1] = v
    dati[j + 2] = v
    dati[j + 3] = 255
  }
  return { dati, larghezza, altezza }
}

/* ------------------------------------------------------------------ */

/**
 * @param {Float64Array} g @param {number} w @param {number} h @param {number} sigma
 */
function sfoca(g, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5))
  const k = new Float64Array(2 * r + 1)
  let somma = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + r] = v
    somma += v
  }
  for (let i = 0; i < k.length; i++) k[i] = /** @type {number} */ (k[i]) / somma
  const tmp = new Float64Array(g.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i))
        acc += /** @type {number} */ (g[y * w + xx]) * /** @type {number} */ (k[i + r])
      }
      tmp[y * w + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i))
        acc += /** @type {number} */ (tmp[yy * w + x]) * /** @type {number} */ (k[i + r])
      }
      g[y * w + x] = acc
    }
  }
}

/**
 * @param {Float64Array} g @param {number} sigma @param {number} seme
 */
function rumoreggia(g, sigma, seme) {
  let s = seme >>> 0 || 1
  const casuale = () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
  for (let i = 0; i < g.length; i++) {
    // Box–Muller, così il rumore è gaussiano come quello di un sensore
    const u = Math.max(1e-9, casuale())
    const v = casuale()
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    g[i] = Math.min(255, Math.max(0, /** @type {number} */ (g[i]) + n * sigma))
  }
}

/**
 * Omografia dal quadrato unitario ai quattro angoli dati.
 * @param {number[][]} a  quattro punti, in ordine TL, TR, BR, BL
 * @returns {number[]} nove coefficienti per righe
 */
function quadratoAQuad(a) {
  const p = (/** @type {number} */ i, /** @type {number} */ j) =>
    /** @type {number} */ (/** @type {number[]} */ (a[i])[j])
  const x0 = p(0, 0), y0 = p(0, 1)
  const x1 = p(1, 0), y1 = p(1, 1)
  const x2 = p(2, 0), y2 = p(2, 1)
  const x3 = p(3, 0), y3 = p(3, 1)
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]
  }
  const den = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / den
  const k = (dx1 * dy3 - dx3 * dy1) / den
  return [
    x1 - x0 + g * x1, x3 - x0 + k * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + k * y3, y0,
    g, k, 1,
  ]
}

/**
 * @param {number[]} m nove coefficienti
 * @returns {number[]}
 */
function inversa(m) {
  const c = (/** @type {number} */ i) => /** @type {number} */ (m[i])
  return [
    c(4) * c(8) - c(5) * c(7), c(2) * c(7) - c(1) * c(8), c(1) * c(5) - c(2) * c(4),
    c(5) * c(6) - c(3) * c(8), c(0) * c(8) - c(2) * c(6), c(2) * c(3) - c(0) * c(5),
    c(3) * c(7) - c(4) * c(6), c(1) * c(6) - c(0) * c(7), c(0) * c(4) - c(1) * c(3),
  ]
}
