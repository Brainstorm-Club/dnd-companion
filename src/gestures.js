/**
 * I gesti a puntatore, e nient'altro. Lo swipe fra le sezioni **non è qui**: è
 * `scroll-snap` CSS — inerzia, accessibilità e precedenza col gesto di sistema
 * il browser le fa meglio di qualunque codice nostro. Restano i due che non
 * offre, dentro il tetto di **cento righe** dichiarato nel piano.
 *
 * Le regole: nessun gesto è l'unica via (WCAG 2.5.1 e 2.5.7); niente parte
 * entro 24 px dai bordi verticali, dove il sistema si è già preso «indietro» e
 * «avanti»; e si annulla al movimento, perché un dito che scivola scorreva.
 */

/** Quanto dura una pressione perché diventi «lunga». */
export const PRESSIONE_LUNGA_MS = 400
/** Oltre questo spostamento il gesto è uno scorrimento, non una pressione. */
export const TOLLERANZA_PX = 10
/** Spegne lente e menu contestuale di iOS (`app.css`) solo sulle righe con una
 *  pressione lunga vera: altrove il testo si deve poter selezionare. */
export const CLASSE_PRESSIONE = 'dc-pressione'

/** @param {EventTarget} b @param {Array<[string, (ev: any) => void, boolean?]>} a */
function lega(b, a) {
  for (const [t, f, c] of a) b.addEventListener(t, f, c)
  return () => { for (const [t, f, c] of a) b.removeEventListener(t, f, c) }
}

/**
 * Pressione lunga in delega: **un** listener sul contenitore, non uno per riga.
 * Solo dove c'è già un'azione al tap — è una scorciatoia, non l'unica via — e
 * chi la usa mette `CLASSE_PRESSIONE` sulle righe.
 * @param {Element} root @param {string} selettore
 * @param {(el: Element, ev: PointerEvent) => void} azione @returns {() => void}
 */
export function pressioneLunga(root, selettore, azione) {
  let timer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined)
  let x = 0, y = 0, scattata = false
  const stop = () => { clearTimeout(timer); timer = undefined }
  const stacca = lega(root, [
    ['pointerdown', (/** @type {PointerEvent} */ ev) => {
      const el = ev.target instanceof Element ? ev.target.closest(selettore) : null
      if (!el || !root.contains(el)) return
      stop(); scattata = false; x = ev.clientX; y = ev.clientY
      timer = setTimeout(() => { timer = undefined; scattata = true; azione(el, ev) }, PRESSIONE_LUNGA_MS)
    }],
    ['pointermove', (/** @type {PointerEvent} */ ev) => { if (timer && Math.hypot(ev.clientX - x, ev.clientY - y) > TOLLERANZA_PX) stop() }],
    ['pointerup', stop], ['pointercancel', stop],
    // Dopo una pressione lunga il clic non tira *anche*: il gesto ha già scelto.
    ['click', (/** @type {Event} */ ev) => { if (scattata) { scattata = false; ev.stopPropagation(); ev.preventDefault() } }, true],
  ])
  return () => { stop(); stacca() }
}

/**
 * Trascinamento verticale con stati d'aggancio: su apre, giù chiude, in mezzo
 * si aggancia. **Funziona anche a tap** e da tastiera (WCAG 2.5.7), e si chiude
 * con Esc. Non muove niente da sé: scrive `--dc-apertura` (0…1) e `data-aperto`
 * sul pannello e lascia fare al CSS, che sa già cosa fare col movimento ridotto.
 * @param {object} p @param {HTMLElement} p.maniglia @param {HTMLElement} p.pannello
 * @param {number[]} [p.stati] frazioni di apertura, es. [0, 0.5, 1]
 * @param {(stato: number) => void} [p.onStato]
 * @returns {{ vai: (stato: number) => void, stato: () => number, dispose: () => void }}
 */
export function maniglia({ maniglia: m, pannello, stati = [0, 1], onStato }) {
  const passi = [...stati].sort((a, b) => a - b)
  const chiuso = passi[0] ?? 0, aperto = passi[passi.length - 1] ?? 1
  let corrente = chiuso, y0 = 0, corsa = 1, trascinato = false, inCorso = false
  const mostra = (/** @type {number} */ f) => {
    pannello.style.setProperty('--dc-apertura', String(f))
    pannello.dataset.aperto = f > chiuso ? 'si' : 'no'
    m.setAttribute('aria-expanded', String(f > chiuso))
  }
  const vai = (/** @type {number} */ f) => {   // si aggancia allo stato più vicino
    corrente = passi.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a), chiuso)
    mostra(corrente); onStato?.(corrente)
  }
  const quota = (/** @type {PointerEvent} */ ev) => Math.min(aperto, Math.max(chiuso, corrente + (y0 - ev.clientY) / corsa))
  const su = (/** @type {PointerEvent} */ ev) => {
    if (!inCorso) return
    inCorso = false; delete pannello.dataset.trascina
    if (trascinato) vai(quota(ev)); else mostra(corrente)
  }
  const stacca = lega(m, [
    ['pointerdown', (/** @type {PointerEvent} */ ev) => {
      inCorso = true; trascinato = false; y0 = ev.clientY
      corsa = Math.max(pannello.offsetHeight - m.offsetHeight, 1)   // quanto può salire
      pannello.dataset.trascina = 'si'; m.setPointerCapture?.(ev.pointerId)
    }],
    ['pointermove', (/** @type {PointerEvent} */ ev) => {
      if (!inCorso) return
      if (Math.abs(ev.clientY - y0) > TOLLERANZA_PX) trascinato = true
      mostra(quota(ev))
    }],
    ['pointerup', su], ['pointercancel', su],
    ['click', () => { if (!trascinato) vai(corrente > chiuso ? chiuso : aperto) }],
  ])
  const esc = lega(document, [['keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Escape' && corrente > chiuso) vai(chiuso)
  }]])
  mostra(corrente)
  return { vai, stato: () => corrente, dispose: () => { stacca(); esc() } }
}
