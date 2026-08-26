/**
 * Vista «livello» — l'avanzamento guidato, un passo per schermata.  ── Lotto J ──
 *
 * Il piano lo scrive `domain/progress.js`: qui non si decide nulla di regole,
 * si mostra ciò che il piano dice e si raccolgono le tre scelte che restano al
 * giocatore — in quale classe salire, come fare i PF, cosa prendere all'ASI.
 *
 * **Salire non muta lo snapshot.** Ne produce uno nuovo e registra il diff in
 * `entry.levels[]`, con dentro il necessario per tornare indietro: è la prima
 * delle cinque regole del progetto, ed è anche il motivo per cui esiste
 * «annulla l'ultimo avanzamento». Il master cambia idea, e l'app deve saperlo
 * accettare.
 *
 * Ciò che il pacchetto regole non porta — il testo italiano di una ventina di
 * privilegi di sottoclasse del 2014, l'elenco dei talenti, le proprietà delle
 * maestrie — si mostra col **nome** e con la dichiarazione che il testo non è
 * nell'SRD. Non si inventa.
 */

import { h, clear } from '../dom.js'
import { planLevelUp } from '../domain/progress.js'
import { loadRules } from '../domain/rules.js'
import { derive, proficiencyBonus, formatModifier, ABILITIES, ABILITY_LABELS } from '../domain/character.js'
import { rollNotation } from '../domain/dice.js'
import { cryptoRng } from '../domain/rng.js'
import { congela } from '../domain/importer.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {import('../domain/progress.js').PianoLivello} PianoLivello */
/** @typedef {import('../domain/character.js').Ability} Ability */

const TAP = 'min-width: var(--dc-tap-min); min-height: var(--dc-tap-min)'
const VISTA = 'display: grid; gap: var(--bsc-space-4); padding-inline: var(--bsc-space-3)'
const RIGA = 'display: flex; flex-wrap: wrap; gap: var(--bsc-space-2); align-items: center'
const COLONNA = 'display: grid; gap: var(--bsc-space-2)'

/** Quanti punti dà un aumento dei punteggi di caratteristica. */
const PUNTI_ASI = 2
/** Nessun punteggio oltre 20: è dell'SRD, non una prudenza dell'app. */
const PUNTEGGIO_MAX = 20

/**
 * Le scelte in corso. Vivono qui e non nello store: finché non si conferma,
 * non è successo niente — e uno stato di procedura salvato a metà è il modo
 * più rapido di ritrovarsi con un personaggio a metà.
 */
const scelte = {
  id: '',
  passo: 0,
  classe: '',
  /** @type {'media'|'tiro'} */
  pfModo: 'media',
  /** @type {{totale: number, formula: string}|null} */
  pfTiro: null,
  sottoclasse: '',
  /** @type {'aumento'|'talento'} */
  asiModo: 'aumento',
  /** @type {Record<string, number>} */
  asiPunti: {},
  eseguito: false,
}

/** @type {import('../domain/rng.js').Rng} */
let rng = cryptoRng()

/** Solo per i test e per una dimostrazione ripetibile. @param {import('../domain/rng.js').Rng} r */
export function _setRng(r) { rng = r }

/** @type {import('./index.js').View} */
export default {
  /**
   * @param {HTMLElement} contenitore
   * @param {ViewCtx} ctx
   */
  async render(contenitore, ctx) {
    const id = ctx.route.params['id'] ?? ctx.state.activeId ?? ''
    const entry = id ? ctx.state.characters[id] : undefined
    if (!entry) {
      contenitore.appendChild(h('p', { class: 'bsc-lead' }, ctx.t('libreria.vuota')))
      contenitore.appendChild(h('a', { class: 'bsc-btn', href: '#/libreria', style: TAP }, ctx.t('nav.libreria')))
      return
    }
    const rules = await regoleDi(entry)
    if (scelte.id !== id) azzera(id, entry)
    disegna(contenitore, ctx, id, rules)
  },

  dispose() {
    scelte.id = ''
  },
}

/**
 * Il pacchetto regole del personaggio, con ciò che eredita dal suo base. Se non
 * arriva, la procedura si disegna lo stesso: `planLevelUp` risponde con quello
 * che si può dire senza, e lo dichiara negli avvisi.
 * @param {CharacterEntry} entry
 * @returns {Promise<unknown>}
 */
function regoleDi(entry) {
  return loadRules(entry.meta.packId).catch(() => null)
}

/**
 * @param {string} id
 * @param {CharacterEntry} entry
 */
function azzera(id, entry) {
  scelte.id = id
  scelte.passo = 0
  scelte.classe = classiDi(entry)[0]?.classId ?? ''
  scelte.pfModo = 'media'
  scelte.pfTiro = null
  scelte.sottoclasse = ''
  scelte.asiModo = 'aumento'
  scelte.asiPunti = {}
  scelte.eseguito = false
}

// ── disegno ───────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {string} id
 * @param {unknown} rules
 */
function disegna(contenitore, ctx, id, rules) {
  const entry = ctx.state.characters[id]
  if (!entry) return
  const t = ctx.t
  const aggiorna = () => disegna(contenitore, ctx, id, rules)

  const classi = classiDi(entry, rules)
  if (!scelte.classe) scelte.classe = classi[0]?.classId ?? ''
  const plan = planLevelUp({ entry, rules, edition: entry.meta.edition, classId: scelte.classe })
  const pfMaxPrima = derive(entry, rules).pfMax
  const guadagno = guadagnoPf(plan)

  clear(contenitore)
  const testa = [
    h('h1', { class: 'bsc-display' }, entry.meta.name),
    ultimoAvanzamento(ctx, entry, () => { annulla(ctx, id); azzera(id, entry); aggiorna() }),
  ]

  if (scelte.eseguito) {
    contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'livello', style: VISTA }, [
      ...testa,
      h('p', { class: 'bsc-lead', dataset: { esito: 'fatto' } }, 'Avanzamento registrato.'),
      h('a', { class: 'bsc-btn', style: TAP, href: `#/scheda/${encodeURIComponent(id)}` }, t('nav.scheda')),
    ]))
    return
  }

  if (plan.da >= 20) {
    contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'livello', style: VISTA }, [
      ...testa,
      avvisi(plan.avvisi),
      h('a', { class: 'bsc-btn bsc-btn--outline', style: TAP, href: `#/scheda/${encodeURIComponent(id)}` }, t('comune.indietro')),
    ]))
    return
  }

  const passi = costruisciPassi(ctx, entry, rules, plan, classi, guadagno, pfMaxPrima, aggiorna)
  scelte.passo = Math.min(Math.max(scelte.passo, 0), passi.length - 1)
  const corrente = passi[scelte.passo]
  if (!corrente) return
  const ultimo = scelte.passo === passi.length - 1

  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'livello', style: VISTA }, [
    ...testa,
    h('p', { class: 'bsc-label', dataset: { passo: corrente.chiave } },
      `Passo ${scelte.passo + 1} di ${passi.length} — ${corrente.titolo}`),
    h('div', { style: COLONNA, dataset: { corpo: corrente.chiave } }, corrente.corpo),
    h('div', { style: RIGA }, [
      h('button', {
        class: 'bsc-btn bsc-btn--outline', type: 'button', style: TAP,
        disabled: scelte.passo === 0,
        onclick: () => { scelte.passo -= 1; aggiorna() },
      }, t('comune.indietro')),
      ultimo
        ? h('button', {
          class: 'bsc-btn', type: 'button', style: TAP, dataset: { azione: 'conferma' },
          onclick: () => {
            applica(ctx, id, plan, pfMaxPrima, guadagno)
            scelte.eseguito = true
            aggiorna()
          },
        }, t('comune.conferma'))
        : h('button', {
          class: 'bsc-btn', type: 'button', style: TAP, dataset: { azione: 'avanti' },
          disabled: !corrente.pronto,
          onclick: () => { scelte.passo += 1; aggiorna() },
        }, 'Avanti'),
    ]),
  ]))
}

/**
 * L'ultimo avanzamento fatto, con il modo di disfarlo. Compare sempre, non
 * solo subito dopo: il master può cambiare idea la settimana dopo.
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {() => void} disfa
 */
function ultimoAvanzamento(ctx, entry, disfa) {
  const voce = entry.levels[entry.levels.length - 1]
  if (!voce) return null
  const d = oggetto(voce.diff)
  return h('div', { class: 'bsc-alert', dataset: { ultimo: 'avanzamento' } }, [
    h('p', { class: 'bsc-lead' },
      `Ultimo avanzamento: ${voce.from} → ${voce.to}${stringa(d['nomeClasse']) ? ` (${stringa(d['nomeClasse'])})` : ''}`),
    h('button', {
      class: 'bsc-btn bsc-btn--outline', type: 'button', style: TAP,
      dataset: { azione: 'annulla-livello' },
      onclick: disfa,
    }, `${ctx.t('comune.annulla')} l'avanzamento`),
  ])
}

/**
 * I passi, nell'ordine del piano (§ 5.5). Quelli che non hanno niente da dire
 * non compaiono: una schermata vuota da confermare è una schermata di troppo.
 *
 * @param {ViewCtx} ctx
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 * @param {PianoLivello} plan
 * @param {Array<{classId: string, nome: string, livello: number}>} classi
 * @param {number} guadagno
 * @param {number} pfMaxPrima
 * @param {() => void} aggiorna
 * @returns {Array<{chiave: string, titolo: string, corpo: Array<Node|null>, pronto: boolean}>}
 */
function costruisciPassi(ctx, entry, rules, plan, classi, guadagno, pfMaxPrima, aggiorna) {
  const t = ctx.t
  /** @type {Array<{chiave: string, titolo: string, corpo: Array<Node|null>, pronto: boolean}>} */
  const passi = []

  // 1 — in quale classe salire.
  passi.push({
    chiave: 'classe', titolo: 'Classe', pronto: !!scelte.classe,
    corpo: [
      avvisi(plan.avvisi),
      h('div', { style: RIGA, role: 'group', 'aria-label': 'Classe in cui salire' },
        classi.map(c => scegli(c.nome + ` ${c.livello} → ${c.livello + 1}`, scelte.classe === c.classId, () => {
          scelte.classe = c.classId
          scelte.sottoclasse = ''
          aggiorna()
        }, { classe: c.classId }))),
      multiclasse(rules, classi, aggiorna),
    ],
  })

  // 2 — i punti ferita: media fissa o dado, tirato dall'app.
  passi.push({
    chiave: 'pf', titolo: t('scheda.pf'),
    pronto: scelte.pfModo === 'media' || scelte.pfTiro !== null,
    corpo: [
      h('div', { style: RIGA, role: 'group', 'aria-label': t('scheda.pf') }, [
        scegli(`Media fissa (+${plan.pf.media})`, scelte.pfModo === 'media',
          () => { scelte.pfModo = 'media'; aggiorna() }, { pf: 'media' }),
        scegli(`Tiro del dado vita (${plan.pf.tiro})`, scelte.pfModo === 'tiro',
          () => { scelte.pfModo = 'tiro'; aggiorna() }, { pf: 'tiro' }),
      ]),
      scelte.pfModo === 'tiro'
        ? h('div', { style: COLONNA }, [
          h('button', {
            class: 'bsc-btn', type: 'button', style: TAP, dataset: { azione: 'tira-pf' },
            onclick: () => {
              const r = rollNotation(plan.pf.tiro, rng, t('scheda.dadiVita'))
              const gruppo = r.groups[0]
              scelte.pfTiro = { totale: r.total, formula: gruppo ? gruppo.formula : plan.pf.tiro }
              aggiorna()
            },
          }, `${t('dadi.tira')} ${plan.pf.tiro}`),
          scelte.pfTiro
            ? h('p', { class: 'bsc-roll', 'aria-live': 'polite' },
              `${scelte.pfTiro.formula} = ${scelte.pfTiro.totale}${scelte.pfTiro.totale < plan.pf.minimo ? ` → ${plan.pf.minimo} (minimo)` : ''}`)
            : h('p', { class: 'bsc-lead' }, 'Nessun tiro ancora.'),
        ])
        : null,
      kv(`${t('scheda.pf')} massimi`, `${pfMaxPrima} → ${pfMaxPrima + guadagno}`),
    ],
  })

  // 3 — il bonus di competenza.
  passi.push({
    chiave: 'competenza', titolo: t('scheda.competenza'), pronto: true,
    corpo: [
      kv(t('scheda.competenza'), `${formatModifier(proficiencyBonus(plan.da))} → ${formatModifier(plan.competenza)}`),
      h('p', { class: 'bsc-lead' }, plan.competenzaCambiata
        ? 'Cambia: tiri salvezza, abilità, CD degli incantesimi e attacchi seguono da soli.'
        : 'Non cambia a questo livello.'),
    ],
  })

  // 4 — i privilegi nuovi, col testo italiano quando l'SRD ce l'ha.
  passi.push({
    chiave: 'privilegi', titolo: 'Privilegi', pronto: true,
    corpo: [
      plan.privilegi.length
        ? h('ul', { class: 'dc-elenco', dataset: { privilegi: 'nuovi' } }, plan.privilegi.map(f =>
          h('li', { class: 'bsc-card', dataset: { privilegio: f.id } }, [
            h('h3', { class: 'bsc-label' }, f.nome),
            f.sottoclasse ? h('span', { class: 'bsc-badge' }, f.sottoclasse) : null,
            f.testo
              ? h('p', { class: 'bsc-prose' }, f.testo)
              : h('p', { class: 'bsc-lead' }, t('scheda.senzaTesto')),
          ])))
        : h('p', { class: 'bsc-lead' }, 'Nessun privilegio nuovo a questo livello.'),
    ],
  })

  // 5 — la sottoclasse, se è il livello giusto (2024: il 3° per tutte).
  if (plan.sottoclasse) {
    const scelteSotto = plan.sottoclasse.scelte
    passi.push({
      chiave: 'sottoclasse', titolo: 'Sottoclasse',
      pronto: !plan.sottoclasse.obbligatoria || !scelteSotto.length || scelte.sottoclasse !== '',
      corpo: [
        scelteSotto.length
          ? h('div', { style: RIGA, role: 'group', 'aria-label': 'Sottoclasse' },
            scelteSotto.map(s => scegli(s.nome, scelte.sottoclasse === s.id,
              () => { scelte.sottoclasse = s.id; aggiorna() }, { sottoclasse: s.id })))
          : h('p', { class: 'bsc-lead' }, 'Il pacchetto non porta sottoclassi per questa classe: la scelta va fatta sul builder.'),
      ],
    })
  }

  // 6 — ASI o talento. Nel 2014 il 19° è un ASI, nel 2024 è un dono epico.
  if (plan.asi || plan.donoEpico) {
    passi.push({
      chiave: 'asi', titolo: plan.donoEpico ? 'Dono epico' : 'Aumento dei punteggi',
      pronto: plan.donoEpico || scelte.asiModo === 'talento' || puntiAssegnati() === PUNTI_ASI,
      corpo: plan.donoEpico
        ? [h('p', { class: 'bsc-lead' }, 'A questo livello si prende un dono epico. L\'elenco non è nell\'SRD: si sceglie sul builder.')]
        : [
          h('div', { style: RIGA, role: 'group', 'aria-label': 'Aumento o talento' }, [
            scegli('Aumento dei punteggi', scelte.asiModo === 'aumento',
              () => { scelte.asiModo = 'aumento'; aggiorna() }, { asi: 'aumento' }),
            scegli('Talento', scelte.asiModo === 'talento',
              () => { scelte.asiModo = 'talento'; scelte.asiPunti = {}; aggiorna() }, { asi: 'talento' }),
          ]),
          scelte.asiModo === 'talento'
            ? h('p', { class: 'bsc-lead' }, 'I talenti non sono nell\'SRD: il talento si sceglie sul builder, qui non si registra niente.')
            : punteggi(entry, aggiorna),
        ],
    })
  }

  // 7 — maestrie d'arma: solo dove il pacchetto le porta (2024).
  if (plan.maestrieArmi && plan.maestrieArmi.nuove > 0) {
    passi.push({
      chiave: 'maestrie', titolo: 'Maestrie d\'arma', pronto: true,
      corpo: [
        kv('Maestrie', `${plan.maestrieArmi.prima} → ${plan.maestrieArmi.dopo}`),
        h('p', { class: 'bsc-lead' }, `Se ne guadagna ${plan.maestrieArmi.nuove}: quali armi, lo si segna sul builder.`),
      ],
    })
  }

  // 8 — incantesimi: slot nuovi, trucchetti, preparati.
  const slotNuovi = plan.slot.nuovi.some(n => n > 0)
  if (plan.incantesimi || slotNuovi) {
    passi.push({
      chiave: 'incantesimi', titolo: t('tab.incantesimi'), pronto: true,
      corpo: [
        plan.slot.dopo.length
          ? h('div', { style: COLONNA, dataset: { slot: 'livello' } }, plan.slot.dopo.map((n, i) => kv(
            `${t('scheda.slot')} di ${i + 1}°`,
            `${plan.slot.prima[i] ?? 0} → ${n}`,
          )))
          : null,
        plan.incantesimi ? kv('Trucchetti', `${plan.incantesimi.trucchetti.prima} → ${plan.incantesimi.trucchetti.dopo}`) : null,
        plan.incantesimi
          ? (plan.incantesimi.incantesimi.dopo === null
            ? h('p', { class: 'bsc-lead' }, 'Quanti incantesimi si portano a questo livello il pacchetto non lo dice: va letto sul manuale.')
            : kv('Incantesimi', `${plan.incantesimi.incantesimi.prima ?? '—'} → ${plan.incantesimi.incantesimi.dopo}`))
          : null,
        h('p', { class: 'bsc-lead' }, 'Quali incantesimi, lo si sceglie sul builder: qui si contano soltanto.'),
      ],
    })
  }

  // 9 — il riepilogo, che è il diff che si sta per scrivere.
  passi.push({
    chiave: 'riepilogo', titolo: 'Riepilogo', pronto: true,
    corpo: [
      avvisi(plan.avvisi),
      kv(t('libreria.livello', { n: plan.a }), `${plan.da} → ${plan.a} (${plan.nomeClasse} ${plan.livelloClasse})`),
      kv(t('scheda.pf'), `${pfMaxPrima} → ${pfMaxPrima + guadagno} (+${guadagno}, ${scelte.pfModo === 'tiro' ? 'tiro' : 'media'})`),
      kv(t('scheda.competenza'), formatModifier(plan.competenza)),
      plan.privilegi.length ? kv('Privilegi', plan.privilegi.map(f => f.nome).join(', ')) : null,
      scelte.sottoclasse ? kv('Sottoclasse', nomeSottoclasse(plan, scelte.sottoclasse)) : null,
      plan.asi && scelte.asiModo === 'aumento' && puntiAssegnati() > 0
        ? kv('Aumento', riassuntoPunti())
        : plan.asi ? kv('Aumento', 'talento — sul builder') : null,
    ],
  })

  return passi
}

/**
 * La multiclasse: le classi del pacchetto che il personaggio non ha ancora.
 * È il passo più fragile della procedura — i prerequisiti di punteggio non li
 * verifica nessuno, e `planLevelUp` lo dichiara negli avvisi — quindi sta
 * dietro un `details`, aperto solo da chi lo sta cercando.
 * @param {unknown} rules
 * @param {Array<{classId: string, nome: string, livello: number}>} classi
 * @param {() => void} aggiorna
 */
function multiclasse(rules, classi, aggiorna) {
  const tutte = oggetto(leggi(rules, 'classes'))
  const gia = new Set(classi.map(c => c.classId))
  const altre = Object.keys(tutte).filter(id => !gia.has(id)).sort()
  if (!altre.length) return null
  const nuova = !gia.has(scelte.classe) ? scelte.classe : ''
  return h('details', { dataset: { multiclasse: 'apri' }, open: !!nuova }, [
    h('summary', { style: TAP }, 'Multiclasse: un\'altra classe'),
    h('select', {
      class: 'bsc-select', style: TAP, 'aria-label': 'Classe nuova',
      onchange: (/** @type {Event} */ ev) => {
        const el = ev.currentTarget
        if (!(el instanceof HTMLSelectElement)) return
        scelte.classe = el.value || classi[0]?.classId || ''
        scelte.sottoclasse = ''
        aggiorna()
      },
    }, [
      h('option', { value: '' }, '—'),
      ...altre.map(id => h('option', {
        value: id, selected: id === nuova,
      }, stringa(oggetto(tutte[id])['name']) || id)),
    ]),
    h('p', { class: 'bsc-lead' }, 'I prerequisiti di punteggio non li verifica l\'app.'),
  ])
}

/**
 * I sei punteggi con il loro stepper: due punti da spendere, uno o due per
 * caratteristica, e mai oltre 20 — il tetto tiene conto dei bonus di razza,
 * perché è il punteggio finale a essere limitato.
 * @param {CharacterEntry} entry
 * @param {() => void} aggiorna
 */
function punteggi(entry, aggiorna) {
  const base = oggetto(entry.snapshot['abilityScores'])
  const razziali = oggetto(entry.snapshot['racialBonuses'])
  const restano = PUNTI_ASI - puntiAssegnati()
  return h('div', { style: COLONNA }, [
    h('p', { class: 'bsc-lead', 'aria-live': 'polite', dataset: { restano: String(restano) } },
      `Punti da assegnare: ${restano}`),
    h('div', { class: 'dc-caratteristiche' }, ABILITIES.map(ab => {
      const partenza = intero(base[ab], 10) + intero(razziali[ab], 0)
      const dato = scelte.asiPunti[ab] ?? 0
      return h('div', { class: 'bsc-stepper', dataset: { punteggio: ab } }, [
        h('button', {
          class: 'bsc-btn bsc-btn--ghost', type: 'button', style: TAP,
          'aria-label': `${ABILITY_LABELS[ab].nome} −1`, disabled: dato <= 0,
          onclick: () => { scelte.asiPunti[ab] = dato - 1; aggiorna() },
        }, '−'),
        h('span', { class: 'bsc-stepper__v' }, `${ABILITY_LABELS[ab].breve} ${partenza + dato}`),
        h('button', {
          class: 'bsc-btn bsc-btn--ghost', type: 'button', style: TAP,
          'aria-label': `${ABILITY_LABELS[ab].nome} +1`,
          disabled: restano <= 0 || partenza + dato >= PUNTEGGIO_MAX,
          onclick: () => { scelte.asiPunti[ab] = dato + 1; aggiorna() },
        }, '+'),
      ])
    })),
  ])
}

// ── scrittura: uno snapshot nuovo, e il diff per tornare indietro ──────────

/**
 * @param {ViewCtx} ctx
 * @param {string} id
 * @param {PianoLivello} plan
 * @param {number} pfMaxPrima
 * @param {number} guadagno
 */
function applica(ctx, id, plan, pfMaxPrima, guadagno) {
  const at = new Date().toISOString()
  const sottoscelta = scelte.sottoclasse
  const punti = { ...scelte.asiPunti }
  const asiAttivo = plan.asi && scelte.asiModo === 'aumento' && puntiAssegnati() > 0

  ctx.update(['characters'], (s) => {
    const e = s.characters[id]
    if (!e) return
    const vecchio = e.snapshot
    /** @type {Record<string, unknown>} */
    const nuovo = { ...vecchio }
    /** Solo i campi toccati, com'erano: è ciò che rende reversibile il tutto. */
    /** @type {Record<string, unknown>} */
    const prima = {}
    /** Le chiavi che prima non c'erano: annullare vuol dire toglierle, non azzerarle. */
    /** @type {string[]} */
    const aggiunte = []
    /** @param {string} k @param {unknown} v */
    const scrivi = (k, v) => {
      if (Object.prototype.hasOwnProperty.call(vecchio, k)) prima[k] = vecchio[k]
      else aggiunte.push(k)
      nuovo[k] = v
    }

    scrivi('level', plan.a)
    scrivi('maxHp', Math.max(1, pfMaxPrima + guadagno))

    // ── Le classi. Uno snapshot monoclasse tiene tutto nei campi in cima e ha
    //    `classes: []`; il primo passo in una classe nuova deve far nascere
    //    l'elenco **con dentro anche la classe di partenza**, altrimenti il
    //    personaggio perde cinque livelli in silenzio.
    const voci = lista(vecchio['classes']).map(v => oggetto(v))
    const classeVecchia = stringa(vecchio['className'])
    if (voci.length) {
      let trovata = false
      const nuove = voci.map(v => {
        if (stringa(v['classId']) !== plan.classe) return v
        trovata = true
        return {
          ...v,
          level: intero(v['level'], 0) + 1,
          subclass: sottoscelta || stringa(v['subclass']),
        }
      })
      if (!trovata) nuove.push({ classId: plan.classe, subclass: sottoscelta, level: 1 })
      scrivi('classes', nuove)
    } else if (plan.classe !== classeVecchia) {
      scrivi('classes', [
        { classId: classeVecchia, subclass: stringa(vecchio['subclass']), level: plan.da },
        { classId: plan.classe, subclass: sottoscelta, level: 1 },
      ])
    }
    if (sottoscelta && plan.classe === classeVecchia) scrivi('subclass', sottoscelta)

    // ── I privilegi nuovi entrano nello snapshot con il loro id: è da lì che
    //    `character.features()` ripesca il nome italiano dal pacchetto.
    const giaAvuti = stringhe(vecchio['featuresTraits'])
    const nuoviId = plan.privilegi
      .map(f => f.id || f.nome)
      .filter(x => x && !giaAvuti.includes(x))
    if (nuoviId.length) scrivi('featuresTraits', [...giaAvuti, ...nuoviId])

    if (asiAttivo) {
      const base = oggetto(vecchio['abilityScores'])
      /** @type {Record<string, unknown>} */
      const aumentati = { ...base }
      for (const [ab, n] of Object.entries(punti)) {
        if (n) aumentati[ab] = intero(base[ab], 10) + n
      }
      scrivi('abilityScores', aumentati)
    }

    const hpPrima = e.play.hp.cur
    e.play.hp = { ...e.play.hp, cur: Math.max(0, hpPrima + guadagno) }

    // Lo snapshot vecchio non è stato toccato: questo è un altro oggetto, e
    // viene congelato come quello che arrivò dal builder.
    e.snapshot = congela(nuovo)
    e.levels = [...e.levels, {
      at,
      from: plan.da,
      to: plan.a,
      diff: {
        classe: plan.classe,
        nomeClasse: plan.nomeClasse,
        livelloClasse: plan.livelloClasse,
        pf: { modo: scelte.pfModo, guadagno, tiro: scelte.pfTiro?.formula ?? null, max: { prima: pfMaxPrima, dopo: pfMaxPrima + guadagno } },
        competenza: plan.competenza,
        privilegi: plan.privilegi.map(f => ({ id: f.id, nome: f.nome })),
        sottoclasse: sottoscelta || null,
        asi: plan.asi ? { modo: scelte.asiModo, punti } : null,
        donoEpico: plan.donoEpico,
        slot: plan.slot,
        ripristino: { prima, aggiunte, hp: hpPrima },
      },
    }]
  })
}

/**
 * Annulla l'ultimo avanzamento: rimette i campi com'erano, toglie quelli
 * nati con il livello, e cancella la voce dallo storico.
 * @param {ViewCtx} ctx
 * @param {string} id
 */
function annulla(ctx, id) {
  ctx.update(['characters'], (s) => {
    const e = s.characters[id]
    if (!e || !e.levels.length) return
    const voce = e.levels[e.levels.length - 1]
    e.levels = e.levels.slice(0, -1)
    const r = oggetto(oggetto(voce?.diff)['ripristino'])
    const prima = oggetto(r['prima'])
    /** @type {Record<string, unknown>} */
    const nuovo = { ...e.snapshot }
    for (const k of Object.keys(prima)) nuovo[k] = prima[k]
    for (const k of stringhe(r['aggiunte'])) delete nuovo[k]
    e.snapshot = congela(nuovo)
    const hp = r['hp']
    if (typeof hp === 'number') e.play.hp = { ...e.play.hp, cur: hp }
  })
}

// ── mattoni ───────────────────────────────────────────────────────────────

/**
 * Una scelta: chip con `aria-pressed`, non un radio nascosto. Al tavolo si
 * tocca, e un chip da 44 px si trova anche al buio.
 * @param {string} etichetta
 * @param {boolean} attiva
 * @param {() => void} onclick
 * @param {Record<string, string>} dataset
 */
function scegli(etichetta, attiva, onclick, dataset) {
  return h('button', {
    class: ['bsc-chip', attiva && 'bsc-chip--on'], type: 'button', style: TAP,
    'aria-pressed': String(attiva), dataset, onclick,
  }, etichetta)
}

/** @param {string} etichetta @param {string} valore */
function kv(etichetta, valore) {
  return h('div', { class: 'bsc-kv' }, [
    h('span', { class: 'bsc-kv__label' }, etichetta),
    h('span', { class: 'bsc-kv__value' }, valore),
  ])
}

/** @param {string[]} righe */
function avvisi(righe) {
  if (!righe.length) return null
  return h('div', { class: 'bsc-alert', dataset: { avvisi: 'piano' } },
    righe.map(a => h('p', { class: 'bsc-lead' }, a)))
}

/** @param {PianoLivello} plan */
function guadagnoPf(plan) {
  if (scelte.pfModo === 'tiro' && scelte.pfTiro) return Math.max(plan.pf.minimo, scelte.pfTiro.totale)
  return plan.pf.media
}

/** @returns {number} */
function puntiAssegnati() {
  return Object.values(scelte.asiPunti).reduce((n, v) => n + v, 0)
}

/** @returns {string} */
function riassuntoPunti() {
  return ABILITIES
    .filter(ab => (scelte.asiPunti[ab] ?? 0) > 0)
    .map(ab => `${ABILITY_LABELS[ab].breve} +${scelte.asiPunti[ab]}`)
    .join(', ')
}

/** @param {PianoLivello} plan @param {string} id */
function nomeSottoclasse(plan, id) {
  return plan.sottoclasse?.scelte.find(s => s.id === id)?.nome ?? id
}

/**
 * Le classi del personaggio, con il livello raggiunto in ciascuna. Appiana i
 * due modi in cui lo snapshot le scrive, come fa `planLevelUp`.
 *
 * Il nome viene dal pacchetto regole, che ce l'ha in italiano: senza, si
 * mostrava «Cleric» a un giocatore che sta leggendo «Chierico» ovunque altro.
 * @param {CharacterEntry} entry
 * @param {unknown} [rules]
 * @returns {Array<{classId: string, nome: string, livello: number}>}
 */
function classiDi(entry, rules) {
  const s = entry.snapshot
  /** @param {string} id */
  const nomeDi = (id) => nomeDalPacchetto(rules, id) ?? leggibile(id)
  const multi = lista(s['classes']).map(c => {
    const o = oggetto(c)
    const id = stringa(o['classId'])
    return { classId: id, nome: nomeDi(id), livello: intero(o['level'], 0) }
  }).filter(v => v.classId)
  if (multi.length) return multi
  const id = stringa(s['className'])
  return id ? [{ classId: id, nome: nomeDi(id), livello: intero(s['level'], 1) }] : []
}

/**
 * Il nome italiano di una classe secondo il pacchetto regole, se c'è.
 * @param {unknown} rules
 * @param {string} id
 * @returns {string|null}
 */
function nomeDalPacchetto(rules, id) {
  const classi = oggetto(oggetto(rules)['classes'])
  const nome = oggetto(classi[id])['name']
  return typeof nome === 'string' && nome ? nome : null
}

/** Un id kebab in qualcosa di leggibile, finché il pacchetto non dà il nome. */
/** @param {string} id */
function leggibile(id) {
  return id.split(/[-_]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

/** @param {unknown} o @param {string} k @returns {unknown} */
function leggi(o, k) {
  return typeof o === 'object' && o !== null ? /** @type {Record<string, unknown>} */ (o)[k] : undefined
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}

/** @param {unknown} v @returns {unknown[]} */
function lista(v) {
  return Array.isArray(v) ? v : []
}

/** @param {unknown} v @returns {string[]} */
function stringhe(v) {
  return lista(v).filter(/** @returns {x is string} */ x => typeof x === 'string')
}

/** @param {unknown} v @returns {string} */
function stringa(v) {
  return typeof v === 'string' ? v : ''
}

/** @param {unknown} v @param {number} dflt @returns {number} */
function intero(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
}
