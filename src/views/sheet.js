/**
 * La scheda: sei sezioni in un pager orizzontale.  ── Lotto B ──
 *
 * Lo scorrimento fra sezioni **non è codice**: è `scroll-snap` CSS (lo porta il
 * lotto D). Qui c'è solo la struttura e le classi, più la barra di sezione che
 * fa da equivalente tappabile — nessuna funzione raggiungibile col solo gesto.
 *
 * Le righe tirabili non tirano: emettono `dc:tira` e lasciano che sia il dice
 * tray a decidere. Così la scheda resta una vista, e i dadi restano un posto
 * solo.
 */

import { h, clear, append } from '../dom.js'
import { loadRegistry } from '../domain/packs.js'
import {
  derive, features, formatModifier, diceModifier, ABILITIES, ABILITY_LABELS,
} from '../domain/character.js'
import { loadBridge, loadIndex } from '../domain/spells.js'
import {
  applyDamage, heal, useSlot, restoreSlot, toggleCondition, modifica,
  shortRest, longRest, slotsMassimi,
} from '../domain/session.js'
import { rollNotation } from '../domain/dice.js'
import { cryptoRng } from '../domain/rng.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {import('../storage.js').PlayState} PlayState */
/** @typedef {import('../domain/character.js').Derived} Derived */

/**
 * Tre termini di regole per cui `lang/it.json` non ha ancora una chiave.
 *
 * Il lotto non può aggiungerne — le lingue le tocca un altro — e senza
 * etichetta questi tre bottoni sarebbero glifi da indovinare. Stanno qui come
 * stanno i nomi delle abilità in `character.js`: sono vocabolario dell'SRD, non
 * interfaccia. Vanno spostati in `lang/` (`scheda.condizioni`,
 * `scheda.riposoBreve`, `scheda.riposoLungo`) appena qualcuno ci mette mano.
 */
const TERMINI = /** @type {const} */ ({
  condizioni: 'Condizioni',
  riposoBreve: 'Riposo breve',
  riposoLungo: 'Riposo lungo',
})

/** L'ordine è quello del piano: per frequenza d'uso al tavolo. */
const SEZIONI = /** @type {const} */ ([
  { id: 'gioco', chiave: 'sezione.gioco' },
  { id: 'prove', chiave: 'sezione.prove' },
  { id: 'azioni', chiave: 'sezione.azioni' },
  { id: 'magia', chiave: 'sezione.magia' },
  { id: 'zaino', chiave: 'sezione.zaino' },
  { id: 'storia', chiave: 'sezione.storia' },
])

/** Cache del pacchetto regole, per id: si carica una volta per sessione. */
/** @type {Map<string, unknown>} */
const regolePerPack = new Map()

/** @type {(() => void)|null} */
let staccaScroll = null

/**
 * Ciò che serve ai gestori dopo il disegno.
 *
 * La scheda non è più solo una vista: i punti ferita, gli slot e le condizioni
 * si toccano, e ogni tocco deve poter riscrivere la sezione che li mostra senza
 * ridisegnare il pager — ridisegnarlo perderebbe la sezione in cui si sta
 * guardando, a metà combattimento.
 * @typedef {object} Vista
 * @property {ViewCtx} ctx
 * @property {string} id
 * @property {CharacterEntry} entry
 * @property {Derived} d
 * @property {unknown} rules
 * @property {HTMLElement} root
 * @property {Map<string, HTMLElement>} pagine
 * @property {PlayState|null} annulla  lo stato prima dell'ultimo riposo
 */

/** @type {Vista|null} */
let vista = null

/** Le cifre battute sul tastierino dei PF, finché non si sceglie danno o cura. */
let digitato = ''

/** @type {(() => void)|null} */
let chiudiFoglio = null

/** @type {import('./index.js').View} */
export default {
  async render(contenitore, ctx) {
    const id = ctx.route.params['id'] ?? ctx.state.activeId ?? ''
    const entry = id ? ctx.state.characters[id] : undefined
    if (!entry) {
      contenitore.appendChild(h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')))
      contenitore.appendChild(h('a', { class: 'bsc-btn', href: '#/libreria' }, ctx.t('nav.libreria')))
      return
    }

    // regole e nomi italiani degli incantesimi insieme: due fetch in parallelo
    // invece di due attese in fila, e la scheda si disegna una volta sola.
    const [rules] = await Promise.all([
      regoleDi(entry),
      caricaNomiIncantesimo(entry.meta.edition),
    ])
    disegna(contenitore, ctx, id, entry, rules)
  },

  dispose() {
    staccaScroll?.()
    staccaScroll = null
    chiudiFoglio?.()
    vista = null
    digitato = ''
  },
}

/**
 * I nomi italiani degli incantesimi, per edizione.
 *
 * Il builder salva gli id inglesi (`1-cure-wounds`); il ponte generato dal
 * compendio li traduce in id italiani (`cura-ferite`), e l'indice dà il nome
 * per esteso. Si carica una volta per edizione, prima di disegnare: la scheda
 * non deve passare da «Cure Wounds» a «Cura ferite» sotto gli occhi.
 * @type {Map<string, Record<string, string>>}
 */
const NOMI_INCANTESIMO = new Map()

/**
 * @param {import('../domain/edition.js').Edition} edizione
 * @returns {Promise<void>}
 */
async function caricaNomiIncantesimo(edizione) {
  if (NOMI_INCANTESIMO.has(edizione)) return
  try {
    const [ponte, indice] = await Promise.all([loadBridge(edizione), loadIndex(edizione)])
    const perId = new Map(indice.map(s => [s.id, s.nome]))
    /** @type {Record<string, string>} */
    const nomi = {}
    for (const [idBuilder, idItaliano] of Object.entries(ponte)) {
      const nome = perId.get(String(idItaliano))
      if (nome) nomi[idBuilder] = nome
    }
    NOMI_INCANTESIMO.set(edizione, nomi)
  } catch {
    NOMI_INCANTESIMO.set(edizione, {})   // niente compendio: si resta sull'id ripulito
  }
}

/**
 * Il pacchetto regole dell'edizione del personaggio. Se non c'è ancora (i
 * pacchetti li genera il lotto C) la scheda si disegna lo stesso, con i numeri
 * che sa calcolare da sé.
 * @param {CharacterEntry} entry
 * @returns {Promise<unknown>}
 */
async function regoleDi(entry) {
  const packId = entry.meta.packId
  if (regolePerPack.has(packId)) return regolePerPack.get(packId)
  /** @type {unknown} */
  let regole = null
  try {
    const registro = await loadRegistry()
    const pack = registro.packs.find(p => p.id === packId)
    if (pack) {
      const res = await fetch(pack.regole)
      if (res.ok) regole = await res.json()
    }
  } catch {
    regole = null
  }
  regolePerPack.set(packId, regole)
  return regole
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {string} id
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 */
function disegna(contenitore, ctx, id, entry, rules) {
  const attiva = sezioneValida(ctx.route.params['sezione'])
  const d = derive(entry, rules)
  digitato = ''
  vista = { ctx, id, entry, d, rules, root: contenitore, pagine: new Map(), annulla: null }

  const pagine = SEZIONI.map(s => h('section', {
    class: 'bsc-pager__page',
    id: `dc-sez-${s.id}`,
    dataset: { sezione: s.id },
    'aria-label': ctx.t(s.chiave),
  }, contenuto(s.id, ctx, entry, d, rules)))

  SEZIONI.forEach((s, i) => { const p = pagine[i]; if (p) vista?.pagine.set(s.id, p) })

  const pager = h('div', { class: 'bsc-pager', dataset: { pager: 'scheda' } }, pagine)

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'scheda' }, [
    h('h1', { class: 'bsc-display' }, entry.meta.name),
    barraSezioni(id, attiva, ctx),
    pager,
  ]))

  // Il gesto porta alla sezione, ma la sezione si raggiunge anche dalla barra:
  // qui si allinea il pager alla rotta, non il contrario.
  const indice = SEZIONI.findIndex(s => s.id === attiva)
  const pagina = pagine[Math.max(indice, 0)]
  if (pagina) pager.scrollLeft = pagina.offsetLeft - pager.offsetLeft

  staccaScroll?.()
  staccaScroll = seguiLoScorrimento(pager, pagine, id)
}

/**
 * Mentre si scorre, la barra segue. Non si tocca la rotta: cambiarla
 * ridisegnerebbe tutto a metà gesto, ed è il modo più rapido di far sentire
 * un'app rotta.
 * @param {HTMLElement} pager
 * @param {HTMLElement[]} pagine
 * @param {string} id
 * @returns {() => void}
 */
function seguiLoScorrimento(pager, pagine, id) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let attesa
  const fn = () => {
    clearTimeout(attesa)
    attesa = setTimeout(() => {
      let vicina = 0
      let minimo = Infinity
      pagine.forEach((p, i) => {
        const dist = Math.abs(p.offsetLeft - pager.offsetLeft - pager.scrollLeft)
        if (dist < minimo) { minimo = dist; vicina = i }
      })
      const corrente = SEZIONI[vicina]
      if (!corrente) return
      for (const a of document.querySelectorAll('[data-sezioni] a')) {
        a.toggleAttribute('aria-current', a.getAttribute('href') === rotta(id, corrente.id))
      }
    }, 120)
  }
  pager.addEventListener('scroll', fn, { passive: true })
  return () => { clearTimeout(attesa); pager.removeEventListener('scroll', fn) }
}

/**
 * @param {string} id
 * @param {string} attiva
 * @param {ViewCtx} ctx
 */
function barraSezioni(id, attiva, ctx) {
  return h('nav', { class: 'bsc-tabs', 'data-sezioni': true, 'aria-label': ctx.t('nav.scheda') },
    SEZIONI.map(s => h('a', {
      class: ['bsc-tab', s.id === attiva && 'is-active'],
      href: rotta(id, s.id),
      'aria-current': s.id === attiva ? 'true' : null,
    }, ctx.t(s.chiave))))
}

/** @param {string} id @param {string} sezione */
function rotta(id, sezione) {
  return `#/scheda/${encodeURIComponent(id)}/${sezione}`
}

/** @param {string|undefined} v */
function sezioneValida(v) {
  return SEZIONI.some(s => s.id === v) ? /** @type {string} */ (v) : 'gioco'
}

// ── le sei sezioni ────────────────────────────────────────────────────────

/**
 * @param {string} sezione
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {Derived} d
 * @param {unknown} rules
 * @returns {Array<Node|null>}
 */
function contenuto(sezione, ctx, entry, d, rules) {
  switch (sezione) {
    case 'prove': return prove(ctx, d)
    case 'azioni': return azioni(ctx, entry, d)
    case 'magia': return magia(ctx, entry, d, rules)
    case 'zaino': return zaino(ctx, entry)
    case 'storia': return storia(ctx, entry, rules)
    default: return gioco(ctx, entry, d, rules)
  }
}

/**
 * Applica un nuovo stato di gioco e riscrive le sezioni che lo mostrano.
 *
 * Tre sezioni su sei leggono `play` — gioco, magia, zaino — e sono le uniche
 * che si rifanno: il resto viene dallo snapshot, che è congelato e non cambia
 * mai. Il pager non si tocca, quindi la sezione in vista resta quella.
 * @param {PlayState} nuovo
 * @param {{annullabile?: boolean}} [opz]  un riposo si può annullare, un tap sui PF no
 */
function applica(nuovo, opz = {}) {
  if (!vista) return
  const { ctx, id } = vista
  vista.annulla = opz.annullabile ? vista.entry.play : null
  ctx.update(['characters'], (s) => {
    const e = s.characters[id]
    if (e) e.play = nuovo
  })
  ridisegna()
}

/** Le tre sezioni che dipendono dallo stato di gioco, ridisegnate in posto. */
function ridisegna() {
  if (!vista) return
  const { ctx, entry, d, rules } = vista
  for (const sezione of ['gioco', 'magia', 'zaino']) {
    const pagina = vista.pagine.get(sezione)
    if (!pagina) continue
    clear(pagina)
    append(pagina, contenuto(sezione, ctx, entry, d, rules))
  }
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {Derived} d
 * @param {unknown} rules
 * @returns {Array<Node|null>}
 */
function gioco(ctx, entry, d, rules) {
  const play = entry.play
  const livello = numero(entry.snapshot['level'], 1)
  const dado = numero(entry.snapshot['hitDie'], 8)
  const velocita = numero(entry.snapshot['speed'], 30)
  const spesi = Math.min(play.hitDice.spent, livello)

  return [
    h('div', { class: 'bsc-meter', role: 'meter', 'aria-label': ctx.t('scheda.pf'),
      'aria-valuenow': String(play.hp.cur), 'aria-valuemin': '0', 'aria-valuemax': String(d.pfMax) }, [
      h('span', { class: 'bsc-meter__label' }, ctx.t('scheda.pf')),
      h('span', { class: 'bsc-meter__value' }, `${play.hp.cur} / ${d.pfMax}`),
      play.hp.temp > 0 ? h('span', { class: 'bsc-badge' }, `+${play.hp.temp}`) : null,
      h('span', { class: 'bsc-meter__fill', style: `--bsc-meter-quota: ${quota(play.hp.cur, d.pfMax)}` }),
    ]),
    tastierino(ctx, d.pfMax),

    // I temporanei sono un'altra riserva, non punti ferita: si aggiungono e si
    // consumano per primi, e una cura non li ridà. Quindi un controllo a parte.
    h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, `${ctx.t('scheda.pf')} +`),
      h('span', { class: 'bsc-kv__value' }, String(play.hp.temp)),
      stepper(String(play.hp.temp), (delta) => applica(
        modifica(play, p => { p.hp.temp = Math.max(0, p.hp.temp + delta) }))),
    ]),

    h('h2', { class: 'bsc-label' }, `${ctx.t('prove.tiroSalvezza')} ☠`),
    rigaMorte(ctx, play, 'succ', '✓'),
    rigaMorte(ctx, play, 'fail', '✕'),

    kv(ctx.t('scheda.ca'), String(d.ca)),
    tirabile(ctx.t('scheda.iniziativa'), d.iniziativa),
    kv(ctx.t('scheda.velocita'), String(velocita)),
    kv(ctx.t('scheda.competenza'), formatModifier(d.competenza)),

    h('button', {
      class: 'bsc-kv bsc-kv--azione', type: 'button',
      'aria-pressed': play.inspiration ? 'true' : 'false',
      onclick: () => applica(modifica(play, p => { p.inspiration = !p.inspiration })),
    }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.ispirazione')),
      h('span', { class: 'bsc-kv__value' }, play.inspiration ? '●' : '○'),
    ]),

    h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.dadiVita')),
      h('span', { class: 'bsc-kv__value' }, `${livello - spesi}d${dado}`),
      pipsTappabili(livello, spesi, ctx.t('scheda.dadiVita'),
        (quanti) => applica(modifica(play, p => { p.hitDice.spent = quanti }))),
    ]),

    riposi(ctx, entry, d, rules, livello, dado),
    condizioni(ctx, play, rules),
  ]
}

/**
 * Il tastierino dei punti ferita: si batte il numero, poi si sceglie se
 * toglierlo o darlo.
 *
 * Due tasti grandi invece di uno stepper, perché al tavolo il danno è tredici —
 * e tredici tap su una freccina, mentre il tavolo aspetta, sono tredici di
 * troppo. Le cifre restano finché non si sceglie: battere e ripensarci non
 * costa niente.
 * @param {ViewCtx} ctx
 * @param {number} pfMax
 */
function tastierino(ctx, pfMax) {
  const schermo = h('span', { class: 'bsc-kv__value', role: 'status' }, digitato || '0')
  /** @param {string} c */
  const batti = (c) => {
    if (c === 'C') digitato = ''
    else if (c === '⌫') digitato = digitato.slice(0, -1)
    else if (digitato.length < 3) digitato = (digitato + c).replace(/^0+(?=\d)/, '')
    schermo.textContent = digitato || '0'
  }
  /** @param {-1|1} segno */
  const applicaPf = (segno) => {
    if (!vista) return
    const n = Number.parseInt(digitato, 10)
    digitato = ''
    if (!Number.isFinite(n) || n <= 0) { schermo.textContent = '0'; return }
    const play = vista.entry.play
    applica(segno < 0 ? applyDamage(play, n, pfMax) : heal(play, n, pfMax))
  }

  return h('div', { class: 'dc-gruppo' }, [
    h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.pf')),
      schermo,
    ]),
    h('div', { class: 'bsc-numpad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C'].map(c =>
      h('button', { type: 'button', onclick: () => batti(c) }, c))),
    h('div', { class: 'bsc-numpad', style: DUE_COLONNE }, [
      h('button', { type: 'button', 'aria-label': `${ctx.t('scheda.pf')} −`, onclick: () => applicaPf(-1) }, '−'),
      h('button', { type: 'button', 'aria-label': `${ctx.t('scheda.pf')} +`, onclick: () => applicaPf(1) }, '+'),
    ]),
  ])
}

/** Due colonne invece di tre, senza scrivere una spaziatura a mano. */
const DUE_COLONNE = 'grid-template-columns: repeat(2, minmax(var(--dc-tap-min), 1fr))'

/**
 * Una delle due righe dei tiri salvezza contro morte: tre caselle, e la terza
 * decide. Toccare l'ultima piena la svuota — è così che si annulla una crocetta
 * messa per sbaglio, senza un tasto in più.
 * @param {ViewCtx} ctx
 * @param {PlayState} play
 * @param {'succ'|'fail'} chiave
 * @param {string} glifo
 */
function rigaMorte(ctx, play, chiave, glifo) {
  const n = Math.min(Math.max(play.deaths[chiave], 0), 3)
  return h('div', { class: 'bsc-kv' }, [
    h('span', { class: 'bsc-kv__label' }, `${glifo} ${ctx.t('prove.tiroSalvezza')}`),
    pipsTappabili(3, n, glifo, (quanti) => applica(
      modifica(play, p => { p.deaths[chiave] = quanti }))),
  ])
}

/**
 * I due riposi, e il modo di tornare indietro.
 *
 * «Annulla» compare solo dopo un riposo: è l'unica azione della scheda che
 * cambia dieci cose insieme, ed è per questa che le funzioni di `session.js`
 * sono pure — lo stato di prima è ancora lì, intero, e ci si torna in un tap.
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {Derived} d
 * @param {unknown} rules
 * @param {number} livello
 * @param {number} dado
 */
function riposi(ctx, entry, d, rules, livello, dado) {
  return h('div', { class: 'dc-gruppo' }, [
    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button',
      onclick: () => chiediRiposoBreve(ctx, d, rules, livello, dado),
    }, TERMINI.riposoBreve),
    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button',
      onclick: () => chiediRiposoLungo(ctx, d, rules, livello),
    }, TERMINI.riposoLungo),
    vista?.annulla
      ? h('button', { class: 'bsc-btn bsc-btn--ghost', type: 'button', onclick: annullaRiposo }, ctx.t('comune.annulla'))
      : null,
  ])
}

function annullaRiposo() {
  const prima = vista?.annulla
  if (prima) applica(prima)
}

/**
 * @param {ViewCtx} ctx
 * @param {Derived} d
 * @param {unknown} rules
 * @param {number} livello
 * @param {number} dado
 */
function chiediRiposoBreve(ctx, d, rules, livello, dado) {
  const disponibili = Math.max(livello - (vista?.entry.play.hitDice.spent ?? 0), 0)
  let quanti = disponibili > 0 ? 1 : 0

  apriFoglio(ctx, TERMINI.riposoBreve, (chiudi) => {
    return [
      h('div', { class: 'bsc-kv' }, [
        h('span', { class: 'bsc-kv__label' }, `${ctx.t('scheda.dadiVita')} d${dado}`),
        h('span', { class: 'bsc-kv__value' }, String(disponibili)),
        stepper(String(quanti), (delta) => {
          quanti = Math.min(Math.max(quanti + delta, 0), disponibili)
          return String(quanti)
        }, ctx.t('scheda.dadiVita')),
      ]),
      conferma(ctx, chiudi, () => {
        if (!vista) return
        const tiri = tiraDadiVita(quanti, dado, d.modificatori.con)
        applica(shortRest(vista.entry.play, { dadiSpesi: quanti, tiri, pfMax: d.pfMax }, rules), { annullabile: true })
        const cura = tiri.reduce((a, b) => a + b, 0)
        if (cura > 0) ctx.toast(`${ctx.t('scheda.pf')} +${cura}`)
      }),
    ]
  })
}

/**
 * @param {ViewCtx} ctx
 * @param {Derived} d
 * @param {unknown} rules
 * @param {number} livello
 */
function chiediRiposoLungo(ctx, d, rules, livello) {
  apriFoglio(ctx, TERMINI.riposoLungo, (chiudi) => [
    h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.pf')),
      h('span', { class: 'bsc-kv__value' }, String(d.pfMax)),
    ]),
    h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, ctx.t('scheda.dadiVita')),
      h('span', { class: 'bsc-kv__value' }, `+${Math.max(1, Math.floor(livello / 2))}`),
    ]),
    conferma(ctx, chiudi, () => {
      if (!vista) return
      applica(longRest(vista.entry.play, { pfMax: d.pfMax, dadiVitaTotali: livello }, rules), { annullabile: true })
    }),
  ])
}

/**
 * I dadi vita di un riposo breve. Il tiro lo fa la vista — `shortRest()` non
 * tira, così resta provabile — e ogni dado cura almeno un punto ferita: con
 * Costituzione bassa, riposare non deve togliere punti.
 * @param {number} quanti
 * @param {number} dado
 * @param {number} modCon
 * @returns {number[]}
 */
function tiraDadiVita(quanti, dado, modCon) {
  if (quanti <= 0) return []
  const r = rollNotation(`${quanti}d${dado}`, cryptoRng())
  return r.groups.flatMap(g => g.dice).filter(x => !x.dropped).map(x => Math.max(1, x.value + modCon))
}

/**
 * Le condizioni attive, e il modo di cambiarle. I nomi li porta il pacchetto:
 * qui non c'è un elenco di condizioni scritto a mano, e nella v3 un pacchetto
 * che ne aggiunge una la vedrà comparire senza toccare questo file.
 * @param {ViewCtx} ctx
 * @param {PlayState} play
 * @param {unknown} rules
 */
function condizioni(ctx, play, rules) {
  const elenco = condizioniDelPacchetto(rules)
  if (!elenco.length && !play.conditions.length) return null
  const perId = new Map(elenco.map(c => [c.id, c]))
  return h('section', {}, [
    h('h2', { class: 'bsc-label' }, TERMINI.condizioni),
    h('div', { class: 'dc-condizioni' }, [
      ...play.conditions.map(id => h('button', {
        class: 'bsc-chip bsc-chip--on', type: 'button', 'aria-pressed': 'true',
        onclick: () => apriCondizioni(ctx, rules),
      }, perId.get(id)?.nome ?? id)),
      h('button', {
        class: 'bsc-chip', type: 'button', 'aria-label': TERMINI.condizioni,
        onclick: () => apriCondizioni(ctx, rules),
      }, '+'),
    ]),
  ])
}

/**
 * Il foglio delle condizioni: nome, interruttore e testo dell'SRD, perché la
 * domanda al tavolo non è «sono spaventato?» ma «cosa vuol dire, spaventato?».
 * @param {ViewCtx} ctx
 * @param {unknown} rules
 */
function apriCondizioni(ctx, rules) {
  const srd = testo(oggetto(rules)['srd'])
  apriFoglio(ctx, TERMINI.condizioni, () => condizioniDelPacchetto(rules).map(c => {
    const attiva = !!vista?.entry.play.conditions.includes(c.id)
    const interruttore = h('button', {
      class: ['bsc-chip', attiva && 'bsc-chip--on'], type: 'button',
      'aria-pressed': attiva ? 'true' : 'false',
      onclick: () => {
        if (!vista) return
        applica(toggleCondition(vista.entry.play, c.id))
        const ora = vista.entry.play.conditions.includes(c.id)
        interruttore.setAttribute('aria-pressed', ora ? 'true' : 'false')
        interruttore.classList.toggle('bsc-chip--on', ora)
      },
    }, c.nome)

    return h('section', {
      class: 'dc-gruppo',
      dataset: { condizione: c.id, testo: c.testo ? 'srd' : 'assente' },
    }, [
      interruttore,
      // Quattro condizioni del 2014 arrivano senza testo: l'SRD 5.1 italiano è
      // mutilo lì, e il testo del 2024 dice altre cose. Si dichiara la lacuna e
      // si mostra da quale SRD manca — inventarlo sarebbe peggio del vuoto.
      c.testo
        ? h('p', { class: 'bsc-prose' }, c.testo)
        : h('p', { class: 'bsc-prose' }, [
          h('span', { class: 'bsc-badge bsc-badge--warn' }, srd ? `SRD ${srd}` : 'SRD'),
          ` ${ctx.t('scheda.senzaTesto')}`,
        ]),
    ])
  }))
}

/**
 * @param {unknown} rules
 * @returns {Array<{id: string, nome: string, testo: string}>}
 */
function condizioniDelPacchetto(rules) {
  return lista(oggetto(rules)['conditions']).map(c => {
    const o = oggetto(c)
    const id = testo(o['id'])
    return { id, nome: testo(o['name']) || testo(o['nome']) || id, testo: testo(o['description']) }
  }).filter(c => c.id)
}

/**
 * Le sei caratteristiche, i sei tiri salvezza, le diciotto abilità. Ogni riga
 * è toccabile e tira: è la sezione per cui esiste l'app.
 * @param {ViewCtx} ctx
 * @param {Derived} d
 */
function prove(ctx, d) {
  return [
    h('div', { class: 'dc-caratteristiche' }, ABILITIES.map(ab => h('button', {
      class: 'bsc-stat', type: 'button',
      onclick: (/** @type {Event} */ ev) => tira(ev, d.modificatori[ab], ABILITY_LABELS[ab].nome),
    }, [
      h('span', { class: 'bsc-stat__label' }, ABILITY_LABELS[ab].breve),
      h('span', { class: 'bsc-stat__value' }, String(d.punteggi[ab])),
      h('span', { class: 'bsc-stat__mod' }, formatModifier(d.modificatori[ab])),
    ]))),

    h('h2', { class: 'bsc-label' }, ctx.t('prove.tiroSalvezza')),
    h('div', { class: 'dc-elenco' }, ABILITIES.map(ab =>
      tirabile(`${ctx.t('prove.tiroSalvezza')}: ${ABILITY_LABELS[ab].nome}`, d.tiriSalvezza[ab], ABILITY_LABELS[ab].nome))),

    h('h2', { class: 'bsc-label' }, ctx.t('prove.abilita')),
    h('div', { class: 'dc-elenco' }, d.abilita.map(a => tirabile(
      a.nome,
      a.bonus,
      a.nome,
      [
        a.maestria ? h('span', { class: 'bsc-badge bsc-badge--ok' }, '◆') : a.competenza ? h('span', { class: 'bsc-badge' }, '●') : null,
        h('span', { class: 'bsc-kv__hint' }, ABILITY_LABELS[a.caratteristica].breve),
      ],
    ))),
  ]
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {Derived} d
 */
function azioni(ctx, entry, d) {
  const armi = lista(entry.snapshot['weapons'])
  if (!armi.length) return [h('p', { class: 'bsc-lead' }, '—')]
  return armi.map(a => {
    const arma = oggetto(a)
    const nome = testo(arma['name']) || '—'
    const bonus = numero(arma['attackBonus'], 0)
    const danno = testo(arma['damage'])
    return h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, nome),
      bottoneTiro(`${ctx.t('scheda.attacco')} ${formatModifier(bonus)}`, `1d20${diceModifier(bonus)}`, `${nome} — ${ctx.t('scheda.attacco')}`),
      danno ? bottoneTiro(danno, danno, `${nome} — ${danno}`) : null,
    ])
  })
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {Derived} d
 * @param {unknown} rules
 * @returns {Array<Node|null>}
 */
function magia(ctx, entry, d, rules) {
  const trucchetti = stringhe(entry.snapshot['cantrips'])
  const conosciuti = stringhe(entry.snapshot['spellsKnown'])
  const preparati = stringhe(entry.snapshot['spellsPrepared'])
  const massimi = slotsMassimi(rules, entry.snapshot)
  if (d.cdIncantesimi === null && !trucchetti.length && !conosciuti.length && !massimi.length) {
    return [h('p', { class: 'bsc-lead' }, '—')]
  }
  return [
    ...massimi.map((max, i) => rigaSlot(ctx, entry, i + 1, max)),
    d.cdIncantesimi !== null ? kv(ctx.t('scheda.cd'), String(d.cdIncantesimi)) : null,
    d.attaccoIncantesimi !== null
      ? tirabile(`${ctx.t('scheda.attacco')} (${ctx.t('tab.incantesimi')})`, d.attaccoIncantesimi)
      : null,
    elenco(ctx, 'nav.incantesimi', [...trucchetti, ...conosciuti].map(idIncantesimo => {
      const preparato = preparati.includes(idIncantesimo)
      return h('a', {
        class: ['bsc-chip', preparato && 'bsc-chip--on'],
        href: `#/incantesimi/${encodeURIComponent(idIncantesimo)}`,
      }, nomeIncantesimo(idIncantesimo, entry.meta.edition))
    })),
  ]
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 */
function zaino(ctx, entry) {
  const monete = entry.play.coins
  return [
    h('div', { class: 'dc-monete' }, ['pp', 'gp', 'ep', 'sp', 'cp'].map(k => kv(k.toUpperCase(), String(monete[k] ?? 0)))),
    elenco(ctx, 'sezione.zaino', stringhe(entry.snapshot['equipment']).map(e => h('li', { class: 'bsc-kv' }, e))),
    testo(entry.snapshot['treasure']) ? h('p', { class: 'bsc-prose' }, testo(entry.snapshot['treasure'])) : null,
  ]
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 */
function storia(ctx, entry, rules) {
  const s = entry.snapshot
  const privilegi = features(entry, rules)
  return [
    privilegi.length
      // `risolto` resta nel DOM anche quando non si vede: quando il pacchetto
      // regole (lotto C) porterà i nomi italiani, è lì che si aggancia il
      // testo — e nel frattempo dice chi è ancora un ripiego.
      ? h('ul', { class: 'dc-elenco' }, privilegi.map(f => h('li', {
        class: 'bsc-kv', dataset: { privilegio: f.id, risolto: String(f.risolto) },
      }, [
        h('span', { class: 'bsc-kv__label' }, f.nome),
        f.volte > 1 ? h('span', { class: 'bsc-badge' }, `×${f.volte}`) : null,
      ])))
      : null,
    ...['personalityTraits', 'ideals', 'bonds', 'flaws', 'backstory', 'allies']
      .map(k => testo(s[k]) ? h('p', { class: 'bsc-prose' }, testo(s[k])) : null),
  ]
}

// ── mattoni ───────────────────────────────────────────────────────────────

/** @param {string} etichetta @param {string} valore */
function kv(etichetta, valore) {
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
function tirabile(etichetta, bonus, nome = etichetta, extra = []) {
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
function bottoneTiro(etichetta, notazione, nome) {
  return h('button', {
    class: 'bsc-btn bsc-btn--sm', type: 'button',
    onclick: (/** @type {Event} */ ev) => emetti(ev.currentTarget, notazione, nome),
  }, etichetta)
}

/** @param {Event} ev @param {number} bonus @param {string} nome */
function tira(ev, bonus, nome) {
  emetti(ev.currentTarget, `1d20${diceModifier(bonus)}`, nome)
}

/**
 * La scheda non tira: dice cosa andrebbe tirato. Chi ascolta (il dice tray del
 * lotto A) decide vantaggio, svantaggio e storico.
 * @param {EventTarget|null} da
 * @param {string} notazione
 * @param {string} etichetta
 */
function emetti(da, notazione, etichetta) {
  if (!(da instanceof HTMLElement)) return
  da.dispatchEvent(new CustomEvent('dc:tira', { detail: { notazione, etichetta }, bubbles: true }))
}


/**
 * Apre un bottom sheet e ne restituisce la chiusura.
 *
 * Ce n'è **uno solo alla volta**: aprirne un altro chiude il precedente, e
 * `dispose()` della vista chiude quello rimasto. Il contenuto arriva come
 * funzione perché quasi sempre ha bisogno di sapere come chiudersi.
 *
 * @param {ViewCtx} ctx
 * @param {string} titolo
 * @param {(chiudi: () => void) => Array<Node|null>|Node} contenuto
 */
function apriFoglio(ctx, titolo, contenuto) {
  chiudiFoglio?.()

  const backdrop = h('div', { class: 'bsc-sheet-backdrop' })
  const chiudi = () => {
    backdrop.remove()
    document.removeEventListener('keydown', suEsc)
    if (chiudiFoglio === chiudi) chiudiFoglio = null
  }
  /** @param {KeyboardEvent} ev */
  const suEsc = (ev) => { if (ev.key === 'Escape') chiudi() }

  const corpo = contenuto(chiudi)
  const foglio = h('div', {
    class: 'bsc-sheet bsc-sheet--app', role: 'dialog', 'aria-modal': 'true', 'aria-label': titolo,
  }, [
    h('div', { class: 'bsc-sheet__head' }, [
      h('h2', { class: 'bsc-sheet__title' }, titolo),
      h('button', {
        class: 'bsc-sheet__close', type: 'button',
        'aria-label': ctx.t('comune.chiudi'), onclick: chiudi,
      }, '✕'),
    ]),
    ...(Array.isArray(corpo) ? corpo : [corpo]),
  ])

  // un tocco sul fondo chiude, uno dentro no
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) chiudi() })
  document.addEventListener('keydown', suEsc)
  backdrop.appendChild(foglio)
  document.body.appendChild(backdrop)
  foglio.querySelector('button')?.focus()

  chiudiFoglio = chiudi
  return chiudi
}

/**
 * La coppia annulla / conferma in fondo a un foglio.
 *
 * Conferma **e chiude**: nessuna azione di sessione resta a metà con il foglio
 * ancora aperto, perché il passo dopo è sempre guardare la scheda.
 * @param {ViewCtx} ctx
 * @param {() => void} chiudi
 * @param {() => void} azione
 */
function conferma(ctx, chiudi, azione) {
  return h('div', { class: 'dc-azioni' }, [
    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button', onclick: chiudi,
    }, ctx.t('comune.annulla')),
    h('button', {
      class: 'bsc-btn', type: 'button',
      onclick: () => { azione(); chiudi() },
    }, ctx.t('comune.conferma')),
  ])
}

/**
 * Una riga di slot incantesimo: livello, quanti ne restano, e i pallini.
 *
 * Toccare un pallino libero lo consuma, toccarne uno speso lo restituisce —
 * non perché esista una regola che li ridà, ma perché al tavolo si sbaglia
 * pallino.
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {number} livello
 * @param {number} max
 */
function rigaSlot(ctx, entry, livello, max) {
  const usati = Math.min(Math.max(0, entry.play.slots?.[String(livello)]?.used ?? 0), max)
  const etichetta = `${ctx.t('scheda.slot')} ${livello}`
  return h('div', { class: 'bsc-kv' }, [
    h('span', { class: 'bsc-kv__label' }, etichetta),
    h('span', { class: 'bsc-kv__value' }, `${max - usati}/${max}`),
    pipsTappabili(max, usati, etichetta, (quanti) => {
      if (!vista) return
      let play = vista.entry.play
      // si passa per useSlot/restoreSlot invece di scrivere il numero: il
      // dominio resta l'unico posto che sa cosa vuol dire consumare uno slot
      while (quanti > (play.slots?.[String(livello)]?.used ?? 0)) play = useSlot(play, livello)
      while (quanti < (play.slots?.[String(livello)]?.used ?? 0)) play = restoreSlot(play, livello)
      applica(play)
    }),
  ])
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
function stepper(valore, onDelta, etichetta = '') {
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
function pipsTappabili(totale, usati, etichetta, onCambio) {
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
function pips(totale, usati) {
  return h('span', { class: 'bsc-pips', role: 'img', 'aria-label': `${totale - usati}/${totale}` },
    Array.from({ length: Math.max(totale, 0) }, (_, i) => h('span', {
      class: ['bsc-pips__pip', i < usati && 'is-used'], 'aria-hidden': 'true',
    })))
}

/** @param {ViewCtx} ctx @param {string} chiave @param {Array<Node|null>} voci */
function elenco(ctx, chiave, voci) {
  if (!voci.length) return null
  return h('section', {}, [
    h('h2', { class: 'bsc-label' }, ctx.t(chiave)),
    h('div', { class: 'dc-elenco' }, voci),
  ])
}

/**
 * Il builder salva gli incantesimi con l'id inglese, a volte col livello in
 * testa (`2-misty-step`). Il nome italiano arriva dal compendio (lotto M):
 * finché non c'è, si mostra l'id ripulito invece di un vuoto.
 * @param {string} id
 * @param {import('../domain/edition.js').Edition} [edizione]
 */
function nomeIncantesimo(id, edizione) {
  const italiano = edizione ? NOMI_INCANTESIMO.get(edizione)?.[id] : undefined
  if (italiano) return italiano
  const senzaLivello = id.replace(/^\d+-/, '')
  return senzaLivello.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

/** @param {number} cur @param {number} max */
function quota(cur, max) {
  if (max <= 0) return '0'
  return String(Math.min(Math.max(cur / max, 0), 1))
}

/** @param {unknown} v @param {number} dflt */
function numero(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt
}

/** @param {unknown} v @returns {string} */
function testo(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** @param {unknown} v @returns {unknown[]} */
function lista(v) {
  return Array.isArray(v) ? v : []
}

/** @param {unknown} v @returns {string[]} */
function stringhe(v) {
  return lista(v).filter(x => typeof x === 'string')
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}
