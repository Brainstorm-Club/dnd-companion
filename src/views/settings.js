/**
 * Le impostazioni.
 *
 * Quasi tutto quello che sta qui esisteva già nello stato ma non aveva un
 * interruttore: la modalità dei punti esperienza, la preferenza di edizione, la
 * lingua. Un'opzione senza interfaccia è un'opzione che non c'è.
 *
 * L'unica cosa che questa vista fa e che nessun'altra può fare è **portare via
 * i dati**: un'app che tiene tutto sul dispositivo deve poter restituire ciò
 * che tiene, altrimenti il «niente esce da qui» diventa una prigione invece che
 * una promessa.
 */

import { h, clear } from '../dom.js'
import { EDITIONS, EDITION_LABELS } from '../domain/edition.js'
import { STORAGE_KEY, SCHEMA_VERSION, migrate } from '../storage.js'
import { setLang, getLang } from '../i18n.js'
import { kv } from './parti.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */

/** Gli URL creati per i salvataggi: si liberano quando la vista se ne va. */
let daLiberare = /** @type {string[]} */ ([])

/** @type {import('./index.js').View} */
export default {
  render(contenitore, ctx) {
    disegna(contenitore, ctx)
  },

  dispose() {
    for (const u of daLiberare) URL.revokeObjectURL(u)
    daLiberare = []
  },
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function disegna(contenitore, ctx) {
  const t = ctx.t
  const s = ctx.state
  const ridisegna = () => disegna(contenitore, ctx)

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'impostazioni' }, [
    h('h1', { class: 'bsc-display' }, t('opz.titolo')),

    // ── Aspetto ───────────────────────────────────────────────────────────
    h('h2', { class: 'bsc-label' }, t('opz.aspetto')),
    scelta(t('opz.tema'), [
      [t('opz.temaScuro'), 'dark'], [t('opz.temaChiaro'), 'light'], [t('opz.temaAuto'), 'auto'],
    ], temaCorrente(), (v) => { cambiaTema(v); ridisegna() }),

    scelta(t('opz.lingua'), [[t('opz.italiano'), 'it'], [t('opz.inglese'), 'en']], getLang(),
      async (v) => {
        await setLang(v)
        ctx.update(['settings'], (st) => { st.settings.lang = v })
        ridisegna()
      }),

    // ── Gioco ─────────────────────────────────────────────────────────────
    h('h2', { class: 'bsc-label' }, t('opz.gioco')),
    scelta(t('opz.px'), [[t('opz.pxConta'), 'xp'], [t('opz.pxTraguardi'), 'milestone']],
      s.settings.xpMode,
      (v) => { ctx.update(['settings'], (st) => { st.settings.xpMode = /** @type {any} */ (v) }); ridisegna() }),

    scelta(t('opz.edizione'),
      [[t('opz.edizioneAuto'), 'auto'], ...EDITIONS.map(e => [`${t(`edizione.${e}`)} · ${EDITION_LABELS[e].srd}`, e])],
      s.settings.edition,
      (v) => { ctx.update(['settings'], (st) => { st.settings.edition = /** @type {any} */ (v) }); ridisegna() }),
    h('p', { class: 'bsc-lead' }, t('opz.edizioneNota')),

    // ── Dati ──────────────────────────────────────────────────────────────
    h('h2', { class: 'bsc-label' }, t('opz.dati')),
    h('p', { class: 'bsc-lead' }, t('opz.privacy')),
    kv('', t('opz.spazio', { kb: spazioUsato() })),

    h('div', { class: 'dc-azioni' }, [
      h('button', { class: 'bsc-btn', type: 'button', onclick: () => salvaCopia(ctx) }, t('opz.esportaTutto')),
      etichettaFile(t('opz.importaTutto'), (file) => ripristina(ctx, file, ridisegna)),
    ]),
    h('p', { class: 'bsc-lead' }, t('opz.esportaNota')),

    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button', 'data-azione': 'azzera',
      onclick: () => azzera(ctx, ridisegna),
    }, t('opz.azzera')),
    h('p', { class: 'bsc-lead' }, t('opz.azzeraNota')),

    // ── Crediti ───────────────────────────────────────────────────────────
    h('h2', { class: 'bsc-label' }, t('opz.crediti')),
    h('div', { class: 'bsc-prose', 'data-crediti': 'true' }, attribuzioni()),
  ]))
}

/**
 * Un gruppo di scelte mutuamente esclusive.
 * @param {string} etichetta
 * @param {Array<[string, string]|string[]>} opzioni
 * @param {string} attuale
 * @param {(v: string) => void} onScelta
 */
function scelta(etichetta, opzioni, attuale, onScelta) {
  return h('div', { class: 'dc-gruppo' }, [
    h('span', { class: 'bsc-field-label' }, etichetta),
    h('div', { class: 'dc-chip-riga', role: 'group', 'aria-label': etichetta },
      opzioni.map(([testo, valore]) => {
        const acceso = valore === attuale
        return h('button', {
          class: ['bsc-chip', acceso && 'bsc-chip--on'],
          type: 'button', 'aria-pressed': acceso ? 'true' : 'false',
          'data-valore': valore,
          onclick: () => onScelta(String(valore)),
        }, String(testo))
      })),
  ])
}

/** Il tri-stato del design system: la preferenza, non il tema risolto. */
function temaCorrente() {
  try { return localStorage.getItem('bsc-theme-pref') || 'dark' } catch { return 'dark' }
}

/** @param {string} v */
function cambiaTema(v) {
  const risolto = v === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : v
  try {
    localStorage.setItem('bsc-theme-pref', v)
    localStorage.setItem('bsc-theme', risolto)
  } catch { /* senza spazio, il tema resta quello di prima */ }
  document.documentElement.setAttribute('data-theme', risolto)
  document.documentElement.setAttribute('data-theme-pref', v)
}

/** Quanto occupa lo stato, in KB, per chi si chiede se sta riempiendo il telefono. */
function spazioUsato() {
  try { return Math.max(1, Math.round((localStorage.getItem(STORAGE_KEY)?.length ?? 0) / 1024)) }
  catch { return 0 }
}

/**
 * Salva tutto in un file.
 * @param {ViewCtx} ctx
 */
function salvaCopia(ctx) {
  const testo = JSON.stringify({ ...ctx.state, v: SCHEMA_VERSION }, null, 2)
  const url = URL.createObjectURL(new Blob([testo], { type: 'application/json' }))
  daLiberare.push(url)
  const a = h('a', { href: url, download: `character-companion-${new Date().toISOString().slice(0, 10)}.json` })
  a.click()
}

/**
 * Un `<input type=file>` vestito da bottone: il controllo nativo non si può
 * disegnare, e da solo non sembra un'azione.
 * @param {string} etichetta
 * @param {(f: File) => void} onFile
 */
function etichettaFile(etichetta, onFile) {
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'application/json', class: 'dc-file-nascosto',
    onchange: () => { const f = input.files?.[0]; if (f) onFile(f); input.value = '' },
  }))
  return h('label', { class: 'bsc-btn bsc-btn--outline' }, [etichetta, input])
}

/**
 * Ripristina da una copia.
 *
 * Passa dalla stessa migrazione dello stato salvato: una copia fatta con una
 * versione precedente deve poter tornare dentro, altrimenti «salva una copia»
 * è una promessa a metà.
 * @param {ViewCtx} ctx
 * @param {File} file
 * @param {() => void} poi
 */
async function ripristina(ctx, file, poi) {
  try {
    const grezzo = JSON.parse(await file.text())
    const stato = migrate(grezzo)
    const quanti = Object.keys(stato.characters ?? {}).length
    ctx.update(['characters', 'settings', 'dice'], (s) => {
      s.characters = stato.characters
      s.activeId = stato.activeId
      s.settings = stato.settings
      s.diceLog = stato.diceLog
    })
    ctx.toast(ctx.t('opz.ripristinato', { n: quanti }))
    poi()
  } catch {
    ctx.toast(ctx.t('comune.errore'))
  }
}

/**
 * @param {ViewCtx} ctx
 * @param {() => void} poi
 */
function azzera(ctx, poi) {
  if (!confirm(ctx.t('opz.azzeraConferma'))) return
  ctx.update(['characters', 'settings', 'dice'], (s) => {
    s.characters = {}
    s.activeId = null
    s.diceLog = []
  })
  ctx.toast(ctx.t('opz.azzerato'))
  poi()
}

/**
 * Le attribuzioni CC-BY dei pacchetti inclusi.
 *
 * Non è una cortesia: è la condizione della licenza con cui il testo delle
 * regole sta in questa app.
 * @returns {Array<Node>}
 */
function attribuzioni() {
  /** @type {Array<Node>} */
  const out = []
  for (const ed of EDITIONS) {
    out.push(h('p', { class: 'bsc-code', 'data-attribuzione': ed }, ATTRIBUZIONI[ed]))
  }
  return out
}

/** @type {Record<string, string>} */
const ATTRIBUZIONI = {
  '2014': 'Questo lavoro include materiale del System Reference Document 5.1 ("SRD 5.1") di Wizards of the Coast LLC disponibile al sito https://dnd.wizards.com/it/resources/systems-reference-document. L\'SRD 5.1 è concesso in licenza sotto l\'Attribuzione 4.0 Internazionale di Creative Commons disponibile al sito https://creativecommons.org/licenses/by/4.0/legalcode.it.',
  '2024': 'Quest\'opera include materiale tratto dal System Reference Document 5.2.1 ("SRD 5.2.1") di Wizards of the Coast LLC, disponibile all\'indirizzo https://www.dndbeyond.com/srd. Il SRD 5.2.1 è concesso in licenza ai sensi della licenza di attribuzione 4.0 Internazionale di Creative Commons, disponibile all\'indirizzo https://creativecommons.org/licenses/by/4.0/legalcode.',
}
