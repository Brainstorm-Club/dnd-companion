/**
 * Vista «prove»: prove di caratteristica e abilità, tiri salvezza, contrapposti.  ── Lotto H ──
 *
 * La vista non conosce le regole: le chiede a `domain/check.js`, che è il posto
 * dove il 20 naturale **non** diventa un successo automatico. Qui si sceglie
 * cosa tirare, si compone la CD col tastierino, e si legge il margine.
 *
 * Il risultato finisce nello stesso storico della vista dadi: un tiro fatto qui
 * e uno fatto col tastierino dei dadi devono essere la stessa cosa.
 */

import { h, clear } from '../dom.js'
import { cryptoRng } from '../domain/rng.js'
import { check, opposed } from '../domain/check.js'
import { loadRegistry } from '../domain/packs.js'
import { derive, formatModifier, ABILITIES, ABILITY_LABELS } from '../domain/character.js'
import { facciaDado, animaDadi } from '../anima-dadi.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {import('../domain/character.js').Derived} Derived */
/** @typedef {import('../domain/check.js').CheckResult} CheckResult */
/** @typedef {import('../domain/dice.js').Roll} Roll */
/** @typedef {'abilita'|'salvezza'|'contrapposto'} Modo */
/** @typedef {'normale'|'vantaggio'|'svantaggio'} Advantage */
/** @typedef {{valore: string, nome: string, testo: string, bonus: number}} Voce */

/** Quanti tiri si ricordano. Lo stesso anello della vista dadi. */
const MAX_STORICO = 50

/** La CD sta in due cifre: una CD a tre cifre è un refuso, non una prova. */
const CD_MAX = 99

/**
 * Stile in linea, solo token — stessa scelta della vista dadi: `.bsc-chip` e
 * `.bsc-roll` non sono ancora nel design system (PIANO § 4.1), e finché il
 * lotto DS non arriva servono queste righe perché i target restino tappabili
 * e lontani dai bordi.
 */
const TAP = 'min-width: var(--dc-tap-min); min-height: var(--dc-tap-min)'
/** 16 px di `.dc-main` + 12 px qui = 28 px: fuori dalla zona morta dei 24. */
const VISTA = 'display: grid; gap: var(--bsc-space-4); padding-inline: var(--bsc-space-3)'
const RIGA = 'display: flex; flex-wrap: wrap; gap: var(--bsc-space-2); align-items: center'

/** @type {() => void} */
let fermaAnimazione = () => {}

/** Lo stato della vista è una scelta d'interfaccia, non un dato da conservare. */
/** @type {Modo} */
let modo = 'abilita'
/** Quale voce si sta tirando, per modo: `car:dex`, `ab:perception`. */
/** @type {Record<Modo, string>} */
const scelta = { abilita: '', salvezza: '', contrapposto: '' }
/** Il ripiego quando non c'è nessun personaggio aperto. */
let bonusManuale = 0
/** @type {number|null} */
let cd = null
/** @type {Advantage} */
let advA = 'normale'
/** @type {Advantage} */
let advB = 'normale'
/** Il lato B: id di un altro personaggio importato, o `''` per il bonus a mano. */
let idB = ''
/** La voce scelta per il lato B, quando B è un personaggio. */
let sceltaB = ''
let bonusB = 0
/** La regola del pareggio: falso = «nessuno», vero = «ripeti». */
let ripetiPareggio = false

/** @type {import('../domain/rng.js').Rng} */
const rng = cryptoRng()

/** Cache del pacchetto regole, per id: si carica una volta per sessione. */
/** @type {Map<string, unknown>} */
const regolePerPack = new Map()

/** @type {import('./index.js').View} */
export default {
  /**
   * @param {HTMLElement} contenitore
   * @param {ViewCtx} ctx
   */
  async render(contenitore, ctx) {
    // Le regole di **tutti** i personaggi, non solo dell'attivo: il lato B del
    // contrapposto cambia con un tap, e non deve aspettare una fetch.
    const packs = new Set(Object.values(ctx.state.characters).map(e => e.meta.packId))
    await Promise.all([...packs].map(p => caricaRegole(p)))

    const sezione = h('section', {
      class: 'dc-vista',
      'data-vista': 'prove',
      'aria-label': ctx.t('prove.titolo'),
      style: VISTA,
    })
    contenitore.appendChild(sezione)

    const risultato = h('div', {
      class: 'bsc-roll',
      'aria-live': 'polite',
      style: 'display: grid; gap: var(--bsc-space-2)',
    }, [h('p', { class: 'dc-avvio' }, ctx.t('dadi.nessunTiro'))])

    // Rientranza: togliere dal DOM un campo che ha il fuoco fa scattare il suo
    // `change`, che vorrebbe ridisegnare mentre il ridisegno è in corso — e due
    // `clear` intrecciati sullo stesso nodo finiscono in un `removeChild` che
    // esplode. Il giro esterno legge comunque il valore nuovo, perché il
    // pannello si costruisce **dopo** aver svuotato.
    let disegnando = false
    const ridisegna = () => {
      if (disegnando) return
      disegnando = true
      try {
        clear(sezione)
        for (const el of pannello(ctx, ridisegna, risultato)) sezione.appendChild(el)
        sezione.appendChild(risultato)
      } finally {
        disegnando = false
      }
    }
    ridisegna()
  },

  dispose() {
    // Nessun listener fuori dal contenitore: togliendone i figli se ne vanno
    // anche i loro. Qui si azzera solo ciò che non deve sopravvivere alla vista.
    cd = null
  },
}

/**
 * I controlli, ricostruiti a ogni cambio. Ricostruire tutto costa meno — in
 * righe e in difetti — che tenere in vita sei rami di aggiornamento parziale.
 * @param {ViewCtx} ctx
 * @param {() => void} ridisegna
 * @param {HTMLElement} risultato
 * @returns {HTMLElement[]}
 */
function pannello(ctx, ridisegna, risultato) {
  const t = ctx.t
  const attivo = ctx.state.activeId ? ctx.state.characters[ctx.state.activeId] : undefined
  const voci = opzioni(attivo, modo)
  const scelto = voci.find(v => v.valore === scelta[modo]) ?? voci[0] ?? null
  if (scelto) scelta[modo] = scelto.valore

  // Nessun personaggio aperto: si ripiega sul bonus digitato a mano, e la vista
  // resta usabile — al tavolo capita di tirare per un PNG o per un compagno.
  const bonusA = scelto ? scelto.bonus : bonusManuale
  const etichettaA = t(modo === 'salvezza' ? 'prove.tiroSalvezza' : 'prove.abilita')
  // Nel contrapposto l'etichetta porta il nome del personaggio: «Vince
  // Furtività» non dice chi ha vinto, «Vince Brynn — Furtività» sì.
  // Anche senza personaggio l'etichetta deve dire *che cosa* si è tirato:
  // «Abilità +0», nello storico, non distingue una prova da un attacco.
  const nomeA = !scelto
    ? `${modo === 'salvezza' ? etichettaA : t('prove.prova')} ${formatModifier(bonusManuale)}`
    : modo === 'contrapposto' && attivo ? `${attivo.meta.name} — ${scelto.nome}`
    : modo === 'salvezza' ? `${etichettaA} — ${scelto.nome}`
    // «Forza» da solo, nello storico, non dice se era una prova, un tiro
    // salvezza o un attacco: fra dieci righe è un numero senza motivo.
    : t('prove.provaDi', { nome: scelto.nome })

  /** @type {HTMLElement[]} */
  const out = []

  out.push(h('div', { style: RIGA, role: 'group', 'aria-label': t('prove.titolo') },
    /** @type {Array<[Modo, string]>} */ ([
      ['abilita', 'prove.abilita'],
      ['salvezza', 'prove.tiroSalvezza'],
      ['contrapposto', 'prove.contrapposto'],
    ]).map(([quale, chiave]) => chip(t(chiave), modo === quale, { modo: quale }, () => {
      modo = quale
      ridisegna()
    }))))

  out.push(h('div', { class: 'bsc-field' }, [
    h('label', { class: 'bsc-field-label', for: 'dc-prova-a' }, etichettaA),
    voci.length
      ? selettore('dc-prova-a', voci, scelta[modo], (v) => { scelta[modo] = v; ridisegna() })
      : numero('dc-prova-a', bonusManuale, (n) => { bonusManuale = n; ridisegna() }),
  ]))
  out.push(interruttori(ctx, etichettaA, advA, (v) => { advA = v; ridisegna() }))

  if (modo === 'contrapposto') out.push(...contro(ctx, ridisegna))
  else out.push(...tastierino(ctx, ridisegna))

  out.push(h('div', { style: RIGA }, [
    h('button', {
      class: 'bsc-btn',
      type: 'button',
      style: TAP,
      dataset: { azione: 'tira' },
      onclick: () => {
        if (modo === 'contrapposto') {
          const lato = latoB(ctx)
          const r = opposed({
            a: { nome: nomeA, bonus: bonusA, advantage: advA },
            b: { nome: lato.nome, bonus: lato.bonus, advantage: advB },
            rng,
            pareggio: ripetiPareggio ? 'ripeti' : 'nessuno',
          })
          registra(ctx, r.a.roll, nomeA)
          registra(ctx, r.b.roll, lato.nome)
          disegnaContrapposto(risultato, ctx, r, nomeA, lato.nome)
        } else {
          const r = check({ bonus: bonusA, cd, advantage: advA, rng, label: nomeA })
          registra(ctx, r.roll, nomeA)
          disegnaEsito(risultato, ctx, r, nomeA)
        }
      },
    }, t('dadi.tira')),
  ]))

  return out
}

/**
 * Il lato B: un altro personaggio importato, oppure un bonus a mano. La prima
 * voce dell'elenco è sempre il bonus a mano — un mostro non è un personaggio
 * importato, ed è il caso più frequente al tavolo.
 * @param {ViewCtx} ctx
 * @param {() => void} ridisegna
 * @returns {HTMLElement[]}
 */
function contro(ctx, ridisegna) {
  const t = ctx.t
  const altri = Object.entries(ctx.state.characters)
    .filter(([cid]) => cid !== ctx.state.activeId)
    .map(([cid, e]) => ({ valore: cid, nome: e.meta.name, testo: e.meta.name, bonus: 0 }))
  const vociB = [
    { valore: '', nome: formatModifier(bonusB), testo: formatModifier(bonusB), bonus: bonusB },
    ...altri,
  ]
  if (!vociB.some(v => v.valore === idB)) idB = ''

  const altro = idB ? ctx.state.characters[idB] : undefined
  const sue = opzioni(altro, 'abilita')
  if (sue.length && !sue.some(v => v.valore === sceltaB)) sceltaB = sue[0]?.valore ?? ''

  return [
    h('div', { class: 'bsc-field' }, [
      h('label', { class: 'bsc-field-label', for: 'dc-prova-b' }, t('prove.contrapposto')),
      selettore('dc-prova-b', vociB, idB, (v) => { idB = v; ridisegna() }),
      // Un personaggio porta le proprie voci; un mostro porta solo un numero.
      sue.length
        ? selettore('dc-prova-b-voce', sue, sceltaB, (v) => { sceltaB = v; ridisegna() })
        : numero('dc-prova-b-bonus', bonusB, (n) => { bonusB = n; ridisegna() }),
    ]),
    interruttori(ctx, t('prove.contrapposto'), advB, (v) => { advB = v; ridisegna() }),
    h('div', { style: RIGA }, [
      chip(t('prove.pareggio'), ripetiPareggio, { pareggio: ripetiPareggio ? 'ripeti' : 'nessuno' }, () => {
        ripetiPareggio = !ripetiPareggio
        ridisegna()
      }),
    ]),
  ]
}

/**
 * Nome e bonus del lato B al momento del tiro.
 * @param {ViewCtx} ctx
 * @returns {{nome: string, bonus: number}}
 */
function latoB(ctx) {
  const altro = idB ? ctx.state.characters[idB] : undefined
  if (!altro) return { nome: formatModifier(bonusB), bonus: bonusB }
  const v = opzioni(altro, 'abilita').find(x => x.valore === sceltaB)
  return v ? { nome: `${altro.meta.name} — ${v.nome}`, bonus: v.bonus } : { nome: altro.meta.name, bonus: 0 }
}

/**
 * Cosa si può tirare, con il suo bonus. Caratteristiche prima delle abilità:
 * la prova secca di Forza è più frequente di Atletica, e sta più in alto.
 *
 * `nome` è pulito perché finisce nell'etichetta dello storico; `testo` porta
 * anche il modificatore, perché nel menù serve vederlo prima di scegliere.
 * @param {CharacterEntry|undefined} entry
 * @param {Modo} quale
 * @returns {Voce[]}
 */
function opzioni(entry, quale) {
  if (!entry) return []
  const d = derivato(entry)
  /** @param {string} valore @param {string} nome @param {number} bonus @returns {Voce} */
  const voce = (valore, nome, bonus) => ({ valore, nome, testo: `${nome} ${formatModifier(bonus)}`, bonus })

  if (quale === 'salvezza') {
    return ABILITIES.map(ab => voce(`car:${ab}`, ABILITY_LABELS[ab].nome, d.tiriSalvezza[ab]))
  }
  return [
    ...ABILITIES.map(ab => voce(`car:${ab}`, ABILITY_LABELS[ab].nome, d.modificatori[ab])),
    ...d.abilita.map(a => voce(`ab:${a.id}`, a.nome, a.bonus)),
  ]
}

/**
 * @param {string} testo
 * @param {boolean} acceso
 * @param {Record<string, string>} dati
 * @param {() => void} premuto
 * @returns {HTMLElement}
 */
function chip(testo, acceso, dati, premuto) {
  return h('button', {
    class: ['bsc-chip', 'bsc-btn', 'bsc-btn--outline', acceso && 'bsc-chip--on'],
    type: 'button',
    style: TAP,
    'aria-pressed': String(acceso),
    dataset: dati,
    onclick: premuto,
  }, testo)
}

/**
 * @param {string} id
 * @param {Voce[]} voci
 * @param {string} valore
 * @param {(v: string) => void} scegli
 * @returns {HTMLElement}
 */
function selettore(id, voci, valore, scegli) {
  return h('select', {
    class: 'bsc-input',
    id,
    style: `${TAP}; width: 100%`,
    onchange: (/** @type {Event} */ ev) => {
      const el = ev.currentTarget
      if (el instanceof HTMLSelectElement) scegli(el.value)
    },
  }, voci.map(v => h('option', { value: v.valore, selected: v.valore === valore }, v.testo)))
}

/**
 * Il bonus digitato a mano: un campo numerico, non uno stepper. Al tavolo il
 * +7 di un mostro si legge sul manuale e si scrive, non si conta a colpi di «+».
 * @param {string} id
 * @param {number} valore
 * @param {(n: number) => void} cambia
 * @returns {HTMLElement}
 */
function numero(id, valore, cambia) {
  return h('input', {
    class: 'bsc-input',
    id,
    type: 'number',
    inputmode: 'numeric',
    step: '1',
    min: '-20',
    max: '30',
    value: String(valore),
    style: `${TAP}; width: 100%`,
    onchange: (/** @type {Event} */ ev) => {
      const el = ev.currentTarget
      if (!(el instanceof HTMLInputElement)) return
      const n = Number(el.value)
      cambia(Number.isFinite(n) ? Math.trunc(n) : 0)
    },
  })
}

/**
 * Vantaggio e svantaggio: due interruttori che si escludono. Toccare quello
 * acceso lo spegne, ed è il modo più rapido di tornare a un tiro normale.
 * @param {ViewCtx} ctx
 * @param {string} lato
 * @param {Advantage} stato
 * @param {(v: Advantage) => void} cambia
 * @returns {HTMLElement}
 */
function interruttori(ctx, lato, stato, cambia) {
  return h('div', { style: RIGA, role: 'group', 'aria-label': lato },
    /** @type {Array<'vantaggio'|'svantaggio'>} */ (['vantaggio', 'svantaggio']).map(quale =>
      chip(ctx.t(`dadi.${quale}`), stato === quale, { modo: quale },
        () => cambia(stato === quale ? 'normale' : quale))))
}

/**
 * La CD, cifra per cifra. Il tastierino è grande e si digita al buio: al tavolo
 * il telefono è appoggiato, non guardato.
 * @param {ViewCtx} ctx
 * @param {() => void} ridisegna
 * @returns {HTMLElement[]}
 */
function tastierino(ctx, ridisegna) {
  const t = ctx.t
  const tasti = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0']
  return [
    h('div', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label', id: 'dc-cd-etichetta' }, t('prove.cd')),
      h('output', { class: 'bsc-display', 'data-cd': cd === null ? '' : String(cd) },
        cd === null ? t('prove.senzaCd') : String(cd)),
    ]),
    h('div', { class: 'bsc-numpad', role: 'group', 'aria-labelledby': 'dc-cd-etichetta' },
      tasti.map(tasto => h('button', {
        class: 'bsc-btn bsc-btn--outline',
        type: 'button',
        style: TAP,
        dataset: { tasto },
        'aria-label': tasto === '⌫' ? t('comune.annulla') : tasto,
        onclick: () => {
          if (tasto === '⌫') cd = cd === null || cd < 10 ? null : Math.floor(cd / 10)
          else cd = Math.min(CD_MAX, (cd ?? 0) * 10 + Number(tasto))
          ridisegna()
        },
      }, tasto))),
    h('div', { style: RIGA }, [
      h('button', {
        class: 'bsc-btn bsc-btn--ghost bsc-btn--sm',
        type: 'button',
        style: TAP,
        dataset: { azione: 'senza-cd' },
        onclick: () => { cd = null; ridisegna() },
      }, t('prove.senzaCd')),
    ]),
  ]
}

/**
 * L'esito, col margine: «18 · CD 14 — Riuscita di 4».
 * @param {HTMLElement} dove
 * @param {ViewCtx} ctx
 * @param {CheckResult} r
 * @param {string} nome
 */
function disegnaEsito(dove, ctx, r, nome) {
  clear(dove)
  fermaAnimazione()
  const t = ctx.t
  dove.appendChild(h('p', { class: 'bsc-display', 'data-totale': String(r.totale) },
    r.cd === null ? `${t('dadi.totale')} ${r.totale}` : `${r.totale} · ${t('prove.cd')} ${r.cd}`))

  // I dadi singoli: con vantaggio o svantaggio sono due, e vedere quale è stato
  // scartato è metà del gusto — oltre che il modo di mostrare al master come è
  // venuto fuori quel numero.
  const dadi = r.roll.groups[0]?.dice ?? []
  if (dadi.length) dove.appendChild(h('div', { class: 'dc-dadi-esito' }, dadi.map(d => facciaDado(d, t))))
  if (r.riuscita !== null && r.margine !== null) {
    dove.appendChild(h('p', {
      class: ['bsc-badge', r.riuscita ? 'bsc-badge--ok' : 'bsc-badge--rosso'],
      'data-esito': r.riuscita ? 'riuscita' : 'fallita',
    }, t(r.riuscita ? 'prove.riuscita' : 'prove.fallita', { margine: Math.abs(r.margine) })))
  }
  // Il 20 si festeggia, ma con una parola: prima la riga intera in maiuscolo
  // — «20 NATURALE (NELLE PROVE NON È SUCCESSO AUTOMATICO)» — copriva il
  // totale, che è il numero che serve. La regola resta, sotto, e solo quando
  // c'è una CD: è lì che il malinteso costa qualcosa.
  if (r.venti) dove.appendChild(h('p', { class: 'bsc-badge bsc-badge--ok', 'data-naturale': '20' }, t('dadi.naturale20')))
  if (r.uno) dove.appendChild(h('p', { class: 'bsc-badge bsc-badge--rosso', 'data-naturale': '1' }, t('dadi.fallimento')))
  if ((r.venti || r.uno) && r.cd !== null) {
    dove.appendChild(h('p', { class: 'bsc-lead dc-nota' }, t('prove.non20')))
  }
  dove.appendChild(h('p', { class: 'bsc-code' },
    `${nome}: ${r.roll.groups[0]?.formula ?? ''} = ${r.totale}`))
  fermaAnimazione = animaDadi(dove.querySelectorAll('.dc-dado'))
}

/**
 * @param {HTMLElement} dove
 * @param {ViewCtx} ctx
 * @param {{a: CheckResult, b: CheckResult, vincitore: 'a'|'b'|null, ripetizioni: number}} r
 * @param {string} nomeA
 * @param {string} nomeB
 */
function disegnaContrapposto(dove, ctx, r, nomeA, nomeB) {
  clear(dove)
  const t = ctx.t
  dove.appendChild(h('p', { class: 'bsc-display', 'data-esito': r.vincitore ?? 'pareggio' },
    r.vincitore === null
      ? t('prove.pareggio')
      : t('prove.vince', { nome: r.vincitore === 'a' ? nomeA : nomeB })))
  for (const [nome, lato] of /** @type {Array<[string, CheckResult]>} */ ([[nomeA, r.a], [nomeB, r.b]])) {
    dove.appendChild(h('p', { class: 'bsc-code' },
      `${nome}: ${lato.roll.groups[0]?.formula ?? ''} = ${lato.totale}`))
  }
  // Quante volte si è ripetuto: senza questo numero un pareggio ripetuto tre
  // volte è indistinguibile da un tiro solo.
  if (r.ripetizioni > 0) {
    dove.appendChild(h('p', { class: 'bsc-badge', 'data-ripetizioni': String(r.ripetizioni) },
      `${t('prove.pareggio')} ×${r.ripetizioni}`))
  }
}

/**
 * Aggiunge un tiro allo storico condiviso, nella forma del lotto A: un tiro
 * fatto qui e uno fatto col tastierino dei dadi devono essere la stessa cosa.
 * @param {ViewCtx} ctx
 * @param {Roll} r
 * @param {string} label
 */
function registra(ctx, r, label) {
  /** @type {import('../storage.js').DiceLogEntry} */
  const voce = {
    at: new Date().toISOString(),
    label,
    source: r.groups.map(g => g.source).join(' · '),
    formula: r.groups.map(g => g.formula).join(' · '),
    total: r.total,
    dice: r.groups.flatMap(g => g.dice.map(d => ({ faces: d.faces, value: d.value, dropped: d.dropped }))),
  }
  ctx.update(['dice'], (s) => {
    const log = Array.isArray(s.diceLog) ? s.diceLog : []
    s.diceLog = [voce, ...log].slice(0, MAX_STORICO)
  })
}

/**
 * I numeri del personaggio, con le regole già in cache.
 * @param {CharacterEntry} entry
 * @returns {Derived}
 */
function derivato(entry) {
  return derive(entry, regolePerPack.get(entry.meta.packId) ?? null)
}

/**
 * Il pacchetto regole di un'edizione. Se non c'è, i bonus si calcolano lo
 * stesso: `derive` sa cavarsela con l'elenco di abilità di serie.
 * @param {string} packId
 * @returns {Promise<unknown>}
 */
async function caricaRegole(packId) {
  if (regolePerPack.has(packId)) return regolePerPack.get(packId) ?? null
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
