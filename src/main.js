/**
 * Avvio: stato → lingua → tema → router.
 *
 * Le viste vere arrivano coi lotti della fase 1; qui c'è l'ossatura che le
 * ospita, e che deve già stare in piedi da sola.
 */

import * as store from './store.js'
import * as router from './router.js'
import { setLang, t } from './i18n.js'
import { $, clear, h } from './dom.js'
import { VISTE } from './views/index.js'
import { mount as montaVassoio } from './components/dice-tray.js'
import { rollNotation } from './domain/dice.js'
import { cryptoRng } from './domain/rng.js'

/**
 * Le cinque voci della barra da pollice. Le etichette sono corte di proposito:
 * cinque parole intere non stanno in 375 px, e una parola troncata è peggio di
 * una parola breve.
 */
const SEZIONI = /** @type {const} */ ([
  { rotta: '#/libreria', chiave: 'tab.libreria' },
  { rotta: '#/dadi', chiave: 'tab.dadi' },
  { rotta: '#/prove', chiave: 'tab.prove' },
  { rotta: '#/incantesimi', chiave: 'tab.incantesimi' },
  { rotta: '#/impostazioni', chiave: 'tab.impostazioni' },
])

async function main() {
  const stato = store.init()
  await setLang(stato.settings.lang)

  const { default: initTheme } = await import('../design-system/theme.js')
  initTheme()

  traduciMarcatori()
  disegnaTabbar()
  router.start(disegna)

  // Cambiare lingua non deve lasciare indietro i pezzi disegnati una volta sola.
  addEventListener('dc:lingua', () => { traduciMarcatori(); disegnaTabbar(); segnaTabAttiva() })
  ascoltaTiriRapidi()
  // Sul body, non su `#principale`: il router svuota quello a ogni navigazione,
  // e il vassoio dei dadi deve restare raggiungibile da qualunque vista.
  montaVassoio(document.body, { state: stato, t })
  registraServiceWorker()
}

/**
 * Il ponte fra la scheda e i dadi.
 *
 * Le righe della scheda non tirano: emettono `dc:tira`. Così la vista scheda non
 * deve conoscere il motore dei dadi, e chiunque altro — una riga d'arma, un
 * incantesimo, un pulsante di prova — può tirare emettendo lo stesso evento.
 *
 * Il risultato finisce nello stesso storico della vista dadi: un tiro fatto
 * dalla scheda e uno fatto dal tastierino devono essere la stessa cosa.
 */
const STORICO_MAX = 50

function ascoltaTiriRapidi() {
  document.addEventListener('dc:tira', (ev) => {
    const dettaglio = /** @type {CustomEvent} */ (ev).detail
    if (!dettaglio?.notazione) return
    try {
      const r = rollNotation(String(dettaglio.notazione), cryptoRng(), dettaglio.etichetta)
      const voce = {
        at: new Date().toISOString(),
        label: dettaglio.etichetta,
        source: String(dettaglio.notazione),
        formula: r.groups.map((/** @type {any} */ g) => g.formula).join(' · '),
        total: r.total,
        dice: r.groups.flatMap((/** @type {any} */ g) => g.dice),
      }
      store.update(['dice'], (s) => {
        const log = Array.isArray(s.diceLog) ? s.diceLog : []
        s.diceLog = [voce, ...log].slice(0, STORICO_MAX)
      })
      const naturale = voce.dice.find((/** @type {any} */ d) => d.faces === 20 && !d.dropped)
      const nota = naturale?.value === 20 ? ` — ${t('dadi.critico')}`
        : naturale?.value === 1 ? ` — ${t('dadi.fallimento')}` : ''
      mostraToast(`${dettaglio.etichetta ?? voce.source}: ${voce.total}${nota}`)
    } catch (e) {
      mostraToast(e instanceof Error ? e.message : t('comune.errore'))
    }
  })
}

/** @param {string} messaggio */
function mostraToast(messaggio) {
  const el = document.querySelector('.bsc-toast')
  if (!el) return
  el.textContent = messaggio
  el.classList.add('is-show')
  setTimeout(() => el.classList.remove('is-show'), 3000)
}

/**
 * In produzione il service worker serve dalla cache per primo: è ciò che rende
 * l'app usabile in un capanno senza campo.
 *
 * In sviluppo la stessa scelta nasconde le modifiche — si continua a vedere il
 * CSS di dieci minuti fa, e si insegue un difetto che non esiste più. Quindi su
 * localhost non lo si registra, a meno di chiederlo con `?sw=1`: i test che
 * devono provare l'offline lo fanno di proposito.
 */
function registraServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return
  const locale = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const richiesto = new URLSearchParams(location.search).has('sw')
  if (locale && !richiesto) {
    // e se ne era rimasto uno da una sessione precedente, se ne va
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))
    return
  }
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline: pazienza */ })
}

/**
 * Traduce i pezzi di `index.html` marcati con `data-i18n`.
 *
 * Il documento nasce in italiano — è la lingua del progetto e così la pagina è
 * leggibile anche se il JavaScript non parte — ma con l'inglese scelto quelle
 * stringhe devono cambiare come tutte le altre.
 */
function traduciMarcatori() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const chiave = el.getAttribute('data-i18n')
    if (chiave) el.textContent = t(chiave)
  }
}

/** Quale rotta è aperta: serve a rimarcare la tab dopo un ridisegno. */
let rottaCorrente = ''

function segnaTabAttiva() {
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${rottaCorrente}`)
  }
}

function disegnaTabbar() {
  const nav = $('#tabbar')
  clear(nav)
  for (const s of SEZIONI) {
    nav.appendChild(h('a', { href: s.rotta, class: 'bsc-tab' }, t(s.chiave)))
  }
}

/** @type {import('./views/index.js').View|null} */
let vistaCorrente = null
/** quale render è l'ultima chiesta: le viste si caricano su richiesta, e una
 *  navigazione veloce non deve far vincere quella arrivata per seconda */
let generazione = 0

/** @param {import('./router.js').Route} route */
async function disegna(route) {
  const mia = ++generazione
  const main = $('#principale')

  vistaCorrente?.dispose?.()
  vistaCorrente = null
  clear(main)
  main.appendChild(h('p', { class: 'dc-avvio' }, t('comune.caricamento')))

  rottaCorrente = route.nome
  segnaTabAttiva()

  const carica = VISTE[route.nome]
  if (!carica) return

  try {
    const vista = await carica()
    if (mia !== generazione) return
    clear(main)
    vistaCorrente = vista
    await vista.render(main, contesto(route))
  } catch (e) {
    if (mia !== generazione) return
    clear(main)
    main.appendChild(h('p', { class: 'dc-avvio' }, t('comune.errore')))
    console.error(e)
  }
}

/**
 * Il contesto che ogni vista riceve. Le viste non importano lo store né il
 * router: ricevono ciò che serve, e restano provabili da sole.
 * @param {import('./router.js').Route} route
 * @returns {import('./views/index.js').ViewCtx}
 */
function contesto(route) {
  return {
    route,
    state: store.getState(),
    update: store.update,
    t,
    toast: mostraToast,
    go: router.go,
  }
}

main()
