/**
 * Quale edizione delle regole vale, qui e ora.
 *
 * Le etichette sono due — `'2014'` e `'2024'` — e stanno per l'SRD 5.1 e l'SRD
 * 5.2.1. In giro le stesse due cose si chiamano anche 5.0, 5.5, One D&D: sono
 * sinonimi da mostrare, mai da salvare.
 *
 * La precedenza è una sola, e vive qui perché tre viste diverse ci si appoggiano:
 * scavalco puntuale → preferenza globale → edizione del personaggio.
 */

/** @typedef {'2014'|'2024'} Edition */

/** @type {readonly Edition[]} */
export const EDITIONS = /** @type {const} */ (['2014', '2024'])

/** Come si chiama, per esteso, in interfaccia. */
export const EDITION_LABELS = {
  '2014': { titolo: 'D&D 2014', srd: 'SRD 5.1', alias: '«5.0», «5e classica»' },
  '2024': { titolo: 'D&D 2024', srd: 'SRD 5.2.1', alias: '«5.5», «One D&D»' },
}

/**
 * Vero se la stringa è una delle due etichette. Serve a non fidarsi di ciò che
 * arriva da localStorage o da un URL.
 * @param {unknown} v
 * @returns {v is Edition}
 */
export function isEdition(v) {
  return v === '2014' || v === '2024'
}

/**
 * L'edizione da usare, date le tre fonti di scelta.
 *
 * @param {object} scelte
 * @param {Edition} scelte.personaggio  edizione del personaggio aperto (dal suo pacchetto)
 * @param {Edition|'auto'} [scelte.preferenza]  preferenza globale in impostazioni
 * @param {Edition|null} [scelte.scavalco]  interruttore sulla singola scheda, non persistito
 * @returns {Edition}
 */
export function resolveEdition({ personaggio, preferenza = 'auto', scavalco = null }) {
  if (scavalco && isEdition(scavalco)) return scavalco
  if (isEdition(preferenza)) return preferenza
  return personaggio
}

/**
 * L'altra. Un selettore a due valori la chiede di continuo.
 * @param {Edition} e
 * @returns {Edition}
 */
export function otherEdition(e) {
  return e === '2014' ? '2024' : '2014'
}
