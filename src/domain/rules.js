/**
 * Il caricatore dei pacchetti regole, e l'ereditarietà fra pacchetti.
 *
 * Prima esisteva quattro volte — scheda, prove, privilegi, avanzamento avevano
 * ciascuna il suo `fetch(pack.regole)` e la sua cache. Finché i pacchetti erano
 * due e indipendenti era duplicazione innocua; con `base` sarebbero diventate
 * quattro implementazioni diverse della stessa fusione, cioè quattro schede
 * dello stesso personaggio con privilegi diversi. Quindi: un caricatore solo,
 * e le viste chiedono a lui.
 *
 * La cache resta una per `packId`, che è la chiave giusta: due personaggi dello
 * stesso pacchetto condividono le regole, e un pacchetto che eredita si fonde
 * una volta per sessione, non una per disegno.
 */

import { loadRegistry, packById, packChain } from './packs.js'

/** @typedef {(url: string) => Promise<Response>} Fetcher */

/** Un pezzo della catena non è arrivato: non è un'assenza, è un buco di rete. */
class NonCaricato extends Error {
  /** @param {string} packId */
  constructor(packId) { super(`pacchetto «${packId}»: un file della catena non si è caricato`) }
}

/** Le regole già fuse, per id di pacchetto. Solo i caricamenti riusciti. */
/** @type {Map<string, unknown>} */
const caricate = new Map()

/** Le richieste in volo: due viste che si disegnano insieme fanno un download solo. */
/** @type {Map<string, Promise<unknown>>} */
const inCorso = new Map()

/**
 * Le regole di un pacchetto, con tutto ciò che eredita dal suo base.
 *
 * Torna `null` — non lancia — quando il pacchetto non è nel registro o un file
 * della catena non si legge: è il comportamento che le viste avevano già, e che
 * tiene l'app in piedi senza rete (`derive`, `planLevelUp` e i privilegi sanno
 * tutti cavarsela con `null`, e lo dichiarano).
 *
 * Lancia invece quando la **catena** è rotta — base inesistente, o ciclo:
 * quello non è un file che manca, è il registro che si contraddice, e passarlo
 * per un'assenza vorrebbe dire spedirlo.
 *
 * @param {string} packId
 * @param {Fetcher} [fetcher]
 * @returns {Promise<unknown>}
 */
export async function loadRules(packId, fetcher = fetch) {
  if (caricate.has(packId)) return caricate.get(packId) ?? null
  const attesa = inCorso.get(packId)
  if (attesa) return attesa

  const p = (async () => {
    const registro = await loadRegistry(fetcher)
    if (!packById(registro, packId)) return null
    const catena = packChain(registro, packId)   // lancia se la catena è rotta
    const pezzi = await Promise.all(catena.map(pack => leggi(pack.regole, fetcher)))
    // Un pezzo che non arriva non si mette in cache come «non c'è»: `leggi()`
    // torna `null` sia per un file assente sia per una rete caduta, e sono due
    // cose diverse. Ricordare il secondo caso avvelenava la sessione intera —
    // regole nulle, sottoclassi mancanti, compendi vuoti — anche dopo che la
    // rete era tornata, e non si riparava senza ricaricare la pagina. Chi apre
    // l'app mentre il service worker sta ancora installando ci finiva dentro.
    if (pezzi.some(x => x === null)) throw new NonCaricato(packId)

    // Si parte dalla radice e si sale verso il figlio: ogni passo sovrappone
    // chi ha più diritto di ridefinire. Un pacchetto senza base non passa
    // nemmeno da `mergeRules` — è il caso di gran lunga più comune, e non deve
    // pagare né una copia né una forma diversa da quella che arriva dal file.
    /** @type {unknown} */
    let out = pezzi[pezzi.length - 1] ?? null
    for (let i = pezzi.length - 2; i >= 0; i--) out = mergeRules(out, pezzi[i])
    return out
  })()
    .then(r => { caricate.set(packId, r); return r })
    // Un buco di rete non diventa un ricordo: si riproverà al prossimo giro.
    .catch(e => { if (e instanceof NonCaricato) return null; throw e })
    .finally(() => { inCorso.delete(packId) })

  inCorso.set(packId, p)
  return p
}

/**
 * Le regole già caricate, senza aspettare. Serve a chi deve rispondere a un
 * tocco: le prove ricalcolano i bonus del lato B mentre il dito è ancora giù,
 * e una `Promise` lì dentro vorrebbe dire un fotogramma con i numeri vecchi.
 * @param {string} packId
 * @returns {unknown}
 */
export function rulesFor(packId) {
  return caricate.get(packId) ?? null
}

/** Solo per i test: dimentica ciò che è stato caricato. */
export function _resetRules() { caricate.clear(); inCorso.clear() }

/**
 * @param {string} url
 * @param {Fetcher} fetcher
 * @returns {Promise<unknown>}
 */
async function leggi(url, fetcher) {
  try {
    const res = await fetcher(url)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/* ── La fusione ───────────────────────────────────────────────────────────── */

/**
 * Fonde `sopra` (il figlio) su `base`, senza toccare nessuno dei due.
 *
 * **Perché profonda.** Un pacchetto che aggiunge una sottoclasse scrive
 * `classes: { barbarian: { subclasses: { … } } }` e basta: non riscrive dado
 * vita, tiri salvezza, livelli di ASI e privilegi del barbaro, che sono già
 * giusti nel base. Con una fusione superficiale quel pacchetto cancellerebbe le
 * classi non citate; con una fusione a un solo livello cancellerebbe tutto il
 * resto del barbaro. Quindi si scende fino alla foglia, e ci si ferma dove la
 * foglia non è più un oggetto.
 *
 * **Gli array non sono tutti uguali**, e il tipo di merge si legge dal dato, non
 * da un elenco di nomi di campo — un elenco andrebbe aggiornato a ogni campo
 * nuovo, e il motore non deve conoscere lo schema dei pacchetti:
 * - un array di oggetti **tutti con un `id`** è una *collezione*: `conditions`,
 *   `features`, `traits`. Aggiungere una condizione non deve cancellare le
 *   altre quindici, quindi si fonde per id — chi c'è già viene ridefinito sul
 *   posto (e in profondità), chi è nuovo si accoda.
 * - qualunque altro array è una *tabella*: `xpThresholds`, `spellSlots.full`,
 *   `cantripsKnown.bard`, `asiLevels`. Sono sequenze posizionali di venti
 *   numeri: concatenarle darebbe una tabella di quaranta livelli, e fonderle
 *   «per indice» darebbe una tabella metà di uno e metà dell'altro, che è
 *   peggio. Chi la ridefinisce la ridefinisce intera.
 *
 * **Assenza, `null` e `[]` vogliono dire la stessa cosa: «non ho niente da
 * dire».** I pacchetti sono generati, e un generatore scrive `description:
 * null` per il testo che non può spedire (materiale non-SRD) e `features: []`
 * per ciò che non ha estratto. Se quei valori vincessero, un pacchetto figlio
 * cancellerebbe il testo SRD dei privilegi che condivide col base — un danno
 * silenzioso, visibile solo a chi apre quella scheda. Il prezzo è dichiarato:
 * **un figlio non può togliere niente al base**, solo aggiungere o ridefinire.
 * Se un giorno servisse, la mossa è un marcatore esplicito (`"__rimuovi": [...]`),
 * non il `null` che i generatori producono per caso.
 *
 * @param {unknown} base
 * @param {unknown} sopra
 * @returns {unknown}
 */
export function mergeRules(base, sopra) {
  if (sopra === undefined || sopra === null) return base
  if (base === undefined || base === null) return sopra
  if (Array.isArray(base) || Array.isArray(sopra)) return fondiArray(base, sopra)
  if (semplice(base) && semplice(sopra)) {
    /** @type {Record<string, unknown>} */
    const out = { ...base }
    for (const [k, v] of Object.entries(sopra)) out[k] = mergeRules(out[k], v)
    return out
  }
  return sopra
}

/**
 * @param {unknown} base
 * @param {unknown} sopra
 * @returns {unknown}
 */
function fondiArray(base, sopra) {
  if (!collezione(base) || !collezione(sopra)) return Array.isArray(sopra) && sopra.length === 0 ? base : sopra
  /** @type {unknown[]} */
  const out = base.slice()
  /** @type {Map<string, number>} */
  const dove = new Map()
  out.forEach((x, i) => { const k = idDi(x); if (k) dove.set(k, i) })
  for (const v of sopra) {
    const i = dove.get(idDi(v))
    if (i === undefined) { dove.set(idDi(v), out.length); out.push(v) }
    else out[i] = mergeRules(out[i], v)
  }
  return out
}

/**
 * Un array è una collezione se ogni elemento è un oggetto con un `id` non
 * vuoto: è la forma che nei pacchetti hanno le cose *elencate*, in opposizione
 * alle cose *tabellate*.
 * @param {unknown} v
 * @returns {v is Record<string, unknown>[]}
 */
function collezione(v) {
  if (!Array.isArray(v) || v.length === 0) return false
  const conId = v.filter(x => semplice(x) && typeof x['id'] === 'string' && x['id'] !== '')
  // Basta **un** elemento con un id, non che ce l'abbiano tutti. Prima serviva
  // la totalità: un solo elemento sbadato — una svista del generatore — faceva
  // ricadere l'array fra le «tabelle», e una tabella si sostituisce intera. Il
  // figlio cancellava così tutto ciò che il base aveva messo lì, in silenzio:
  // privilegi spariti da una scheda senza un errore.
  //
  // Nel dubbio si conserva, perché fra i due errori possibili — tenere una
  // riga di troppo o perdere un privilegio — solo il secondo si nota al tavolo,
  // e solo quando è tardi. Le tabelle vere non hanno **nessun** id
  // (`spellSlots.pact`, le voci del patatrac) e restano tabelle.
  return conId.length > 0
}

/** @param {unknown} x @returns {string} */
function idDi(x) {
  return semplice(x) ? String(x['id']) : ''
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function semplice(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
