/**
 * Importare inquadrando il QR.  ── vista `#/inquadra` ──
 *
 * Il builder stampa il personaggio come QR: dentro c'è un link di
 * condivisione, cioè il personaggio per intero. Qui si apre la telecamera, si
 * legge, e da lì in poi è la stessa strada dell'import da link — `fromShareUrl`
 * e la libreria che accoglie. Niente di quel percorso è duplicato: la
 * telecamera è solo un quarto modo di procurarsi la stessa stringa.
 *
 * È una **vista** e non un pannello dentro la libreria per una ragione sola:
 * il router chiama `dispose()` quando si esce, comunque si esca — un tocco su
 * «chiudi», il tasto indietro, un link, il cambio di rotta di un altro. Una
 * spia della telecamera che resta accesa è un difetto grave, e questa è
 * l'unica forma in cui lo spegnimento non dipende dal fatto che me ne ricordi.
 */

import { h } from '../dom.js'
import { loadRegistry } from '../domain/packs.js'
import { fromShareUrl } from '../domain/importer.js'
import { leggiQr } from '../domain/qr/index.js'
import { accogliImport } from './library.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */

/**
 * Otto fotogrammi al secondo.
 *
 * A mano ferma un QR resta inquadrato per qualche decimo di secondo: leggerlo
 * sessanta volte al secondo non lo trova prima, scalda il telefono e mangia la
 * batteria proprio mentre si sta giocando. Con 125 ms la lettura riesce al
 * primo o al secondo giro utile, e fra un giro e l'altro il processore respira.
 */
const CADENZA_MS = 125

/**
 * Dopo tanto silenzio si dice qualcosa.
 *
 * Una telecamera accesa che non legge sembra rotta: a chi guarda non arriva
 * nessuna differenza fra «sto cercando» e «non troverò mai». Dodici secondi
 * sono abbastanza per non interrompere chi sta ancora inquadrando.
 */
const SUGGERIMENTO_MS = 12_000

/**
 * Lato del ritaglio passato al lettore.
 *
 * Un QR stampato su un foglio A4 e inquadrato da venti centimetri occupa gran
 * parte del quadrato: 512 px bastano a distinguerne i moduli, e sono un quarto
 * dei pixel di un fotogramma 1080p — cioè un quarto del lavoro, a ogni giro.
 */
const LATO_MAX = 512

/**
 * Ogni avvio ha il suo numero. Una risposta che arriva dopo che la vista è
 * cambiata — `getUserMedia` è lenta, e l'utente non aspetta — trova il numero
 * diverso e spegne quello che ha in mano invece di attaccarlo a un DOM morto.
 */
let sessione = 0

/** @type {MediaStream|null} */
let flusso = null
/** @type {HTMLVideoElement|null} */
let video = null
/** @type {HTMLCanvasElement|null} */
let tela = null
/** @type {ReturnType<typeof setTimeout>|undefined} */
let attesa
/** @type {ReturnType<typeof setTimeout>|undefined} */
let attesaSuggerimento
/** @type {(() => void)|null} */
let stacca = null
/** @type {Promise<import('../domain/packs.js').PackRegistry|null>|null} */
let registroPronto = null

/** @type {import('./index.js').View} */
export default {
  render(contenitore, ctx) {
    // Il registro dei pacchetti serve solo quando il codice è già letto: si
    // carica in parallelo alla telecamera, che è la cosa lenta e visibile.
    registroPronto = loadRegistry().catch(() => null)

    const stato = h('p', { class: 'dc-qr__stato', role: 'status', 'aria-live': 'polite' }, ctx.t('qr.avvio'))

    // Il video non è informazione per chi non vede: quello che sta succedendo
    // lo dice `stato`, che è la sola cosa annunciata.
    const v = /** @type {HTMLVideoElement} */ (h('video', {
      class: 'dc-qr__video', playsinline: true, autoplay: true, 'aria-hidden': 'true',
    }))
    v.muted = true   // l'attributo da solo non basta: Safari lo vuole anche come proprietà
    video = v

    const riprova = h('button', {
      class: 'bsc-btn', type: 'button', hidden: true,
      onclick: () => { avvia(ctx, stato, riprova) },
    }, ctx.t('qr.riprova'))

    contenitore.appendChild(h('section', { class: 'dc-vista dc-qr', 'data-vista': 'inquadra' }, [
      h('h1', { class: 'bsc-display' }, ctx.t('qr.titolo')),
      h('p', { class: 'bsc-lead' }, ctx.t('qr.istruzioni')),
      h('div', { class: 'dc-qr__cornice' }, [
        v,
        h('span', { class: 'dc-qr__mirino', 'aria-hidden': 'true' }),
      ]),
      stato,
      h('div', { class: 'dc-azioni' }, [
        riprova,
        h('button', {
          class: 'bsc-btn bsc-btn--outline', type: 'button',
          onclick: () => ctx.go('#/libreria'),
        }, ctx.t('comune.chiudi')),
      ]),
    ]))

    /** @param {KeyboardEvent} ev */
    const suTasto = (ev) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ctx.go('#/libreria')
    }
    // Passare in secondo piano non spegne la telecamera da sé su tutti i
    // sistemi: la spegniamo noi, e al ritorno si riprende con un tocco invece
    // di riaccenderla alle spalle di chi è andato altrove.
    const suVisibilita = () => { if (document.hidden) sospendi(ctx, stato, riprova) }
    document.addEventListener('keydown', suTasto)
    document.addEventListener('visibilitychange', suVisibilita)
    stacca = () => {
      document.removeEventListener('keydown', suTasto)
      document.removeEventListener('visibilitychange', suVisibilita)
    }

    avvia(ctx, stato, riprova)
  },

  dispose() {
    spegni()
    stacca?.()
    stacca = null
    video = null
    tela = null
    registroPronto = null
  },
}

/**
 * Spegne tutto: il ciclo di lettura, il video, e soprattutto le tracce del
 * flusso — finché una traccia è viva la spia resta accesa, anche se il video
 * non è più nel documento.
 */
function spegni() {
  sessione++
  clearTimeout(attesa)
  clearTimeout(attesaSuggerimento)
  attesa = undefined
  attesaSuggerimento = undefined
  if (video) {
    video.pause()
    video.srcObject = null
  }
  for (const t of flusso?.getTracks() ?? []) t.stop()
  flusso = null
}

/**
 * @param {ViewCtx} ctx
 * @param {HTMLElement} stato
 * @param {HTMLElement} riprova
 */
async function avvia(ctx, stato, riprova) {
  spegni()
  const mia = sessione
  riprova.hidden = true
  riprova.textContent = ctx.t('qr.riprova')
  annuncia(stato, ctx.t('qr.avvio'))

  const md = navigator.mediaDevices
  if (!md?.getUserMedia) {
    // `getUserMedia` non esiste proprio fuori da https (o localhost). Non è un
    // permesso negato — è un contesto in cui la telecamera non si può nemmeno
    // chiedere, e chi guarda deve sapere che il rimedio è l'indirizzo.
    fallisci(ctx, stato, riprova, isSecureContext ? 'qr.nessunaTelecamera' : 'qr.contestoInsicuro')
    return
  }

  /** @type {MediaStream} */
  let s
  try {
    s = await md.getUserMedia({ video: { facingMode: 'environment' } })
  } catch (e) {
    if (mia !== sessione) return
    fallisci(ctx, stato, riprova, chiaveErrore(e))
    return
  }
  if (mia !== sessione || !video) {
    for (const t of s.getTracks()) t.stop()
    return
  }

  flusso = s
  video.srcObject = s
  try {
    await video.play()
  } catch {
    // qualche browser parte da sé con `autoplay`: se non parte lo dirà il ciclo
  }
  if (mia !== sessione) return

  annuncia(stato, ctx.t('qr.attiva'))
  attesaSuggerimento = setTimeout(() => {
    if (mia === sessione) annuncia(stato, ctx.t('qr.nienteDaLeggere'))
  }, SUGGERIMENTO_MS)

  const rilevatore = await rilevatoreDiSistema()
  if (mia !== sessione) return
  cicla(ctx, stato, riprova, rilevatore, mia)
}

/**
 * @param {ViewCtx} ctx
 * @param {HTMLElement} stato
 * @param {HTMLElement} riprova
 * @param {any} rilevatore
 * @param {number} mia
 */
function cicla(ctx, stato, riprova, rilevatore, mia) {
  attesa = setTimeout(async () => {
    if (mia !== sessione) return
    /** @type {string|null} */
    let testo = null
    try {
      testo = await unGiro(rilevatore)
    } catch {
      // un fotogramma illeggibile non è un errore: si riprova al giro dopo
    }
    if (mia !== sessione) return
    if (!testo) {
      cicla(ctx, stato, riprova, rilevatore, mia)
      return
    }
    // Letto: la telecamera si spegne **prima** dell'import, non dopo. L'import
    // può fallire e prendersi il suo tempo, la spia no.
    spegni()
    const finale = sessione
    annuncia(stato, ctx.t('qr.letto'))
    await importa(testo, ctx, stato, riprova, finale)
  }, CADENZA_MS)
}

/**
 * @param {string} testo
 * @param {ViewCtx} ctx
 * @param {HTMLElement} stato
 * @param {HTMLElement} riprova
 * @param {number} mia
 */
async function importa(testo, ctx, stato, riprova, mia) {
  const registro = await registroPronto
  if (mia !== sessione) return
  if (!registro) {
    fallisci(ctx, stato, riprova, 'qr.senzaRegistro')
    return
  }

  const r = await fromShareUrl(testo, registro)
  if (mia !== sessione) return
  if (!r.ok) {
    // Un QR qualunque — un link, un biglietto da visita, il wi-fi di casa — si
    // legge benissimo e non è un personaggio. Va detto con la frase che spiega
    // *cosa* manca, e si riprova senza tornare indietro.
    annuncia(stato, `${ctx.t('qr.nonUnPersonaggio')} ${r.message}`, 'errore')
    riprova.hidden = false
    return
  }

  // Da qui in poi è la libreria a decidere: il personaggio, l'esito e gli
  // avvisi si vedono lì, come per le altre tre vie d'ingresso.
  accogliImport(r, ctx)
  ctx.go('#/libreria')
}

/**
 * Un giro di lettura. Col rilevatore di sistema il fotogramma non passa
 * nemmeno da noi; senza, si ritaglia il quadrato centrale — quello che il
 * mirino mostra — e lo si consegna al lettore.
 * @param {any} rilevatore
 * @returns {Promise<string|null>}
 */
async function unGiro(rilevatore) {
  const v = video
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null

  if (rilevatore) {
    const trovati = await rilevatore.detect(v)
    const grezzo = trovati?.[0]?.rawValue
    return typeof grezzo === 'string' && grezzo ? grezzo : null
  }

  const lato = Math.min(v.videoWidth, v.videoHeight)
  const n = Math.min(lato, LATO_MAX)
  if (!tela) tela = document.createElement('canvas')
  tela.width = n
  tela.height = n
  const g = tela.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(v, (v.videoWidth - lato) / 2, (v.videoHeight - lato) / 2, lato, lato, 0, 0, n, n)
  const img = g.getImageData(0, 0, n, n)
  return leggiQr(img.data, n, n)
}

/**
 * Il rilevatore del sistema operativo, dove c'è.
 *
 * Non è un'ottimizzazione: è codice nativo che tollera la messa a fuoco storta
 * e la carta piegata meglio di quanto possa fare qualunque cosa scriviamo noi.
 * Dove non c'è — Safari, cioè metà dei telefoni — si torna a `leggiQr`.
 * @returns {Promise<any>}
 */
async function rilevatoreDiSistema() {
  const B = /** @type {any} */ (globalThis).BarcodeDetector
  if (typeof B !== 'function') return null
  try {
    const formati = await B.getSupportedFormats?.()
    if (Array.isArray(formati) && !formati.includes('qr_code')) return null
    return new B({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

/**
 * Ogni modo di non avere la telecamera ha la sua frase, perché ha un rimedio
 * diverso: il permesso si ridà, l'app che la occupa si chiude, e a un telefono
 * senza telecamera non c'è niente da dire se non «usa un'altra via».
 * @param {unknown} e
 * @returns {string} la chiave di traduzione
 */
export function chiaveErrore(e) {
  const nome = /** @type {{name?: unknown}} */ (e)?.name
  switch (nome) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'qr.permessoNegato'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'qr.nessunaTelecamera'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'qr.telecameraOccupata'
    default:
      return 'qr.errore'
  }
}

/**
 * @param {ViewCtx} ctx
 * @param {HTMLElement} stato
 * @param {HTMLElement} riprova
 * @param {string} chiave
 */
function fallisci(ctx, stato, riprova, chiave) {
  spegni()
  annuncia(stato, ctx.t(chiave), 'errore')
  // Riprovare ha senso quando può cambiare qualcosa: un permesso si ridà, una
  // telecamera che non c'è resta quella. Un bottone che non serve a niente è
  // peggio di nessun bottone.
  riprova.hidden = chiave === 'qr.contestoInsicuro' || chiave === 'qr.nessunaTelecamera'
}

/**
 * @param {ViewCtx} ctx
 * @param {HTMLElement} stato
 * @param {HTMLElement} riprova
 */
function sospendi(ctx, stato, riprova) {
  if (!flusso) return
  spegni()
  annuncia(stato, ctx.t('qr.sospesa'))
  riprova.textContent = ctx.t('qr.riprendi')
  riprova.hidden = false
}

/**
 * @param {HTMLElement} stato
 * @param {string} testo
 * @param {'nota'|'errore'} [tono]
 */
function annuncia(stato, testo, tono = 'nota') {
  stato.textContent = testo
  stato.dataset['tono'] = tono
}
