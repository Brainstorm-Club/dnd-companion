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
import { trovaDaAggiornare, riportaSopra } from '../domain/reimport.js'

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

/**
 * Se il pannello d'import è aperto.
 *
 * Serve perché la libreria si ridisegna da sé — quando arriva il registro dei
 * pacchetti, dopo un import, cambiando lingua — e un `<details>` ricostruito
 * nasce chiuso. Chi stava incollando un JSON se lo vedeva sparire sotto le
 * dita insieme a quello che aveva scritto.
 */
let importAperto = false

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

  // Con dei personaggi dentro, questa pagina parla di loro: il pannello
  // d'importazione è una card grande quanto un personaggio, e in cima
  // all'elenco competeva con quello che si era venuti a cercare. Resta a
  // portata di un tocco, chiuso, in fondo.
  const importa = pannelloImport(contenitore, ctx)
  const zonaImport = voci.length
    ? h('details', {
      class: 'dc-import', open: importAperto || undefined,
      ontoggle: (/** @type {Event} */ ev) => {
        importAperto = /** @type {HTMLDetailsElement} */ (ev.currentTarget).open
      },
    }, [
      h('summary', { class: 'bsc-btn bsc-btn--outline' }, `+ ${ctx.t('libreria.importa')}`),
      importa,
    ])
    : importa

  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'libreria' }, [
    h('h1', { class: 'bsc-display' }, ctx.t('nav.libreria')),
    voci.length
      ? h('p', { class: 'dc-conta' }, voci.length === 1
        ? ctx.t('libreria.uno')
        : ctx.t('libreria.quanti', { n: voci.length }))
      : null,
    voci.length
      ? h('ul', { class: 'dc-elenco' }, voci.map(([id, entry]) => riga(id, entry, contenitore, ctx)))
      : h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')),
    zonaImport,
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

  const classe = nomeClasse(s, entry?.meta?.edition)
  const razza = nomeRazza(s, entry?.meta?.edition)
  const sottotitolo = razza
    ? ctx.t('libreria.dettaglio', { classe, razza })
    : classe

  // Il nome è la cosa che si cerca: al tavolo si scorre la libreria per
  // trovare *chi* si sta giocando, non di che classe è. Prima stava in un
  // maiuscoletto più piccolo della classe, cioè l'esatto contrario.
  return h('li', { class: 'bsc-card dc-pg', dataset: { id } }, [
    h('a', {
      class: 'dc-pg__testa',
      href: `#/scheda/${encodeURIComponent(id)}/gioco`,
      'aria-label': ctx.t('libreria.apriScheda', { nome: entry.meta.name }),
    }, [
      h('h2', { class: 'dc-pg__nome' }, entry.meta.name),
      // Un'unica riga di testo, non tre pezzi in un flex: andando a capo, il
      // separatore restava orfano in cima alla riga dopo.
      h('p', { class: 'dc-pg__sotto' },
        [sottotitolo, ctx.t('libreria.livello', { n: livello })].filter(Boolean).join(' · ')),
    ]),

    h('div', { class: 'dc-pg__stato' }, [
      h('span', { class: 'dc-pg__pf' }, `${entry.play.hp.cur} / ${d.pfMax}`),
      h('span', { class: 'dc-pg__pfEtichetta' }, ctx.t('scheda.pf')),
      h('span', { class: 'bsc-badge' }, ctx.t(`edizione.${entry.meta.edition}`)),
    ]),

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
  // «Apri» non c'è più fra i bottoni: tutta la testa della scheda è il
  // collegamento. Quel che resta sono azioni secondarie, e devono sembrarlo.
  return h('div', { class: 'dc-azioni dc-azioni--minori' }, [
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

    // Col foglio del builder in mano è la via più corta: niente file da
    // ritrovare, niente link da copiare fra due telefoni. Sta per prima perché
    // è quella che si prova per prima, e resta un link perché è una rotta.
    h('a', { class: 'bsc-btn dc-import__qr', href: '#/inquadra' }, ctx.t('import.qr')),

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
        // Decomprimere è asincrono: il formato compresso del builder passa da
        // `DecompressionStream`, che non ha una variante sincrona.
        fromShareUrl(t, registro).then(fatto)
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
 * Cosa è cambiato ri-importando, in una frase per riga.
 * @param {import('../domain/reimport.js').Cambiamento} c
 * @param {ViewCtx} ctx
 * @returns {string}
 */
function descriviCambiamento(c, ctx) {
  return ctx.t(`reimport.${c.tipo}`, { da: String(c.da ?? ''), a: String(c.a ?? '') })
}

/**
 * @param {ReturnType<typeof fromJson>} r
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
function accogli(r, contenitore, ctx) {
  accogliImport(r, ctx)
  disegna(contenitore, ctx)
}

/**
 * Registra l'esito di un import e, se è andata, il personaggio.
 *
 * È esportata perché l'import dal QR avviene in un'altra vista (`scan.js`):
 * quando quella finisce, la libreria non è ancora disegnata. Lasciarle
 * scrivere l'esito qui e poi navigare è l'unico modo di non avere due copie di
 * questa decisione — quale personaggio entra, con che nome, con quali avvisi.
 * @param {ReturnType<typeof fromJson>} r
 * @param {ViewCtx} ctx
 */
export function accogliImport(r, ctx) {
  if (!r.ok) {
    // Un rifiuto non è un errore: è una frase che spiega cosa manca.
    esito = { tipo: 'ko', messaggio: r.message, avvisi: [] }
    return
  }
  // Lo stesso personaggio che rientra non fa un doppione: aggiorna quello che
  // c'è e si tiene la partita. Prima le strade erano due e sbagliate entrambe —
  // due schede uguali, o una copia con i punti ferita azzerati.
  const esistente = trovaDaAggiornare(ctx.state.characters, r.entry.snapshot)
  if (esistente) {
    const vecchia = ctx.state.characters[esistente]
    const { entry, cambiamenti } = riportaSopra(/** @type {any} */ (vecchia), r.entry)
    ctx.update(['characters'], s => {
      s.characters[esistente] = entry
      s.activeId = esistente
    })
    esito = {
      tipo: 'ok',
      messaggio: ctx.t('import.aggiornato', { nome: entry.meta.name }),
      avvisi: [...r.warnings, ...cambiamenti.map(c => descriviCambiamento(c, ctx))],
    }
    ctx.toast(esito.messaggio)
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
 * @type {Map<string, {classi: Record<string, string>, razze: Record<string, string>}>}
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
      /** @param {Record<string, unknown>} da */
      const nomiDi = (da) => {
        /** @type {Record<string, string>} */
        const out = {}
        for (const [id, v] of Object.entries(da ?? {})) {
          const nome = /** @type {any} */ (v)?.name
          if (typeof nome === 'string') out[id] = nome
        }
        return out
      }
      NOMI_CLASSE.set(ed, { classi: nomiDi(pack.classes), razze: nomiDi(pack.races) })
    } catch {
      // niente pacchetto: si resta sugli id ripuliti
      NOMI_CLASSE.set(ed, { classi: {}, razze: {} })
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
  return nomeDi(s['className'], edizione, 'classi')
}

/**
 * La razza, in italiano quando il pacchetto la conosce.
 * @param {Record<string, unknown>} s
 * @param {string} [edizione]
 */
function nomeRazza(s, edizione) {
  return nomeDi(s['race'], edizione, 'razze')
}

/**
 * @param {unknown} valore
 * @param {string|undefined} edizione
 * @param {'classi'|'razze'} dove
 * @returns {string}
 */
function nomeDi(valore, edizione, dove) {
  const v = typeof valore === 'string' ? valore : ''
  if (!v) return ''
  const italiano = edizione ? NOMI_CLASSE.get(edizione)?.[dove]?.[v] : undefined
  if (italiano) return italiano
  return v.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}
