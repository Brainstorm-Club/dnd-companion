/**
 * Il compendio: indice, ricerca, testo, confronto fra edizioni.  ── Lotti M e N ──
 *
 * Due indici (uno per edizione) stanno sempre in memoria: sono leggeri e
 * servono a elencare, cercare e filtrare. Il testo sta in dieci blocchi per
 * edizione, caricati su richiesta e tenuti al massimo due alla volta — 658
 * incantesimi con testo integrale vivi tutti insieme sarebbero ~2,6 MB, e non è
 * un prezzo che una scheda deve far pagare a un telefono.
 */

import { EDITION_LABELS, otherEdition } from './edition.js'

/** @typedef {import('./edition.js').Edition} Edition */

/**
 * @typedef {object} SpellIndexEntry
 * @property {string} id
 * @property {string} nome
 * @property {number} livello   0 = trucchetto
 * @property {string} scuola
 * @property {string[]} classi
 * @property {boolean} rituale
 * @property {boolean} concentrazione
 * @property {boolean} differisce  le regole cambiano nell'altra edizione
 * @property {string[]} cambiamenti  cosa cambia: 'livello', 'scuola', 'rituale',
 *   'concentrazione', 'classi', oppure 'assente' se l'altra edizione non lo ha
 */

/**
 * @typedef {SpellIndexEntry & {
 *   tempoDiLancio: string, gittata: string, componenti: string, durata: string,
 *   testo: string, aLivelliSuperiori?: string, edizione: Edition, fonte: string
 * }} Spell
 */

/** Quanti blocchi di testo tenere vivi insieme. @type {number} */
export const MAX_LOADED_LEVELS = 2

/** @typedef {(url: string) => Promise<Response>} Fetcher */

/**
 * Da dove si legge il compendio: un'edizione, oppure una pila di cartelle da
 * sovrapporre — la prima è quella che vince.
 *
 * **Perché l'edizione resta la chiave, e la variante si sovrappone.**
 * L'edizione è l'asse su cui l'utente si muove davvero: il selettore del
 * compendio, `counterpart`, `resolveEdition`, l'etichetta accanto a ogni testo
 * e l'attribuzione CC-BY sono tutti «per edizione». Un pacchetto di variante
 * non è un compendio *alternativo*: dichiarando `base: srd-2014` dice
 * «l'SRD 5.1 **più** i miei», ed è esattamente una sovrapposizione. Re-indicizzare
 * tutto per pacchetto avrebbe reso l'«altra edizione» una domanda senza
 * risposta e avrebbe costretto ogni vista a portarsi dietro un id di pacchetto
 * che spesso non ha — il compendio si apre anche senza nessun personaggio.
 *
 * Con una cartella sola tutto resta com'era, chiave di cache compresa: il caso
 * comune non paga niente per una possibilità che non usa.
 *
 * @typedef {{edizione: Edition, cartelle: string[]}} Fonte
 */

/** @typedef {Edition|Fonte} DaDove */

/** La cartella di serie di un'edizione. @param {Edition} ed @returns {string} */
function cartellaDi(ed) { return `data/spells/${ed}/` }

/**
 * @param {DaDove} d
 * @returns {{edizione: Edition, cartelle: string[], chiave: string}}
 */
function normalizza(d) {
  const f = typeof d === 'string' ? { edizione: d, cartelle: [cartellaDi(d)] } : d
  const cartelle = f.cartelle.length ? f.cartelle : [cartellaDi(f.edizione)]
  // La chiave identifica *l'insieme di cartelle*; quando è quello di serie il
  // nome corto è l'edizione, così le cache restano quelle di prima e chi passa
  // l'edizione e chi passa il pacchetto SRD non si ritrovano due indici uguali.
  const sola = cartelle.length === 1 ? cartelle[0] : null
  const chiave = sola && sola === cartellaDi(f.edizione) ? f.edizione : cartelle.join('|')
  return { edizione: f.edizione, cartelle, chiave }
}

/** L'ordine dell'indice, lo stesso che usa il generatore: livello, poi nome. */
const ORDINE = /** @param {SpellIndexEntry} a @param {SpellIndexEntry} b */
  (a, b) => a.livello - b.livello || a.nome.localeCompare(b.nome, 'it')

/**
 * Gli indici, uno per fonte, e non se ne vanno più: sono ~13 KB gzip in due
 * e servono a ogni elenco, filtro e confronto.
 * @type {Map<string, SpellIndexEntry[]>}
 */
const indici = new Map()

/**
 * Da quale cartella viene ogni incantesimo dell'indice fuso. Serve a `loadLevel`
 * per non chiedere `l7.json` a una variante che di incantesimi di 7° non ne ha:
 * sarebbe un 404 per livello, e offline un 404 non si distingue da un guasto.
 * @type {Map<string, Map<string, string>>}
 */
const origini = new Map()

/**
 * I blocchi di testo, al massimo `MAX_LOADED_LEVELS` insieme, i più vecchi
 * lasciati andare. Tenerli tutti sarebbe ~2,6 MB vivi su un telefono.
 * @type {Map<string, Spell[]>}
 */
const blocchi = new Map()

/** Le tabelle id-inglese → id-italiano, una per fonte. @type {Map<string, Record<string, string>>} */
const ponti = new Map()

/** @type {Map<string, Promise<any>>} */
const inCorso = new Map()

/**
 * Una richiesta sola per file anche se tre viste la chiedono insieme: due
 * `fetch` per lo stesso blocco sono due download veri, non uno.
 * @template T
 * @param {string} url @param {Fetcher} fetcher @returns {Promise<T>}
 */
function leggi(url, fetcher) {
  const attesa = inCorso.get(url)
  if (attesa) return attesa
  const p = fetcher(url).then(res => {
    if (!res.ok) throw new Error(`compendio non leggibile: ${url} (${res.status})`)
    return res.json()
  }).finally(() => inCorso.delete(url))
  inCorso.set(url, p)
  return p
}

/**
 * Un file che una sovrapposizione può legittimamente non avere.
 *
 * Un pacchetto di variante dichiara la sua cartella di compendio anche quando
 * di incantesimi non ne aggiunge (o non ne aggiunge ancora): far cadere l'intero
 * compendio perché manca il file di una variante vorrebbe dire lasciare senza
 * incantesimi anche l'SRD che c'è. La cartella di base, invece, resta severa —
 * lì un file che non si legge è un guasto, e va detto.
 * @param {string} url @param {Fetcher} fetcher @returns {Promise<any>}
 */
function leggiSePresente(url, fetcher) {
  return leggi(url, fetcher).catch(() => null)
}

/** @param {DaDove} da @param {Fetcher} [fetcher] @returns {Promise<SpellIndexEntry[]>} */
export async function loadIndex(da, fetcher = fetch) {
  const f = normalizza(da)
  const gia = indici.get(f.chiave)
  if (gia) return gia
  if (f.cartelle.length === 1) {
    const dati = /** @type {SpellIndexEntry[]} */ (await leggi(`${f.cartelle[0]}index.json`, fetcher))
    indici.set(f.chiave, dati)
    return dati
  }

  const parti = await Promise.all(f.cartelle.map((c, i) => i === f.cartelle.length - 1
    ? leggi(`${c}index.json`, fetcher)
    : leggiSePresente(`${c}index.json`, fetcher)))

  // Dalla radice verso il figlio, così l'ultimo che scrive è quello che vince.
  // Una voce d'indice si sostituisce intera e non si fonde: è un record piatto
  // di undici campi, e una voce «a metà» — un livello senza scuola, delle classi
  // senza nome — non è una cosa che il compendio sappia mostrare.
  /** @type {Map<string, SpellIndexEntry>} */
  const per = new Map()
  /** @type {Map<string, string>} */
  const org = new Map()
  for (let i = f.cartelle.length - 1; i >= 0; i--) {
    const cartella = f.cartelle[i] ?? ''
    for (const voce of /** @type {SpellIndexEntry[]} */ (parti[i] ?? [])) {
      per.set(voce.id, voce)
      org.set(voce.id, cartella)
    }
  }
  // Riordinare serve: l'elenco si raggruppa per livello, e degli incantesimi
  // accodati in fondo spezzerebbero i gruppi.
  const dati = [...per.values()].sort(ORDINE)
  indici.set(f.chiave, dati)
  origini.set(f.chiave, org)
  return dati
}

/** @param {DaDove} da @param {number} livello @param {Fetcher} [fetcher] @returns {Promise<Spell[]>} */
export async function loadLevel(da, livello, fetcher = fetch) {
  if (!Number.isInteger(livello) || livello < 0 || livello > 9) throw new Error(`livello fuori scala: ${livello}`)
  const f = normalizza(da)
  const chiave = `${f.chiave}:${livello}`
  const gia = blocchi.get(chiave)
  if (gia) {
    // Riaccodare tiene in vita quello appena usato: la mappa è la coda LRU.
    blocchi.delete(chiave)
    blocchi.set(chiave, gia)
    return gia
  }
  const dati = f.cartelle.length === 1
    ? /** @type {Spell[]} */ (await leggi(`${f.cartelle[0]}l${livello}.json`, fetcher))
    : await bloccoSovrapposto(f, livello, fetcher)
  blocchi.set(chiave, dati)
  while (blocchi.size > MAX_LOADED_LEVELS) {
    const piuVecchio = blocchi.keys().next().value
    if (piuVecchio === undefined) break
    blocchi.delete(piuVecchio)
  }
  return dati
}

/**
 * Il blocco di un livello quando le cartelle sono più d'una.
 * @param {{edizione: Edition, cartelle: string[], chiave: string}} f
 * @param {number} livello
 * @param {Fetcher} fetcher
 * @returns {Promise<Spell[]>}
 */
async function bloccoSovrapposto(f, livello, fetcher) {
  await loadIndex(f, fetcher)
  const indice = indici.get(f.chiave) ?? []
  const org = origini.get(f.chiave) ?? new Map()
  const quali = f.cartelle.filter(c => indice.some(s => s.livello === livello && org.get(s.id) === c))
  const parti = await Promise.all(quali.map((c, i) => i === quali.length - 1
    ? leggi(`${c}l${livello}.json`, fetcher)
    : leggiSePresente(`${c}l${livello}.json`, fetcher)))
  /** @type {Map<string, Spell>} */
  const per = new Map()
  for (let i = quali.length - 1; i >= 0; i--) {
    for (const s of /** @type {Spell[]} */ (parti[i] ?? [])) per.set(s.id, s)
  }
  return [...per.values()]
}

/** @param {DaDove} da @param {string} id @param {Fetcher} [fetcher] @returns {Promise<Spell|null>} */
export async function getSpell(da, id, fetcher = fetch) {
  const indice = await loadIndex(da, fetcher)
  const voce = indice.find(s => s.id === id)
  // Senza la voce d'indice non si sa quale blocco aprire, e scaricarli tutti
  // per cercare un id che non esiste sarebbe il modo peggiore di dire «non c'è».
  if (!voce) return null
  const livello = await loadLevel(da, voce.livello, fetcher)
  return livello.find(s => s.id === id) ?? null
}

/**
 * Il ponte: il builder salva gli incantesimi come id inglesi (`fire-bolt`,
 * `2-locate-object`), il compendio è italiano. Chi non c'è non c'è: si torna
 * `null` e la scheda lo mostra col suo nome e senza testo, dicendo perché.
 * @param {DaDove} da @param {Fetcher} [fetcher] @returns {Promise<Record<string, string>>}
 */
export async function loadBridge(da, fetcher = fetch) {
  const f = normalizza(da)
  const gia = ponti.get(f.chiave)
  if (gia) return gia
  if (f.cartelle.length === 1) {
    const solo = /** @type {Record<string, string>} */ (await leggi(`${f.cartelle[0]}ponte.json`, fetcher))
    ponti.set(f.chiave, solo)
    return solo
  }
  const parti = await Promise.all(f.cartelle.map((c, i) => i === f.cartelle.length - 1
    ? leggi(`${c}ponte.json`, fetcher)
    : leggiSePresente(`${c}ponte.json`, fetcher)))
  /** @type {Record<string, string>} */
  let dati = {}
  for (let i = f.cartelle.length - 1; i >= 0; i--) dati = { ...dati, ...(parti[i] ?? {}) }
  ponti.set(f.chiave, dati)
  return dati
}

/** @param {DaDove} da @param {string} idBuilder @param {Fetcher} [fetcher] @returns {Promise<Spell|null>} */
export async function getSpellByBuilderId(da, idBuilder, fetcher = fetch) {
  const ponte = await loadBridge(da, fetcher)
  const id = ponte[idBuilder]
  return id ? getSpell(da, id, fetcher) : null
}

/** Quali blocchi di testo sono vivi adesso. Serve ai test e a nient'altro. @returns {string[]} */
export function _loadedLevels() { return [...blocchi.keys()] }

/** Solo per i test: dimentica tutto ciò che è stato caricato. */
export function _reset() { indici.clear(); blocchi.clear(); ponti.clear(); origini.clear(); inCorso.clear() }

/* ── Ricerca ──────────────────────────────────────────────────────────────
   Si cerca mentre si scrive, e si scrive al tavolo con una mano sola: ogni
   tasto premuto ripassa 339 record. Quindi niente espressioni regolari
   costruite dal testo digitato — che oltre a costare la compilazione a ogni
   tasto renderebbero `(` una ricerca sintatticamente rotta — e niente
   normalizzazione ripetuta: i nomi si normalizzano una volta per incantesimo
   e restano attaccati alla voce d'indice, che non se ne va più.               */

/** I segni diacritici che `NFD` stacca dalle lettere. */
const DIACRITICI = /[\u0300-\u036f]/g
/** Separatore dei termini digitati. */
const SPAZI = /\s+/

/**
 * @typedef {object} Cercabile
 * @property {string} nome
 * @property {string} scuola
 * @property {string[]} classi
 */

/**
 * I campi già normalizzati, uno per voce d'indice. Le voci vivono quanto
 * l'indice, quindi il lavoro si paga una volta per incantesimo e non una per
 * tasto premuto. `WeakMap` perché la cache non deve tenere in vita niente.
 * @type {WeakMap<SpellIndexEntry, Cercabile>}
 */
const cercabili = new WeakMap()

/** Minuscolo e senza accenti: «Invisibilità» si trova scrivendo «invisibilita». @param {string} s @returns {string} */
function piatto(s) {
  return s.normalize('NFD').replace(DIACRITICI, '').toLowerCase()
}

/** @param {SpellIndexEntry} voce @returns {Cercabile} */
function cercabile(voce) {
  let c = cercabili.get(voce)
  if (!c) {
    c = { nome: piatto(voce.nome), scuola: piatto(voce.scuola), classi: voce.classi.map(piatto) }
    cercabili.set(voce, c)
  }
  return c
}

/**
 * Ricerca sull'indice: nome, scuola, classe, livello.
 *
 * Puro e sincrono: lavora sull'indice che è già in memoria e non tocca la
 * rete. I termini del testo si combinano in **e** e in qualunque ordine
 * («fuoco palla» trova *Palla di fuoco*); dentro un filtro i valori si
 * combinano in **o** (livello 1 o 2), fra filtri diversi in **e**. Un filtro
 * vuoto o assente non filtra.
 *
 * L'ordine dell'indice si conserva — per livello e poi per nome — perché è
 * quello con cui l'elenco si raggruppa: riordinare per «pertinenza» spezzerebbe
 * i gruppi. Il risultato è sempre un array nuovo: l'indice è condiviso e
 * restituirlo com'è invita chi lo riceve a ordinarlo sul posto.
 *
 * @param {SpellIndexEntry[]} index
 * @param {{testo?: string, livelli?: number[], classi?: string[], scuole?: string[]}} filtri
 * @returns {SpellIndexEntry[]}
 */
export function search(index, filtri) {
  const { testo = '', livelli, classi, scuole } = filtri ?? {}
  const termini = piatto(testo).split(SPAZI).filter(Boolean)
  const perLivello = livelli && livelli.length ? new Set(livelli) : null
  const perClasse = classi && classi.length ? new Set(classi.map(piatto)) : null
  const perScuola = scuole && scuole.length ? new Set(scuole.map(piatto)) : null

  if (!termini.length && !perLivello && !perClasse && !perScuola) return index.slice()

  return index.filter(voce => {
    if (perLivello && !perLivello.has(voce.livello)) return false
    const c = cercabile(voce)
    if (perScuola && !perScuola.has(c.scuola)) return false
    if (perClasse && !c.classi.some(k => perClasse.has(k))) return false
    return termini.every(t => c.nome.includes(t))
  })
}

/**
 * Lo stesso incantesimo nell'altra edizione, o il motivo per cui non c'è.
 *
 * Due esiti diversi, e vanno tenuti distinti da chi chiama:
 * - **non esiste in quell'edizione** → risolve `{presente: false, motivo}`.
 *   Mai `null`: un pannello vuoto non spiega niente, e la ragione va scritta
 *   accanto al lato disattivato del selettore.
 * - **non si è riusciti a leggerlo** (rete assente, file corrotto) → *lancia*.
 *   È l'unico modo di non far passare un guasto per un'assenza: la prima si
 *   racconta, il secondo si riprova.
 *
 * L'assenza si legge dall'indice, che è già in memoria: `cambiamenti` porta
 * `'assente'` proprio per questo, e dirlo non costa un download. Il caso
 * scomodo è l'altro: lo stesso incantesimo tradotto con due nomi diversi
 * (*saltare* nel 5.1, *salto* nel 5.2.1). Lì l'id inglese del builder è il solo
 * ponte fra i due, e si paga il ponte solo quando serve davvero — due
 * incantesimi su 317.
 *
 * Il confronto è fra **edizioni**, e resta tale anche quando si guarda da un
 * pacchetto di variante: di qua si cerca nel compendio com'è, sovrapposizione
 * compresa (un incantesimo della variante deve almeno trovarsi), di là c'è
 * l'altro SRD e basta. Chiedersi quale sia «la variante dell'altra edizione»
 * non avrebbe risposta: una variante sceglie una base, non due.
 *
 * @param {DaDove} da   il compendio da cui si guarda
 * @param {string} id   l'id italiano dell'incantesimo in quell'edizione
 * @param {Fetcher} [fetcher]
 * @returns {Promise<{presente: false, motivo: string} | {presente: true, spell: Spell}>}
 */
export async function counterpart(da, id, fetcher = fetch) {
  const ed = normalizza(da).edizione
  const altra = otherEdition(ed)
  const laSrd = EDITION_LABELS[altra].srd

  const qui = await loadIndex(da, fetcher)
  const voce = qui.find(s => s.id === id)
  if (!voce) return { presente: false, motivo: `«${id}» non è nel compendio dell'${EDITION_LABELS[ed].srd}.` }
  if (voce.cambiamenti.includes('assente')) return { presente: false, motivo: `Non esiste nell'${laSrd}.` }

  const la = await loadIndex(altra, fetcher)
  let idAltra = la.some(s => s.id === id) ? id : ''
  if (!idAltra) {
    const ponteQui = await loadBridge(da, fetcher)
    const idBuilder = Object.keys(ponteQui).find(k => ponteQui[k] === id)
    const ponteLa = idBuilder ? await loadBridge(altra, fetcher) : null
    idAltra = (idBuilder && ponteLa?.[idBuilder]) || ''
  }
  if (!idAltra) return { presente: false, motivo: `Non esiste nell'${laSrd}.` }

  const spell = await getSpell(altra, idAltra, fetcher)
  // L'indice lo dà per presente ma il blocco non ce l'ha: è un dato incoerente,
  // non un'assenza. Si dice com'è invece di far finta che l'incantesimo non ci sia.
  if (!spell) return { presente: false, motivo: `Il compendio dell'${laSrd} non ne ha il testo.` }
  return { presente: true, spell }
}
