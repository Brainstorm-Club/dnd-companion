/**
 * Notazione dei dadi: analisi e tiro.  ── Lotto A ──
 *
 * Grammatica accettata:
 *   gruppi      := espressione ( (',' | ';' | ' e ') espressione )*    tiri indipendenti
 *   espressione := termine ( ('+'|'-') termine )*
 *   termine     := [N]dM[mod] | intero
 *   mod         := kh<n> | kl<n> | dh<n> | dl<n> | r1
 *   facce M     ∈ ALLOWED_FACES
 *   scorciatoie : vantaggio|adv → 2d20kh1 ; svantaggio|dis → 2d20kl1
 *
 * Esempi che devono funzionare:
 *   1d20+5 · 4d12 · «2d6 e 3d20» · 4d6dl1 · 2d20kh1+3 · 1d8+1d6+2 · 1d100 · 3d3
 */

/** I dadi che esistono. Insieme chiuso: un d7 è un errore, non una faccia. */
export const ALLOWED_FACES = /** @type {const} */ ([2, 3, 4, 6, 8, 10, 12, 20, 100])

/** Tetti anti-abuso: un `999d100` non deve poter bloccare il telefono. */
export const MAX_DICE_PER_TERM = 100
export const MAX_GROUPS = 10

/** @typedef {import('./rng.js').Rng} Rng */
/** @typedef {{ count: number, faces: number, keep?: {mode: 'kh'|'kl'|'dh'|'dl', n: number}, reroll1?: boolean, sign: 1|-1 }} DiceTerm */
/** @typedef {{ value: number, sign: 1|-1 }} ConstTerm */
/** @typedef {{ terms: Array<DiceTerm|ConstTerm>, source: string }} Expression */
/** @typedef {{ groups: Expression[] }} Notation */
/** @typedef {{ faces: number, value: number, dropped: boolean, rerolled: boolean }} DieResult */
/** @typedef {{ dice: DieResult[], total: number, formula: string, source: string }} GroupRoll */
/** @typedef {{ groups: GroupRoll[], total: number, label?: string }} Roll */

/** Set di ricerca. Il cast serve perché ALLOWED_FACES è una tupla di letterali. */
const FACCE = new Set(/** @type {readonly number[]} */ (ALLOWED_FACES))

/** «d2 d3 d4 …»: compare nel messaggio d'errore, quindi vive accanto all'insieme. */
export const FACCE_AMMESSE_TESTO = ALLOWED_FACES.map(f => `d${f}`).join(' ')

/**
 * Le scorciatoie si espandono **prima** dell'analisi, così il resto della
 * grammatica non deve saperne niente. `svantaggio` viene prima di `vantaggio`
 * solo per chiarezza: i confini di parola già impedirebbero la collisione.
 * @type {Array<[RegExp, string]>}
 */
const SCORCIATOIE = [
  [/\b(?:svantaggio|dis)\b/g, '2d20kl1'],
  [/\b(?:vantaggio|adv)\b/g, '2d20kh1'],
]

/** Separatori di gruppo: virgola, punto e virgola, oppure una « e » isolata. */
const SEPARATORE = /\s*[,;]\s*|\s+e\s+/

/** `[N]dM` seguito da zero o più modificatori. Le facce si validano dopo: qui
 *  accetta anche `1d7`, altrimenti l'errore direbbe «non capisco» invece di
 *  spiegare quali dadi esistono. */
const RE_DADO = /^(\d*)d(\d+)((?:kh\d+|kl\d+|dh\d+|dl\d+|r1)*)$/
const RE_MOD = /(kh|kl|dh|dl)(\d+)|r1/g

/** @param {string} testo */
function esempi(testo) {
  return `non capisco «${testo}» — esempi: 1d20+5, 4d6dl1, 2d20kh1+3, «2d6 e 3d20»`
}

/**
 * Un termine: `4d6dl1`, `1d20`, `5`.
 * @param {string} testo
 * @param {1|-1} sign
 * @returns {DiceTerm|ConstTerm}
 */
function analizzaTermine(testo, sign) {
  if (/^\d+$/.test(testo)) {
    const value = Number(testo)
    if (!Number.isSafeInteger(value)) throw new Error(`numero troppo grande: ${testo}`)
    return { value, sign }
  }

  const m = RE_DADO.exec(testo)
  if (!m) throw new Error(esempi(testo))

  const grezzoN = m[1] ?? ''
  const faces = Number(m[2])
  if (!FACCE.has(faces)) {
    throw new Error(`il d${faces} non esiste — dadi ammessi: ${FACCE_AMMESSE_TESTO}`)
  }

  const count = grezzoN === '' ? 1 : Number(grezzoN)
  if (count < 1) throw new Error(`0d${faces} non tira niente — serve almeno un dado`)
  if (count > MAX_DICE_PER_TERM) {
    throw new Error(`troppi dadi: ${count}d${faces} — al massimo ${MAX_DICE_PER_TERM} per termine`)
  }

  /** @type {DiceTerm} */
  const term = { count, faces, sign }
  for (const mod of (m[3] ?? '').matchAll(RE_MOD)) {
    const modo = mod[1]
    if (!modo) { term.reroll1 = true; continue }
    if (term.keep) throw new Error(`un solo modificatore fra kh/kl/dh/dl per termine: «${testo}»`)
    const n = Number(mod[2])
    if (n < 1) throw new Error(`${modo}0 non ha senso: dice di tenere o scartare zero dadi`)
    term.keep = { mode: /** @type {'kh'|'kl'|'dh'|'dl'} */ (modo), n }
  }
  return term
}

/**
 * Un'espressione: termini separati da `+` e `-`.
 * @param {string} testo  già normalizzato, senza spazi
 * @param {string} source testo originale del gruppo, per il risultato
 * @returns {Expression}
 */
function analizzaEspressione(testo, source) {
  if (!testo) throw new Error('notazione vuota: scrivi per esempio 1d20+5')
  /** @type {Array<DiceTerm|ConstTerm>} */
  const terms = []
  /** @type {1|-1} */
  let sign = 1
  let pezzo = ''
  const chiudi = () => {
    if (!pezzo) throw new Error(esempi(source.trim() || testo))
    terms.push(analizzaTermine(pezzo, sign))
    pezzo = ''
  }
  for (const ch of testo) {
    if (ch === '+' || ch === '-') {
      if (pezzo === '' && terms.length === 0 && ch === '-') { sign = -1; continue }
      chiudi()
      sign = ch === '+' ? 1 : -1
    } else {
      pezzo += ch
    }
  }
  chiudi()
  return { terms, source }
}

/**
 * Analizza la notazione. Non tira: separare le due cose è ciò che rende
 * testabile il parser e riproducibile il tiro.
 * @param {string} input
 * @returns {Notation}
 * @throws {Error} con un messaggio leggibile da mostrare all'utente
 *   (una faccia fuori insieme dice quali dadi esistono, non «parse error»)
 */
export function parse(input) {
  if (typeof input !== 'string') throw new Error('notazione vuota: scrivi per esempio 1d20+5')
  const testo = input.toLowerCase().trim()
  if (!testo) throw new Error('notazione vuota: scrivi per esempio 1d20+5')

  // Un gruppo vuoto («1d20,,2d6») non si scarta in silenzio: lo segnala
  // analizzaEspressione, perché una virgola di troppo è quasi sempre un refuso.
  const pezzi = testo.split(SEPARATORE)
  if (pezzi.length > MAX_GROUPS) {
    throw new Error(`troppi gruppi: ${pezzi.length} — al massimo ${MAX_GROUPS} tiri per volta`)
  }
  // Le scorciatoie si espandono **dopo** aver messo da parte il testo digitato:
  // `source` deve restare «vantaggio», altrimenti nello storico nessuno
  // riconosce più il proprio tiro.
  const groups = pezzi.map(p => {
    let compatto = p.replace(/\s+/g, '')
    for (const [re, con] of SCORCIATOIE) compatto = compatto.replace(re, con)
    return analizzaEspressione(compatto, p.trim())
  })
  return { groups }
}

/** @param {DiceTerm|ConstTerm} t @returns {string} */
function testoTermine(t) {
  if ('value' in t) return String(t.value)
  return `${t.count}d${t.faces}${t.keep ? t.keep.mode + t.keep.n : ''}${t.reroll1 ? 'r1' : ''}`
}

/**
 * La notazione canonica del gruppo: le scorciatoie sono già espanse, quindi
 * `vantaggio+3` si legge `2d20kh1 + 3`. `source` conserva ciò che è stato
 * digitato; questa è la formula da mostrare sotto il totale.
 * @param {Expression} expr
 * @returns {string}
 */
function formulaDi(expr) {
  return expr.terms.map((t, i) => {
    const s = testoTermine(t)
    if (i === 0) return t.sign < 0 ? `-${s}` : s
    return t.sign < 0 ? ` - ${s}` : ` + ${s}`
  }).join('')
}

/**
 * Quanti dadi di un termine contano nel totale, dopo tieni/scarta.
 * Un `kh5` su tre dadi tiene tutti e tre invece di inventarne due.
 * @param {DiceTerm} t
 * @returns {number}
 */
function tenuti(t) {
  if (!t.keep) return t.count
  const n = t.keep.n
  return t.keep.mode === 'kh' || t.keep.mode === 'kl'
    ? Math.min(n, t.count)
    : Math.max(0, t.count - n)
}

/**
 * @param {DiceTerm} term
 * @param {Rng} rng
 * @returns {DieResult[]}
 */
function tiraTermine(term, rng) {
  /** @type {DieResult[]} */
  const out = []
  for (let i = 0; i < term.count; i++) {
    let value = rng.int(term.faces) + 1
    let rerolled = false
    // r1 ritira una volta sola e tiene il secondo risultato: il minimo teorico
    // resta 1, ed è il motivo per cui bounds() non lo alza.
    if (term.reroll1 && value === 1) { value = rng.int(term.faces) + 1; rerolled = true }
    out.push({ faces: term.faces, value, dropped: false, rerolled })
  }
  const k = term.keep
  if (k) {
    const ordinati = out
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.value - b.d.value || a.i - b.i)
    const quanti = out.length - tenuti(term)
    const scartati = k.mode === 'kh' || k.mode === 'dl'
      ? ordinati.slice(0, quanti)          // via i più bassi
      : ordinati.slice(out.length - quanti) // via i più alti
    for (const x of scartati) x.d.dropped = true
  }
  return out
}

/**
 * @param {Expression} expr
 * @param {Rng} rng
 * @returns {GroupRoll}
 */
function tiraGruppo(expr, rng) {
  /** @type {DieResult[]} */
  const dice = []
  let total = 0
  for (const t of expr.terms) {
    if ('value' in t) { total += t.sign * t.value; continue }
    const nuovi = tiraTermine(t, rng)
    for (const d of nuovi) if (!d.dropped) total += t.sign * d.value
    // I dadi scartati restano nell'elenco: al tavolo si vedono sul feltro, e
    // nasconderli è il modo più rapido di far dubitare del tiro.
    dice.push(...nuovi)
  }
  return { dice, total, formula: formulaDi(expr), source: expr.source }
}

/**
 * Tira una notazione già analizzata.
 * @param {Notation} notation
 * @param {Rng} rng
 * @returns {Roll}
 */
export function roll(notation, rng) {
  const groups = notation.groups.map(g => tiraGruppo(g, rng))
  return { groups, total: groups.reduce((n, g) => n + g.total, 0) }
}

/**
 * Comodo: analizza e tira in un colpo.
 * @param {string} input
 * @param {Rng} rng
 * @param {string} [label]
 * @returns {Roll}
 */
export function rollNotation(input, rng, label) {
  const r = roll(parse(input), rng)
  return label === undefined ? r : { ...r, label }
}

/**
 * Minimo e massimo teorici di una notazione: servono ai test di proprietà e a
 * mostrare la forbice prima di tirare.
 *
 * I gruppi sono tiri indipendenti, ma `Roll.total` ne è la somma: la forbice
 * segue la stessa convenzione, altrimenti non sarebbe confrontabile.
 * @param {Notation} notation
 * @returns {{min: number, max: number}}
 */
export function bounds(notation) {
  let min = 0
  let max = 0
  for (const g of notation.groups) {
    for (const t of g.terms) {
      if ('value' in t) {
        const v = t.sign * t.value
        min += v
        max += v
        continue
      }
      const k = tenuti(t)
      const basso = k * 1
      const alto = k * t.faces
      if (t.sign < 0) { min -= alto; max -= basso }
      else { min += basso; max += alto }
    }
  }
  return { min, max }
}
