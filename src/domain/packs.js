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
 * Il pacchetto con questo id, o `null`.
 * @param {PackRegistry} registro
 * @param {string} id
 * @returns {Pack|null}
 */
export function packById(registro, id) {
  return registro.packs.find(p => p.id === id) ?? null
}

/**
 * La catena di ereditarietà: il pacchetto, poi il suo `base`, poi il base del
 * base, fino alla radice. **Figlio per primo**, perché è l'ordine di
 * precedenza: chi viene prima vince su chi viene dopo.
 *
 * Due guasti possibili, e sono guasti diversi:
 * - **il ciclo** (A eredita da B, B da A). Non è un caso teorico: basta un
 *   copia-e-incolla nel registro. Senza il `Set` dei visti il `while` non
 *   finisce, e l'app resta in attesa di una schermata che non arriverà mai.
 * - **il base che non esiste**: il registro è rotto, e chi legge l'errore deve
 *   sapere *quale* pacchetto dichiara *quale* base — «pacchetto non trovato»
 *   manda a cercare a mano nel JSON.
 *
 * @param {PackRegistry} registro
 * @param {string} id
 * @returns {Pack[]}
 */
export function packChain(registro, id) {
  /** @type {Pack[]} */
  const catena = []
  /** @type {string[]} */
  const visti = []
  let corrente = id
  while (corrente) {
    if (visti.includes(corrente)) {
      throw new Error(`catena di pacchetti circolare: ${[...visti, corrente].join(' → ')}`)
    }
    visti.push(corrente)
    const pack = packById(registro, corrente)
    if (!pack) {
      const chi = catena[catena.length - 1]
      throw new Error(chi
        ? `il pacchetto «${chi.id}» dichiara base «${corrente}», che non è nel registro`
        : `il pacchetto «${corrente}» non è nel registro`)
    }
    catena.push(pack)
    corrente = pack.base ?? ''
  }
  return catena
}

/**
 * Le cartelle di compendio da sovrapporre per un pacchetto, figlio per primo.
 *
 * Un pacchetto con un base non ha un compendio *alternativo*: ha il compendio
 * del base **più** il suo. Dire quali cartelle sono e in che ordine è mestiere
 * del registro; sovrapporle è mestiere di `spells.js`.
 *
 * @param {PackRegistry} registro
 * @param {string} id
 * @returns {{edizione: Edition, cartelle: string[]}}
 */
export function spellSources(registro, id) {
  const catena = packChain(registro, id)
  const primo = catena[0]
  if (!primo) throw new Error(`il pacchetto «${id}» non è nel registro`)
  return {
    edizione: primo.edizione,
    cartelle: catena.map(p => p.incantesimi).filter(Boolean),
  }
}

/**
 * Vero se il testo di questo pacchetto si può spedire con l'app.
 *
 * I due SRD sono CC-BY: il testo viaggia con l'app. Brancalonia e Apocalisse
 * no — sono di Acheron Games, e finché non c'è il permesso il pacchetto porta
 * nomi, struttura e numeri, ma non le descrizioni. Chi disegna deve poterlo
 * dire all'utente con la frase giusta, e la differenza sta qui e non in un
 * confronto sulla variante sparso per le viste.
 *
 * @param {Pack|null|undefined} pack
 * @returns {boolean}
 */
export function testoSpedibile(pack) {
  return pack?.licenza === 'CC-BY-4.0'
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
