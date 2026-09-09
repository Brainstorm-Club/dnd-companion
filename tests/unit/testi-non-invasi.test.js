/**
 * Nessuna descrizione si mangia la voce che la segue.
 *
 * I testi dei pacchetti sono estratti da PDF impaginati su due colonne, e
 * l'estrattore delimita ogni voce fermandosi al titolo dopo. Quando un titolo
 * non è nell'elenco di quelli noti, il blocco **non si ferma**: prosegue e si
 * porta dentro la sezione successiva.
 *
 * È già successo, e non se n'era accorto nessuno: il tratto «Resistenza
 * Strutturale (Contundenti)» del robivecchi — una frase di 84 caratteri —
 * arrivava a 1.524 con dentro l'intera razza Bieconiglio, società, soprannomi
 * e nomi tipici compresi.
 *
 * Le reti che c'erano non potevano vederlo: controllavano che il testo non
 * cominciasse in minuscola, non finisse senza punto, non fosse troppo *corto*.
 * Non esisteva niente contro un testo che **continua troppo**.
 *
 * Il controllo qui è strutturale e non sulla lunghezza, perché la lunghezza
 * darebbe falsi allarmi: «Malitratti Infernali» sta legittimamente a 1.980
 * caratteri, ed elenca corna, code e orecchie di ogni malebranche.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const PACCHETTI = ['2014', '2024', 'brancalonia', 'brancalonia-brainstorm', 'apocalisse']

/** @param {string} id */
function pacchetto(id) {
  const f = `data/rules/${id}.json`
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

/**
 * I nomi delle «voci» di un pacchetto: razze, sottorazze, background, classi,
 * talenti. Sono i titoli che nel manuale aprono una sezione, e quindi quelli
 * che una descrizione non deve mai contenere in apertura di frase.
 * @param {any} p
 * @returns {Set<string>}
 */
function nomiDiVoce(p) {
  /** @type {Set<string>} */
  const out = new Set()
  const agg = (/** @type {unknown} */ n) => {
    // I nomi cortissimi darebbero falsi allarmi: «Dotato» compare in mezzo a
    // una frase come aggettivo, «Umano» come sostantivo comune.
    if (typeof n === 'string' && n.length > 8) out.add(n)
  }
  for (const r of Object.values(p.races ?? {})) {
    const razza = /** @type {any} */ (r)
    agg(razza.name)
    for (const s of Object.values(razza.subraces ?? {})) agg(/** @type {any} */ (s).name)
  }
  for (const b of Object.values(p.backgrounds ?? {})) agg(/** @type {any} */ (b).name)
  for (const t of Object.values(p.talenti ?? {})) {
    const talento = /** @type {any} */ (t)
    agg(talento.name ?? talento.nome)
  }
  return out
}

/**
 * Ogni descrizione del pacchetto, col nome della voce a cui appartiene.
 * @param {unknown} v
 * @param {string} nome
 * @returns {Array<{nome: string, testo: string}>}
 */
function descrizioni(v, nome = '') {
  if (Array.isArray(v)) return v.flatMap(x => descrizioni(x, nome))
  if (!v || typeof v !== 'object') return []
  const o = /** @type {any} */ (v)
  const mio = typeof o.name === 'string' ? o.name : nome
  const qui = typeof o.description === 'string' && o.description
    ? [{ nome: mio, testo: o.description }]
    : []
  return [...qui, ...Object.values(o).flatMap(x => descrizioni(x, mio))]
}

/** @param {string} v */
function perRegex(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe.each(PACCHETTI)('il pacchetto %s', (id) => {
  const p = pacchetto(id)

  it('nessuna descrizione contiene un\'altra voce in apertura di frase', () => {
    if (!p) return
    const nomi = nomiDiVoce(p)
    if (!nomi.size) return

    /** @type {string[]} */
    const invase = []
    for (const { nome, testo } of descrizioni(p)) {
      for (const altro of nomi) {
        if (altro === nome) continue
        // «…non magici. Bieconiglio Alti circa un metro…»: il nome di un'altra
        // voce dopo un punto e seguito da maiuscola è un titolo inghiottito,
        // non una citazione.
        const re = new RegExp(`[.!?»]\\s+${perRegex(altro)}\\s+[A-ZÀ-Ù]`)
        if (re.test(testo)) invase.push(`«${nome}» si è mangiato «${altro}» (${testo.length} caratteri)`)
      }
    }
    expect(invase).toEqual([])
  })
})
