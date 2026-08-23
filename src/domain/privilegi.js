/**
 * I privilegi di classe, letti dal pacchetto regole.
 *
 * Servono in due posti diversi, ed è per questo che stanno qui e non in una
 * vista: la scheda mostra quelli **del personaggio**, il compendio mostra
 * **tutti**. Le due cose leggono lo stesso dato con due domande diverse.
 */

/** @typedef {import('./edition.js').Edition} Edition */

/**
 * @typedef {object} Privilegio
 * @property {string} id
 * @property {string} nome
 * @property {number} livello        a che livello si ottiene
 * @property {string|null} testo     null quando la fonte non ce l'ha
 * @property {string} classe         il nome della classe
 * @property {string} classeId
 * @property {string|null} sottoclasse  il nome, se viene da una sottoclasse
 */

/**
 * Tutti i privilegi di una classe, quelli della classe e quelli delle sue
 * sottoclassi, ordinati per livello.
 *
 * @param {unknown} rules
 * @param {string} classeId
 * @param {string} [sottoclasseId]  se dato, solo quella sottoclasse
 * @returns {Privilegio[]}
 */
export function privilegiDiClasse(rules, classeId, sottoclasseId) {
  const classe = oggetto(oggetto(leggi(rules, 'classes'))[classeId])
  if (!classe['id'] && !classe['features']) return []
  const nomeClasse = stringa(classe['name']) || classeId

  /** @type {Privilegio[]} */
  const out = []
  for (const f of lista(classe['features'])) {
    const v = voce(f, nomeClasse, classeId, null)
    if (v) out.push(v)
  }

  const sotto = oggetto(classe['subclasses'])
  for (const [id, s] of Object.entries(sotto)) {
    if (sottoclasseId && id !== sottoclasseId) continue
    const o = oggetto(s)
    const nomeSotto = stringa(o['name']) || id
    for (const f of lista(o['features'])) {
      const v = voce(f, nomeClasse, classeId, nomeSotto)
      if (v) out.push(v)
    }
  }

  return out.sort((a, b) => a.livello - b.livello || a.nome.localeCompare(b.nome, 'it'))
}

/**
 * L'elenco delle classi del pacchetto, per costruire un indice.
 * @param {unknown} rules
 * @returns {Array<{id: string, nome: string}>}
 */
export function classiDelPacchetto(rules) {
  return Object.entries(oggetto(leggi(rules, 'classes')))
    .map(([id, c]) => ({ id, nome: stringa(oggetto(c)['name']) || id }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
}

/**
 * @param {unknown} f
 * @param {string} classe
 * @param {string} classeId
 * @param {string|null} sottoclasse
 * @returns {Privilegio|null}
 */
function voce(f, classe, classeId, sottoclasse) {
  const o = oggetto(f)
  const nome = stringa(o['name']) || stringa(o['nome'])
  if (!nome) return null
  const testo = stringa(o['description']) || stringa(o['descrizione'])
  return {
    id: stringa(o['id']) || nome,
    nome,
    livello: typeof o['level'] === 'number' ? o['level'] : 0,
    // La fonte a volte non ha il testo — venti privilegi di sottoclasse del
    // 2014, per esempio. `null` dice «non c'è», che non è «stringa vuota».
    testo: testo || null,
    classe,
    classeId,
    sottoclasse,
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
