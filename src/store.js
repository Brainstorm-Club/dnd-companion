/**
 * Lo stato dell'app, e chi va avvisato quando cambia.
 *
 * Le notifiche sono **per sezione** (`hp`, `slots`, `dice`, `characters`, …):
 * un tap sui punti ferita non deve far ridisegnare l'inventario. È la scelta
 * che tiene bassi i nodi DOM toccati, e con loro il consumo.
 *
 * Il salvataggio è differito di un tick: dieci tap sui PF fanno una scrittura,
 * non dieci.
 */

import { load, save, emptyState } from './storage.js'

/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {string} Section */

/** @type {AppState} */
let state = emptyState()
/** @type {Map<Section, Set<(s: AppState) => void>>} */
const subs = new Map()
/** @type {ReturnType<typeof setTimeout>|undefined} */
let pending

/** @returns {AppState} */
export function getState() { return state }

/** Carica da localStorage. Da chiamare una volta, all'avvio. */
export function init() {
  state = load()
  return state
}

/**
 * @param {Section} sezione
 * @param {(s: AppState) => void} fn
 * @returns {() => void}
 */
export function subscribe(sezione, fn) {
  let set = subs.get(sezione)
  if (!set) { set = new Set(); subs.set(sezione, set) }
  set.add(fn)
  return () => { set?.delete(fn) }
}

/**
 * Applica una modifica e avvisa **solo** le sezioni indicate.
 * @param {Section[]} sezioni
 * @param {(s: AppState) => void} muta
 */
export function update(sezioni, muta) {
  muta(state)
  for (const s of sezioni) subs.get(s)?.forEach(fn => fn(state))
  scheduleSave()
}

function scheduleSave() {
  if (pending !== undefined) return
  pending = setTimeout(() => { pending = undefined; save(state) }, 0)
}

/**
 * Scrive subito, se c'era qualcosa in attesa.
 *
 * Il raggruppamento delle scritture serve a non serializzare l'intero stato a
 * ogni tap sui PF, ma lascia una finestra in cui l'ultimo gesto non è ancora su
 * disco. Chiudere l'app o passare in sfondo dentro quella finestra farebbe
 * perdere l'ultimo tiro: qui la finestra si chiude.
 */
export function flush() {
  if (pending === undefined) return
  clearTimeout(pending)
  pending = undefined
  save(state)
}

if (typeof document !== 'undefined') {
  // `pagehide` e `visibilitychange` sono gli unici due eventi su cui iOS dà
  // garanzie quando l'app va in sfondo o viene chiusa: `beforeunload` no.
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

/** Solo per i test. @param {AppState} s */
export function _setState(s) { state = s }
