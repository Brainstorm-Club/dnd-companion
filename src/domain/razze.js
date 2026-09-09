/**
 * Le razze e i loro tratti, letti dal pacchetto regole.
 *
 * È il gemello di `privilegi.js`, e sta qui per la stessa ragione: la scheda
 * mostra i tratti **del personaggio**, il compendio mostra **tutti**. Due
 * domande diverse sullo stesso dato, e nessuna delle due è affare di una vista.
 *
 * La forma nel pacchetto è `races[id] = { name, traits[], subraces[id] }`: una
 * razza porta i propri tratti, e ogni sottorazza i suoi in più — non al posto
 * di. Chi legge non deve saperlo, e infatti da qui esce un elenco piatto in cui
 * ogni tratto dice da dove viene.
 */

/**
 * @typedef {object} Tratto
 * @property {string} id
 * @property {string} nome
 * @property {string|null} testo         null quando la fonte non ce l'ha
 * @property {string} razza              il nome della razza
 * @property {string} razzaId
 * @property {string|null} sottorazza    il nome, se viene da una sottorazza
 * @property {string|null} sottorazzaId
 */

/**
 * @typedef {object} Razza
 * @property {string} id
 * @property {string} nome
 * @property {Array<{id: string, nome: string}>} sottorazze  vuoto se non ne ha
 */

/**
 * Tutti i tratti di una razza: i suoi e quelli delle sue sottorazze.
 *
 * **Non si riordina.** Nei privilegi c'è il livello, che è un ordine vero; qui
 * non c'è niente di simile, e l'ordine del pacchetto è quello del manuale —
 * riordinare per nome vorrebbe dire mescolare l'elenco che il giocatore ha
 * sotto gli occhi sulla sua scheda con uno inventato qui. I tratti della razza
 * vengono comunque prima di quelli delle sottorazze: è l'ordine in cui si
 * acquisiscono, e in cui li si legge.
 *
 * @param {unknown} rules
 * @param {string} razzaId
 * @param {string} [sottorazzaId]  se dato, solo quella sottorazza
 * @returns {Tratto[]}
 */
export function trattiDiRazza(rules, razzaId, sottorazzaId) {
  const razza = oggetto(oggetto(leggi(rules, 'races'))[razzaId])
  if (!razza['id'] && !razza['traits']) return []
  const nomeRazza = stringa(razza['name']) || razzaId

  /** @type {Tratto[]} */
  const out = []
  for (const t of lista(razza['traits'])) {
    const v = voce(t, nomeRazza, razzaId, null, null)
    if (v) out.push(v)
  }

  const sotto = oggetto(razza['subraces'])
  for (const [id, s] of Object.entries(sotto)) {
    if (sottorazzaId && id !== sottorazzaId) continue
    const o = oggetto(s)
    const nomeSotto = stringa(o['name']) || id
    for (const t of lista(o['traits'])) {
      const v = voce(t, nomeRazza, razzaId, nomeSotto, id)
      if (v) out.push(v)
    }
  }

  return out
}

/**
 * L'elenco delle razze del pacchetto, con le loro sottorazze, per costruire un
 * indice. Ordinate per nome — qui l'ordine del manuale non dice niente, e chi
 * cerca «Marionetta» in venti razze la cerca in ordine alfabetico.
 * @param {unknown} rules
 * @returns {Razza[]}
 */
export function razzeDelPacchetto(rules) {
  return Object.entries(oggetto(leggi(rules, 'races')))
    .map(([id, r]) => ({
      id,
      nome: stringa(oggetto(r)['name']) || id,
      sottorazze: Object.entries(oggetto(oggetto(r)['subraces']))
        .map(([sid, s]) => ({ id: sid, nome: stringa(oggetto(s)['name']) || sid }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
}

/**
 * @param {unknown} t
 * @param {string} razza
 * @param {string} razzaId
 * @param {string|null} sottorazza
 * @param {string|null} sottorazzaId
 * @returns {Tratto|null}
 */
function voce(t, razza, razzaId, sottorazza, sottorazzaId) {
  const o = oggetto(t)
  const nome = stringa(o['name']) || stringa(o['nome'])
  if (!nome) return null
  const testo = stringa(o['description']) || stringa(o['descrizione'])
  return {
    id: stringa(o['id']) || nome,
    nome,
    // Oggi nessun pacchetto ha il testo dei tratti di razza: `null` dice «non
    // c'è», che non è «stringa vuota», e la vista può dire *perché* non c'è.
    testo: testo || null,
    razza,
    razzaId,
    sottorazza,
    sottorazzaId,
  }
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {any} */ (v) : {} }
/** @param {unknown} v @returns {unknown[]} */
function lista(v) { return Array.isArray(v) ? v : [] }
/** @param {unknown} v @returns {string} */
function stringa(v) { return typeof v === 'string' ? v : '' }
/** @param {unknown} r @param {string} k @returns {unknown} */
function leggi(r, k) { return oggetto(r)[k] }
