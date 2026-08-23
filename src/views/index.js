/**
 * Il registro delle viste, e il loro contratto.
 *
 * Ogni vista esporta `render(contenitore, ctx)` e, se le serve, `dispose()`.
 * Il router chiama `dispose()` della vista uscente e `render()` di quella
 * entrante: chi apre un listener fuori dal proprio contenitore lo chiude qui.
 *
 * Questo file esiste perché cinque lotti in parallelo non possano litigare su
 * `main.js`: ognuno scrive **solo** il proprio file di vista.
 */

/**
 * @typedef {object} ViewCtx
 * @property {import('../router.js').Route} route
 * @property {import('../storage.js').AppState} state
 * @property {(sezioni: string[], muta: (s: import('../storage.js').AppState) => void) => void} update
 * @property {(chiave: string, vars?: Record<string, string|number>) => string} t
 * @property {(messaggio: string) => void} toast
 * @property {(rotta: string) => void} go
 */

/**
 * @typedef {object} View
 * @property {(contenitore: HTMLElement, ctx: ViewCtx) => void|Promise<void>} render
 * @property {() => void} [dispose]
 */

/** @type {Record<string, () => Promise<View>>} */
export const VISTE = {
  libreria:     () => import('./library.js').then(m => m.default),
  scheda:       () => import('./sheet.js').then(m => m.default),
  dadi:         () => import('./dice.js').then(m => m.default),
  prove:        () => import('./checks.js').then(m => m.default),
  px:           () => import('./progress.js').then(m => m.default),
  livello:      () => import('./levelup.js').then(m => m.default),
  incantesimi:  () => import('./spells.js').then(m => m.default),
  impostazioni: () => import('./settings.js').then(m => m.default),
}
