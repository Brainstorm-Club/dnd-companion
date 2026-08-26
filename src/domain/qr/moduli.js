/**
 * Dalla griglia dei moduli al testo.
 *
 * Formato, versione, smascheramento, lettura a serpentina, de-interlacciamento
 * dei blocchi, Reed–Solomon, segmenti. Nessuna libreria: sta in piedi da solo.
 *
 * Due scelte attraversano tutto il file.
 *
 * **Non si lancia mai.** Chi chiama macina fotogrammi dalla telecamera, dove il
 * caso normale è che nel fotogramma un codice non ci sia proprio. «Non l'ho
 * letto» è un esito, non un guasto: ogni strada senza uscita finisce in `null`.
 *
 * **Si corregge davvero.** Una foto di un codice stampato ha sempre qualche
 * modulo sbagliato — un riflesso, una piega, una soglia decisa male. Verificare
 * e basta vorrebbe dire rifiutare quasi tutto: qui c'è Reed–Solomon intero
 * (sindromi, Berlekamp–Massey, Chien, Forney), non solo il controllo.
 */

/* ------------------------------------------------------------- GF(256) --- */

// Il campo di Galois di QR: polinomio primitivo 0x11d, generatore α = 2. Le
// due tavole sono 768 byte che a scriverli a mano non direbbero niente a
// nessuno: costruirli all'avvio del modulo costa un giro di ciclo.
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  EXP[i + 255] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}

/** @param {number} i @returns {number} */
const exp = (i) => EXP[i] ?? 0
/** @param {number} a @returns {number} */
const log = (a) => LOG[a] ?? 0

/** @param {number} a @param {number} b @returns {number} */
const mul = (a, b) => (a === 0 || b === 0 ? 0 : exp(log(a) + log(b)))

/** @param {number} a @param {number} b @returns {number} */
const div = (a, b) => (a === 0 ? 0 : exp(log(a) + 255 - log(b)))

/** α elevato a un esponente anche negativo. @param {number} e @returns {number} */
const alfa = (e) => exp(((e % 255) + 255) % 255)

/**
 * Polinomi come array di coefficienti, indice = grado. Fuori dall'array il
 * coefficiente è zero: è per questo che ovunque si legge `p[i] ?? 0`.
 * @param {number[]} p @param {number} x @returns {number}
 */
function valuta(p, x) {
  let y = 0
  for (let i = p.length - 1; i >= 0; i--) y = mul(y, x) ^ (p[i] ?? 0)
  return y
}

/* ------------------------------------------------------- Reed–Solomon --- */

/**
 * @param {Uint8Array} b  dati seguiti dai codeword di correzione
 * @param {number} nsym
 * @returns {number[]}
 */
function sindromi(b, nsym) {
  /** @type {number[]} */
  const s = []
  for (let j = 0; j < nsym; j++) {
    const aj = exp(j)
    let v = 0
    for (let i = 0; i < b.length; i++) v = mul(v, aj) ^ (b[i] ?? 0)
    s.push(v)
  }
  return s
}

/**
 * Corregge il blocco sul posto. Restituisce `false` quando gli errori sono
 * più di quanti il codice ne regga: meglio nessun testo che testo inventato.
 *
 * @param {Uint8Array} b
 * @param {number} nsym
 * @returns {boolean}
 */
function correggi(b, nsym) {
  const n = b.length
  const s = sindromi(b, nsym)
  if (s.every((v) => v === 0)) return true

  // Berlekamp–Massey: il più corto registro a scorrimento che genera le
  // sindromi è il polinomio localizzatore degli errori.
  /** @type {number[]} */
  let lam = [1]
  /** @type {number[]} */
  let prec = [1]
  let gradi = 0
  let salto = 1
  let scarto = 1
  for (let k = 0; k < nsym; k++) {
    let d = s[k] ?? 0
    for (let i = 1; i <= gradi; i++) d ^= mul(lam[i] ?? 0, s[k - i] ?? 0)
    if (d === 0) {
      salto++
      continue
    }
    const copia = lam.slice()
    const f = div(d, scarto)
    while (lam.length < prec.length + salto) lam.push(0)
    for (let i = 0; i < prec.length; i++) {
      lam[i + salto] = (lam[i + salto] ?? 0) ^ mul(f, prec[i] ?? 0)
    }
    if (2 * gradi <= k) {
      gradi = k + 1 - gradi
      prec = copia
      scarto = d
      salto = 1
    } else salto++
  }

  while (lam.length > 1 && lam[lam.length - 1] === 0) lam.pop()
  // Se il grado non torna, le sindromi descrivono più errori di quanti se ne
  // possano localizzare: fermarsi qui è il punto del controllo.
  if (gradi === 0 || 2 * gradi > nsym || lam.length - 1 !== gradi) return false

  // Chien: le radici di Λ sono gli inversi delle posizioni d'errore.
  /** @type {number[]} */
  const espo = []
  for (let e = 0; e < n; e++) if (valuta(lam, alfa(-e)) === 0) espo.push(e)
  if (espo.length !== gradi) return false

  // Ω = S·Λ mod x^nsym, e la derivata formale di Λ (in caratteristica 2
  // sopravvivono solo i gradi dispari).
  /** @type {number[]} */
  const omega = []
  for (let i = 0; i < nsym; i++) {
    let v = 0
    for (let j = 0; j <= i && j < lam.length; j++) v ^= mul(lam[j] ?? 0, s[i - j] ?? 0)
    omega.push(v)
  }
  const der = new Array(Math.max(1, lam.length - 1)).fill(0)
  for (let i = 1; i < lam.length; i += 2) der[i - 1] = lam[i] ?? 0

  for (const e of espo) {
    const inv = alfa(-e)
    const den = valuta(der, inv)
    if (den === 0) return false
    const idx = n - 1 - e
    if (idx < 0) return false
    b[idx] = (b[idx] ?? 0) ^ mul(alfa(e), div(valuta(omega, inv), den))
  }

  // Controprova: dopo Forney le sindromi devono essere tutte nulle. Senza
  // questa riga un blocco troppo rovinato uscirebbe «corretto» e sbagliato.
  return sindromi(b, nsym).every((v) => v === 0)
}

/* -------------------------------------------------- tabelle per versione --- */

/**
 * Codeword di correzione per blocco e numero di blocchi, per versione 1..40 e
 * livello L, M, Q, H. Sono le uniche due tabelle che non si ricavano da una
 * formula; in stringa costano poco e in gzip quasi niente.
 * @param {string} s @returns {number[]}
 */
const numeri = (s) => s.split(' ').map(Number)

const ECC_PER_BLOCCO = [
  numeri('7 10 15 20 26 18 20 24 30 18 20 24 26 30 22 24 28 30 28 28 28 28 30 30 26 28 30 30 30 30 30 30 30 30 30 30 30 30 30 30'),
  numeri('10 16 26 18 24 16 18 22 22 26 30 22 22 24 24 28 28 26 26 26 26 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28 28'),
  numeri('13 22 18 26 18 24 18 22 20 24 28 26 24 20 30 24 28 28 26 30 28 30 30 30 30 28 30 30 30 30 30 30 30 30 30 30 30 30 30 30'),
  numeri('17 28 22 16 22 28 26 26 24 28 24 28 22 24 24 30 28 28 26 28 30 24 30 30 30 30 30 30 30 30 30 30 30 30 30 30 30 30 30 30'),
]

const BLOCCHI = [
  numeri('1 1 1 1 1 2 2 2 2 4 4 4 4 4 6 6 6 6 7 8 8 9 9 10 12 12 12 13 14 15 16 17 18 19 19 20 21 22 24 25'),
  numeri('1 1 1 2 2 4 4 4 5 5 5 8 9 9 10 10 11 13 14 16 17 17 18 20 21 23 25 26 28 29 31 33 35 37 38 40 43 45 47 49'),
  numeri('1 1 2 2 4 4 6 6 8 8 8 10 12 16 12 17 16 18 21 20 23 23 25 27 29 34 34 35 38 40 43 45 48 51 53 56 59 62 65 68'),
  numeri('1 1 2 4 4 4 5 6 8 8 11 11 16 16 18 16 19 21 25 25 25 34 30 32 35 37 40 42 45 48 51 54 57 60 63 66 70 74 77 81'),
]

/** I due bit del formato non sono in ordine L, M, Q, H. */
const LIVELLO_DA_BIT = [1, 0, 3, 2]

/**
 * Moduli totali meno quelli funzionali, diviso otto.
 * @param {number} v @returns {number}
 */
function codewordTotali(v) {
  let m = (16 * v + 128) * v + 64
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2
    m -= (25 * na - 10) * na - 55
    if (v >= 7) m -= 36
  }
  return m >> 3
}

/**
 * Le coordinate dei pattern di allineamento: una progressione regolare con
 * un'unica irregolarità storica, la versione 32.
 * @param {number} v @returns {number[]}
 */
function posizioniAllineamento(v) {
  if (v === 1) return []
  const na = Math.floor(v / 7) + 2
  const passo = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2
  const out = [6]
  for (let p = v * 4 + 10; out.length < na; p -= passo) out.splice(1, 0, p)
  return out
}

/* ------------------------------------------------------------ BCH --- */

/** @param {number} x @returns {number} */
function popcount(x) {
  let n = 0
  for (let v = x; v !== 0; v >>>= 1) n += v & 1
  return n
}

/** I 15 bit del formato per un dato valore di 5 bit, maschera 0x5412 inclusa.
 * @param {number} dati @returns {number} */
function bchFormato(dati) {
  let r = dati << 10
  for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10)
  return (((dati << 10) | r) ^ 0x5412) & 0x7fff
}

/** I 18 bit della versione. @param {number} v @returns {number} */
function bchVersione(v) {
  let r = v << 12
  for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12)
  return ((v << 12) | r) & 0x3ffff
}

/**
 * Il candidato più vicino, se è vicino abbastanza. La distanza minima del
 * codice è 7 per il formato e 8 per la versione: sotto le quattro differenze
 * il vincitore è unico, e non serve gestire i pareggi.
 * @param {number} grezzo
 * @param {number} quanti  quanti valori può assumere il dato
 * @param {(d:number)=>number} codifica
 * @returns {{dato: number, dist: number}}  `dato` è -1 se nessuno è vicino
 */
function bchCorreggi(grezzo, quanti, codifica) {
  let dato = -1
  let dist = 4
  for (let d = 0; d < quanti; d++) {
    const q = popcount(codifica(d) ^ grezzo)
    if (q < dist) {
      dist = q
      dato = d
    }
  }
  return { dato, dist }
}

/* ------------------------------------------------------- maschere --- */

/** @type {((r:number,c:number)=>boolean)[]} */
const MASCHERE = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (((r / 2) | 0) + ((c / 3) | 0)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

/* ------------------------------------------------------- segmenti --- */

const ALFANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

// numerico, alfanumerico, byte, kanji — per i tre scaglioni di versione
const CONTEGGIO = [
  [10, 9, 8, 8],
  [12, 11, 16, 10],
  [14, 13, 16, 12],
]

/** @param {Uint8Array} b @returns {string} */
function latin1(b) {
  let s = ''
  for (let i = 0; i < b.length; i += 4096) {
    s += String.fromCharCode(...b.subarray(i, i + 4096))
  }
  return s
}

/**
 * La specifica dice ISO-8859-1 quando nessun ECI parla, ma praticamente ogni
 * generatore scrive UTF-8 e tace. Si prova UTF-8 in modo rigoroso: se i byte
 * non sono UTF-8 valido non lo erano, e il ripiego è quello della specifica.
 * @param {number[]} bytes
 * @param {'auto'|'utf8'|'latin1'} eci
 * @returns {string}
 */
function testoByte(bytes, eci) {
  const u8 = Uint8Array.from(bytes)
  if (eci === 'latin1') return latin1(u8)
  if (eci === 'utf8') return new TextDecoder('utf-8').decode(u8)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8)
  } catch {
    return latin1(u8)
  }
}

/**
 * @param {Uint8Array} dati
 * @param {number} versione
 * @returns {string|null}
 */
function segmenti(dati, versione) {
  const totBit = dati.length * 8
  const scaglione = versione < 10 ? 0 : versione < 27 ? 1 : 2
  let p = 0

  /** @param {number} k @returns {number} */
  const leggi = (k) => {
    if (p + k > totBit) throw new RangeError('bit finiti')
    let v = 0
    for (let i = 0; i < k; i++, p++) v = (v << 1) | (((dati[p >> 3] ?? 0) >> (7 - (p & 7))) & 1)
    return v
  }
  /** @param {number} modo @returns {number} */
  const conteggio = (modo) => leggi(CONTEGGIO[scaglione]?.[modo] ?? 0)

  let testo = ''
  /** @type {number[]} */
  let buffer = []
  /** @type {'auto'|'utf8'|'latin1'} */
  let eci = 'auto'

  // I segmenti byte adiacenti si uniscono prima di decodificare: un carattere
  // multibyte spezzato a cavallo di due segmenti è raro ma legale.
  const svuota = () => {
    if (buffer.length) {
      testo += testoByte(buffer, eci)
      buffer = []
    }
  }

  for (;;) {
    if (totBit - p < 4) break
    const modo = leggi(4)
    if (modo === 0) break // terminatore

    if (modo !== 4) svuota()

    if (modo === 1) {
      let n = conteggio(0)
      while (n >= 3) {
        const v = leggi(10)
        if (v > 999) return null
        testo += String(v).padStart(3, '0')
        n -= 3
      }
      if (n === 2) {
        const v = leggi(7)
        if (v > 99) return null
        testo += String(v).padStart(2, '0')
      } else if (n === 1) {
        const v = leggi(4)
        if (v > 9) return null
        testo += String(v)
      }
    } else if (modo === 2) {
      let n = conteggio(1)
      while (n >= 2) {
        const v = leggi(11)
        if (v > 44 * 45 + 44) return null
        testo += (ALFANUM[(v / 45) | 0] ?? '') + (ALFANUM[v % 45] ?? '')
        n -= 2
      }
      if (n === 1) {
        const v = leggi(6)
        if (v > 44) return null
        testo += ALFANUM[v] ?? ''
      }
    } else if (modo === 4) {
      const n = conteggio(2)
      for (let i = 0; i < n; i++) buffer.push(leggi(8))
    } else if (modo === 8) {
      // Kanji: si consumano i bit giusti — così i segmenti dopo restano
      // leggibili — ma la tavola Shift-JIS non la portiamo dietro per un'app
      // che legge link. Un carattere, un segnaposto.
      const n = conteggio(3)
      for (let i = 0; i < n; i++) {
        leggi(13)
        testo += '�'
      }
    } else if (modo === 7) {
      const primo = leggi(8)
      let v
      if ((primo & 0x80) === 0) v = primo
      else if ((primo & 0xc0) === 0x80) v = ((primo & 0x3f) << 8) | leggi(8)
      else if ((primo & 0xe0) === 0xc0) v = ((primo & 0x1f) << 16) | leggi(16)
      else return null
      eci = v === 26 ? 'utf8' : v === 3 ? 'latin1' : 'auto'
    } else if (modo === 3) {
      leggi(16) // append strutturato: posizione, totale, parità
    } else if (modo === 5) {
      // FNC1 in prima posizione: nessun parametro
    } else if (modo === 9) {
      leggi(8) // FNC1 in seconda posizione
    } else return null
  }

  svuota()
  return testo
}

/* ---------------------------------------------------------- griglia --- */

/**
 * @param {boolean[][]} matrice   matrice[riga][colonna], true = modulo scuro,
 *                                quadrata, senza quiet zone
 * @returns {string|null}         il testo, o null se non si decodifica
 */
export function testoDa(matrice) {
  try {
    return decodifica(matrice)
  } catch {
    // L'unica rete: qualunque cosa vada storta là dentro esce come «non l'ho
    // letto», che è ciò che il chiamante sa gestire.
    return null
  }
}

/**
 * @param {boolean[][]} matrice
 * @returns {string|null}
 */
function decodifica(matrice) {
  const n = matrice.length
  const versione = (n - 17) / 4
  if (!Number.isInteger(versione) || versione < 1 || versione > 40) return null

  const g = new Uint8Array(n * n)
  for (let r = 0; r < n; r++) {
    const riga = matrice[r]
    if (!riga || riga.length !== n) return null
    for (let c = 0; c < n; c++) if (riga[c]) g[r * n + c] = 1
  }
  /** @param {number} r @param {number} c @returns {number} */
  const mod = (r, c) => g[r * n + c] ?? 0

  /** @param {[number, number][]} celle @returns {number} */
  const parola = (celle) => {
    let v = 0
    for (let i = 0; i < celle.length; i++) {
      const cella = celle[i]
      if (cella && mod(cella[0], cella[1])) v |= 1 << i
    }
    return v
  }

  /* --- informazione di formato: due copie, si tiene la prima che regge --- */

  /** @type {[number, number][]} */
  const f1 = []
  for (let i = 0; i <= 5; i++) f1.push([i, 8])
  f1.push([7, 8], [8, 8], [8, 7])
  for (let i = 9; i <= 14; i++) f1.push([8, 14 - i])

  /** @type {[number, number][]} */
  const f2 = []
  for (let i = 0; i <= 7; i++) f2.push([8, n - 1 - i])
  for (let i = 8; i <= 14; i++) f2.push([n - 15 + i, 8])

  // Le due copie si tengono tutte e due. Una copia molto rovinata può cadere
  // per caso a tre bit da un formato *sbagliato ma valido*: fidarsi della
  // prima che si corregge vorrebbe dire buttare via l'altra, che magari è
  // intatta. Si prova la più vicina, e se la decodifica non regge si prova
  // l'altra — è Reed–Solomon a dire quale delle due aveva ragione.
  const formati = [...new Set([f1, f2]
    .map((celle) => bchCorreggi(parola(celle), 32, bchFormato))
    .filter((x) => x.dato >= 0)
    .sort((a, b) => a.dist - b.dist)
    .map((x) => x.dato))]
  if (!formati.length) return null

  /* --- informazione di versione: controprova, non fonte --- */

  if (versione >= 7) {
    /** @type {[number, number][]} */
    const v1 = []
    /** @type {[number, number][]} */
    const v2 = []
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3)
      const b = Math.floor(i / 3)
      v1.push([b, a])
      v2.push([a, b])
    }
    // La dimensione della griglia dice già la versione, e la dice meglio: qui
    // si controlla soltanto che i 18 bit non la smentiscano. Se nessuna delle
    // due copie è leggibile si va avanti; se una lo è e dice un'altra cosa,
    // vuol dire che la griglia non è quella che crediamo.
    const letture = [v1, v2].map((c) => bchCorreggi(parola(c), 41, bchVersione).dato)
    const valide = letture.filter((v) => v >= 7)
    if (valide.length && !valide.includes(versione)) return null
  }

  /* --- pattern funzionali --- */

  const funz = new Uint8Array(n * n)
  /** @param {number} r @param {number} c */
  const segna = (r, c) => {
    if (r >= 0 && c >= 0 && r < n && c < n) funz[r * n + c] = 1
  }
  // I tre finder con separatori, formato e modulo scuro stanno tutti dentro
  // questi tre rettangoli: contarli insieme evita tre elenchi separati.
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) segna(r, c)
  for (let r = 0; r < 9; r++) for (let c = n - 8; c < n; c++) segna(r, c)
  for (let r = n - 8; r < n; r++) for (let c = 0; c < 9; c++) segna(r, c)
  for (let i = 0; i < n; i++) {
    segna(6, i)
    segna(i, 6)
  }
  const pos = posizioniAllineamento(versione)
  const ultima = pos[pos.length - 1] ?? 0
  for (const a of pos) {
    for (const b of pos) {
      if ((a === 6 && b === 6) || (a === 6 && b === ultima) || (a === ultima && b === 6)) continue
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) segna(a + dr, b + dc)
    }
  }
  if (versione >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3)
      const b = Math.floor(i / 3)
      segna(b, a)
      segna(a, b)
    }
  }

  const totale = codewordTotali(versione)

  /**
   * Lettura a serpentina, de-interlacciamento e correzione, per un'ipotesi di
   * formato. È qui dentro perché è la parte che va rifatta se l'ipotesi cade.
   * @param {number} formato
   * @returns {string|null}
   */
  const prova = (formato) => {
    const livello = LIVELLO_DA_BIT[formato >> 3] ?? 0
    const maschera = MASCHERE[formato & 7]
    if (!maschera) return null

    const parole = new Uint8Array(totale)
    const bitUtili = totale * 8
    let bit = 0
    for (let destra = n - 1; destra >= 1; destra -= 2) {
      if (destra === 6) destra = 5 // la colonna del timing non conta
      for (let v = 0; v < n && bit < bitUtili; v++) {
        for (let j = 0; j < 2; j++) {
          const c = destra - j
          const su = ((destra + 1) & 2) === 0
          const r = su ? n - 1 - v : v
          if (funz[r * n + c] || bit >= bitUtili) continue
          const scuro = mod(r, c) === 1
          if (scuro !== maschera(r, c)) parole[bit >> 3] = (parole[bit >> 3] ?? 0) | (0x80 >> (bit & 7))
          bit++
        }
      }
    }
    if (bit < bitUtili) return null

    const nsym = ECC_PER_BLOCCO[livello]?.[versione - 1]
    const numBlocchi = BLOCCHI[livello]?.[versione - 1]
    if (!nsym || !numBlocchi) return null

    const corto = Math.floor(totale / numBlocchi)
    const quantiCorti = numBlocchi - (totale % numBlocchi)
    /** @type {number[]} */
    const lunghezze = []
    /** @type {Uint8Array[]} */
    const blocchi = []
    for (let i = 0; i < numBlocchi; i++) {
      const len = corto - nsym + (i < quantiCorti ? 0 : 1)
      if (len <= 0) return null
      lunghezze.push(len)
      blocchi.push(new Uint8Array(len + nsym))
    }
    const maxDati = corto - nsym + (quantiCorti < numBlocchi ? 1 : 0)

    let k = 0
    for (let j = 0; j < maxDati; j++) {
      for (let i = 0; i < numBlocchi; i++) {
        if (j < (lunghezze[i] ?? 0)) {
          const bl = blocchi[i]
          if (bl) bl[j] = parole[k] ?? 0
          k++
        }
      }
    }
    for (let j = 0; j < nsym; j++) {
      for (let i = 0; i < numBlocchi; i++) {
        const bl = blocchi[i]
        if (bl) bl[(lunghezze[i] ?? 0) + j] = parole[k] ?? 0
        k++
      }
    }

    const dati = new Uint8Array(totale - nsym * numBlocchi)
    let d = 0
    for (let i = 0; i < numBlocchi; i++) {
      const bl = blocchi[i]
      if (!bl || !correggi(bl, nsym)) return null
      const len = lunghezze[i] ?? 0
      for (let j = 0; j < len; j++) dati[d++] = bl[j] ?? 0
    }

    return segmenti(dati, versione)
  }

  for (const formato of formati) {
    const t = prova(formato)
    if (t !== null) return t
  }
  return null
}
