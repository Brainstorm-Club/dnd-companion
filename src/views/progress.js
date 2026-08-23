/**
 * Vista «px» — i punti esperienza.  ── Lotto J ──
 *
 * Due modi, perché due sono i tavoli: chi i PX li conta e chi va a traguardi.
 * In modalità traguardi i punti spariscono del tutto — un contatore fermo a
 * zero è peggio di nessun contatore — e resta il solo «sali di livello».
 *
 * La regola che governa questa vista: **il livello non sale da solo**. Superata
 * la soglia compare l'invito; a salire è il giocatore, quando lo dice il
 * master. Nessun `if` qui dentro scrive `snapshot.level`.
 *
 * Si può anche **togliere** PX: i master sbagliano a digitare, e una app che
 * accetta solo aggiunte costringe a rifare i conti a mano.
 */

import { h, clear } from '../dom.js'
import { levelForXp, xpProgress } from '../domain/progress.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** Una assegnazione: quando, quanto, e quanti PX c'erano dopo. */
/** @typedef {{at: string, delta: number, xp: number}} VocePx */

/** Le quattro aggiunte rapide del piano (§ 5.5). */
export const RAPIDI = /** @type {const} */ ([50, 100, 250, 500])

/** Quante assegnazioni si ricordano: è un registro di sessione, non un archivio. */
export const MAX_STORICO = 30

/**
 * Stile in linea, solo token — come nella vista dadi: `.bsc-meter`,
 * `.bsc-numpad` e `.bsc-chip` esistono già in `app.css`, ma il respiro fra i
 * blocchi e i target minimi non sono di nessun componente. Nessun valore
 * inventato: ogni misura è un token.
 */
const TAP = 'min-width: var(--dc-tap-min); min-height: var(--dc-tap-min)'
/** 24 px di `.dc-main` più 12 qui: i controlli restano fuori dalla zona morta. */
const VISTA = 'display: grid; gap: var(--bsc-space-4); padding-inline: var(--bsc-space-3)'
const RIGA = 'display: flex; flex-wrap: wrap; gap: var(--bsc-space-2); align-items: center'
const COLONNA = 'display: grid; gap: var(--bsc-space-2)'

/** Si aggiunge (+1) o si toglie (−1). È una scelta di interfaccia: non si salva. */
let segno = 1
/** Quello che c'è sul tastierino, come stringa: «0025» non deve diventare 25 prima del tempo. */
let digitato = ''

/** @type {import('./index.js').View} */
export default {
  /**
   * @param {HTMLElement} contenitore
   * @param {ViewCtx} ctx
   */
  render(contenitore, ctx) {
    const id = ctx.route.params['id'] ?? ctx.state.activeId ?? ''
    const entry = id ? ctx.state.characters[id] : undefined
    if (!entry) {
      contenitore.appendChild(h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')))
      contenitore.appendChild(h('a', { class: 'bsc-btn', href: '#/libreria', style: TAP }, ctx.t('nav.libreria')))
      return
    }
    disegna(contenitore, ctx, id)
  },

  dispose() {
    segno = 1
    digitato = ''
  },
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {string} id
 */
function disegna(contenitore, ctx, id) {
  const entry = ctx.state.characters[id]
  if (!entry) return
  const t = ctx.t
  const traguardi = ctx.state.settings.xpMode === 'milestone'
  const livelloScheda = intero(entry.snapshot['level'], 1)
  const xp = Math.max(0, intero(entry.play.xp, 0))
  const p = xpProgress(xp)
  // Il confronto è fra il livello che i PX consentono e quello che la scheda
  // dichiara: l'invito nasce da qui, e da nient'altro.
  const puoiSalire = traguardi || levelForXp(xp) > livelloScheda

  /** Ridisegna: la vista è piccola, e un ridisegno intero costa meno di sei
   *  aggiornamenti mirati da tenere allineati. */
  const aggiorna = () => disegna(contenitore, ctx, id)

  /** @param {number} delta */
  const assegna = (delta) => {
    if (!delta) return
    ctx.update(['characters'], (s) => {
      const e = s.characters[id]
      if (!e) return
      const prima = Math.max(0, intero(e.play.xp, 0))
      const dopo = Math.max(0, prima + delta)
      e.play.xp = dopo
      if (dopo !== prima) {
        scriviStorico(e, [{ at: new Date().toISOString(), delta: dopo - prima, xp: dopo }, ...storicoPx(e)])
      }
    })
    digitato = ''
    aggiorna()
  }

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'px', style: VISTA }, [
    h('h1', { class: 'bsc-display' }, entry.meta.name),
    interruttoreModo(ctx, aggiorna),

    traguardi
      ? h('p', { class: 'bsc-lead' }, `Traguardi: i PX non si contano. ${t('libreria.livello', { n: livelloScheda })}.`)
      : misuratore(ctx, xp, p),

    puoiSalire ? invito(ctx, id, traguardi) : null,

    traguardi ? null : h('div', { style: COLONNA }, [
      h('h2', { class: 'bsc-label' }, t('px.aggiungi')),
      versoDelSegno(aggiorna),
      rapidi(assegna),
      tastierino(aggiorna),
      h('button', {
        class: 'bsc-btn', type: 'button', style: TAP,
        dataset: { azione: 'applica' },
        disabled: digitato === '' || Number(digitato) === 0,
        onclick: () => assegna(segno * Number(digitato || '0')),
      }, segno > 0 ? t('px.aggiungi') : 'Togli PX'),
    ]),

    traguardi ? null : storico(ctx, entry),
  ]))
}

/**
 * La barra verso la soglia successiva, e quanti PX mancano.
 * @param {ViewCtx} ctx
 * @param {number} xp
 * @param {ReturnType<typeof xpProgress>} p
 */
function misuratore(ctx, xp, p) {
  const mancano = p.mancano === null
    ? `${ctx.t('libreria.livello', { n: 20 })} — non manca più niente`
    : ctx.t('px.mancano', { n: p.mancano, liv: p.livello + 1 })
  return h('div', {
    class: 'bsc-meter', role: 'meter', 'aria-label': ctx.t('px.totale', { n: xp }),
    'aria-valuenow': String(xp), 'aria-valuemin': '0',
    'aria-valuemax': String(p.prossimo ?? xp), 'aria-live': 'polite',
    dataset: { px: String(xp) },
  }, [
    h('span', { class: 'bsc-meter__label' }, ctx.t('px.totale', { n: xp })),
    h('span', { class: 'bsc-meter__value' }, mancano),
    h('span', { class: 'bsc-meter__fill', style: `--bsc-meter-quota: ${p.frazione}` }),
  ])
}

/**
 * L'invito. È un invito e basta: porta alla procedura guidata, non avanza
 * niente da sé.
 * @param {ViewCtx} ctx
 * @param {string} id
 * @param {boolean} traguardi
 */
function invito(ctx, id, traguardi) {
  return h('div', { class: 'bsc-alert', dataset: { invito: 'livello' }, role: 'status' }, [
    h('p', { class: 'bsc-lead' }, traguardi ? ctx.t('px.sali') : ctx.t('px.puoiSalire')),
    h('a', {
      class: 'bsc-btn', style: TAP, href: `#/livello/${encodeURIComponent(id)}`,
    }, ctx.t('px.sali')),
  ])
}

/**
 * Aggiungere o togliere. Due chip invece di un campo con il meno: al buio si
 * tocca, non si digita un segno.
 * @param {() => void} aggiorna
 */
function versoDelSegno(aggiorna) {
  /** @param {1|-1} v @param {string} etichetta */
  const chip = (v, etichetta) => h('button', {
    class: ['bsc-chip', segno === v && 'bsc-chip--on'], type: 'button', style: TAP,
    'aria-pressed': String(segno === v),
    dataset: { verso: v > 0 ? 'piu' : 'meno' },
    onclick: () => { segno = v; aggiorna() },
  }, etichetta)
  return h('div', { style: RIGA, role: 'group', 'aria-label': 'Aggiungi o togli' }, [
    chip(1, '+ aggiungi'),
    chip(-1, '− togli'),
  ])
}

/**
 * @param {(delta: number) => void} assegna
 */
function rapidi(assegna) {
  return h('div', { style: RIGA, role: 'group', 'aria-label': 'Aggiunta rapida' },
    RAPIDI.map(n => h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button', style: TAP,
      dataset: { rapido: String(n) },
      onclick: () => assegna(segno * n),
    }, `${segno > 0 ? '+' : '−'}${n}`)))
}

/**
 * Il valore libero. Tastierino e non `<input type=number>`: le frecce di
 * sistema sono microscopiche e la tastiera del telefono copre metà schermo.
 * @param {() => void} aggiorna
 */
function tastierino(aggiorna) {
  /** @param {string} c */
  const premi = (c) => {
    if (c === 'C') digitato = ''
    else if (c === '←') digitato = digitato.slice(0, -1)
    else if (digitato.length < 6) digitato = (digitato + c).replace(/^0+(?=\d)/, '')
    aggiorna()
  }
  const tasti = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←']
  return h('div', { style: COLONNA }, [
    h('output', {
      class: 'bsc-num', dataset: { digitato: digitato },
      style: 'font-variant-numeric: tabular-nums; text-align: center',
    }, digitato === '' ? '—' : `${segno > 0 ? '+' : '−'}${digitato}`),
    h('div', { class: 'bsc-numpad', role: 'group', 'aria-label': 'Valore libero' },
      tasti.map(c => h('button', {
        type: 'button', style: TAP, dataset: { tasto: c },
        'aria-label': c === 'C' ? 'Cancella' : c === '←' ? 'Cancella una cifra' : c,
        onclick: () => premi(c),
      }, c))),
  ])
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 */
function storico(ctx, entry) {
  const voci = storicoPx(entry)
  return h('section', { style: COLONNA }, [
    h('h2', { class: 'bsc-label' }, 'Assegnazioni'),
    voci.length
      ? h('ul', { class: 'dc-elenco', dataset: { storico: 'px' } }, voci.map(v => h('li', { class: 'bsc-kv' }, [
        h('span', { class: 'bsc-kv__label' }, quando(v.at)),
        h('span', { class: 'bsc-kv__hint' }, ctx.t('px.totale', { n: v.xp })),
        h('span', { class: 'bsc-kv__value' }, `${v.delta > 0 ? '+' : '−'}${Math.abs(v.delta)}`),
      ])))
      : h('p', { class: 'bsc-lead' }, 'Nessuna assegnazione.'),
  ])
}

/**
 * Il commutatore PX / traguardi. Sta qui e non solo nelle impostazioni perché
 * è una scelta del tavolo, e si scopre proprio mentre si segnano i punti.
 * @param {ViewCtx} ctx
 * @param {() => void} aggiorna
 */
function interruttoreModo(ctx, aggiorna) {
  const modo = ctx.state.settings.xpMode
  /** @param {'xp'|'milestone'} v @param {string} etichetta */
  const chip = (v, etichetta) => h('button', {
    class: ['bsc-chip', modo === v && 'bsc-chip--on'], type: 'button', style: TAP,
    'aria-pressed': String(modo === v),
    dataset: { modo: v },
    onclick: () => {
      ctx.update(['settings'], (s) => { s.settings.xpMode = v })
      aggiorna()
    },
  }, etichetta)
  return h('div', { style: RIGA, role: 'group', 'aria-label': 'Come si sale di livello' }, [
    chip('xp', 'Punti esperienza'),
    chip('milestone', 'Traguardi'),
  ])
}

// ── lo storico, e dove sta ────────────────────────────────────────────────

/**
 * Lo storico delle assegnazioni **non ha ancora un campo suo** in `PlayState`
 * (PIANO § 3.2 si ferma a `xp`). Sta accanto allo stato di gioco, sulla voce
 * del personaggio, e ci si arriva da qui — con un cast dichiarato in un posto
 * solo invece che con un `any` sparso per la vista. Quando `storage.js` gli
 * darà un nome tipato, cambiano queste due funzioni e nient'altro.
 * @param {CharacterEntry} entry
 * @returns {VocePx[]}
 */
export function storicoPx(entry) {
  const e = /** @type {{pxLog?: unknown}} */ (/** @type {unknown} */ (entry))
  if (!Array.isArray(e.pxLog)) return []
  /** @type {VocePx[]} */
  const out = []
  for (const v of e.pxLog) {
    const o = oggetto(v)
    if (typeof o['delta'] !== 'number') continue
    out.push({ at: stringa(o['at']), delta: o['delta'], xp: intero(o['xp'], 0) })
  }
  return out
}

/**
 * @param {CharacterEntry} entry
 * @param {VocePx[]} voci
 */
function scriviStorico(entry, voci) {
  const e = /** @type {{pxLog?: VocePx[]}} */ (/** @type {unknown} */ (entry))
  e.pxLog = voci.slice(0, MAX_STORICO)
}

/** @param {string} iso */
function quando(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}

/** @param {unknown} v @returns {string} */
function stringa(v) {
  return typeof v === 'string' ? v : ''
}

/** @param {unknown} v @param {number} dflt @returns {number} */
function intero(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
}
