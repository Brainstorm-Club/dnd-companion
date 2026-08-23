/**
 * I dadi che si scuotono e poi si scoprono.
 *
 * L'animazione è quella del D&D Character Builder
 * (`src/components/shared/DiceRoller.vue`), portata qui perché le due app del
 * club tirino i dadi con lo stesso gesto: scuotimento mentre i numeri girano,
 * poi ogni dado si scopre con uno scatto elastico, uno dopo l'altro.
 *
 * Il tiro **non** dipende dall'animazione: il risultato è già calcolato e
 * salvato quando questa parte. Qui si scopre soltanto ciò che è già deciso —
 * se l'animazione non parte, o viene saltata, i numeri sono comunque quelli
 * giusti. È anche il motivo per cui `prefers-reduced-motion` può non fare
 * assolutamente nulla senza perdere informazione.
 *
 * Nel builder c'era una nota: «se i dadi vanno unificati fra le app del club
 * serve prima un `.bsc-die` a monte nel submodule». Ora c'è.
 */

import { h } from './dom.js'

/** Quanto spesso cambiano i numeri mentre il dado gira. */
const GIRO_MS = 60
/** Attesa prima che il primo dado si fermi. */
const PRIMA_MS = 400
/** Distanza fra un dado e il successivo, con un tetto: dieci dadi non devono
 *  costare dieci volte il tempo di uno. */
const PASSO_MAX_MS = 200
const CODA_MS = 900

/** @typedef {{faces: number, value: number, dropped: boolean}} Dado */

/**
 * Un dado singolo, disegnato.
 *
 * Il 20 e l'1 naturali si vedono, e chi non distingue i colori li legge lo
 * stesso: la nota è testo, non solo una classe.
 * @param {Dado} d
 * @param {(chiave: string) => string} t
 * @returns {HTMLElement}
 */
export function facciaDado(d, t) {
  const critico = d.faces === 20 && d.value === 20
  const fallimento = d.faces === 20 && d.value === 1
  /** @type {string[]} */
  const note = []
  if (critico) note.push(t('dadi.critico'))
  if (fallimento) note.push(t('dadi.fallimento'))
  if (d.dropped) note.push(t('dadi.scartato'))
  return h('span', {
    class: [
      'bsc-die', 'dc-dado',
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

/** Vero se chi guarda ha chiesto meno movimento. */
export function movimentoRidotto() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Scuote e poi scopre, uno alla volta, i dadi già disegnati.
 *
 * @param {Iterable<Element>} nodi  le facce prodotte da `facciaDado`
 * @param {{ridotto?: boolean, rng?: () => number}} [opz]
 * @returns {() => void}  ferma tutto e mostra subito i valori veri
 */
export function animaDadi(nodi, opz = {}) {
  const facce = [...nodi]
  const ridotto = opz.ridotto ?? movimentoRidotto()
  const casuale = opz.rng ?? Math.random
  if (!facce.length || ridotto) return () => {}

  /** Il testo definitivo, messo da parte prima di cominciare a mentire. */
  const veri = facce.map(el => el.textContent ?? '')
  const scoperti = facce.map(() => false)
  const passo = Math.min(PASSO_MAX_MS, CODA_MS / facce.length)

  for (const el of facce) el.classList.add('dc-dado--gira')

  const giro = setInterval(() => {
    facce.forEach((el, i) => {
      if (scoperti[i]) return
      const facceDado = Number(el.getAttribute('data-facce')) || 20
      el.textContent = String(Math.floor(casuale() * facceDado) + 1)
    })
  }, GIRO_MS)

  /** @type {ReturnType<typeof setTimeout>[]} */
  const attese = []
  facce.forEach((el, i) => {
    attese.push(setTimeout(() => {
      scoperti[i] = true
      el.textContent = veri[i] ?? ''
      el.classList.remove('dc-dado--gira')
      el.classList.add('dc-dado--scopre')
    }, PRIMA_MS + i * passo))
  })

  const ferma = () => {
    clearInterval(giro)
    for (const a of attese) clearTimeout(a)
    facce.forEach((el, i) => {
      el.textContent = veri[i] ?? ''
      el.classList.remove('dc-dado--gira')
    })
  }
  attese.push(setTimeout(ferma, PRIMA_MS + facce.length * passo + 200))
  return ferma
}
