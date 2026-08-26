/**
 * Lo schermo acceso e il telefono che risponde al tocco.
 *
 * Due migliorie progressive, nel senso stretto: dove il browser non le ha,
 * l'app funziona identica e nessuno se ne accorge. Nessuna funzione dipende da
 * loro, nessun messaggio d'errore le nomina.
 *
 * **Perché servono.** Una partita è tre ore in cui si guarda la scheda per
 * dieci secondi ogni tanto: il telefono si spegne di continuo, e ogni volta
 * sono due gesti per tornare dov'eri, mentre il tuo turno passa. E un tiro
 * fatto senza guardare — mentre il master parla — non dà nessun riscontro se
 * non alzi gli occhi.
 *
 * **Perché sono spegnibili.** Il wake lock consuma batteria, e a un tavolo
 * silenzioso una vibrazione è rumore. Chi non le vuole le toglie, e la scelta
 * resta.
 */

/** @type {any} */
let sentinella = null
/** Se l'utente vuole lo schermo sveglio. Il lock vero segue lo stato della pagina. */
let voluto = false

/**
 * Chiede o rilascia il wake lock.
 *
 * Il browser lo rilascia da sé ogni volta che la pagina passa in secondo piano
 * — è il comportamento giusto, ma vuol dire che tornando all'app lo schermo
 * ricomincia a spegnersi da solo. Da qui l'ascolto su `visibilitychange`: senza,
 * la promessa dura fino alla prima notifica che ti porta altrove.
 *
 * @param {boolean} attivo
 * @returns {Promise<void>}
 */
export async function tieniAcceso(attivo) {
  voluto = attivo
  if (!attivo) return rilascia()
  await chiedi()
}

async function chiedi() {
  const wl = /** @type {any} */ (navigator)['wakeLock']
  if (!wl || document.visibilityState !== 'visible' || sentinella) return
  try {
    sentinella = await wl.request('screen')
    // Il rilascio può arrivare dal sistema (batteria bassa, risparmio energia):
    // se ci si tiene il riferimento si crede di avere un lock che non c'è più.
    sentinella.addEventListener?.('release', () => { sentinella = null })
  } catch {
    // Niente da dire all'utente: ha chiesto una comodità, non una funzione.
    sentinella = null
  }
}

async function rilascia() {
  const s = sentinella
  sentinella = null
  try { await s?.release?.() } catch { /* già rilasciato */ }
}

/** Vero se in questo momento lo schermo è tenuto acceso da noi. Serve ai test. */
export function acceso() {
  return sentinella !== null
}

/** @param {boolean} [attivo] solo per i test: reimposta l'intenzione */
export function _reset(attivo = false) { voluto = attivo; sentinella = null }

/**
 * Riaggancia il lock tornando in primo piano. Da chiamare una volta all'avvio.
 * @returns {() => void} per smettere di ascoltare
 */
export function seguiVisibilita() {
  const su = () => {
    if (document.visibilityState === 'visible' && voluto) void chiedi()
    else if (document.visibilityState !== 'visible') sentinella = null
  }
  document.addEventListener('visibilitychange', su)
  return () => document.removeEventListener('visibilitychange', su)
}

/* ── Vibrazione ───────────────────────────────────────────────────────────── */

/**
 * Le tre risposte al tocco, in millisecondi.
 *
 * Corte: una vibrazione lunga a un tavolo la sentono in cinque. Il critico e il
 * fallimento hanno una forma riconoscibile a occhi chiusi — due colpi e tre —
 * perché è esattamente lì che serve: quando il dado l'hai tirato senza guardare.
 */
const SCHEMI = /** @type {const} */ ({
  tiro: [12],
  critico: [22, 40, 22],
  fallimento: [10, 30, 10, 30, 10],
})

/** @typedef {keyof typeof SCHEMI} Schema */

/**
 * @param {Schema} quale
 * @param {boolean} attiva  la preferenza dell'utente
 */
export function vibra(quale, attiva) {
  if (!attiva) return
  const v = /** @type {any} */ (navigator)['vibrate']
  if (typeof v !== 'function') return
  try { v.call(navigator, [...SCHEMI[quale]]) } catch { /* niente */ }
}
