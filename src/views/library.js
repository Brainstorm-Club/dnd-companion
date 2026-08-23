/**
 * La libreria: chi c'è, e come ne entra uno nuovo.  ── Lotto B ──
 *
 * Tre vie d'ingresso (file, incolla, link) che finiscono tutte in
 * `domain/importer.js`, e quattro azioni per ogni scheda già dentro. Tutto ciò
 * che l'import ha dovuto supplire viene mostrato: un default silenzioso è un
 * numero sbagliato che nessuno vede.
 */

import { h, clear } from '../dom.js'
import { loadRegistry } from '../domain/packs.js'
import { fromJson, fromShareUrl, nuovoId, congela } from '../domain/importer.js'
import { derive } from '../domain/character.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */

/** @type {import('../domain/packs.js').PackRegistry|null} */
let registro = null

/** L'esito dell'ultimo import, da mostrare finché non se ne fa un altro. */
/** @type {{tipo: 'ok'|'ko', messaggio: string, avvisi: string[]}|null} */
let esito = null

/** Quale scheda ha chiesto conferma di cancellazione. */
/** @type {string|null} */
let daEliminare = null

/** @type {string[]} */
let urlDaLiberare = []

/** @type {import('./index.js').View} */
export default {
  async render(contenitore, ctx) {
    if (!registro) {
      try {
        registro = await loadRegistry()
      } catch {
        // Senza registro non si può importare, ma la libreria si può leggere.
        registro = null
      }
    }
    // I nomi italiani delle classi stanno nei pacchetti regole: si caricano solo
    // per le edizioni davvero presenti in libreria, prima di disegnare, così la
    // riga non passa da «Cleric» a «Chierico» sotto gli occhi di chi guarda.
    const edizioni = Object.values(ctx.state.characters ?? {})
      .map(c => c?.meta?.edition).filter(Boolean)
    if (edizioni.length) await caricaNomiClasse(/** @type {string[]} */ (edizioni))
    disegna(contenitore, ctx)
  },

  dispose() {
    for (const u of urlDaLiberare) URL.revokeObjectURL(u)
    urlDaLiberare = []
    esito = null
    daEliminare = null
  },
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function disegna(contenitore, ctx) {
  clear(contenitore)
  const voci = Object.entries(ctx.state.characters)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'libreria' }, [
    h('h1', { class: 'bsc-display' }, ctx.t('nav.libreria')),
    voci.length
      ? h('ul', { class: 'dc-elenco' }, voci.map(([id, entry]) => riga(id, entry, contenitore, ctx)))
      : h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')),
    pannelloImport(contenitore, ctx),
  ]))
}

/**
 * Una scheda in elenco: nome, classe e livello, edizione, punti ferita.
 * @param {string} id
 * @param {CharacterEntry} entry
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function riga(id, entry, contenitore, ctx) {
  const d = derive(entry, null)
  const s = entry.snapshot
  const livello = typeof s['level'] === 'number' ? s['level'] : 1

  return h('li', { class: 'bsc-card', dataset: { id } }, [
    h('h2', { class: 'bsc-label' }, entry.meta.name),
    h('p', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, nomeClasse(s, entry?.meta?.edition)),
      h('span', { class: 'bsc-kv__value' }, ctx.t('libreria.livello', { n: livello })),
    ]),
    h('p', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.pf')),
      h('span', { class: 'bsc-kv__value' }, `${entry.play.hp.cur} / ${d.pfMax}`),
    ]),
    h('span', { class: 'bsc-badge' }, ctx.t(`edizione.${entry.meta.edition}`)),
    daEliminare === id ? confermaEliminazione(id, contenitore, ctx) : azioni(id, entry, contenitore, ctx),
  ])
}

/**
 * @param {string} id
 * @param {CharacterEntry} entry
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function azioni(id, entry, contenitore, ctx) {
  return h('div', { class: 'dc-azioni' }, [
    h('a', { class: 'bsc-btn bsc-btn--sm', href: `#/scheda/${encodeURIComponent(id)}/gioco` }, ctx.t('libreria.apri')),
    h('button', {
      class: 'bsc-btn bsc-btn--outline bsc-btn--sm', type: 'button',
      onclick: () => { duplica(id, entry, ctx); disegna(contenitore, ctx) },
    }, ctx.t('libreria.duplica')),
    h('button', {
      class: 'bsc-btn bsc-btn--outline bsc-btn--sm', type: 'button',
      onclick: () => esporta(entry),
    }, ctx.t('libreria.esporta')),
    h('button', {
      class: 'bsc-btn bsc-btn--outline bsc-btn--sm', type: 'button',
      onclick: () => { daEliminare = id; disegna(contenitore, ctx) },
    }, ctx.t('comune.elimina')),
  ])
}

/**
 * Eliminare è l'unica azione che non si disfa: la conferma è in linea, non in
 * un `confirm()` del browser, perché deve stare dentro la stessa scheda e
 * avere target grandi come tutto il resto.
 * @param {string} id
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function confermaEliminazione(id, contenitore, ctx) {
  return h('div', { class: 'dc-azioni', role: 'group', 'aria-label': ctx.t('comune.elimina') }, [
    h('p', { class: 'bsc-alert' }, ctx.t('comune.elimina')),
    h('button', {
      class: 'bsc-btn bsc-btn--errore bsc-btn--sm', type: 'button',
      onclick: () => {
        ctx.update(['characters'], s => {
          delete s.characters[id]
          if (s.activeId === id) s.activeId = null
        })
        daEliminare = null
        disegna(contenitore, ctx)
      },
    }, ctx.t('comune.conferma')),
    h('button', {
      class: 'bsc-btn bsc-btn--ghost bsc-btn--sm', type: 'button',
      onclick: () => { daEliminare = null; disegna(contenitore, ctx) },
    }, ctx.t('comune.annulla')),
  ])
}

/**
 * Il pannello d'import: le tre vie, una sotto l'altra, sempre visibili. Non
 * dietro un accordion: al tavolo si importa una volta e si vuole trovare
 * subito quella che funziona.
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function pannelloImport(contenitore, ctx) {
  const fatto = (/** @type {ReturnType<typeof fromJson>} */ r) => {
    accogli(r, contenitore, ctx)
  }

  const testoIncollato = h('textarea', {
    class: 'bsc-input', id: 'dc-incolla', rows: '4',
    placeholder: ctx.t('import.incollaQui'),
  })
  const linkIncollato = h('input', {
    class: 'bsc-input', id: 'dc-link', type: 'url', inputmode: 'url',
    placeholder: ctx.t('import.incollaQui'),
  })

  return h('section', { class: 'bsc-card', 'data-import': true }, [
    h('h2', { class: 'bsc-label' }, ctx.t('import.titolo')),

    h('label', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label' }, ctx.t('import.file')),
      h('input', {
        class: 'bsc-input', type: 'file', accept: 'application/json,.json',
        onchange: (/** @type {Event} */ ev) => {
          const input = ev.currentTarget
          if (!(input instanceof HTMLInputElement)) return
          const file = input.files?.[0]
          if (!file || !registro) return
          file.text().then(t => fatto(fromJson(t, /** @type {any} */ (registro), 'file')))
          input.value = ''
        },
      }),
    ]),

    h('label', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label' }, ctx.t('import.incolla')),
      testoIncollato,
    ]),
    h('button', {
      class: 'bsc-btn', type: 'button',
      onclick: () => {
        const t = /** @type {HTMLTextAreaElement} */ (testoIncollato).value.trim()
        if (!t || !registro) return
        fatto(fromJson(t, registro, 'paste'))
      },
    }, ctx.t('libreria.importa')),

    h('label', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label' }, ctx.t('import.link')),
      linkIncollato,
    ]),
    h('button', {
      class: 'bsc-btn', type: 'button',
      onclick: () => {
        const t = /** @type {HTMLInputElement} */ (linkIncollato).value.trim()
        if (!t || !registro) return
        fatto(fromShareUrl(t, registro))
      },
    }, ctx.t('libreria.importa')),

    esito ? riquadroEsito(esito, ctx) : false,
  ])
}

/**
 * @param {{tipo: 'ok'|'ko', messaggio: string, avvisi: string[]}} e
 * @param {ViewCtx} ctx
 */
function riquadroEsito(e, ctx) {
  return h('div', { class: 'bsc-alert', role: 'status', 'aria-live': 'polite' }, [
    h('p', {}, e.tipo === 'ko' ? `${ctx.t('import.rifiutato')} — ${e.messaggio}` : e.messaggio),
    e.avvisi.length
      ? h('details', { open: true }, [
        h('summary', {}, ctx.t('import.avvisi', { n: e.avvisi.length })),
        h('ul', {}, e.avvisi.map(a => h('li', {}, a))),
      ])
      : false,
  ])
}

/**
 * @param {ReturnType<typeof fromJson>} r
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function accogli(r, contenitore, ctx) {
  if (!r.ok) {
    // Un rifiuto non è un errore: è una frase che spiega cosa manca.
    esito = { tipo: 'ko', messaggio: r.message, avvisi: [] }
    disegna(contenitore, ctx)
    return
  }
  const id = nuovoId()
  ctx.update(['characters'], s => {
    s.characters[id] = r.entry
    s.activeId = id
  })
  esito = {
    tipo: 'ok',
    messaggio: ctx.t('import.fatto', { nome: r.entry.meta.name }),
    avvisi: r.warnings,
  }
  ctx.toast(esito.messaggio)
  disegna(contenitore, ctx)
}

/**
 * Duplicare copia lo snapshot e **azzera** lo stato di gioco: la copia serve a
 * provare un'altra strada, non a portarsi dietro le ferite dell'originale.
 * @param {string} id
 * @param {CharacterEntry} entry
 * @param {ViewCtx} ctx
 */
function duplica(id, entry, ctx) {
  const copia = /** @type {CharacterEntry} */ (JSON.parse(JSON.stringify(entry)))
  copia.meta = { ...entry.meta, name: `${entry.meta.name} (copia)`, importedAt: new Date().toISOString() }
  copia.snapshot = congela(copia.snapshot)
  ctx.update(['characters'], s => { s.characters[nuovoId()] = copia })
}

/**
 * Esporta lo snapshot così com'è: ciò che esce dall'app deve poter rientrare
 * nel builder senza traduzioni di mezzo.
 * @param {CharacterEntry} entry
 */
function esporta(entry) {
  const blob = new Blob([JSON.stringify(entry.snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  urlDaLiberare.push(url)
  const a = h('a', { href: url, download: `${nomeFile(entry.meta.name)}.json` })
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** @param {string} nome */
function nomeFile(nome) {
  return nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'personaggio'
}

/**
 * I nomi italiani delle classi, per edizione. Si caricano una volta sola dal
 * pacchetto regole; finché non sono arrivati si mostra l'id ripulito, che è
 * riconoscibile e non fa lampeggiare la pagina.
 * @type {Map<string, Record<string, string>>}
 */
const NOMI_CLASSE = new Map()

/**
 * @param {string[]} edizioni
 * @returns {Promise<void>}
 */
export async function caricaNomiClasse(edizioni) {
  await Promise.all([...new Set(edizioni)].map(async (ed) => {
    if (NOMI_CLASSE.has(ed)) return
    try {
      const res = await fetch(`data/rules/${ed}.json`)
      if (!res.ok) throw new Error(String(res.status))
      const pack = await res.json()
      /** @type {Record<string, string>} */
      const nomi = {}
      for (const [id, c] of Object.entries(pack.classes ?? {})) {
        const nome = /** @type {any} */ (c)?.name
        if (typeof nome === 'string') nomi[id] = nome
      }
      NOMI_CLASSE.set(ed, nomi)
    } catch {
      NOMI_CLASSE.set(ed, {})   // niente pacchetto: si resta sull'id ripulito
    }
  }))
}

/**
 * Il builder salva la classe con l'id inglese («cleric»). Il pacchetto regole
 * porta il nome italiano; se manca si mostra l'id ripulito, perché «Cleric» è
 * comunque meglio di «cleric» e molto meglio di niente.
 * @param {Record<string, unknown>} s
 * @param {string} [edizione]
 */
function nomeClasse(s, edizione) {
  const v = typeof s['className'] === 'string' ? s['className'] : ''
  if (!v) return '—'
  const italiano = edizione ? NOMI_CLASSE.get(edizione)?.[v] : undefined
  if (italiano) return italiano
  return v.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}
