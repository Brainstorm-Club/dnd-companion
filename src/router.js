/**
 * Router a hash.
 *
 * A hash e non a percorsi perché l'app sta su GitHub Pages senza server: con i
 * percorsi servirebbe il trucco del `404.html` che il builder si porta dietro,
 * e non ne vale la pena per sei viste.
 *
 * Le rotte sono `#/libreria`, `#/scheda/<id>/<sezione>`, `#/dadi`, `#/prove`,
 * `#/px`, `#/incantesimi`, `#/impostazioni`.
 */

/** @typedef {{ nome: string, params: Record<string, string> }} Route */

/** @type {Array<{re: RegExp, nome: string, chiavi: string[]}>} */
const ROTTE = [
  { re: /^#\/?$/,                                   nome: 'libreria',     chiavi: [] },
  { re: /^#\/libreria$/,                            nome: 'libreria',     chiavi: [] },
  { re: /^#\/scheda\/([^/]+)(?:\/([^/]+))?$/,       nome: 'scheda',       chiavi: ['id', 'sezione'] },
  { re: /^#\/dadi$/,                                nome: 'dadi',         chiavi: [] },
  { re: /^#\/prove$/,                               nome: 'prove',        chiavi: [] },
  { re: /^#\/px\/([^/]+)$/,                         nome: 'px',           chiavi: ['id'] },
  { re: /^#\/livello\/([^/]+)$/,                    nome: 'livello',      chiavi: ['id'] },
  { re: /^#\/incantesimi(?:\/([^/]+))?$/,           nome: 'incantesimi',  chiavi: ['id'] },
  { re: /^#\/impostazioni$/,                        nome: 'impostazioni', chiavi: [] },
]

/**
 * @param {string} hash
 * @returns {Route}
 */
export function match(hash) {
  const h = hash || '#/'
  for (const r of ROTTE) {
    const m = r.re.exec(h)
    if (!m) continue
    /** @type {Record<string, string>} */
    const params = {}
    r.chiavi.forEach((k, i) => { const v = m[i + 1]; if (v) params[k] = decodeURIComponent(v) })
    return { nome: r.nome, params }
  }
  return { nome: 'libreria', params: {} }
}

/**
 * @param {(r: Route) => void} onRoute
 * @returns {() => void}
 */
export function start(onRoute) {
  const fire = () => onRoute(match(location.hash))
  addEventListener('hashchange', fire)
  fire()
  return () => removeEventListener('hashchange', fire)
}

/** @param {string} to */
export function go(to) {
  location.hash = to.startsWith('#') ? to : `#${to}`
}
