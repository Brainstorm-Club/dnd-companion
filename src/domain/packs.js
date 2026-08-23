/**
 * Il registro dei pacchetti di regole.
 *
 * È l'unico punto dell'app che sa quali varianti di gioco esistono. Tutto il
 * resto chiede qui. La ragione è la v3: Brancalonia e gli altri giochi Acheron
 * arriveranno come pacchetti scaricabili, e devono poterlo fare aggiungendo una
 * voce a `data/packs.json` — non toccando il motore.
 *
 * Da cui la regola, verificata da un test: **nessun confronto sulla variante di
 * gioco fuori da questo file**.
 */

/** @typedef {import('./edition.js').Edition} Edition */

/**
 * @typedef {object} Pack
 * @property {string} id
 * @property {string} nome
 * @property {Edition} edizione
 * @property {string[]} varianti   le `variant` del builder che questo pacchetto copre
 * @property {boolean} incluso     spedito con l'app (true) o da scaricare (false)
 * @property {string} licenza
 * @property {number} kb           peso dichiarato, mostrato prima di scaricare
 * @property {string} [base]       id del pacchetto da cui eredita ciò che non ridefinisce
 * @property {string} [url]        da dove si scarica, se non incluso
 * @property {string} regole       percorso del pacchetto regole
 * @property {string} incantesimi  cartella del compendio
 * @property {string} attribuzione testo di attribuzione, verbatim
 */

/** @typedef {{ v: number, packs: Pack[] }} PackRegistry */

/** @type {PackRegistry|null} */
let _registro = null

/**
 * Carica il registro una volta sola.
 * @param {(url: string) => Promise<Response>} [fetcher]
 * @returns {Promise<PackRegistry>}
 */
export async function loadRegistry(fetcher = fetch) {
  if (_registro) return _registro
  const res = await fetcher('data/packs.json')
  if (!res.ok) throw new Error(`registro dei pacchetti non leggibile: ${res.status}`)
  _registro = /** @type {PackRegistry} */ (await res.json())
  return _registro
}

/** Solo per i test: dimentica ciò che è stato caricato. @param {PackRegistry|null} [r] */
export function _setRegistry(r = null) { _registro = r }

/**
 * Il pacchetto che copre una variante del builder, o `null` se nessuno lo fa.
 * @param {PackRegistry} registro
 * @param {string} variante
 * @returns {Pack|null}
 */
export function packForVariant(registro, variante) {
  return registro.packs.find(p => p.varianti.includes(variante)) ?? null
}

/**
 * Se la variante non è coperta, cosa dire all'utente. Mai «errore»: la v1
 * semplicemente non ha ancora quel pacchetto, e la frase deve dirlo.
 * @param {string} variante
 * @returns {string}
 */
export function missingPackMessage(variante) {
  const noti = { brancalonia: 'Brancalonia', apocalisse: 'Apocalisse' }
  const nome = noti[/** @type {keyof typeof noti} */ (variante)]
  return nome
    ? `Questo personaggio è di ${nome}, che ha regole sue. Il pacchetto ${nome} arriva in una prossima versione: per ora l'app gestisce D&D 2014 e 2024.`
    : `Questo personaggio usa la variante «${variante}», che l'app non conosce. Per ora gestisce D&D 2014 e 2024.`
}
