/**
 * I mattoni con cui è fatta una scheda.
 *
 * Righe chiave/valore, pallini, stepper, elenchi, righe tirabili: pezzi di
 * presentazione, senza stato e senza sapere che esiste un personaggio. Chi li
 * usa passa i valori e le azioni; loro disegnano.
 *
 * Stanno qui perché `views/sheet.js` aveva raggiunto il tetto dei 12 KB che
 * vale per una singola vista — e quel tetto non dice «è troppo grosso», dice
 * che sei sezioni e i loro mattoni in un file solo hanno smesso di essere una
 * vista.
 */

import { h } from '../dom.js'
import { formatModifier, diceModifier } from '../domain/character.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */

/** @param {string} etichetta @param {string} valore */
export function kv(etichetta, valore) {
  return h('div', { class: 'bsc-kv' }, [
    h('span', { class: 'bsc-kv__label' }, etichetta),
    h('span', { class: 'bsc-kv__value' }, valore),
  ])
}

/**
 * Una riga che si tocca e tira. Il tap è il gesto, ma la riga è un `button`:
 * tastiera e lettore di schermo la trovano come tutto il resto.
 * @param {string} etichetta
 * @param {number} bonus
 * @param {string} [nome]  come chiamare il tiro nello storico
 * @param {Array<Node|null>} [extra]
 */
export function tirabile(etichetta, bonus, nome = etichetta, extra = []) {
  return h('button', {
    class: 'bsc-kv bsc-kv--azione', type: 'button',
    onclick: (/** @type {Event} */ ev) => tira(ev, bonus, nome),
  }, [
    h('span', { class: 'bsc-kv__label' }, etichetta),
    ...extra,
    h('span', { class: 'bsc-kv__value' }, formatModifier(bonus)),
  ])
}

/** @param {string} etichetta @param {string} notazione @param {string} nome */
export function bottoneTiro(etichetta, notazione, nome) {
  return h('button', {
    class: 'bsc-btn bsc-btn--sm', type: 'button',
    onclick: (/** @type {Event} */ ev) => emetti(ev.currentTarget, notazione, nome),
  }, etichetta)
}

/** @param {Event} ev @param {number} bonus @param {string} nome */
export function tira(ev, bonus, nome) {
  emetti(ev.currentTarget, `1d20${diceModifier(bonus)}`, nome)
}

/**
 * La scheda non tira: dice cosa andrebbe tirato. Chi ascolta (il dice tray del
 * lotto A) decide vantaggio, svantaggio e storico.
 * @param {EventTarget|null} da
 * @param {string} notazione
 * @param {string} etichetta
 */
export function emetti(da, notazione, etichetta) {
  if (!(da instanceof HTMLElement)) return
  da.dispatchEvent(new CustomEvent('dc:tira', { detail: { notazione, etichetta }, bubbles: true }))
}

/**
 * Meno / valore / più, per i contatori che si muovono di uno alla volta.
 *
 * Il valore in mezzo è testo, non un campo: qui si tocca, non si digita — chi
 * deve battere un numero grande usa il tastierino dei punti ferita.
 * Il valore lo tiene lo stepper: `onDelta` restituisce la stringa nuova e il
 * nodo si aggiorna da sé, così chi chiama non deve tenere un riferimento a un
 * elemento e ricordarsi di scriverci dentro.
 * @param {string} valore
 * @param {(delta: number) => string|void} onDelta
 * @param {string} [etichetta]
 */
export function stepper(valore, onDelta, etichetta = '') {
  const nodo = h('span', { class: 'bsc-stepper__valore' }, valore)
  /** @param {number} delta */
  const muovi = (delta) => {
    const nuovo = onDelta(delta)
    if (typeof nuovo === 'string') nodo.textContent = nuovo
  }
  return h('span', { class: 'bsc-stepper' }, [
    h('button', {
      class: 'bsc-stepper__btn', type: 'button',
      'aria-label': `${etichetta} −1`.trim(),
      onclick: () => muovi(-1),
    }, '−'),
    nodo,
    h('button', {
      class: 'bsc-stepper__btn', type: 'button',
      'aria-label': `${etichetta} +1`.trim(),
      onclick: () => muovi(1),
    }, '+'),
  ])
}

/**
 * Pallini che si consumano al tocco.
 *
 * A differenza di `pips`, che disegna e basta, questi sono pulsanti veri: si
 * tocca il primo libero per spenderlo e uno già speso per recuperarlo. Il
 * conteggio arriva a chi chiama, che decide cosa farne — la funzione non sa
 * se sta contando dadi vita, slot o usi di un privilegio.
 *
 * @param {number} totale
 * @param {number} usati
 * @param {string} etichetta
 * @param {(usati: number) => void} onCambio
 */
export function pipsTappabili(totale, usati, etichetta, onCambio) {
  const n = Math.max(0, Math.trunc(totale))
  const spesi = Math.min(Math.max(0, Math.trunc(usati)), n)
  return h('span', {
    class: 'bsc-pips', role: 'group',
    'aria-label': `${etichetta}: ${n - spesi} su ${n}`,
  }, Array.from({ length: n }, (_, i) => {
    const speso = i < spesi
    return h('button', {
      class: ['bsc-pips__pip', speso && 'is-used'],
      type: 'button',
      'aria-pressed': speso ? 'true' : 'false',
      // toccare un pallino speso lo restituisce, toccarne uno libero lo consuma
      // insieme a tutti quelli che lo precedono: è come si segna sulla carta
      'aria-label': `${etichetta} ${i + 1}`,
      onclick: () => onCambio(speso ? i : i + 1),
    })
  }))
}

/** @param {number} totale @param {number} usati */
export function pips(totale, usati) {
  return h('span', { class: 'bsc-pips', role: 'img', 'aria-label': `${totale - usati}/${totale}` },
    Array.from({ length: Math.max(totale, 0) }, (_, i) => h('span', {
      class: ['bsc-pips__pip', i < usati && 'is-used'], 'aria-hidden': 'true',
    })))
}

/** @param {ViewCtx} ctx @param {string} chiave @param {Array<Node|null>} voci */
export function elenco(ctx, chiave, voci) {
  if (!voci.length) return null
  return h('section', {}, [
    h('h2', { class: 'bsc-label' }, ctx.t(chiave)),
    h('div', { class: 'dc-elenco' }, voci),
  ])
}

/** L'ordine in cui si guardano i privilegi: da dove viene il personaggio, poi cosa fa. */
const ORDINE_ORIGINI = ['race', 'subrace', 'class', 'subclass', 'background', 'feat']

/**
 * I privilegi raggruppati per origine.
 *
 * Con lo schema 2 il builder dice da dove viene ogni voce e a che livello si
 * ottiene: raggruppare non è decorazione, è la differenza fra una lista di
 * sedici righe indistinte e una scheda in cui si trova quello che si cerca.
 * Senza quell'informazione — export vecchi — restano un elenco solo, come prima.
 *
 * @param {ViewCtx} ctx
 * @param {import('../domain/character.js').Feature[]} privilegi
 * @returns {Array<Node|null>}
 */
export function gruppiDiPrivilegi(ctx, privilegi) {
  if (!privilegi.length) return []

  /** @type {Map<string|null, import('../domain/character.js').Feature[]>} */
  const gruppi = new Map()
  for (const f of privilegi) {
    const chiave = f.origine ?? null
    const lista = gruppi.get(chiave) ?? []
    lista.push(f)
    gruppi.set(chiave, lista)
  }

  const chiavi = [...gruppi.keys()].sort((a, b) => {
    const ia = a === null ? 99 : ORDINE_ORIGINI.indexOf(a)
    const ib = b === null ? 99 : ORDINE_ORIGINI.indexOf(b)
    return ia - ib
  })

  return chiavi.map(chiave => {
    const voci = (gruppi.get(chiave) ?? []).slice()
      // dentro un gruppo, l'ordine è quello in cui si sono ottenuti
      .sort((a, b) => (a.livello ?? 0) - (b.livello ?? 0))
    return h('section', {}, [
      h('h2', { class: 'bsc-label' }, ctx.t(chiave ? `privilegi.${chiave}` : 'privilegi.altro')),
      h('ul', { class: 'dc-elenco' }, voci.map(f => h('li', {
        class: 'bsc-kv',
        // `risolto` resta nel DOM anche quando non si vede: dice chi ha ancora
        // un nome di ripiego invece che quello del pacchetto regole.
        dataset: { privilegio: f.id, risolto: String(f.risolto) },
      }, [
        h('span', { class: 'bsc-kv__label' }, f.nome),
        f.volte > 1 ? h('span', { class: 'bsc-badge' }, `×${f.volte}`) : null,
        f.livello ? h('span', { class: 'bsc-kv__hint' }, ctx.t('privilegi.alLivello', { n: f.livello })) : null,
      ]))),
    ])
  })
}
