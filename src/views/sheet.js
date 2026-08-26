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
import { loadRegistry, spellSources } from '../domain/packs.js'
import { loadRules } from '../domain/rules.js'
import {
  derive, features, formatModifier, diceModifier, ABILITIES, ABILITY_LABELS,
} from '../domain/character.js'
import { loadBridge, loadIndex } from '../domain/spells.js'
import { privilegiDiClasse } from '../domain/privilegi.js'
import { apriCassetto } from '../components/dice-tray.js'
import { kv, elenco, pips, pipsTappabili, stepper, tirabile, bottoneTiro, tira, gruppiDiPrivilegi } from './parti.js'
import {
  applyDamage, heal, useSlot, restoreSlot, toggleCondition, modifica,
  shortRest, longRest, slotsMassimi, aggiungiOggetto, togliOggetto, cambiaMonete, MONETE,
  tracciaUsi, smettiUsi, segnaUsi,
} from '../domain/session.js'
import { errataDi } from '../domain/errata.js'
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
  { id: 'privilegi', chiave: 'sezione.privilegi' },
  { id: 'zaino', chiave: 'sezione.zaino' },
  { id: 'storia', chiave: 'sezione.storia' },
])

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

    // Il personaggio che si sta guardando è quello attivo. Sembra ovvio, ma
    // prima lo diventava solo passando dalla libreria: aprendo una scheda per
    // collegamento diretto, il compendio mostrava gli incantesimi
    // nell'edizione di qualcun altro.
    if (entry && ctx.state.activeId !== id) {
      ctx.update(['characters'], (st) => { st.activeId = id })
    }
    if (!entry) {
      contenitore.appendChild(h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')))
      contenitore.appendChild(h('a', { class: 'bsc-btn', href: '#/libreria' }, ctx.t('nav.libreria')))
      return
    }

    // regole e nomi italiani degli incantesimi insieme: due fetch in parallelo
    // invece di due attese in fila, e la scheda si disegna una volta sola.
    const [rules] = await Promise.all([
      regoleDi(entry),
      caricaNomiIncantesimo(entry),
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
 * Il pacchetto regole del personaggio, con ciò che eredita dal suo base. Se non
 * si legge, la scheda si disegna lo stesso, con i numeri che sa calcolare da sé.
 * @param {CharacterEntry} entry
 * @returns {Promise<unknown>}
 */
async function regoleDi(entry) {
  try {
    return await loadRules(entry.meta.packId)
  } catch {
    return null
  }
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
    case 'privilegi': return privilegi(ctx, entry, rules)
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
 * @param {{annullabile?: boolean, mantieniFuoco?: boolean, ridisegna?: boolean}} [opz]
 *   un riposo si può annullare, un tap sui PF no; e chi sta scrivendo in un
 *   campo non vuole che gli si rifaccia la sezione sotto le dita
 */
function applica(nuovo, opz = {}) {
  if (!vista) return
  const { ctx, id } = vista
  vista.annulla = opz.annullabile ? vista.entry.play : null
  ctx.update(['characters'], (s) => {
    const e = s.characters[id]
    if (e) e.play = nuovo
  })
  if (opz.ridisegna === false) {
    // lo stato è salvato, ma la sezione resta com'è: la si sta usando
    if (vista) vista.entry = /** @type {any} */ ({ ...vista.entry, play: nuovo })
    return
  }
  ridisegna()
  // Il ridisegno rifà la sezione da capo e si porta via il fuoco: chi sta
  // segnando il bottino deve poter scrivere la riga dopo senza ritoccare il
  // campo. Si rimette dov'era, non altrove.
  if (opz.mantieniFuoco) {
    const campo = document.querySelector('.dc-aggiungi input')
    if (campo instanceof HTMLInputElement) campo.focus()
  }
}

/** Le sezioni che dipendono dallo stato di gioco, ridisegnate in posto. */
function ridisegna() {
  if (!vista) return
  const { ctx, entry, d, rules } = vista
  // Anche i privilegi, da quando ci si contano gli usi. La storia no: le note
  // si salvano mentre si scrive, e rifarle sotto le dita cancellerebbe il
  // cursore a metà parola.
  for (const sezione of ['gioco', 'magia', 'zaino', 'privilegi']) {
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
const DUE_COLONNE = 'grid-template-columns: repeat(2, minmax(var(--bsc-tap-min), 1fr))'

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
      // Quando la fonte sbaglia il testo resta com'è e l'errore si dichiara:
      // riscriverlo di nascosto sarebbe peggio del refuso.
      nota(ctx, srd, c),
    ])
  }))
}

/**
 * La nota su un errore della fonte, se questa voce ne ha uno.
 * @param {ViewCtx} ctx
 * @param {string} srd
 * @param {{id: string, testo: string}} c
 */
function nota(ctx, srd, c) {
  const chiave = c.testo ? errataDi(srd, 'condizione', c.id, c.testo) : null
  if (!chiave) return null
  return h('p', { class: 'dc-errata' }, [
    h('span', { class: 'bsc-badge bsc-badge--warn' }, ctx.t('errata.fonte')),
    ` ${ctx.t(chiave)}`,
  ])
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
      onclick: (/** @type {Event} */ ev) => tira(ev, d.modificatori[ab], ctx.t('prove.provaDi', { nome: ABILITY_LABELS[ab].nome })),
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
    elenco(ctx, 'nav.incantesimi', [...trucchetti, ...conosciuti].map(
      idIncantesimo => rigaIncantesimo(ctx, entry, idIncantesimo, preparati, massimi))),
  ]
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 */
function zaino(ctx, entry) {
  const play = entry.play
  const raccolti = play.oggetti ?? []

  return [
    h('h2', { class: 'bsc-label' }, ctx.t('zaino.monete')),
    h('div', { class: 'dc-monete' }, MONETE.map(k => h('div', { class: 'bsc-kv' }, [
      h('span', { class: 'bsc-kv__label' }, k.toUpperCase()),
      h('span', { class: 'bsc-kv__value' }, String(play.coins?.[k] ?? 0)),
      stepper(String(play.coins?.[k] ?? 0),
        (delta) => { applica(cambiaMonete(play, k, delta)); return undefined },
        k.toUpperCase()),
    ]))),

    campoOggetto(ctx),

    // Quello che si è raccolto giocando: è l'unico che si può togliere.
    elenco(ctx, 'zaino.raccolti', raccolti.length
      ? raccolti.map((o, i) => h('div', { class: 'bsc-kv' }, [
        h('span', { class: 'bsc-kv__label' }, o),
        h('button', {
          class: 'bsc-btn bsc-btn--ghost bsc-btn--sm', type: 'button',
          'aria-label': ctx.t('zaino.togli', { cosa: o }),
          onclick: () => applica(togliOggetto(entry.play, i), { annullabile: true }),
        }, '✕'),
      ]))
      : [h('p', { class: 'dc-avvio' }, ctx.t('zaino.nessunOggetto'))]),

    // L'equipaggiamento iniziale viene dallo snapshot, che non si tocca mai:
    // si legge e basta, ed è giusto che si veda che sono due liste diverse.
    elenco(ctx, 'zaino.iniziale', stringhe(entry.snapshot['equipment']).map(e => h('li', { class: 'bsc-kv' }, e))),
    testo(entry.snapshot['treasure']) ? h('p', { class: 'bsc-prose' }, testo(entry.snapshot['treasure'])) : null,
  ]
}

/**
 * I privilegi del personaggio, con il testo del pacchetto regole.
 *
 * Stavano in fondo a «Storia», in mezzo a personalità e legami: due cose che
 * non si consultano nello stesso momento — una la si legge una volta, l'altra
 * ogni volta che si dichiara qualcosa. Adesso hanno una sezione loro.
 *
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 */
function privilegi(ctx, entry, rules) {
  const suoi = features(entry, rules)
  if (!suoi.length) return [h('p', { class: 'bsc-lead' }, '—')]

  const classeId = typeof entry.snapshot['className'] === 'string' ? entry.snapshot['className'] : ''
  const testi = new Map(
    privilegiDiClasse(rules, classeId).map(p => [slugSemplice(p.nome), p.testo]))

  return [
    ...gruppiDiPrivilegi(ctx, suoi, (f) => testi.get(slugSemplice(f.nome)) ?? null,
      (f) => contatore(ctx, entry, f)),
    // Il compendio ha anche quelli che non ha ancora: utile quando si guarda
    // avanti, salendo di livello.
    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button',
      onclick: () => apriCassetto('privilegi'),
    }, ctx.t('priv.titolo')),
  ]
}

/**
 * Il contatore degli usi di un privilegio.
 *
 * Non c'è finché non lo si chiede: la maggior parte dei privilegi non si conta,
 * e riempire la scheda di contatori a zero la renderebbe illeggibile. Chi ha
 * un'Ira o un Recupero Energie da contare tocca «conta gli usi» e dice quanti
 * sono — perché il manuale ce l'ha lui, e il pacchetto regole quel numero non
 * ce l'ha.
 *
 * @param {ViewCtx} ctx
 * @param {import('../storage.js').CharacterEntry} entry
 * @param {import('../domain/character.js').Feature} f
 * @returns {Node}
 */
function contatore(ctx, entry, f) {
  const u = entry.play.uses[f.id]
  if (!u) {
    return h('button', {
      class: 'bsc-btn bsc-btn--sm bsc-btn--outline dc-usi__attiva', type: 'button',
      onclick: () => chiediUsi(ctx, f),
    }, ctx.t('usi.conta'))
  }
  return h('span', { class: 'dc-usi' }, [
    pipsTappabili(u.max, u.spesi, `${f.nome} — ${ctx.t('usi.titolo')}`,
      (spesi) => applica(segnaUsi(entry.play, f.id, spesi))),
    h('button', {
      class: 'bsc-btn bsc-btn--sm bsc-btn--outline', type: 'button',
      'aria-label': `${ctx.t('usi.modifica')} — ${f.nome}`,
      onclick: () => chiediUsi(ctx, f),
    }, '⋯'),
  ])
}

/**
 * Quanti usi, e quando tornano. Due domande, un foglio solo.
 * @param {ViewCtx} ctx
 * @param {import('../domain/character.js').Feature} f
 */
function chiediUsi(ctx, f) {
  apriFoglio(ctx, f.nome, (chiudi) => {
    const attuale = vista?.entry.play.uses[f.id]
    let quanti = attuale?.max ?? 1
    let quando = attuale?.recupero ?? 'lungo'

    const numero = h('span', { class: 'bsc-stepper__valore' }, String(quanti))
    /** @param {number} d */
    const muovi = (d) => {
      quanti = Math.max(1, Math.min(20, quanti + d))
      numero.textContent = String(quanti)
    }

    const scelte = h('div', { class: 'dc-condizioni', role: 'group', 'aria-label': ctx.t('usi.quando') },
      /** @type {const} */ (['breve', 'lungo']).map(v => {
        const b = h('button', {
          class: ['bsc-chip', v === quando && 'bsc-chip--on'], type: 'button',
          'aria-pressed': v === quando ? 'true' : 'false',
          onclick: () => {
            quando = v
            for (const altro of scelte.children) {
              const suo = altro === b
              altro.classList.toggle('bsc-chip--on', suo)
              altro.setAttribute('aria-pressed', suo ? 'true' : 'false')
            }
          },
        }, ctx.t(`usi.${v}`))
        return b
      }))

    return [
      h('p', { class: 'bsc-lead' }, ctx.t('usi.nota')),
      h('div', { class: 'bsc-kv' }, [
        h('span', { class: 'bsc-kv__label' }, ctx.t('usi.quanti')),
        h('span', { class: 'bsc-stepper' }, [
          h('button', { class: 'bsc-stepper__btn', type: 'button', 'aria-label': `${ctx.t('usi.quanti')} −1`, onclick: () => muovi(-1) }, '−'),
          numero,
          h('button', { class: 'bsc-stepper__btn', type: 'button', 'aria-label': `${ctx.t('usi.quanti')} +1`, onclick: () => muovi(1) }, '+'),
        ]),
      ]),
      h('h3', { class: 'bsc-label' }, ctx.t('usi.quando')),
      scelte,
      h('div', { class: 'dc-azioni' }, [
        h('button', {
          class: 'bsc-btn', type: 'button',
          onclick: () => {
            if (vista) applica(tracciaUsi(vista.entry.play, f.id, quanti, quando))
            chiudi()
          },
        }, ctx.t('comune.conferma')),
        attuale
          ? h('button', {
            class: 'bsc-btn bsc-btn--outline', type: 'button',
            onclick: () => {
              if (vista) applica(smettiUsi(vista.entry.play, f.id))
              chiudi()
            },
          }, ctx.t('usi.smetti'))
          : null,
      ]),
    ]
  })
}

/** Confronto fra nomi che tollera maiuscole e accenti. @param {string} v */
function slugSemplice(v) {
  return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}




/**
 * I nomi italiani degli incantesimi, per pacchetto.
 *
 * Il builder salva gli id inglesi (`1-cure-wounds`); il ponte generato dal
 * compendio li traduce in id italiani (`cura-ferite`), e l'indice dà il nome
 * per esteso. Si carica una volta per pacchetto, prima di disegnare: la scheda
 * non deve passare da «Cure Wounds» a «Cura ferite» sotto gli occhi.
 *
 * La chiave è il **pacchetto** e non l'edizione perché due pacchetti della
 * stessa edizione possono avere compendi diversi: chi ne eredita uno vede i
 * suoi incantesimi in più, e con l'edizione per chiave si sarebbe preso quelli
 * di chi ha disegnato per primo.
 * @type {Map<string, Record<string, {nome: string, livello: number}>>}
 */
const NOMI_INCANTESIMO = new Map()

/**
 * @param {CharacterEntry} entry
 * @returns {Promise<void>}
 */
async function caricaNomiIncantesimo(entry) {
  const chiave = entry.meta.packId
  if (NOMI_INCANTESIMO.has(chiave)) return
  try {
    const da = await fonteDi(entry)
    const [ponte, indice] = await Promise.all([loadBridge(da), loadIndex(da)])
    const perId = new Map(indice.map(s => [s.id, s]))
    /** @type {Record<string, {nome: string, livello: number}>} */
    const nomi = {}
    for (const [idBuilder, idItaliano] of Object.entries(ponte)) {
      const voce = perId.get(String(idItaliano))
      if (voce) nomi[idBuilder] = { nome: voce.nome, livello: voce.livello }
    }
    NOMI_INCANTESIMO.set(chiave, nomi)
  } catch {
    NOMI_INCANTESIMO.set(chiave, {})   // niente compendio: si resta sull'id ripulito
  }
}

/**
 * Da dove leggere il compendio di questo personaggio: le cartelle del suo
 * pacchetto e di quelli da cui eredita. Senza registro si resta sull'edizione,
 * che è il compendio di serie.
 * @param {CharacterEntry} entry
 * @returns {Promise<import('../domain/spells.js').DaDove>}
 */
async function fonteDi(entry) {
  try {
    return spellSources(await loadRegistry(), entry.meta.packId)
  } catch {
    return entry.meta.edition
  }
}

/**
 * Una riga della lista incantesimi: nome, livello, e il modo di segnarne l'uso.
 *
 * Il nome apre la scheda dell'incantesimo nel compendio; «usa» spende uno slot
 * del livello giusto. I trucchetti non hanno il bottone, e non è una
 * dimenticanza: si lanciano a volontà, e un pulsante che non consuma niente
 * insegnerebbe una regola sbagliata.
 *
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {string} id
 * @param {string[]} preparati
 * @param {number[]} massimi  slot massimi per livello, indice 0 = 1° livello
 */
function rigaIncantesimo(ctx, entry, id, preparati, massimi) {
  const nome = nomeIncantesimo(id, entry.meta.packId)
  const livello = livelloIncantesimo(id, entry.meta.packId)
  const preparato = preparati.includes(id)

  const etichetta = livello === 0
    ? ctx.t('magia.trucchetto')
    : ctx.t('magia.livello', { n: livello })

  return h('div', { class: ['bsc-kv', preparato && 'bsc-kv--preparato'] }, [
    // Il nome apre la descrizione **sopra** la scheda, non al posto suo: si
    // legge cosa fa l'incantesimo e si torna esattamente dov'era, senza
    // riaprire il personaggio.
    h('button', {
      class: 'bsc-kv__label dc-kv__link', type: 'button',
      onclick: () => apriCassetto('incantesimi', id),
    }, nome),
    h('span', { class: 'bsc-kv__hint' }, etichetta),
    livello > 0
      ? h('button', {
        class: 'bsc-btn bsc-btn--sm', type: 'button',
        'aria-label': ctx.t('magia.usaLungo', { nome, livello }),
        onclick: () => usaIncantesimo(ctx, nome, livello, massimi),
      }, ctx.t('magia.usa'))
      : null,
  ])
}

/**
 * Spende uno slot del livello dell'incantesimo.
 *
 * Se a quel livello non ne restano, **non** ne prende uno più alto da sé: in
 * gioco si può lanciare con uno slot superiore, ma è una scelta di chi gioca,
 * non una comodità che l'app si prende. Quindi lo dice, e dice anche quali
 * livelli sono ancora liberi.
 *
 * @param {ViewCtx} ctx
 * @param {string} nome
 * @param {number} livello
 * @param {number[]} massimi
 */
function usaIncantesimo(ctx, nome, livello, massimi) {
  if (!vista) return
  const play = vista.entry.play
  const liberi = massimi
    .map((max, i) => ({ livello: i + 1, quanti: max - (play.slots?.[String(i + 1)]?.used ?? 0) }))
    .filter(v => v.quanti > 0)

  const suo = liberi.find(v => v.livello === livello)
  if (suo) {
    applica(useSlot(play, livello, massimi[livello - 1] ?? 0), { annullabile: true })
    ctx.toast(ctx.t('magia.usato', { nome, livello }))
    return
  }
  ctx.toast(liberi.length
    ? ctx.t('magia.senzaSlot', { livello, liberi: liberi.map(v => `${v.livello}°`).join(', ') })
    : ctx.t('magia.senzaSlotAffatto'))
}

/**
 * Il livello di un incantesimo.
 *
 * Dal compendio quando c'è; altrimenti dal prefisso dell'id del builder
 * (`2-locate-object`), che il livello ce l'ha scritto dentro. Senza né l'uno né
 * l'altro è un trucchetto, che è il caso degli id senza prefisso.
 * @param {string} id
 * @param {string} [packId]
 * @returns {number}
 */
function livelloIncantesimo(id, packId) {
  const dal = packId ? NOMI_INCANTESIMO.get(packId)?.[id]?.livello : undefined
  if (typeof dal === 'number') return dal
  const prefisso = /^(\d+)-/.exec(id)
  return prefisso ? Number(prefisso[1]) : 0
}

/**
 * Il builder salva gli incantesimi con l'id inglese, a volte col livello in
 * testa (`2-misty-step`). Il nome italiano arriva dal compendio (lotto M):
 * finché non c'è, si mostra l'id ripulito invece di un vuoto.
 * @param {string} id
 * @param {string} [packId]
 */
function nomeIncantesimo(id, packId) {
  const italiano = packId ? NOMI_INCANTESIMO.get(packId)?.[id]?.nome : undefined
  if (italiano) return italiano
  const senzaLivello = id.replace(/^\d+-/, '')
  return senzaLivello.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

/**
 * Il campo per segnare quello che si è appena raccolto.
 *
 * Invio aggiunge: al tavolo si scrive «tre torce» e si torna a giocare, non si
 * cerca un bottone. Il bottone c'è lo stesso, perché il gesto non può essere
 * l'unico modo.
 * @param {ViewCtx} ctx
 */
function campoOggetto(ctx) {
  const campo = /** @type {HTMLInputElement} */ (h('input', {
    class: 'bsc-input', type: 'text', autocomplete: 'off',
    enterkeyhint: 'done', maxlength: '120',
    placeholder: ctx.t('zaino.nomeOggetto'),
  }))
  const aggiungi = () => {
    if (!vista) return
    const valore = campo.value.trim()
    if (!valore) return
    campo.value = ''
    applica(aggiungiOggetto(vista.entry.play, valore), { annullabile: true, mantieniFuoco: true })
  }
  campo.addEventListener('keydown', (ev) => {
    if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') { ev.preventDefault(); aggiungi() }
  })
  return h('div', { class: 'dc-aggiungi' }, [
    h('label', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label' }, ctx.t('zaino.aggiungi')),
      campo,
    ]),
    h('button', { class: 'bsc-btn', type: 'button', onclick: aggiungi }, '+'),
  ])
}

/**
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 */
function storia(ctx, entry, rules) {
  const s = entry.snapshot
  return [
    ...['personalityTraits', 'ideals', 'bonds', 'flaws', 'backstory', 'allies']
      .map(k => testo(s[k]) ? h('p', { class: 'bsc-prose' }, testo(s[k])) : null),
    noteDiSessione(ctx, entry),
  ]
}

/**
 * Le note di sessione.
 *
 * Stanno qui e non fra i tratti perché sono l'unica cosa scritta di questa
 * scheda che appartiene a chi gioca e non al builder: il nome dell'oste, cosa
 * si è promesso al barone, dove si è lasciato il carro. Il resto della sezione
 * è la storia che il personaggio si porta da casa; questa è quella che gli
 * succede.
 *
 * Si salvano mentre si scrive, senza un pulsante: al tavolo si annota di
 * fretta e poi si torna al gioco, e un salvataggio da confermare è un modo per
 * perdere quello che si è scritto.
 * @param {ViewCtx} ctx
 * @param {import('../storage.js').CharacterEntry} entry
 */
function noteDiSessione(ctx, entry) {
  const campo = h('textarea', {
    class: 'bsc-input dc-note', id: 'dc-note', rows: '5',
    placeholder: ctx.t('note.invito'),
  })
  const area = /** @type {HTMLTextAreaElement} */ (campo)
  area.value = entry.play.notes ?? ''
  area.addEventListener('input', () => {
    applica(modifica(vista?.entry.play ?? entry.play, p => { p.notes = area.value }), { ridisegna: false })
  })
  return h('section', { class: 'dc-gruppo' }, [
    h('label', { class: 'bsc-field-label', for: 'dc-note' }, ctx.t('note.titolo')),
    campo,
  ])
}

// ── mattoni ───────────────────────────────────────────────────────────────







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
      // Si passa per useSlot/restoreSlot invece di scrivere il numero: il
      // dominio resta l'unico posto che sa cosa vuol dire consumare uno slot.
      // Il conto dei passi è deciso prima e non si rilegge dallo stato: un ciclo
      // che aspetta un numero prodotto dalla funzione che sta chiamando è un
      // ciclo che, il giorno in cui quella funzione non fa niente, non finisce.
      const adesso = Math.min(Math.max(0, quanti), max)
      const passi = adesso - usati
      for (let i = 0; i < Math.abs(passi); i++) {
        play = passi > 0 ? useSlot(play, livello, max) : restoreSlot(play, livello)
      }
      applica(play)
    }),
  ])
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
