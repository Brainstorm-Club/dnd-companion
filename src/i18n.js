/**
 * Traduzioni, ridotte all'osso.
 *
 * Un dizionario per lingua, caricato all'avvio; nessuna libreria, nessuna
 * compilazione a runtime. L'italiano è la lingua del progetto: se una chiave
 * manca in inglese si mostra l'italiano, non la chiave.
 */

/** @type {Record<string, string>} */
let dict = {}
/** @type {Record<string, string>} */
let fallback = {}
let corrente = 'it'

/**
 * @param {string} lang
 * @param {(url: string) => Promise<Response>} [fetcher]
 */
export async function setLang(lang, fetcher = fetch) {
  const carica = async (/** @type {string} */ l) => {
    const res = await fetcher(`lang/${l}.json`)
    return res.ok ? await res.json() : {}
  }
  fallback = await carica('it')
  dict = lang === 'it' ? fallback : await carica(lang)
  corrente = lang
  document.documentElement.lang = lang
  // Chi ha già disegnato qualcosa deve poterlo rifare: la barra di navigazione
  // è disegnata una volta all'avvio, e senza questo restava nella lingua di
  // prima mentre il resto cambiava.
  dispatchEvent(new CustomEvent('dc:lingua', { detail: { lang } }))
}

export function getLang() { return corrente }

/**
 * @param {string} chiave
 * @param {Record<string, string|number>} [vars]  sostituisce `{nome}`
 * @returns {string}
 */
export function t(chiave, vars) {
  let s = dict[chiave] ?? fallback[chiave] ?? chiave
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}
