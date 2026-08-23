/**
 * Il vassoio dei dadi. ── Lotto I ──
 *
 * Si apre dal basso **da qualunque vista**, perché tirare non deve costare la
 * perdita di quello che stai guardando (PIANO § 5.2). Non è una vista: il
 * router non lo conosce, vive accanto a `#principale` e sopravvive alle
 * navigazioni — è montato una volta sola all'avvio.
 *
 * **Non tira da sé**: emette `dc:tira`, lo stesso evento che usano le righe
 * della scheda. Chi lo ascolta (`main.js`) scrive nell'unico storico —
 * `state.diceLog`, anello da 50 — e mostra il totale. Così un tiro dal
 * vassoio, uno dal tastierino e uno da una riga di abilità sono la stessa
 * cosa, e qui non c'è una seconda copia della logica che potrebbe divergere.
 *
 * L'apertura è un gesto **e** un tocco (`gestures.js` — WCAG 2.5.1 e 2.5.7),
 * e a partire da 1024 px non è nemmeno un'apertura: il vassoio è la terza
 * colonna, sempre in vista. Quella decisione è tutta in `app.css`: qui non c'è
 * un solo ramo sul viewport.
 */

import { h, clear } from '../dom.js'
import { ALLOWED_FACES } from '../domain/dice.js'
import { maniglia } from '../gestures.js'
import { facciaDado, animaDadi } from '../anima-dadi.js'

/**
 * Quel poco di contesto che serve: leggere lo storico e tradurre. Non è la
 * `ViewCtx` intera perché il vassoio non è una vista — non ha rotta, non
 * naviga, e lo stato lo scrive chi ascolta `dc:tira`.
 * @typedef {object} TrayCtx
 * @property {import('../storage.js').AppState} state
 * @property {(chiave: string, vars?: Record<string, string|number>) => string} t
 */

/** @typedef {import('../storage.js').DiceLogEntry} Voce */

/** @type {{pannello: HTMLElement, gesto: ReturnType<typeof maniglia>, suTiro: () => void}|null} */
let montato = null

/**
 * Appende il vassoio e lo aggancia alla maniglia. Chiamalo una volta sola:
 * un secondo montaggio smonta il primo, così un ricaricamento a caldo non
 * lascia due vassoi sovrapposti.
 * @param {HTMLElement} root dove appenderlo: `document.body`, non `#principale`
 *   — il router svuota quello a ogni navigazione.
 * @param {TrayCtx} ctx
 */
export function mount(root, ctx) {
  dispose()
  const t = ctx.t

  const risultato = h('div', { class: 'bsc-roll', 'aria-live': 'polite' })
  const elenco = h('ul', { class: 'dc-elenco' })

  const dadi = h('div', { class: 'dc-dadi', role: 'group', 'aria-label': t('dadi.tira') })
  for (const facce of ALLOWED_FACES) {
    dadi.appendChild(h('button', {
      class: 'bsc-die',
      type: 'button',
      dataset: { facce: String(facce) },
      onclick: () => tira(`1d${facce}`),
    }, `d${facce}`))
  }

  const presa = h('button', {
    class: 'dc-tray__maniglia',
    type: 'button',
    'aria-controls': 'dc-tray-corpo',
    'aria-expanded': 'false',
  }, [
    h('span', { class: 'dc-tray__presa', 'aria-hidden': 'true' }),
    h('span', {}, t('nav.dadi')),
  ])

  const corpo = h('div', { class: 'dc-tray__corpo', id: 'dc-tray-corpo' }, [
    dadi,
    risultato,
    h('h2', { class: 'bsc-label' }, t('dadi.storico')),
    elenco,
    h('button', {
      class: 'dc-tray__chiudi bsc-btn bsc-btn--ghost bsc-btn--sm',
      type: 'button',
      onclick: () => gesto.vai(0),
    }, t('comune.chiudi')),
  ])

  const pannello = h('aside', { class: 'dc-tray', 'aria-label': t('nav.dadi') }, [presa, corpo])
  root.appendChild(pannello)

  const gesto = maniglia({
    maniglia: presa,
    pannello,
    // Aprendolo si guarda lo storico: che sia quello di adesso, non quello di
    // quando è stato disegnato l'ultima volta.
    onStato: (s) => { if (s > 0) disegna() },
  })

  /** @param {string} notazione @param {string} [etichetta] */
  function tira(notazione, etichetta) {
    document.dispatchEvent(new CustomEvent('dc:tira', { detail: { notazione, etichetta } }))
  }

  // Un tiro fatto altrove — una riga di abilità, il tastierino — è comunque un
  // tiro: lo storico del vassoio lo mostra. Il ridisegno va in coda perché
  // l'ordine degli ascoltatori non è affare nostro: chi scrive il registro
  // deve avere finito.
  const suTiro = () => queueMicrotask(disegna)
  document.addEventListener('dc:tira', suTiro)

  /** L'istante dell'ultimo tiro già mostrato: serve a distinguere un tiro
   *  nuovo da un semplice ridisegno, perché i dadi girino solo la prima volta. */
  let ultimoMostrato = ''
  /** @type {() => void} */
  let fermaAnimazione = () => {}

  function disegna() {
    const voci = /** @type {Voce[]} */ (ctx.state.diceLog ?? [])
    clear(risultato)
    clear(elenco)

    const ultimo = voci[0]
    if (!ultimo) {
      risultato.appendChild(h('p', { class: 'dc-avvio' }, t('dadi.nessunTiro')))
      elenco.appendChild(h('li', { class: 'dc-avvio' }, t('dadi.nessunTiro')))
      return
    }

    risultato.appendChild(h('p', { class: 'bsc-display', 'data-totale': String(ultimo.total) }, `${t('dadi.totale')} ${ultimo.total}`))
    risultato.appendChild(h('div', { class: 'dc-tray__facce' }, ultimo.dice.map(d => facciaDado(d, t))))
    risultato.appendChild(h('p', { class: 'bsc-code' }, `${ultimo.formula} = ${ultimo.total}`))

    if (ultimo.at !== ultimoMostrato) {
      ultimoMostrato = ultimo.at
      fermaAnimazione()
      fermaAnimazione = animaDadi(risultato.querySelectorAll('.dc-dado'))
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

  disegna()
  montato = { pannello, gesto, suTiro }
}

/** Smonta il vassoio e stacca tutto ciò che aveva legato fuori da sé. */
export function dispose() {
  if (!montato) return
  montato.gesto.dispose()
  document.removeEventListener('dc:tira', montato.suTiro)
  montato.pannello.remove()
  montato = null
}

