/**
 * Il cassetto di consultazione: dadi, incantesimi, privilegi.
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
 * e a partire da 1024 px non è nemmeno un'apertura: il cassetto è la terza
 * colonna, sempre in vista. Quella decisione è tutta in `app.css`: qui non c'è
 * un solo ramo sul viewport.
 *
 * **Perché i compendi stanno qui e non sono destinazioni.** Consultare una
 * regola non deve costare il posto in cui sei: si apre il cassetto sopra la
 * scheda, si legge, si chiude, e sei ancora nello zaino da cui eri partito.
 * Le due viste dei compendi non sono duplicate — sono le stesse di
 * `#/incantesimi` e `#/privilegi`, disegnate qui dentro con una rotta finta,
 * che è esattamente ciò per cui sono parametrizzate da una rotta.
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
 * @property {(sezioni: string[], muta: (s: import('../storage.js').AppState) => void) => void} [update]
 *   serve solo ai compendi ospitati qui dentro, che sono viste vere
 */

/** @typedef {import('../storage.js').DiceLogEntry} Voce */

/** @type {{pannello: HTMLElement, gesto: ReturnType<typeof maniglia>, suTiro: () => void}|null} */
let montato = null

/**
 * Come chi non conosce il cassetto può aprirlo lo stesso.
 * @type {((quale: 'dadi'|'incantesimi'|'privilegi', id?: string|null) => void)|null}
 */
let aperturaEsterna = null

/**
 * Apre il cassetto da fuori: la scheda del personaggio la usa per mostrare un
 * incantesimo senza portare via la pagina a chi la stava guardando.
 * @param {'dadi'|'incantesimi'|'privilegi'} quale
 * @param {string|null} [id]
 */
export function apriCassetto(quale, id = null) {
  aperturaEsterna?.(quale, id)
}

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

  // La scheda «dadi» è quella che c'era: le altre due ospitano i compendi.
  const paneDadi = h('div', { class: 'dc-tray__pane', 'data-pane': 'dadi' }, [
    dadi,
    risultato,
    h('h2', { class: 'bsc-label' }, t('dadi.storico')),
    elenco,
  ])
  const paneAltro = h('div', { class: 'dc-tray__pane', 'data-pane': 'compendio', hidden: true })

  const schede = h('div', { class: 'bsc-tabs dc-tray__schede', role: 'tablist' })
  const corpo = h('div', { class: 'dc-tray__corpo', id: 'dc-tray-corpo' }, [
    schede,
    paneDadi,
    paneAltro,
    h('button', {
      class: 'dc-tray__chiudi bsc-btn bsc-btn--ghost bsc-btn--sm',
      type: 'button',
      onclick: () => gesto.vai(0),
    }, t('comune.chiudi')),
  ])

  const pannello = h('aside', { class: 'dc-tray', 'aria-label': t('cassetto.titolo') }, [presa, corpo])
  root.appendChild(pannello)

  /** Quale scheda si sta guardando, e su cosa. */
  let scheda = /** @type {'dadi'|'incantesimi'|'privilegi'} */ ('dadi')
  /** @type {string|null} */
  let dettaglio = null

  /** Disegna la barra delle schede. */
  function mostraSchede() {
    clear(schede)
    for (const [id, chiave] of /** @type {const} */ ([
      ['dadi', 'nav.dadi'], ['incantesimi', 'nav.incantesimi'], ['privilegi', 'nav.privilegi'],
    ])) {
      const attiva = id === scheda
      schede.appendChild(h('button', {
        class: ['bsc-tab', attiva && 'is-attiva'],
        type: 'button', role: 'tab', 'aria-selected': attiva ? 'true' : 'false',
        'data-scheda': id,
        onclick: () => vaiA(id),
      }, t(chiave)))
    }
  }

  /**
   * @param {'dadi'|'incantesimi'|'privilegi'} quale
   * @param {string|null} [id]  un incantesimo da aprire direttamente
   */
  async function vaiA(quale, id = null) {
    scheda = quale
    dettaglio = id
    mostraSchede()
    paneDadi.hidden = quale !== 'dadi'
    paneAltro.hidden = quale === 'dadi'
    if (quale === 'dadi') { disegna(); return }

    clear(paneAltro)
    paneAltro.appendChild(h('p', { class: 'dc-avvio' }, t('comune.caricamento')))
    const modulo = quale === 'incantesimi'
      ? await import('../views/spells.js')
      : await import('../views/features.js')
    // La rotta finta è tutto ciò che serve: le viste dei compendi sono già
    // scritte per riceverne una, e così qui non ne esiste una seconda copia.
    clear(paneAltro)
    await modulo.default.render(paneAltro, /** @type {any} */ ({
      ...ctx,
      route: { nome: quale, params: id ? { id } : {} },
      go: (/** @type {string} */ r) => { location.hash = r },
      toast: () => {},
      update: ctx.update ?? (() => {}),
    }))
  }

  const gesto = maniglia({
    maniglia: presa,
    pannello,
    // Aprendolo si guarda lo storico: che sia quello di adesso, non quello di
    // quando è stato disegnato l'ultima volta.
    onStato: (s) => { if (s > 0 && scheda === 'dadi') disegna() },
  })

  mostraSchede()

  /**
   * Apre il cassetto su una scheda precisa — o su un incantesimo preciso.
   *
   * È così che una riga della scheda del personaggio mostra la descrizione di
   * un suo incantesimo: senza navigare, e senza perdere il posto.
   * @param {'dadi'|'incantesimi'|'privilegi'} quale
   * @param {string|null} [id]
   */
  function apriSu(quale, id = null) {
    gesto.vai(1)
    void vaiA(quale, id)
  }
  aperturaEsterna = apriSu

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

