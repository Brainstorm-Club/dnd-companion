/**
 * Dal fotogramma alla griglia dei moduli.
 *
 * Il percorso è quello che fanno tutti i lettori, e per buone ragioni:
 * luminanza, soglia locale a blocchi, i tre finder pattern trovati dal
 * rapporto 1:1:3:1:1, l'omografia sui quattro angoli, un campione al centro
 * di ogni modulo. Qui è scritto per girare su un telefono a ogni fotogramma:
 * array tipizzati, un solo buffer, nessuna allocazione dentro i cicli caldi.
 *
 * Niente stato di modulo: il buffer nasce e muore dentro la chiamata, così
 * `matriceDa` resta rientrante anche dentro un worker o due telecamere.
 */

/** Lato del blocco su cui si calcola la soglia. Otto pixel è il compromesso
 *  classico: abbastanza piccolo da seguire l'ombra di una mano sul tavolo,
 *  abbastanza grande da contenere quasi sempre sia inchiostro sia carta. */
const BLOCCO = 8

/** Sotto questo salto di luminanza il blocco è tutto carta o tutto
 *  inchiostro: la sua media non dice niente e va chiesta ai vicini. */
const GAMMA_MINIMA = 24

/** Raggio, in blocchi, su cui si media la soglia. */
const RAGGIO = 2

const DIM_MIN = 21
const DIM_MAX = 177

/** Oltre questi candidati il fotogramma è rumore, non un codice. */
const MAX_CANDIDATI = 64

/** Quota massima di moduli sbagliati fra finder e temporizzazioni prima di
 *  dichiarare che la griglia non è quella giusta. Una foto rovinata ne
 *  sbaglia qualcuno; una griglia storta li sbaglia quasi tutti. */
const SOGLIA_STRUTTURA = 0.12

/** Quanti finder tenere in gioco quando se ne trovano troppi: la terna si
 *  cerca a forza bruta, e la forza bruta cresce col cubo. */
const MAX_TERNA = 9

/**
 * @typedef {object} Centro
 * @property {number} x
 * @property {number} y
 * @property {number} m   dimensione del modulo stimata sulle righe
 * @property {number} n   quante righe l'hanno confermato
 * @property {number} pol 1 = codice scuro su chiaro, 0 = chiaro su scuro
 */

/**
 * @typedef {object} Omografia
 * @property {number} a11 @property {number} a12 @property {number} a13
 * @property {number} a21 @property {number} a22 @property {number} a23
 * @property {number} a31 @property {number} a32 @property {number} a33
 */

/**
 * @param {Uint8ClampedArray} dati   RGBA, come da ImageData
 * @param {number} larghezza
 * @param {number} altezza
 * @returns {boolean[][]|null}       matrice[riga][colonna], true = scuro,
 *                                   quadrata, senza quiet zone; null se non
 *                                   si trova un codice
 */
export function matriceDa(dati, larghezza, altezza) {
  // Chi chiama macina fotogrammi in tempo reale e la maggior parte non
  // contiene niente: qualunque inciampo vale `null`, mai un'eccezione.
  try {
    const w = larghezza | 0
    const h = altezza | 0
    if (!dati || w < DIM_MIN || h < DIM_MIN || dati.length < w * h * 4) return null

    const { g, medio } = luminanza(dati, w, h)
    binarizza(g, w, h, medio)

    /** @type {Centro[]} */
    const candidati = []
    cercaFinder(g, w, h, candidati)
    if (candidati.length < 3) return null

    // Le due polarità si raccolgono nella stessa passata (una finestra di
    // cinque tratti è 1:1:3:1:1 comunque parta), ma si decodificano a turno.
    let scuri = 0
    let chiari = 0
    for (const c of candidati) {
      if (c.n < 2) continue
      if (c.pol === 1) scuri++
      else chiari++
    }
    const ordine = scuri >= chiari ? [1, 0] : [0, 1]
    for (const pol of ordine) {
      const m = decodificaGriglia(g, w, h, candidati, pol)
      if (m) return m
    }
    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Luminanza e soglia
 * ------------------------------------------------------------------ */

/**
 * @param {Uint8ClampedArray} dati
 * @param {number} w
 * @param {number} h
 * @returns {{g: Uint8Array, medio: number}}
 */
function luminanza(dati, w, h) {
  const n = w * h
  const g = new Uint8Array(n)
  let mn = 255
  let mx = 0
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = /** @type {number} */ (dati[j])
    const v = /** @type {number} */ (dati[j + 1])
    const b = /** @type {number} */ (dati[j + 2])
    const y = (r * 77 + v * 151 + b * 28) >> 8
    if (y < mn) mn = y
    if (y > mx) mx = y
    g[i] = y
  }
  // il livello a metà fra il pixel più scuro e il più chiaro serve ai blocchi
  // senza contrasto, che da soli non saprebbero dire da che parte stanno
  return { g, medio: (mn + mx) / 2 }
}

/**
 * Soglia locale, blocco per blocco, poi lisciata sui blocchi vicini: una
 * soglia globale non sopravvive a una foto con mezzo codice in ombra.
 *
 * Scrive **dentro** `g`, e può farlo perché le medie sono tutte calcolate
 * prima che si scriva un solo pixel, e ogni pixel appartiene a un blocco solo.
 * @param {Uint8Array} g
 * @param {number} w
 * @param {number} h
 * @param {number} medio
 */
function binarizza(g, w, h, medio) {
  const bw = Math.max(1, Math.ceil(w / BLOCCO))
  const bh = Math.max(1, Math.ceil(h / BLOCCO))
  const punti = new Int32Array(bw * bh)

  for (let by = 0; by < bh; by++) {
    const y0 = Math.min(by * BLOCCO, h - BLOCCO)
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.min(bx * BLOCCO, w - BLOCCO)
      let somma = 0
      let mn = 255
      let mx = 0
      for (let y = 0; y < BLOCCO; y++) {
        const base = (y0 + y) * w + x0
        for (let x = 0; x < BLOCCO; x++) {
          const v = /** @type {number} */ (g[base + x])
          somma += v
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
      }
      let media = somma >> 6
      if (mx - mn <= GAMMA_MINIMA) {
        // Un blocco tutto uguale non sa dove sia la propria soglia: la
        // eredita dai vicini, o in mancanza dal livello medio del
        // fotogramma. Il classico `min/2` di ZXing dà per scontato che il
        // nero sia vicino a zero, e su una foto poco contrastata (grigi fra
        // 95 e 150) finirebbe sotto l'inchiostro, dichiarando bianco tutto.
        media = medio
        if (by > 0 && bx > 0) {
          const su = /** @type {number} */ (punti[(by - 1) * bw + bx])
          const sx = /** @type {number} */ (punti[by * bw + bx - 1])
          const diag = /** @type {number} */ (punti[(by - 1) * bw + bx - 1])
          media = (su + 2 * sx + diag) >> 2
        }
        // qualunque soglia erediti, il blocco non si ribalta: se è tutto più
        // chiaro della media generale è carta, se è tutto più scuro è segno
        if (mn > medio) media = Math.min(media, mn - 1)
        else if (mx < medio) media = Math.max(media, mx)
      }
      punti[by * bw + bx] = media
    }
  }

  for (let by = 0; by < bh; by++) {
    const j0 = Math.max(0, by - RAGGIO)
    const j1 = Math.min(bh - 1, by + RAGGIO)
    const y0 = by * BLOCCO
    const y1 = Math.min(y0 + BLOCCO, h)
    for (let bx = 0; bx < bw; bx++) {
      const i0 = Math.max(0, bx - RAGGIO)
      const i1 = Math.min(bw - 1, bx + RAGGIO)
      let somma = 0
      let quanti = 0
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          somma += /** @type {number} */ (punti[j * bw + i])
          quanti++
        }
      }
      const soglia = somma / quanti
      const x0 = bx * BLOCCO
      const x1 = Math.min(x0 + BLOCCO, w)
      for (let y = y0; y < y1; y++) {
        const base = y * w
        for (let x = x0; x < x1; x++) {
          g[base + x] = /** @type {number} */ (g[base + x]) <= soglia ? 1 : 0
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Finder pattern
 * ------------------------------------------------------------------ */

/**
 * @param {number} r0 @param {number} r1 @param {number} r2
 * @param {number} r3 @param {number} r4
 * @returns {boolean}
 */
function rapportoOk(r0, r1, r2, r3, r4) {
  const somma = r0 + r1 + r2 + r3 + r4
  if (somma < 7) return false
  const m = somma / 7
  const v = m / 2
  return (
    Math.abs(m - r0) < v &&
    Math.abs(m - r1) < v &&
    Math.abs(3 * m - r2) < 3 * v &&
    Math.abs(m - r3) < v &&
    Math.abs(m - r4) < v
  )
}

/**
 * I cinque tratti 1:1:3:1:1 lungo una direzione qualsiasi passando per
 * (x, y). Il conteggio è in *passi*, non in pixel: anche in diagonale un
 * modulo largo m costa m passi, quindi il rapporto vale identico.
 *
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} x @param {number} y
 * @param {number} dx @param {number} dy
 * @param {number} centrale  colore atteso del tratto di mezzo (0 o 1)
 * @param {number} totale    somma dei cinque tratti già misurata altrove
 * @param {boolean} [libero] non confrontare la somma con `totale`
 * @returns {number} lo scarto del centro dal punto di partenza, o NaN
 */
function assePassante(g, w, h, x, y, dx, dy, centrale, totale, libero) {
  const m = totale / 7
  const capL = m * (libero ? 3.5 : 2.2) + 2
  const capC = m * (libero ? 7 : 5) + 2

  let i = x
  let j = y
  let a = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] === centrale) {
    if (++a > capC) return NaN
    i -= dx
    j -= dy
  }
  if (a === 0) return NaN
  let r1 = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] !== centrale) {
    if (++r1 > capL) return NaN
    i -= dx
    j -= dy
  }
  if (r1 === 0) return NaN
  let r0 = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] === centrale) {
    if (++r0 > capL) return NaN
    i -= dx
    j -= dy
  }
  if (r0 === 0) return NaN

  i = x + dx
  j = y + dy
  let b = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] === centrale) {
    if (++b > capC) return NaN
    i += dx
    j += dy
  }
  let r3 = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] !== centrale) {
    if (++r3 > capL) return NaN
    i += dx
    j += dy
  }
  if (r3 === 0) return NaN
  let r4 = 0
  while (i >= 0 && j >= 0 && i < w && j < h && g[j * w + i] === centrale) {
    if (++r4 > capL) return NaN
    i += dx
    j += dy
  }
  if (r4 === 0) return NaN

  const r2 = a + b
  const somma = r0 + r1 + r2 + r3 + r4
  if (!libero && Math.abs(somma - totale) * 5 >= totale * 2) return NaN
  if (!rapportoOk(r0, r1, r2, r3, r4)) return NaN
  return (b - a + 2) / 2
}

/**
 * @param {Centro[]} lista
 * @param {number} x @param {number} y @param {number} m @param {number} pol
 */
function aggiungiCentro(lista, x, y, m, pol) {
  for (const c of lista) {
    if (c.pol !== pol) continue
    if (Math.abs(x - c.x) > c.m || Math.abs(y - c.y) > c.m) continue
    if (Math.abs(m - c.m) > Math.max(1, c.m * 0.5)) continue
    const n = c.n + 1
    c.x = (c.x * c.n + x) / n
    c.y = (c.y * c.n + y) / n
    c.m = (c.m * c.n + m) / n
    c.n = n
    return
  }
  if (lista.length < MAX_CANDIDATI) lista.push({ x, y, m, n: 1, pol })
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} cx @param {number} cy
 * @param {number} totale @param {number} centrale
 * @param {Centro[]} lista
 */
function forseCentro(g, w, h, cx, cy, totale, centrale, lista) {
  const xi = Math.floor(cx)
  if (xi < 0 || xi >= w) return

  const dv = assePassante(g, w, h, xi, cy, 0, 1, centrale, totale)
  if (Number.isNaN(dv)) return
  const y = cy + dv
  const yi = Math.floor(y)
  if (yi < 0 || yi >= h) return

  const dh = assePassante(g, w, h, xi, yi, 1, 0, centrale, totale)
  if (Number.isNaN(dh)) return
  const x = xi + dh
  const xj = Math.floor(x)
  if (xj < 0 || xj >= w) return

  // Le due diagonali costano poco e buttano via quasi tutti i falsi
  // positivi: un rettangolo di rumore regge una riga, non quattro assi.
  //
  // La loro somma però non si confronta con quella della riga: qui i tratti
  // si contano in passi, e su un codice ruotato di 45° la diagonale
  // attraversa il finder in metà passi rispetto all'orizzontale. Il rapporto
  // 1:1:3:1:1 regge lo stesso — è quello che conta — la somma no.
  if (Number.isNaN(assePassante(g, w, h, xj, yi, 1, 1, centrale, totale, true))) return
  if (Number.isNaN(assePassante(g, w, h, xj, yi, 1, -1, centrale, totale, true))) return

  aggiungiCentro(lista, x, y, totale / 7, centrale)
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {Centro[]} lista
 */
function cercaFinder(g, w, h, lista) {
  const salto = Math.max(1, Math.min(3, Math.round(h / 320)))
  for (let y = 0; y < h; y += salto) {
    const base = y * w
    let a0 = 0
    let a1 = 0
    let a2 = 0
    let a3 = 0
    let a4 = 0
    let quanti = 0
    let colore = /** @type {number} */ (g[base])
    let lung = 1
    for (let x = 1; x <= w; x++) {
      const v = x < w ? /** @type {number} */ (g[base + x]) : -1
      if (v === colore) {
        lung++
        continue
      }
      a0 = a1
      a1 = a2
      a2 = a3
      a3 = a4
      a4 = lung
      quanti++
      // I tratti si alternano: a4 e a2 hanno per forza lo stesso colore,
      // che è quello del tratto appena chiuso. Da lì la polarità, gratis.
      if (quanti >= 5 && rapportoOk(a0, a1, a2, a3, a4)) {
        const cx = x - a4 - a3 - a2 / 2
        forseCentro(g, w, h, cx, y, a0 + a1 + a2 + a3 + a4, colore, lista)
      }
      colore = v
      lung = 1
    }
  }
}

/* ------------------------------------------------------------------ *
 * Geometria della terna
 * ------------------------------------------------------------------ */

/**
 * @param {Centro} a @param {Centro} b
 * @returns {number}
 */
function distanza(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * La terna che somiglia di più a tre angoli di un quadrato: moduli
 * confrontabili, un angolo retto, due cateti simili.
 * @param {Centro[]} cand
 * @returns {[Centro, Centro, Centro]|null}
 */
function scegliTerna(cand) {
  if (cand.length < 3) return null
  const pool = cand.length <= MAX_TERNA
    ? cand
    : [...cand].sort((p, q) => q.n - p.n).slice(0, MAX_TERNA)

  /** @type {[Centro, Centro, Centro]|null} */
  let migliore = null
  let punteggio = Infinity
  for (let i = 0; i < pool.length - 2; i++) {
    for (let j = i + 1; j < pool.length - 1; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const a = /** @type {Centro} */ (pool[i])
        const b = /** @type {Centro} */ (pool[j])
        const c = /** @type {Centro} */ (pool[k])
        const mMin = Math.min(a.m, b.m, c.m)
        const mMax = Math.max(a.m, b.m, c.m)
        if (mMin <= 0 || mMax / mMin > 1.7) continue

        const dab = distanza(a, b)
        const dbc = distanza(b, c)
        const dca = distanza(c, a)
        // l'ipotenusa è il lato più lungo; l'angolo è il vertice opposto
        let ipo = dab
        let l1 = dbc
        let l2 = dca
        if (dbc > ipo) { ipo = dbc; l1 = dca; l2 = dab }
        if (dca > ipo) { ipo = dca; l1 = dab; l2 = dbc }
        if (ipo <= 0) continue

        const simmetria = Math.min(l1, l2) / Math.max(l1, l2)
        if (simmetria < 0.62) continue
        const retto = Math.abs(l1 * l1 + l2 * l2 - ipo * ipo) / (ipo * ipo)
        if (retto > 0.42) continue
        const moduli = (l1 + l2) / 2 / ((a.m + b.m + c.m) / 3)
        if (moduli < 10 || moduli > 230) continue

        const p = (1 - simmetria) + retto + (mMax / mMin - 1) - 0.01 * (a.n + b.n + c.n)
        if (p < punteggio) {
          punteggio = p
          migliore = [a, b, c]
        }
      }
    }
  }
  return migliore
}

/**
 * Chi è l'angolo, chi è in alto a destra, chi in basso a sinistra. Da qui
 * esce anche la rotazione: non serve dedurla a parte, sta nei tre punti.
 * @param {[Centro, Centro, Centro]} t
 * @returns {{tl: Centro, tr: Centro, bl: Centro}}
 */
function ordinaTerna(t) {
  const [a, b, c] = t
  const dab = distanza(a, b)
  const dbc = distanza(b, c)
  const dca = distanza(c, a)
  let tl = c
  let p = a
  let q = b
  if (dbc >= dab && dbc >= dca) { tl = a; p = b; q = c }
  else if (dca >= dab && dca >= dbc) { tl = b; p = c; q = a }

  // con l'asse y verso il basso, il prodotto vettoriale positivo vuol dire
  // che `p` sta in alto a destra e `q` in basso a sinistra
  const cr = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x)
  return cr > 0 ? { tl, tr: p, bl: q } : { tl, tr: q, bl: p }
}

/**
 * Larghezza del tratto scuro-chiaro-scuro attraversato partendo dal centro
 * di un finder verso un altro: sono 3,5 moduli, misurati dove il codice è
 * per definizione regolare.
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} x0 @param {number} y0
 * @param {number} x1 @param {number} y1
 * @param {number} pol
 * @returns {number}
 */
function trattoDaCentro(g, w, h, x0, y0, x1, y1, pol) {
  const ripido = Math.abs(y1 - y0) > Math.abs(x1 - x0)
  let ax = x0
  let ay = y0
  let bx = x1
  let by = y1
  if (ripido) { ax = y0; ay = x0; bx = y1; by = x1 }
  const dx = Math.abs(bx - ax)
  const dy = Math.abs(by - ay)
  let errore = -dx / 2
  const px = ax < bx ? 1 : -1
  const py = ay < by ? 1 : -1
  let stato = 0
  const fine = bx + px
  let y = ay
  for (let x = ax; x !== fine; x += px) {
    const rx = ripido ? y : x
    const ry = ripido ? x : y
    if (rx < 0 || ry < 0 || rx >= w || ry >= h) break
    const scuro = g[ry * w + rx] === pol
    if ((stato === 1) === scuro) {
      if (stato === 2) {
        const ddx = x - ax
        const ddy = y - ay
        return Math.sqrt(ddx * ddx + ddy * ddy)
      }
      stato++
    }
    errore += dy
    if (errore > 0) {
      if (y === by) break
      y += py
      errore -= dx
    }
  }
  return NaN
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {Centro} a @param {Centro} b @param {number} pol
 * @returns {number}
 */
function moduloVerso(g, w, h, a, b, pol) {
  const ax = Math.floor(a.x)
  const ay = Math.floor(a.y)
  const bx = Math.floor(b.x)
  const by = Math.floor(b.y)
  let s1 = trattoDaCentro(g, w, h, ax, ay, bx, by, pol)
  let s2 = trattoDaCentro(g, w, h, ax, ay, 2 * ax - bx, 2 * ay - by, pol)
  let s3 = trattoDaCentro(g, w, h, bx, by, ax, ay, pol)
  let s4 = trattoDaCentro(g, w, h, bx, by, 2 * bx - ax, 2 * by - ay, pol)
  if (Number.isNaN(s1) || Number.isNaN(s2)) { s1 = NaN; s2 = NaN }
  if (Number.isNaN(s3) || Number.isNaN(s4)) { s3 = NaN; s4 = NaN }
  const parti = []
  if (!Number.isNaN(s1)) parti.push((s1 + s2 - 1) / 7)
  if (!Number.isNaN(s3)) parti.push((s3 + s4 - 1) / 7)
  if (!parti.length) return NaN
  return parti.reduce((s, v) => s + v, 0) / parti.length
}

/* ------------------------------------------------------------------ *
 * Dimensione: stima, e poi il conteggio della temporizzazione
 * ------------------------------------------------------------------ */

/**
 * @param {number} grezza
 * @returns {number} la dimensione valida più vicina, o 0 se fuori scala
 */
function dimensionePiuVicina(grezza) {
  const dim = 4 * Math.round((grezza - 21) / 4) + 21
  if (dim < DIM_MIN || dim > DIM_MAX) return 0
  return dim
}

/**
 * Conta i moduli lungo un pattern di temporizzazione. È l'unica misura
 * *esatta* che l'immagine offra: contare dà interi, stimare no, e su una
 * versione alta basta l'1% di errore sul modulo per sbagliare griglia.
 *
 * Ritorna la dimensione dedotta dal numero di transizioni, o 0 se il
 * percorso non somiglia a una temporizzazione (segno che ha sbandato).
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 * @param {number} pol
 * @returns {number}
 */
function dimensioneDaTemporizzazione(g, w, h, ax, ay, bx, by, pol) {
  const dx = bx - ax
  const dy = by - ay
  const lunghezza = Math.sqrt(dx * dx + dy * dy)
  if (!(lunghezza > 8)) return 0
  const passi = Math.ceil(lunghezza * 2)
  const sx = dx / passi
  const sy = dy / passi

  /** @type {number[]} */
  const tratti = []
  let precedente = -1
  let corrente = 0
  for (let i = 0; i <= passi; i++) {
    const x = Math.floor(ax + sx * i)
    const y = Math.floor(ay + sy * i)
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    const v = g[y * w + x] === pol ? 1 : 0
    if (v === precedente) { corrente++; continue }
    if (precedente >= 0) tratti.push(corrente)
    precedente = v
    corrente = 1
  }
  tratti.push(corrente)
  if (tratti.length < 6) return 0

  // se il percorso è uscito dalla riga di temporizzazione finisce nei dati,
  // e i dati non alternano regolari: i tratti interni se ne accorgono
  let fuori = 0
  for (let i = 2; i < tratti.length - 2; i++) {
    const vicini = (/** @type {number} */ (tratti[i - 1]) + /** @type {number} */ (tratti[i + 1])) / 2
    const r = /** @type {number} */ (tratti[i]) / vicini
    if (r < 0.5 || r > 1.9) fuori++
  }
  if (fuori > (tratti.length - 4) * 0.12) return 0

  const dim = tratti.length - 1 + 13
  if (dim < DIM_MIN || dim > DIM_MAX || (dim - 21) % 4 !== 0) return 0
  return dim
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {{tl: Centro, tr: Centro, bl: Centro}} q
 * @param {number} dim
 * @param {number} pol
 * @returns {number}
 */
function raffinaDimensione(g, w, h, q, dim, pol) {
  const { tl, tr, bl } = q
  const passo = dim - 7
  // tre moduli dal centro del finder alla riga 6: la si raggiunge con il
  // vettore verso l'altro angolo, riscalato sul modulo locale di ciascuno
  const gx = (bl.x - tl.x) / passo
  const gy = (bl.y - tl.y) / passo
  const vx = (tr.x - tl.x) / passo
  const vy = (tr.y - tl.y) / passo
  const kTr = tl.m > 0 ? tr.m / tl.m : 1
  const kBl = tl.m > 0 ? bl.m / tl.m : 1

  const alto = dimensioneDaTemporizzazione(
    g, w, h,
    tl.x + 3 * gx, tl.y + 3 * gy,
    tr.x + 3 * gx * kTr, tr.y + 3 * gy * kTr,
    pol,
  )
  const sinistra = dimensioneDaTemporizzazione(
    g, w, h,
    tl.x + 3 * vx, tl.y + 3 * vy,
    bl.x + 3 * vx * kBl, bl.y + 3 * vy * kBl,
    pol,
  )

  if (alto && alto === sinistra) return alto
  const soli = alto || sinistra
  if (soli && Math.abs(soli - dim) <= 12) return soli
  return 0
}

/* ------------------------------------------------------------------ *
 * Alignment pattern
 * ------------------------------------------------------------------ */

/**
 * Verifica verticale del 1:1:1 di un alignment pattern.
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} x @param {number} y
 * @param {number} modulo @param {number} pol
 * @returns {number} lo scarto del centro, o NaN
 */
function centroAllineamentoV(g, w, h, x, y, modulo, pol) {
  const cap = Math.ceil(modulo * 2) + 2
  let j = y
  let a = 0
  while (j >= 0 && g[j * w + x] === pol) { if (++a > cap) return NaN; j-- }
  if (a === 0) return NaN
  let r0 = 0
  while (j >= 0 && g[j * w + x] !== pol) { if (++r0 > cap) return NaN; j-- }
  if (r0 === 0) return NaN

  j = y + 1
  let b = 0
  while (j < h && g[j * w + x] === pol) { if (++b > cap) return NaN; j++ }
  let r2 = 0
  while (j < h && g[j * w + x] !== pol) { if (++r2 > cap) return NaN; j++ }
  if (r2 === 0) return NaN

  const v = modulo / 2
  if (Math.abs(modulo - r0) >= v) return NaN
  if (Math.abs(modulo - (a + b)) >= v) return NaN
  if (Math.abs(modulo - r2) >= v) return NaN
  return (b - a + 2) / 2
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} x0 @param {number} y0
 * @param {number} larg @param {number} alt
 * @param {number} modulo @param {number} pol
 * @param {number} ex @param {number} ey   dove ce lo si aspetta
 * @returns {{x: number, y: number}|null}
 */
function cercaAllineamento(g, w, h, x0, y0, larg, alt, modulo, pol, ex, ey) {
  /** @type {{x: number, y: number, doppio: boolean}[]} */
  const visti = []
  const yMed = y0 + (alt >> 1)
  const xFine = Math.min(w, x0 + larg)
  for (let k = 0; k < alt; k++) {
    const y = yMed + ((k & 1) === 0 ? (k + 1) >> 1 : -((k + 1) >> 1))
    if (y < y0 || y >= y0 + alt || y < 0 || y >= h) continue
    const base = y * w
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let quanti = 0
    let colore = /** @type {number} */ (g[base + x0])
    let lung = 1
    for (let x = x0 + 1; x <= xFine; x++) {
      const v = x < xFine ? /** @type {number} */ (g[base + x]) : -1
      if (v === colore) { lung++; continue }
      b0 = b1
      b1 = b2
      b2 = lung
      quanti++
      // il tratto appena chiuso è chiaro: la terna è chiaro-scuro-chiaro, e
      // il centro cercato è quello del tratto scuro di mezzo
      if (quanti >= 3 && colore !== pol) {
        const vr = modulo / 2
        if (
          Math.abs(modulo - b0) < vr &&
          Math.abs(modulo - b1) < vr &&
          Math.abs(modulo - b2) < vr
        ) {
          const cx = x - b2 - b1 / 2
          const xi = Math.floor(cx)
          if (xi >= 0 && xi < w) {
            const d = centroAllineamentoV(g, w, h, xi, y, modulo, pol)
            if (!Number.isNaN(d)) {
              const cy = y + d
              let noto = false
              for (const p of visti) {
                if (Math.abs(p.x - cx) <= modulo && Math.abs(p.y - cy) <= modulo) {
                  p.x = (p.x + cx) / 2
                  p.y = (p.y + cy) / 2
                  p.doppio = true
                  noto = true
                  break
                }
              }
              if (!noto && visti.length < 24) visti.push({ x: cx, y: cy, doppio: false })
            }
          }
        }
      }
      colore = v
      lung = 1
    }
  }
  // Fra i candidati vince quello più vicino a dove lo si aspettava, e a
  // parità vince chi è stato visto due volte: dentro l'area dei dati il
  // rapporto 1:1:1 lo soddisfa per caso un modulo isolato su tanti.
  /** @type {{x: number, y: number, doppio: boolean}|null} */
  let scelto = null
  let punteggio = Infinity
  for (const p of visti) {
    const dx = p.x - ex
    const dy = p.y - ey
    const d = Math.sqrt(dx * dx + dy * dy) - (p.doppio ? modulo : 0)
    if (d < punteggio) {
      punteggio = d
      scelto = p
    }
  }
  return scelto
}

/* ------------------------------------------------------------------ *
 * Omografia e campionamento
 * ------------------------------------------------------------------ */

/**
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number} x2 @param {number} y2 @param {number} x3 @param {number} y3
 * @returns {Omografia}
 */
function quadratoAQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3
  const dy3 = y0 - y1 + y2 - y3
  if (dx3 === 0 && dy3 === 0) {
    return {
      a11: x1 - x0, a12: y1 - y0, a13: 0,
      a21: x2 - x1, a22: y2 - y1, a23: 0,
      a31: x0, a32: y0, a33: 1,
    }
  }
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const a13 = (dx3 * dy2 - dx2 * dy3) / den
  const a23 = (dx1 * dy3 - dx3 * dy1) / den
  return {
    a11: x1 - x0 + a13 * x1, a12: y1 - y0 + a13 * y1, a13,
    a21: x3 - x0 + a23 * x3, a22: y3 - y0 + a23 * y3, a23,
    a31: x0, a32: y0, a33: 1,
  }
}

/**
 * @param {Omografia} t
 * @returns {Omografia}
 */
function aggiunta(t) {
  return {
    a11: t.a22 * t.a33 - t.a23 * t.a32,
    a21: t.a23 * t.a31 - t.a21 * t.a33,
    a31: t.a21 * t.a32 - t.a22 * t.a31,
    a12: t.a13 * t.a32 - t.a12 * t.a33,
    a22: t.a11 * t.a33 - t.a13 * t.a31,
    a32: t.a12 * t.a31 - t.a11 * t.a32,
    a13: t.a12 * t.a23 - t.a13 * t.a22,
    a23: t.a13 * t.a21 - t.a11 * t.a23,
    a33: t.a11 * t.a22 - t.a12 * t.a21,
  }
}

/**
 * @param {Omografia} a @param {Omografia} b
 * @returns {Omografia}
 */
function per(a, b) {
  return {
    a11: a.a11 * b.a11 + a.a21 * b.a12 + a.a31 * b.a13,
    a21: a.a11 * b.a21 + a.a21 * b.a22 + a.a31 * b.a23,
    a31: a.a11 * b.a31 + a.a21 * b.a32 + a.a31 * b.a33,
    a12: a.a12 * b.a11 + a.a22 * b.a12 + a.a32 * b.a13,
    a22: a.a12 * b.a21 + a.a22 * b.a22 + a.a32 * b.a23,
    a32: a.a12 * b.a31 + a.a22 * b.a32 + a.a32 * b.a33,
    a13: a.a13 * b.a11 + a.a23 * b.a12 + a.a33 * b.a13,
    a23: a.a13 * b.a21 + a.a23 * b.a22 + a.a33 * b.a23,
    a33: a.a13 * b.a31 + a.a23 * b.a32 + a.a33 * b.a33,
  }
}

/**
 * @param {number[]} s  otto coordinate nella griglia dei moduli
 * @param {number[]} d  otto coordinate nell'immagine
 * @returns {Omografia}
 */
function quadAQuad(s, d) {
  const n = (/** @type {number[]} */ v, /** @type {number} */ i) =>
    /** @type {number} */ (v[i])
  const verso = quadratoAQuad(n(d, 0), n(d, 1), n(d, 2), n(d, 3), n(d, 4), n(d, 5), n(d, 6), n(d, 7))
  const da = quadratoAQuad(n(s, 0), n(s, 1), n(s, 2), n(s, 3), n(s, 4), n(s, 5), n(s, 6), n(s, 7))
  return per(verso, aggiunta(da))
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {Omografia} t
 * @param {number} dim
 * @param {number} pol
 * @param {number} modulo
 * @returns {boolean[][]|null}
 */
function campiona(g, w, h, t, dim, pol, modulo) {
  // con moduli grandi conviene la maggioranza su cinque punti: costa poco e
  // regge il rumore sale-e-pepe che la soglia locale lascia passare
  const r = modulo >= 3.5 ? Math.max(1, Math.round(modulo * 0.22)) : 0
  /** @type {boolean[][]} */
  const matrice = []
  let fuori = 0
  for (let riga = 0; riga < dim; riga++) {
    const v = riga + 0.5
    /** @type {boolean[]} */
    const linea = new Array(dim)
    for (let col = 0; col < dim; col++) {
      const u = col + 0.5
      const den = t.a13 * u + t.a23 * v + t.a33
      const x = (t.a11 * u + t.a21 * v + t.a31) / den
      const y = (t.a12 * u + t.a22 * v + t.a32) / den
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) {
        linea[col] = false
        fuori++
        continue
      }
      if (r === 0) {
        linea[col] = g[yi * w + xi] === pol
        continue
      }
      let voti = g[yi * w + xi] === pol ? 1 : 0
      const xa = xi - r >= 0 ? xi - r : xi
      const xb = xi + r < w ? xi + r : xi
      const ya = yi - r >= 0 ? yi - r : yi
      const yb = yi + r < h ? yi + r : yi
      if (g[yi * w + xa] === pol) voti++
      if (g[yi * w + xb] === pol) voti++
      if (g[ya * w + xi] === pol) voti++
      if (g[yb * w + xi] === pol) voti++
      linea[col] = voti >= 3
    }
    matrice.push(linea)
  }
  if (fuori > dim * dim * 0.02) return null
  return matrice
}

/**
 * Quota di moduli sbagliati fra quelli che il formato impone: i tre finder
 * e le due temporizzazioni. Sono l'unico pezzo di un QR che si conosce
 * *prima* di decodificarlo, ed è la prova che la griglia campionata è quella
 * giusta: una griglia storta di mezzo modulo li sbaglia quasi tutti, e tre
 * quadrati concentrici disegnati su un muro non ne hanno nessuno.
 * @param {boolean[][]} m
 * @param {number} dim
 * @returns {number}
 */
function erroriStruttura(m, dim) {
  let errori = 0
  let quanti = 0
  const finder = (/** @type {number} */ r0, /** @type {number} */ c0) => {
    for (let r = 0; r < 7; r++) {
      const riga = /** @type {boolean[]} */ (m[r0 + r])
      for (let c = 0; c < 7; c++) {
        const bordo = r === 0 || c === 0 || r === 6 || c === 6
        const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4
        quanti++
        if (riga[c0 + c] !== (bordo || centro)) errori++
      }
    }
  }
  finder(0, 0)
  finder(0, dim - 7)
  finder(dim - 7, 0)
  const sesta = /** @type {boolean[]} */ (m[6])
  for (let c = 8; c <= dim - 9; c++) {
    quanti++
    if (sesta[c] !== (c % 2 === 0)) errori++
  }
  for (let r = 8; r <= dim - 9; r++) {
    quanti++
    if (/** @type {boolean[]} */ (m[r])[6] !== (r % 2 === 0)) errori++
  }
  return quanti ? errori / quanti : 1
}

/* ------------------------------------------------------------------ *
 * Il filo che tiene tutto
 * ------------------------------------------------------------------ */

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {Centro[]} candidati
 * @param {number} pol
 * @returns {boolean[][]|null}
 */
function decodificaGriglia(g, w, h, candidati, pol) {
  const terna = scegliTerna(candidati.filter(c => c.pol === pol && c.n >= 2))
  if (!terna) return null
  const q = ordinaTerna(terna)
  const { tl, tr, bl } = q

  let modulo = (moduloVerso(g, w, h, tl, tr, pol) + moduloVerso(g, w, h, tl, bl, pol)) / 2
  if (!(modulo > 0.7)) modulo = (tl.m + tr.m + bl.m) / 3
  if (!(modulo > 0.7)) return null

  const lato = (distanza(tl, tr) + distanza(tl, bl)) / 2
  const grezza = lato / modulo + 7
  const vicina = dimensionePiuVicina(grezza)
  if (!vicina) return null

  // Contare la temporizzazione batte sempre lo stimare il modulo: su 150
  // moduli basta l'1% di errore per finire nella versione sbagliata, e
  // l'1% è più o meno la precisione di una misura su sette moduli.
  let dim = raffinaDimensione(g, w, h, q, vicina, pol)
  if (!dim) {
    if (Math.abs(grezza - vicina) > 1.9) return null
    dim = vicina
  }
  modulo = lato / (dim - 7)

  const brx = tr.x - tl.x + bl.x
  const bry = tr.y - tl.y + bl.y

  /** @type {{x: number, y: number}|null} */
  let all = null
  if (dim >= 25) {
    const k = 1 - 3 / (dim - 7)
    const ex = tl.x + k * (brx - tl.x)
    const ey = tl.y + k * (bry - tl.y)
    for (let f = 4; f <= 16 && !all; f *= 2) {
      const sc = Math.round(f * modulo)
      const x0 = Math.max(0, Math.floor(ex) - sc)
      const x1 = Math.min(w - 1, Math.floor(ex) + sc)
      const y0 = Math.max(0, Math.floor(ey) - sc)
      const y1 = Math.min(h - 1, Math.floor(ey) + sc)
      if (x1 - x0 < modulo * 3 || y1 - y0 < modulo * 3) continue
      all = cercaAllineamento(g, w, h, x0, y0, x1 - x0, y1 - y0, modulo, pol, ex, ey)
    }
  }

  const d = dim - 3.5
  const fondo = [tl.x, tl.y, tr.x, tr.y, brx, bry, bl.x, bl.y]
  if (all) {
    const conAll = griglia(
      g, w, h, dim, pol, modulo,
      [3.5, 3.5, d, 3.5, dim - 6.5, dim - 6.5, 3.5, d],
      [tl.x, tl.y, tr.x, tr.y, all.x, all.y, bl.x, bl.y],
    )
    if (conAll) return conAll
    // l'alignment trovato era un modulo qualunque che ci somigliava: meglio
    // il quadrilatero dedotto dai soli finder che una prospettiva inventata
  }
  return griglia(g, w, h, dim, pol, modulo, [3.5, 3.5, d, 3.5, d, d, 3.5, d], fondo)
}

/**
 * @param {Uint8Array} g
 * @param {number} w @param {number} h
 * @param {number} dim @param {number} pol @param {number} modulo
 * @param {number[]} sorgente @param {number[]} destinazione
 * @returns {boolean[][]|null}
 */
function griglia(g, w, h, dim, pol, modulo, sorgente, destinazione) {
  const t = quadAQuad(sorgente, destinazione)
  if (!Number.isFinite(t.a11) || !Number.isFinite(t.a33)) return null
  const m = campiona(g, w, h, t, dim, pol, modulo)
  if (!m) return null
  return erroriStruttura(m, dim) <= SOGLIA_STRUTTURA ? m : null
}
