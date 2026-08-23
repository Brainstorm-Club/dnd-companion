/**
 * Persistenza su localStorage, con migrazioni versionate.
 *
 * Uno snapshot di personaggio pesa ~20 KB: il budget di localStorage (5 MB)
 * regge una decina di personaggi con largo margine, e a quel punto avvisiamo.
 * Le scritture sono raggruppate: un tap sui PF non deve costare una
 * serializzazione dell'intero stato.
 */

export const STORAGE_KEY = 'dndc'
export const SCHEMA_VERSION = 1
/** Oltre questa quota si avvisa l'utente. */
export const QUOTA_WARN = 0.8
/** Dove finisce uno stato che non sappiamo leggere, invece che nel cestino. */
export const BACKUP_KEY = 'dndc.backup'

/** @typedef {import('./domain/edition.js').Edition} Edition */

/**
 * @typedef {object} PlayState
 * @property {{cur: number, temp: number}} hp
 * @property {{spent: number}} hitDice
 * @property {Record<string, {used: number}>} slots
 * @property {string[]} conditions
 * @property {boolean} inspiration
 * @property {Record<string, number>} coins
 * @property {Record<string, number>} uses
 * @property {number} xp
 * @property {{succ: number, fail: number}} deaths
 * @property {string} notes
 */

/**
 * @typedef {object} CharacterEntry
 * @property {Record<string, unknown>} snapshot  il JSON del builder, congelato
 * @property {{importedAt: string, source: 'file'|'paste'|'link', variant: string, name: string, packId: string, edition: Edition}} meta
 * @property {PlayState} play
 * @property {Array<{at: string, from: number, to: number, diff: unknown}>} levels
 */

/**
 * Una voce dello storico dei tiri. La forma è fissata dal lotto A: tiparla qui
 * evita che ogni lettore debba indovinare con un cast.
 * @typedef {object} DiceLogEntry
 * @property {string} at          quando, in ISO
 * @property {string} [label]     da dove veniva il tiro («Percezione», «Spadone — danno»)
 * @property {string} source      la notazione come l'ha scritta chi tirava
 * @property {string} formula     la notazione espansa («2d20kh1 + 3»)
 * @property {number} total
 * @property {Array<{faces: number, value: number, dropped: boolean, rerolled?: boolean}>} dice
 */

/**
 * @typedef {object} AppState
 * @property {number} v
 * @property {Record<string, CharacterEntry>} characters
 * @property {string|null} activeId
 * @property {{theme: string, lang: string, xpMode: 'xp'|'milestone', edition: Edition|'auto'}} settings
 * @property {DiceLogEntry[]} diceLog
 */

/** @returns {AppState} */
export function emptyState() {
  return {
    v: SCHEMA_VERSION,
    characters: {},
    activeId: null,
    settings: { theme: 'dark', lang: 'it', xpMode: 'xp', edition: 'auto' },
    diceLog: [],
  }
}

/**
 * Migrazioni da versione a versione. La chiave è la versione di partenza.
 * Aggiungerne una è l'unico modo consentito di cambiare la forma dello stato:
 * uno stato salvato mesi fa deve poter arrivare a oggi senza perdere niente.
 * @type {Record<number, (s: any) => any>}
 */
export const MIGRATIONS = {}

/**
 * @param {any} raw
 * @returns {AppState}
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState()
  let s = raw
  let v = typeof s.v === 'number' ? s.v : 0
  // Stato scritto da una versione più nuova dell'app: succede se qualcuno apre
  // una copia in cache dopo aver usato un aggiornamento. Non sappiamo leggerlo
  // e non dobbiamo indovinare — ma nemmeno buttarlo: ci pensa load() a metterlo
  // da parte prima di ripartire da zero.
  if (v > SCHEMA_VERSION) return emptyState()
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v]
    if (!step) return emptyState()   // salto impossibile: meglio ripartire che corrompere
    s = step(s)
    v = s.v
  }
  return /** @type {AppState} */ (s)
}

/**
 * @param {Storage} [store]
 * @returns {AppState}
 */
export function load(store = globalThis.localStorage) {
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.v === 'number' && parsed.v > SCHEMA_VERSION) {
      try { store.setItem(BACKUP_KEY, raw) } catch { /* niente spazio: pazienza */ }
      return emptyState()
    }
    return migrate(parsed)
  } catch {
    return emptyState()
  }
}

/**
 * @param {AppState} state
 * @param {Storage} [store]
 * @returns {{ok: true, bytes: number} | {ok: false, error: string}}
 */
export function save(state, store = globalThis.localStorage) {
  try {
    const text = JSON.stringify(state)
    store.setItem(STORAGE_KEY, text)
    return { ok: true, bytes: text.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
