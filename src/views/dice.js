/** Vista «dadi». Vedi il contratto in views/index.js. */
import { h, clear } from '../dom.js'
import { cryptoRng } from '../domain/rng.js'
import { ALLOWED_FACES, MAX_DICE_PER_TERM, parse, roll } from '../domain/dice.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../domain/dice.js').Roll} Roll */
/** @typedef {{at: string, label?: string, source: string, formula: string, total: number, dice: Array<{faces: number, value: number, dropped: boolean}>}} VoceStorico */

/** Quanti tiri si ricordano. Oltre, il più vecchio esce: è un anello, non un archivio. */
export const MAX_STORICO = 50

/**
 * Stile in linea, solo token.
 *
 * `.bsc-die`, `.bsc-roll`, `.bsc-stepper` e `.bsc-chip` non sono ancora nel
 * design system (PIANO § 4.1): le classi si usano lo stesso — il contratto è
 * il nome — ma finché il lotto DS non arriva servono queste due righe perché
 * i target restino tappabili e lontani dai bordi. Nessun valore inventato:
 * ogni misura è un token. Quando `.bsc-die` esisterà, questo sparisce.
 */
const TAP = 'min-width: var(--dc-tap-min); min-height: var(--dc-tap-min)'
/** 16 px di `.dc-main` + 12 px qui = 28 px: fuori dalla zona morta dei 24. */
const VISTA = 'display: grid; gap: var(--bsc-space-4); padding-inline: var(--bsc-space-3)'
const GRIGLIA = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(4rem, 1fr)); gap: var(--bsc-space-2)'
const RIGA = 'display: flex; flex-wrap: wrap; gap: var(--bsc-space-2); align-items: center'

/** Lo stato della vista vive qui, non nello store: è una scelta di interfaccia,
 *  non un dato da conservare fra una sessione e l'altra. */
let moltiplicatore = 1
/** @type {'nessuno'|'vantaggio'|'svantaggio'} */
let modo = 'nessuno'
/** L'ultima notazione tirata: è ciò che «ritira» ripete. */
let ultima = ''

/** @type {import('../domain/rng.js').Rng} */
let rng = cryptoRng()

/** Solo per i test e per la ripetibilità di una dimostrazione.
 *  @param {import('../domain/rng.js').Rng} r */
export function _setRng(r) { rng = r }

/** @param {ViewCtx} ctx @returns {VoceStorico[]} */
function storico(ctx) {
  return /** @type {VoceStorico[]} */ (ctx.state.diceLog ?? [])
}

/**
 * Il modo scelto vale solo sui d20: un vantaggio su 4d6 non significa niente,
 * e trasformarlo in 2d6kh1 sarebbe una regola inventata.
 * @param {string} notazione
 * @returns {string}
 */
function conModo(notazione) {
  if (modo === 'nessuno') return notazione
  const scorciatoia = modo === 'vantaggio' ? '2d20kh1' : '2d20kl1'
  return /^1?d20$/.test(notazione) ? scorciatoia : notazione
}

/** @type {import('./index.js').View} */
export default {
  /**
   * @param {HTMLElement} contenitore
   * @param {ViewCtx} ctx
   */
  render(contenitore, ctx) {
    const t = ctx.t

    const risultato = h('div', { class: 'bsc-roll', 'aria-live': 'polite', style: 'display: grid; gap: var(--bsc-space-2)' })
    const elencoStorico = h('ul', { class: 'dc-elenco' })
    const campo = /** @type {HTMLInputElement} */ (h('input', {
      class: 'bsc-input',
      type: 'text',
      id: 'dc-notazione',
      inputmode: 'text',
      autocapitalize: 'off',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: '1d20+5 · 4d6dl1 · 2d6 e 3d20',
      style: `${TAP}; width: 100%`,
    }))

    const contatore = h('output', { class: 'bsc-num', for: 'dc-notazione' }, String(moltiplicatore))

    /** @param {string} notazione @param {string} [etichetta] */
    const tira = (notazione, etichetta) => {
      try {
        const r = roll(parse(notazione), rng)
        ultima = notazione
        registra(ctx, r, notazione, etichetta)
        disegnaRisultato(risultato, r, ctx)
        disegnaStorico(elencoStorico, ctx)
      } catch (e) {
        // Il messaggio del dominio è già scritto per essere letto da chi gioca:
        // non lo si traduce in «errore», lo si mostra.
        ctx.toast(e instanceof Error ? e.message : t('comune.errore'))
      }
    }

    const dadi = h('div', { class: 'dc-dadi', style: GRIGLIA, role: 'group', 'aria-label': t('dadi.tira') })
    for (const facce of ALLOWED_FACES) {
      dadi.appendChild(h('button', {
        class: 'bsc-die bsc-btn bsc-btn--outline',
        type: 'button',
        style: TAP,
        dataset: { facce: String(facce) },
        onclick: () => tira(conModo(`${moltiplicatore}d${facce}`)),
      }, `${moltiplicatore}d${facce}`))
    }

    /** Ridisegna solo le etichette dei dadi: cambiare il contatore non deve
     *  ricostruire mezza pagina. */
    const aggiornaDadi = () => {
      contatore.textContent = String(moltiplicatore)
      for (const b of dadi.children) {
        if (!(b instanceof HTMLElement)) continue
        b.textContent = `${moltiplicatore}d${b.dataset.facce}`
      }
    }

    /** @param {number} d */
    const passo = (d) => {
      moltiplicatore = Math.min(MAX_DICE_PER_TERM, Math.max(1, moltiplicatore + d))
      aggiornaDadi()
    }

    const stepper = h('div', { class: 'bsc-stepper', style: RIGA }, [
      h('button', { class: 'bsc-btn bsc-btn--ghost', type: 'button', style: TAP, 'aria-label': '−1', onclick: () => passo(-1) }, '−'),
      contatore,
      h('button', { class: 'bsc-btn bsc-btn--ghost', type: 'button', style: TAP, 'aria-label': '+1', onclick: () => passo(1) }, '+'),
    ])

    /** @type {Record<string, HTMLElement>} */
    const interruttori = {}
    /** @param {'vantaggio'|'svantaggio'} quale */
    const commuta = (quale) => {
      modo = modo === quale ? 'nessuno' : quale
      for (const [k, el] of Object.entries(interruttori)) {
        el.setAttribute('aria-pressed', String(modo === k))
        el.classList.toggle('bsc-chip--on', modo === k)
      }
    }
    const modi = /** @type {const} */ (['vantaggio', 'svantaggio']).map(quale => {
      const b = h('button', {
        class: 'bsc-chip bsc-btn bsc-btn--outline',
        type: 'button',
        style: TAP,
        'aria-pressed': String(modo === quale),
        onclick: () => commuta(quale),
      }, t(`dadi.${quale}`))
      interruttori[quale] = b
      return b
    })

    const azioni = h('div', { style: RIGA }, [
      h('button', { class: 'bsc-btn', type: 'button', style: TAP, onclick: () => tira(conModo(campo.value.trim() || `${moltiplicatore}d20`)) }, t('dadi.tira')),
      h('button', { class: 'bsc-btn bsc-btn--outline', type: 'button', style: TAP, onclick: () => tira(ultima || conModo(`${moltiplicatore}d20`)) }, t('dadi.ritira')),
    ])

    campo.addEventListener('keydown', (ev) => {
      if (ev instanceof KeyboardEvent && ev.key === 'Enter') tira(conModo(campo.value.trim()))
    })

    const svuota = h('button', {
      class: 'bsc-btn bsc-btn--ghost bsc-btn--sm',
      type: 'button',
      style: TAP,
      onclick: () => {
        ctx.update(['dice'], (s) => { s.diceLog = [] })
        disegnaStorico(elencoStorico, ctx)
      },
    }, t('dadi.svuota'))

    const sezione = h('section', { class: 'dc-vista', 'data-vista': 'dadi', style: VISTA }, [
      dadi,
      stepper,
      h('div', { class: 'bsc-field' }, [
        h('label', { class: 'bsc-field-label', for: 'dc-notazione' }, t('dadi.notazione')),
        campo,
      ]),
      h('div', { style: RIGA, role: 'group' }, modi),
      azioni,
      risultato,
      h('section', {}, [
        h('h2', { class: 'bsc-label' }, t('dadi.storico')),
        elencoStorico,
        svuota,
      ]),
    ])

    contenitore.appendChild(sezione)
    disegnaStorico(elencoStorico, ctx)
    const ultimo = storico(ctx)[0]
    if (ultimo) disegnaVoce(risultato, ultimo, ctx)
    else risultato.appendChild(h('p', { class: 'dc-avvio' }, t('dadi.nessunTiro')))
  },

  dispose() {
    // Nessun listener fuori dal contenitore: rimuovendo i figli se ne vanno
    // anche i suoi. Qui si azzera solo ciò che non deve sopravvivere alla vista.
    ultima = ''
  },
}

/**
 * Aggiunge un tiro allo storico. Anello da 50: il più vecchio esce da solo.
 * @param {ViewCtx} ctx
 * @param {Roll} r
 * @param {string} source
 * @param {string} [label]
 */
function registra(ctx, r, source, label) {
  /** @type {VoceStorico} */
  const voce = {
    at: new Date().toISOString(),
    source,
    formula: r.groups.map(g => g.formula).join(' · '),
    total: r.total,
    dice: r.groups.flatMap(g => g.dice.map(d => ({ faces: d.faces, value: d.value, dropped: d.dropped }))),
  }
  if (label !== undefined) voce.label = label
  ctx.update(['dice'], (s) => {
    const log = Array.isArray(s.diceLog) ? s.diceLog : []
    s.diceLog = [voce, ...log].slice(0, MAX_STORICO)
  })
}

/**
 * @param {HTMLElement} dove
 * @param {Roll} r
 * @param {ViewCtx} ctx
 */
function disegnaRisultato(dove, r, ctx) {
  clear(dove)
  dove.appendChild(h('p', { class: 'bsc-display', 'data-totale': String(r.total) }, `${ctx.t('dadi.totale')} ${r.total}`))
  for (const g of r.groups) {
    dove.appendChild(h('div', { class: 'dc-gruppo' }, [
      h('div', { style: RIGA }, g.dice.map(d => facciaDado(d, ctx))),
      h('p', { class: 'bsc-code' }, `${g.formula} = ${g.total}`),
    ]))
  }
}

/**
 * Un dado singolo. Il 20 e l'1 naturali si vedono, e chi non distingue i colori
 * lo legge lo stesso: c'è il testo, non solo la classe.
 * @param {{faces: number, value: number, dropped: boolean}} d
 * @param {ViewCtx} ctx
 * @returns {HTMLElement}
 */
function facciaDado(d, ctx) {
  const critico = d.faces === 20 && d.value === 20
  const fallimento = d.faces === 20 && d.value === 1
  /** @type {string[]} */
  const note = []
  if (critico) note.push(ctx.t('dadi.critico'))
  if (fallimento) note.push(ctx.t('dadi.fallimento'))
  if (d.dropped) note.push(ctx.t('dadi.scartato'))
  return h('span', {
    class: [
      'bsc-pill',
      critico && 'bsc-badge--ok',
      fallimento && 'bsc-badge--rosso',
      d.dropped && 'is-scartato',
    ],
    'data-facce': String(d.faces),
    'data-valore': String(d.value),
    'data-scartato': d.dropped ? 'si' : null,
    title: note.join(' · '),
  }, note.length ? `${d.value} (${note.join(', ')})` : String(d.value))
}

/**
 * @param {HTMLElement} elenco
 * @param {ViewCtx} ctx
 */
function disegnaStorico(elenco, ctx) {
  clear(elenco)
  const voci = storico(ctx)
  if (!voci.length) {
    elenco.appendChild(h('li', { class: 'dc-avvio' }, ctx.t('dadi.nessunTiro')))
    return
  }
  for (const v of voci) {
    elenco.appendChild(h('li', { class: 'bsc-card' }, [
      h('strong', { class: 'bsc-num' }, String(v.total)),
      ' ',
      h('span', { class: 'bsc-code' }, v.formula),
      v.label ? h('span', { class: 'bsc-badge' }, v.label) : '',
    ]))
  }
}

/**
 * Ridisegna l'ultimo tiro dallo storico: riaprendo la vista si ritrova ciò che
 * si era tirato, invece di uno schermo vuoto.
 * @param {HTMLElement} dove
 * @param {VoceStorico} v
 * @param {ViewCtx} ctx
 */
function disegnaVoce(dove, v, ctx) {
  clear(dove)
  dove.appendChild(h('p', { class: 'bsc-display', 'data-totale': String(v.total) }, `${ctx.t('dadi.totale')} ${v.total}`))
  dove.appendChild(h('div', { style: RIGA }, v.dice.map(d => facciaDado(d, ctx))))
  dove.appendChild(h('p', { class: 'bsc-code' }, `${v.formula} = ${v.total}`))
}
