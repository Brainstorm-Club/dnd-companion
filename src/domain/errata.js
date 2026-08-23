/**
 * Errori della fonte, non nostri.
 *
 * I pacchetti regole riportano l'SRD verbatim: è la condizione della licenza
 * CC-BY, ed è anche l'unico modo onesto di spedire un testo di regole — chi
 * legge deve poter confrontare quello che vede con il documento pubblicato.
 * Quando però la fonte sbaglia, tacere non aiuta nessuno: al tavolo si prende
 * una decisione sbagliata leggendo una riga sbagliata.
 *
 * La via di mezzo è questa: il testo resta intoccato, e accanto compare una
 * nota che dice dov'è l'errore e cosa dice l'originale.
 *
 * Ogni voce porta una `spia`: un pezzo del testo sbagliato. La nota si mostra
 * **solo** se quella spia è ancora lì. Così il giorno in cui la fonte viene
 * corretta e i pacchetti rigenerati, la nota sparisce da sé invece di
 * contraddire un testo ormai giusto.
 */

/**
 * @typedef {object} Errata
 * @property {string} srd    la versione del documento che contiene l'errore
 * @property {string} tipo   che genere di voce («condizione», «incantesimo»…)
 * @property {string} id     l'id della voce
 * @property {string} spia   il frammento sbagliato: senza, la nota non esce
 * @property {string} chiave la chiave i18n della nota
 */

/** @type {ReadonlyArray<Errata>} */
const ERRATA = [
  // L'SRD 5.2.1 italiano ufficiale apre «Incapacitato» dicendo che il
  // personaggio «ha la condizione "paralizzato"». L'inglese dice
  // «Incapacitated»: è un refuso della traduzione, e cambia la regola —
  // paralizzato è tutta un'altra cosa, con gli attacchi ravvicinati che
  // diventano critici automatici.
  {
    srd: '5.2.1',
    tipo: 'condizione',
    id: 'incapacitated',
    spia: 'ha la condizione "paralizzato"',
    chiave: 'errata.incapacitato',
  },
]

/**
 * La chiave della nota da mostrare sotto un testo, se c'è.
 *
 * @param {string} srd
 * @param {string} tipo
 * @param {string} id
 * @param {string} testo  il testo come lo spedisce il pacchetto
 * @returns {string|null}
 */
export function errataDi(srd, tipo, id, testo) {
  const voce = ERRATA.find(e => e.srd === srd && e.tipo === tipo && e.id === id)
  if (!voce || !testo.includes(voce.spia)) return null
  return voce.chiave
}
