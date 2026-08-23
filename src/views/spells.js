/**
 * Il compendio: elenco con ricerca, e la scheda di un incantesimo.  ── Lotto N ──
 *
 * Due schermate dietro la stessa rotta. `#/incantesimi` elenca e filtra
 * lavorando sul solo indice — che è già in memoria e non costa un download —
 * mentre `#/incantesimi/<id>` apre il testo, e quello sì che si va a prendere.
 *
 * L'id nella rotta arriva da due parti: dalla scheda del personaggio è l'id
 * **inglese** del builder (`1-cure-wounds`), dall'elenco è quello **italiano**
 * (`cura-ferite`). Si provano tutti e due prima di dire che non c'è: una rotta
 * che funziona solo se ci arrivi dalla porta giusta è una rotta rotta.
 *
 * Sull'edizione la regola è una sola e vive in `domain/edition.js`. Qui si
 * aggiunge un solo pezzo: lo **scavalco** del selettore non si appiccica —
 * `dispose()` lo azzera, e il router lo chiama a ogni cambio di rotta. Guardare
 * il 2024 su un personaggio del 2014 è una consultazione, non una conversione.
 */

import { h, clear } from '../dom.js'
import { EDITIONS, EDITION_LABELS, otherEdition, resolveEdition } from '../domain/edition.js'
import { loadIndex, loadBridge, getSpell, getSpellByBuilderId, search, counterpart } from '../domain/spells.js'
import { loadRegistry } from '../domain/packs.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../domain/edition.js').Edition} Edition */
/** @typedef {import('../domain/spells.js').SpellIndexEntry} SpellIndexEntry */
/** @typedef {import('../domain/spells.js').Spell} Spell */
/** @typedef {{presente: false, motivo: string} | {presente: true, spell: Spell}} Controparte */

/**
 * Le parole che `lang/it.json` non ha ancora. Stanno tutte qui invece che
 * sparse nel codice, così quando le chiavi arriveranno ci sarà un posto solo
 * da svuotare. (Elenco riportato a chi coordina i lotti.)
 */
const ETICHETTA = {
  cerca: 'Cerca un incantesimo',
  livello: 'Livello',
  classe: 'Classe',
  scuola: 'Scuola',
  edizione: 'Edizione',
  tempoDiLancio: 'Tempo di lancio',
  gittata: 'Gittata',
  componenti: 'Componenti',
  durata: 'Durata',
  rituale: 'Rituale',
  concentrazione: 'Concentrazione',
  classi: 'Classi',
  aLivelliSuperiori: 'A livelli superiori',
  trucchetto: 'Trucchetto',
  trucchetti: 'Trucchetti',
  si: 'sì',
  no: 'no',
  cambia: 'cambia',
  nessuno: 'Nessun incantesimo con questi filtri.',
  nessunoDeiMiei: 'Nessuno dei tuoi incantesimi con questi filtri.',
  quali: 'Quali',
  miei: 'I miei',
  tutti: 'Tutti',
}

/**
 * Cosa cambia fra un'edizione e l'altra, detto in italiano. Il segno non deve
 * dire «attenzione, qualcosa è diverso»: deve dire *cosa*, o è un allarme che
 * si impara a ignorare.
 * @type {Record<string, string>}
 */
const COSA_CAMBIA = {
  livello: 'il livello',
  scuola: 'la scuola',
  rituale: 'il rituale',
  concentrazione: 'la concentrazione',
  classi: 'la lista delle classi',
}

/** Il 5.2.1 è l'ultimo SRD uscito: senza personaggi da cui dedurre, il compendio si apre lì. */
const PREDEFINITA = /** @type {Edition} */ ('2024')

const PREFISSO_LIVELLO = /^\d+-/

/* ── Lo stato della vista ─────────────────────────────────────────────────
   Ricerca e filtri sopravvivono all'andata e ritorno verso un incantesimo:
   chi ha appena filtrato «3° livello, mago» e apre *Palla di fuoco* non deve
   rifiltrare per tornare indietro. Lo scavalco dell'edizione invece no, e la
   differenza è tutto il punto del § 5.1.1.                                   */

let testo = ''
/** @type {Set<number>} */
const livelli = new Set()
/** @type {Set<string>} */
const classi = new Set()
/** @type {Set<string>} */
const scuole = new Set()
/** @type {Edition|null} */
let scavalco = null

/**
 * Se mostrare solo gli incantesimi che il personaggio ha sulla scheda.
 *
 * Parte acceso, ed è la scelta giusta: chi apre il compendio in mezzo a una
 * sessione quasi sempre vuole i propri, non tutti e 339. Chi cerca qualcos'altro
 * lo spegne una volta e la scelta resta, come per gli altri filtri.
 * Senza personaggio aperto, o con un personaggio che non lancia incantesimi,
 * l'interruttore non compare e il compendio si mostra intero.
 */
let soloMiei = true

/** @type {import('../domain/packs.js').PackRegistry|null} */
let registro = null

/** @type {import('./index.js').View} */
export default {
  async render(contenitore, ctx) {
    // Il registro porta l'attribuzione CC-BY, che è un obbligo di licenza:
    // si carica prima di disegnare, non dopo.
    if (!registro) {
      try { registro = await loadRegistry() } catch { registro = null }
    }
    const id = ctx.route.params['id']
    if (id) await scheda(contenitore, ctx, id)
    else await elenco(contenitore, ctx)
  },

  dispose() {
    scavalco = null
  },
}

/* ── L'edizione ───────────────────────────────────────────────────────────── */

/**
 * L'edizione da mostrare. La precedenza sta in `domain/edition.js`; qui si
 * decide solo cosa contare come «edizione del personaggio» quando la libreria
 * è vuota o non c'è nessuno aperto — il compendio si consulta anche senza
 * personaggi, e da qualche parte deve pur aprirsi.
 * @param {ViewCtx} ctx
 * @param {Edition|null} [override]
 * @returns {Edition}
 */
function edizione(ctx, override = null) {
  const s = ctx.state
  const attivo = s.activeId ? s.characters[s.activeId] : undefined
  const primo = Object.values(s.characters ?? {})[0]
  return resolveEdition({
    personaggio: attivo?.meta?.edition ?? primo?.meta?.edition ?? PREDEFINITA,
    preferenza: s.settings?.edition ?? 'auto',
    scavalco: override,
  })
}

/**
 * L'etichetta che accompagna sempre il testo. Non è decorazione: un testo di
 * regole senza l'edizione a fianco è un testo di cui non si sa se vale al
 * proprio tavolo.
 * @param {ViewCtx} ctx @param {Edition} ed
 */
function etichettaEdizione(ctx, ed) {
  return h('p', { class: 'bsc-badge' }, `${ctx.t(`edizione.${ed}`)} · ${EDITION_LABELS[ed].srd}`)
}

/**
 * L'attribuzione, verbatim dal registro dei pacchetti. Chiusa in un `details`
 * perché al tavolo non serve, raggiungibile perché la licenza lo impone.
 * @param {Edition} ed
 */
function attribuzione(ed) {
  const pack = registro?.packs.find(p => p.edizione === ed)
  if (!pack) return null
  return h('details', { class: 'dc-gruppo' }, [
    h('summary', { class: 'bsc-label' }, `${EDITION_LABELS[ed].srd} · ${pack.licenza}`),
    h('p', { class: 'bsc-prose' }, pack.attribuzione),
  ])
}

/* ── L'elenco ─────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 */
async function elenco(contenitore, ctx) {
  const ed = edizione(ctx)
  const [index, miei] = await Promise.all([loadIndex(ed), incantesimiDelPersonaggio(ctx, ed)])

  const risultati = h('div', { class: 'dc-elenco' })
  const filtri = h('div', { class: 'dc-gruppo' })

  const mostraRisultati = () => {
    clear(risultati)
    for (const nodo of righe(ctx, index, ed, miei)) risultati.appendChild(nodo)
  }
  const mostraFiltri = () => {
    clear(filtri)
    // I valori vengono dall'indice, non da una lista scritta a mano: un
    // pacchetto della v3 che portasse una scuola in più comparirebbe da solo.
    filtri.appendChild(gruppoChip(ETICHETTA.livello, distinti(index, s => s.livello, l => l === 0 ? ETICHETTA.trucchetti : `${l}°`), livelli, poi))
    filtri.appendChild(gruppoChip(ETICHETTA.classe, distinti(index, s => s.classi, maiuscola), classi, poi))
    filtri.appendChild(gruppoChip(ETICHETTA.scuola, distinti(index, s => s.scuola, s => s), scuole, poi))
  }

  const interruttoreMiei = miei ? h('div', { class: 'dc-gruppo' }) : null
  const poi = () => { mostraQuali(); mostraFiltri(); mostraRisultati() }
  const mostraQuali = () => {
    if (!interruttoreMiei) return
    clear(interruttoreMiei)
    interruttoreMiei.append(
      h('span', { class: 'bsc-label' }, ETICHETTA.quali),
      h('div', { class: 'dc-chip-riga' }, [
        chipQuali(ETICHETTA.miei, true, poi),
        chipQuali(ETICHETTA.tutti, false, poi),
      ]),
    )
  }

  /** @param {Event} ev */
  const digitato = (ev) => {
    const el = ev.currentTarget
    testo = el instanceof HTMLInputElement ? el.value : ''
    // Solo i risultati: rifare il campo mentre ci si scrive dentro gli
    // porterebbe via il fuoco a ogni lettera.
    mostraRisultati()
  }

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'incantesimi' }, [
    h('h1', { class: 'bsc-display' }, ctx.t('nav.incantesimi')),
    etichettaEdizione(ctx, ed),
    h('label', { class: 'bsc-field' }, [
      h('span', { class: 'bsc-field-label' }, ETICHETTA.cerca),
      h('input', {
        class: 'bsc-input', type: 'search', value: testo, autocomplete: 'off',
        enterkeyhint: 'search', oninput: digitato,
      }),
    ]),
    interruttoreMiei,
    filtri,
    risultati,
    attribuzione(ed),
  ]))

  mostraQuali()
  mostraFiltri()
  mostraRisultati()
}

/**
 * @param {ViewCtx} ctx
 * @param {SpellIndexEntry[]} index
 * @param {Edition} ed
 * @param {Set<string>|null} [miei]  gli incantesimi del personaggio, se ce n'è uno
 * @returns {Array<Node>}
 */
function righe(ctx, index, ed, miei) {
  let trovati = search(index, {
    testo,
    livelli: [...livelli],
    classi: [...classi],
    scuole: [...scuole],
  })
  if (miei && soloMiei) trovati = trovati.filter(v => miei.has(v.id))
  if (!trovati.length) {
    return [h('p', { class: 'bsc-lead' },
      miei && soloMiei ? ETICHETTA.nessunoDeiMiei : ETICHETTA.nessuno)]
  }

  /** @type {Array<Node>} */
  const out = []
  let ultimo = -1
  for (const voce of trovati) {
    if (voce.livello !== ultimo) {
      ultimo = voce.livello
      out.push(h('h2', { class: 'bsc-label' }, voce.livello === 0 ? ETICHETTA.trucchetti : titoloLivello(voce.livello)))
    }
    out.push(riga(ctx, voce, ed))
  }
  return out
}

/**
 * @param {ViewCtx} ctx
 * @param {SpellIndexEntry} voce
 * @param {Edition} ed
 */
function riga(ctx, voce, ed) {
  const segno = segnale(ctx, voce, ed)
  return h('a', {
    class: 'bsc-kv bsc-kv--azione',
    href: `#/incantesimi/${encodeURIComponent(voce.id)}`,
    title: segno || null,
  }, [
    h('span', { class: 'bsc-kv__label' }, voce.nome),
    segno ? h('span', { class: 'bsc-kv__hint' }, ETICHETTA.cambia) : null,
    h('span', { class: 'bsc-kv__hint' }, voce.scuola),
  ])
}

/**
 * «cambia nel D&D 2024: la scuola». Non compare dove l'incantesimo è del tutto
 * assente: quella non è una differenza, è un'assenza, e si spiega col selettore.
 * @param {ViewCtx} ctx
 * @param {SpellIndexEntry} voce
 * @param {Edition} ed  l'edizione da cui si guarda
 * @returns {string}
 */
function segnale(ctx, voce, ed) {
  if (!voce.differisce || voce.cambiamenti.includes('assente')) return ''
  const cose = voce.cambiamenti.map(c => COSA_CAMBIA[c] ?? c)
  if (!cose.length) return ''
  const altra = EDITION_LABELS[otherEdition(ed)].titolo
  return `${ctx.t('edizione.confronta', { altra })}: ${cose.join(', ')}`
}

/**
 * Gli id degli incantesimi che il personaggio aperto ha sulla scheda, tradotti
 * negli id del compendio.
 *
 * Restituisce `null` — e non un insieme vuoto — quando non c'è un personaggio
 * o quando non lancia incantesimi: sono i due casi in cui l'interruttore non
 * deve nemmeno comparire, e un insieme vuoto li confonderebbe con «ha degli
 * incantesimi, ma nessuno di questi».
 *
 * @param {ViewCtx} ctx
 * @param {Edition} ed
 * @returns {Promise<Set<string>|null>}
 */
async function incantesimiDelPersonaggio(ctx, ed) {
  const s = ctx.state
  const attivo = s.activeId ? s.characters[s.activeId] : undefined
  if (!attivo) return null
  const grezzi = [attivo.snapshot['cantrips'], attivo.snapshot['spellsKnown'], attivo.snapshot['spellsPrepared']]
    .flatMap(v => (Array.isArray(v) ? v : []))
    .filter(v => typeof v === 'string')
  if (!grezzi.length) return null
  try {
    const ponte = await loadBridge(ed)
    /** @type {Set<string>} */
    const ids = new Set()
    for (const id of grezzi) {
      const italiano = ponte[id]
      if (typeof italiano === 'string' && italiano) ids.add(italiano)
    }
    return ids.size ? ids : null
  } catch {
    return null
  }
}

/**
 * Uno dei due chip dell'interruttore «i miei / tutti».
 * @param {string} etichetta
 * @param {boolean} valore
 * @param {() => void} poi
 */
function chipQuali(etichetta, valore, poi) {
  const acceso = soloMiei === valore
  return h('button', {
    class: ['bsc-chip', acceso && 'bsc-chip--on'],
    type: 'button',
    'aria-pressed': acceso ? 'true' : 'false',
    onclick: () => { soloMiei = valore; poi() },
  }, etichetta)
}

/* ── I filtri ─────────────────────────────────────────────────────────────── */

/**
 * @template T
 * @param {string} etichetta
 * @param {Array<{valore: T, testo: string}>} voci
 * @param {Set<T>} scelte
 * @param {() => void} poi
 * @returns {HTMLElement}
 */
function gruppoChip(etichetta, voci, scelte, poi) {
  return h('div', { class: 'dc-gruppo' }, [
    h('h2', { class: 'bsc-label' }, etichetta),
    h('div', { class: 'dc-condizioni', role: 'group', 'aria-label': etichetta }, voci.map(v => {
      const acceso = scelte.has(v.valore)
      return h('button', {
        type: 'button',
        class: ['bsc-chip', acceso && 'bsc-chip--on'],
        'aria-pressed': String(acceso),
        onclick: () => {
          if (acceso) scelte.delete(v.valore); else scelte.add(v.valore)
          poi()
        },
      }, v.testo)
    })),
  ])
}

/**
 * I valori distinti di un campo dell'indice, ordinati, pronti da chippare.
 * @template {number|string} T
 * @param {SpellIndexEntry[]} index
 * @param {(s: SpellIndexEntry) => T|T[]} campo
 * @param {(v: T) => string} etichetta
 * @returns {Array<{valore: T, testo: string}>}
 */
function distinti(index, campo, etichetta) {
  const visti = [...new Set(index.flatMap(s => {
    const v = campo(s)
    return Array.isArray(v) ? v : [v]
  }))].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))))
  return visti.map(v => ({ valore: v, testo: etichetta(v) }))
}

/* ── La scheda di un incantesimo ──────────────────────────────────────────── */

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {string} idRotta
 */
async function scheda(contenitore, ctx, idRotta) {
  const base = edizione(ctx)
  const spell = (await getSpellByBuilderId(base, idRotta)) ?? (await getSpell(base, idRotta))
  if (!spell) { senzaTesto(contenitore, ctx, base, idRotta); return }

  /** @type {Controparte} */
  let altro
  try {
    altro = await counterpart(base, spell.id)
  } catch {
    // Un guasto di lettura non è un'assenza. `counterpart` le distingue —
    // l'assenza la risolve, il guasto lo lancia — e qui la distinzione si
    // traduce in due frasi diverse: la prima si riprova, la seconda no.
    altro = { presente: false, motivo: ctx.t('comune.errore') }
  }

  const disegna = () => {
    const mostrata = altro.presente && edizione(ctx, scavalco) !== base ? altro.spell : spell
    const ed = mostrata.edizione
    const segno = segnale(ctx, mostrata, ed)
    const ragione = motivoAssenza(ctx, spell, base, altro)

    clear(contenitore)
    contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'incantesimo' }, [
      h('a', { class: 'bsc-btn bsc-btn--ghost bsc-btn--sm', href: '#/incantesimi' }, ctx.t('comune.indietro')),
      h('h1', { class: 'bsc-display' }, mostrata.nome),
      h('p', { class: 'bsc-lead' }, `${titoloLivello(mostrata.livello)} · ${mostrata.scuola}`),
      selettore(ctx, base, altro, ed, ragione, disegna),
      segno ? h('p', { class: 'bsc-badge bsc-badge--warn' }, segno) : null,
      h('div', { class: 'dc-elenco' }, [
        campo(ETICHETTA.tempoDiLancio, mostrata.tempoDiLancio),
        campo(ETICHETTA.gittata, mostrata.gittata),
        campo(ETICHETTA.componenti, mostrata.componenti),
        campo(ETICHETTA.durata, mostrata.durata),
        campo(ETICHETTA.rituale, mostrata.rituale ? ETICHETTA.si : ETICHETTA.no),
        campo(ETICHETTA.concentrazione, mostrata.concentrazione ? ETICHETTA.si : ETICHETTA.no),
        campo(ETICHETTA.classi, mostrata.classi.map(maiuscola).join(', ')),
      ]),
      etichettaEdizione(ctx, ed),
      h('p', { class: 'bsc-prose' }, mostrata.testo),
      mostrata.aLivelliSuperiori ? h('h2', { class: 'bsc-label' }, ETICHETTA.aLivelliSuperiori) : null,
      mostrata.aLivelliSuperiori ? h('p', { class: 'bsc-prose' }, mostrata.aLivelliSuperiori) : null,
      attribuzione(ed),
    ]))
  }

  disegna()
}

/**
 * Il selettore `2014 | 2024`. Il lato che non c'è resta visibile e disattivato,
 * con la ragione scritta sotto: un pannello vuoto non spiega niente.
 * @param {ViewCtx} ctx
 * @param {Edition} base     l'edizione che vale per regola
 * @param {Controparte} altro
 * @param {Edition} mostrata
 * @param {string} ragione
 * @param {() => void} poi
 */
function selettore(ctx, base, altro, mostrata, ragione, poi) {
  return h('div', { class: 'dc-gruppo' }, [
    h('h2', { class: 'bsc-label' }, ETICHETTA.edizione),
    h('div', { class: 'dc-condizioni', role: 'group', 'aria-label': ETICHETTA.edizione }, EDITIONS.map(e => {
      const attiva = e === mostrata
      const disponibile = e === base || altro.presente
      return h('button', {
        type: 'button',
        class: ['bsc-chip', attiva && 'bsc-chip--on'],
        'aria-pressed': String(attiva),
        disabled: !disponibile,
        title: disponibile ? null : ragione,
        // Tornare all'edizione di regola azzera lo scavalco invece di
        // impostarlo: così «chiuso e riaperto» e «tornato indietro» finiscono
        // nello stesso posto.
        onclick: () => { scavalco = e === base ? null : e; poi() },
      }, ctx.t(`edizione.${e}`))
    })),
    ragione ? h('p', { class: 'bsc-lead' }, ragione) : null,
  ])
}

/**
 * Perché il lato disattivato è disattivato.
 *
 * L'assenza vera ha già la sua chiave in `lang/it.json`, e usarla vuol dire che
 * anche l'inglese la troverà tradotta. Tutto il resto — un guasto di lettura,
 * un dato incoerente — lo racconta il dominio, che è l'unico ad aver visto
 * cos'è successo.
 * @param {ViewCtx} ctx
 * @param {Spell} spell
 * @param {Edition} base
 * @param {Controparte} altro
 * @returns {string}
 */
function motivoAssenza(ctx, spell, base, altro) {
  if (altro.presente) return ''
  return spell.cambiamenti.includes('assente')
    ? ctx.t('edizione.assente', { srd: EDITION_LABELS[otherEdition(base)].srd })
    : altro.motivo
}

/**
 * Un incantesimo che il compendio non ha: il builder lo prende dal Player's
 * Handbook, che non è SRD e non si spedisce. Se ne mostra il nome e si dice
 * perché non c'è altro — meglio un buco dichiarato che un testo inventato.
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {Edition} ed
 * @param {string} idRotta
 */
function senzaTesto(contenitore, ctx, ed, idRotta) {
  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'incantesimo' }, [
    h('a', { class: 'bsc-btn bsc-btn--ghost bsc-btn--sm', href: '#/incantesimi' }, ctx.t('comune.indietro')),
    h('h1', { class: 'bsc-display' }, nomeDaId(idRotta)),
    etichettaEdizione(ctx, ed),
    h('p', { class: 'bsc-lead' }, ctx.t('scheda.senzaTesto')),
    attribuzione(ed),
  ]))
}

/* ── Spiccioli ────────────────────────────────────────────────────────────── */

/**
 * Nome del campo a sinistra, valore a destra — e non il contrario: i valori
 * qui sono prosa («V, S, M (una campanella e un filo d'argento)»), e devono
 * poter andare a capo invece di allargare la riga fino a far scorrere il corpo.
 * @param {string} nome @param {string} valore
 */
function campo(nome, valore) {
  return h('p', { class: 'bsc-kv' }, [
    h('span', { class: 'bsc-kv__hint' }, nome),
    h('span', { class: 'bsc-kv__label' }, valore),
  ])
}

/** @param {number} l @returns {string} */
function titoloLivello(l) {
  return l === 0 ? ETICHETTA.trucchetto : `${l}° ${ETICHETTA.livello.toLowerCase()}`
}

/** @param {string} s @returns {string} */
function maiuscola(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** @param {string} id @returns {string} */
function nomeDaId(id) {
  return id.replace(PREFISSO_LIVELLO, '').split('-').map(maiuscola).join(' ')
}
