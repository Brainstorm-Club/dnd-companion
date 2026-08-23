/**
 * Prove, tiri salvezza, tiri contrapposti.  ── Lotto H ──
 *
 * Una regola che l'app non deve sbagliare: **nelle prove di caratteristica il
 * 20 naturale non è un successo automatico**. Si segnala perché fa piacere
 * vederlo, ma non cambia l'esito. Il successo automatico esiste solo sui tiri
 * per colpire.
 */

import { rollNotation } from './dice.js'
import { diceModifier } from './character.js'

/** @typedef {import('./rng.js').Rng} Rng */
/** @typedef {import('./dice.js').Roll} Roll */
/** @typedef {'normale'|'vantaggio'|'svantaggio'} Advantage */

/**
 * Il tiro non si riscrive: vantaggio e svantaggio sono già notazione, e il
 * motore dei dadi sa tenerne il più alto o il più basso.
 * @type {Record<Advantage, string>}
 */
const D20 = {
  normale: '1d20',
  vantaggio: '2d20kh1',
  svantaggio: '2d20kl1',
}

/**
 * Quante volte si ripete un pareggio prima di arrendersi.
 *
 * Con un RNG onesto due pareggi di fila sono già rari; il tetto non serve a
 * quello, serve a chi passa un RNG degenere — un `{int: () => 0}` in un test,
 * o un generatore rotto — che altrimenti farebbe girare il ciclo per sempre.
 */
export const MAX_RIPETIZIONI = 20

/**
 * @typedef {object} CheckResult
 * @property {Roll} roll
 * @property {number} naturale       il d20 tenuto
 * @property {number} totale
 * @property {number|null} cd
 * @property {boolean|null} riuscita  null se non è stata data una CD
 * @property {number|null} margine    totale − cd
 * @property {boolean} venti          20 naturale (segnalato, non applicato)
 * @property {boolean} uno            1 naturale
 */

/** @param {unknown} n @param {number} ripiego @returns {number} */
function intero(n, ripiego) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : ripiego
}

/**
 * @param {object} p
 * @param {number} p.bonus
 * @param {number|null} [p.cd]
 * @param {Advantage} [p.advantage]
 * @param {Rng} p.rng
 * @param {string} [p.label]
 * @returns {CheckResult}
 */
export function check({ bonus, cd = null, advantage = 'normale', rng, label }) {
  const modo = D20[advantage] ? advantage : 'normale'
  const roll = rollNotation(`${D20[modo]}${diceModifier(intero(bonus, 0))}`, rng, label)

  // Il naturale è il d20 **tenuto**: con lo svantaggio i dadi sono due, e
  // quello scartato non è il risultato della prova.
  const tenuto = roll.groups[0]?.dice.find(d => d.faces === 20 && !d.dropped)
  const naturale = tenuto?.value ?? 0

  const soglia = cd === null || cd === undefined ? null : intero(cd, 0)

  return {
    roll,
    naturale,
    totale: roll.total,
    cd: soglia,
    // Qui sta la regola: si confronta il **totale**, e basta. Nessun ramo per
    // il 20, nessuno per l'1. Aggiungerlo sarebbe insegnare una regola falsa.
    riuscita: soglia === null ? null : roll.total >= soglia,
    margine: soglia === null ? null : roll.total - soglia,
    venti: naturale === 20,
    uno: naturale === 1,
  }
}

/**
 * Tiro contrapposto fra due lati.
 * @param {object} p
 * @param {{nome: string, bonus: number, advantage?: Advantage}} p.a
 * @param {{nome: string, bonus: number, advantage?: Advantage}} p.b
 * @param {Rng} p.rng
 * @param {'nessuno'|'ripeti'} [p.pareggio]  cosa fare a parità
 * @returns {{a: CheckResult, b: CheckResult, vincitore: 'a'|'b'|null, ripetizioni: number}}
 */
export function opposed({ a, b, rng, pareggio = 'nessuno' }) {
  /** @param {{nome: string, bonus: number, advantage?: Advantage}} lato */
  const tira = (lato) => check({
    bonus: lato.bonus,
    advantage: lato.advantage ?? 'normale',
    rng,
    label: lato.nome,
  })

  let ra = tira(a)
  let rb = tira(b)
  let ripetizioni = 0
  while (ra.totale === rb.totale && pareggio === 'ripeti' && ripetizioni < MAX_RIPETIZIONI) {
    ripetizioni++
    ra = tira(a)
    rb = tira(b)
  }

  // Pareggio che resta pareggio — per regola scelta o perché il tetto è stato
  // raggiunto — non ha un vincitore: al tavolo significa che non succede
  // niente, non che vince chi ha tirato per primo.
  const vincitore = ra.totale === rb.totale ? null : ra.totale > rb.totale ? 'a' : 'b'
  return { a: ra, b: rb, vincitore, ripetizioni }
}
