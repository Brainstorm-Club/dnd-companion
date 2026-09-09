/**
 * Il compendio delle razze: tutte, non solo la propria.
 *
 * È il terzo gemello — dopo incantesimi e privilegi — e nasce dalla stessa
 * domanda del tavolo: «cosa fa di preciso il Soffio del Drago?». Finora la
 * risposta stava solo dentro la scheda di chi è dragonide; per tutti gli altri
 * non stava da nessuna parte.
 *
 * Come per i privilegi, se c'è un personaggio aperto si parte dalla sua razza:
 * è quasi sempre quella che si sta cercando.
 */

import { h, clear } from '../dom.js'
import { EDITION_LABELS, resolveEdition } from '../domain/edition.js'
import { trattiDiRazza, razzeDelPacchetto } from '../domain/razze.js'
import { loadRegistry, packById, testoSpedibile } from '../domain/packs.js'
import { loadRules } from '../domain/rules.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../domain/edition.js').Edition} Edition */

/** Quale razza si sta guardando. Sopravvive all'andata e ritorno, come i filtri del compendio. */
let razzaScelta = ''
/** Quale sottorazza, o `''` per tutte. */
let sottorazzaScelta = ''

/** Se il filtro delle sottorazze è aperto: chiuso di suo, vedi `mostraSotto`. */
let sottoAperto = false

/** @type {import('./index.js').View} */
export default {
  async render(contenitore, ctx) {
    const ed = edizione(ctx)
    const { pack, rules } = await regole(ctx, ed)
    disegna(contenitore, ctx, ed, rules, testoSpedibile(pack))
  },
}

/**
 * @param {ViewCtx} ctx
 * @returns {Edition}
 */
function edizione(ctx) {
  const s = ctx.state
  const attivo = s.activeId ? s.characters[s.activeId] : undefined
  const primo = Object.values(s.characters ?? {})[0]
  return resolveEdition({
    personaggio: attivo?.meta?.edition ?? primo?.meta?.edition ?? '2024',
    preferenza: s.settings?.edition ?? 'auto',
  })
}

/**
 * Il pacchetto da cui leggere le razze.
 *
 * Quello del personaggio aperto quando l'edizione mostrata è la sua — altrimenti
 * chi gioca una variante aprirebbe il compendio e ci troverebbe nove razze
 * dell'SRD invece delle venti che il suo pacchetto conosce, e la sua non
 * sarebbe fra quelle. Se si sta guardando l'altra edizione, o non c'è nessuno
 * aperto, vale il primo pacchetto di quell'edizione: il compendio si consulta
 * anche a libreria vuota.
 *
 * `loadRules` fonde già il pacchetto col suo base e tiene la cache per id: qui
 * non serve saperlo.
 * @param {ViewCtx} ctx
 * @param {Edition} ed
 * @returns {Promise<{pack: import('../domain/packs.js').Pack|null|undefined, rules: unknown}>}
 */
async function regole(ctx, ed) {
  try {
    const registro = await loadRegistry()
    const attivo = ctx.state.activeId ? ctx.state.characters[ctx.state.activeId] : undefined
    const suo = attivo && attivo.meta.edition === ed ? packById(registro, attivo.meta.packId) : null
    const pack = suo ?? registro.packs.find(p => p.edizione === ed)
    return { pack, rules: pack ? await loadRules(pack.id) : null }
  } catch {
    return { pack: null, rules: null }
  }
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {Edition} ed
 * @param {unknown} rules
 * @param {boolean} conTesto  se il pacchetto può spedire le descrizioni
 */
function disegna(contenitore, ctx, ed, rules, conTesto) {
  const t = ctx.t
  const razze = razzeDelPacchetto(rules)
  const attivo = ctx.state.activeId ? ctx.state.characters[ctx.state.activeId] : undefined
  const sua = typeof attivo?.snapshot?.['race'] === 'string' ? attivo.snapshot['race'] : ''
  const suaSotto = typeof attivo?.snapshot?.['subrace'] === 'string' ? attivo.snapshot['subrace'] : ''

  // La prima volta si parte dalla razza del personaggio aperto — e dalla sua
  // sottorazza, che è il pezzo che di solito si va a rileggere.
  //
  // La stessa riga ripara anche la scelta **scaduta**: il compendio ricorda
  // cosa si stava guardando, ma fra un'apertura e l'altra il pacchetto può
  // essere cambiato (si importa un personaggio, si cambia edizione). Una razza
  // che lì non esiste lascerebbe l'elenco vuoto e nessun chip acceso, cioè una
  // schermata che non si sa come si è ottenuta.
  if (!razze.some(r => r.id === razzaScelta)) {
    razzaScelta = razze.some(r => r.id === sua) ? sua : razze[0]?.id ?? ''
    sottorazzaScelta = razzaScelta === sua ? suaSotto : ''
  }

  const elenco = h('div', { class: 'dc-elenco' })
  const chip = h('div', { class: 'dc-chip-riga', role: 'group', 'aria-label': t('razze.razza') })
  const gruppoSotto = h('div', { class: 'dc-gruppo' })

  const quale = () => razze.find(r => r.id === razzaScelta)

  // Cambiare razza deve ridisegnare **anche** i chip: altrimenti chi guarda
  // non vede quale razza stia leggendo.
  const mostraChip = () => {
    clear(chip)
    for (const r of razze) {
      const acceso = r.id === razzaScelta
      chip.appendChild(h('button', {
        class: ['bsc-chip', acceso && 'bsc-chip--on'],
        type: 'button', 'aria-pressed': acceso ? 'true' : 'false',
        'data-razza': r.id,
        onclick: () => { razzaScelta = r.id; sottorazzaScelta = ''; mostraChip(); mostraSotto(); mostra() },
      }, r.id === sua ? `${r.nome} ★` : r.nome))
    }
  }

  /**
   * Il filtro di sottorazza esiste solo dove ci sono sottorazze: metà delle
   * razze non ne ha, e un gruppo con dentro il solo «Tutte» sarebbe un
   * controllo che non controlla niente.
   *
   * E sta chiuso. Il dragonide del 2024 ha dieci stirpi: dieci chip sotto i
   * nove delle razze riempivano lo schermo intero, e chi apriva il compendio
   * per leggere un tratto non ne vedeva nemmeno uno senza scorrere due blocchi
   * di pulsanti. La scelta corrente sta scritta nel sommario, così chiuso dice
   * comunque a che punto sei.
   */
  const mostraSotto = () => {
    clear(gruppoSotto)
    const sottorazze = quale()?.sottorazze ?? []
    gruppoSotto.hidden = sottorazze.length === 0
    if (!sottorazze.length) { sottorazzaScelta = ''; return }
    if (!sottorazze.some(s => s.id === sottorazzaScelta)) sottorazzaScelta = ''

    const riga = h('div', { class: 'dc-chip-riga', role: 'group', 'aria-label': t('razze.sottorazza') })
    for (const s of [{ id: '', nome: t('razze.tutte') }, ...sottorazze]) {
      const acceso = s.id === sottorazzaScelta
      riga.appendChild(h('button', {
        class: ['bsc-chip', acceso && 'bsc-chip--on'],
        type: 'button', 'aria-pressed': acceso ? 'true' : 'false',
        'data-sottorazza': s.id || 'tutte',
        onclick: () => { sottorazzaScelta = s.id; sottoAperto = false; mostraSotto(); mostra() },
      }, s.nome))
    }

    const scelta = sottorazze.find(s => s.id === sottorazzaScelta)?.nome ?? t('razze.tutte')
    gruppoSotto.appendChild(h('details', {
      class: 'dc-sotto', open: sottoAperto || undefined,
      ontoggle: (/** @type {Event} */ ev) => {
        sottoAperto = /** @type {HTMLDetailsElement} */ (ev.currentTarget).open
      },
    }, [
      h('summary', { class: 'bsc-btn bsc-btn--outline bsc-btn--sm' },
        `${t('razze.sottorazza')}: ${scelta}`),
      riga,
    ]))
  }

  const mostra = () => {
    clear(elenco)
    const voci = trattiDiRazza(rules, razzaScelta, sottorazzaScelta || undefined)
    if (!voci.length) {
      elenco.appendChild(h('p', { class: 'bsc-lead' }, t('razze.nessuno')))
      return
    }
    // Un'intestazione per provenienza: prima i tratti della razza, poi quelli
    // di ciascuna sottorazza. Senza, in un elenco di dodici tratti non si
    // capisce quali si hanno davvero e quali dipendono dalla sottorazza.
    let ultimo = /** @type {string|null|undefined} */ (undefined)
    for (const tr of voci) {
      if (tr.sottorazza !== ultimo) {
        ultimo = tr.sottorazza
        elenco.appendChild(h('h2', { class: 'bsc-label' }, tr.sottorazza ?? t('razze.comuni')))
      }
      elenco.appendChild(riga(ctx, tr, conTesto))
    }
  }

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'razze' }, [
    h('h1', { class: 'bsc-display' }, t('razze.titolo')),
    h('p', { class: 'bsc-badge' }, `${t(`edizione.${ed}`)} · ${EDITION_LABELS[ed].srd}`),

    h('div', { class: 'dc-gruppo' }, [
      h('span', { class: 'bsc-field-label' }, t('razze.razza')),
      chip,
    ]),
    gruppoSotto,

    elenco,
  ]))

  mostraChip()
  mostraSotto()
  mostra()
}

/**
 * @param {ViewCtx} ctx
 * @param {import('../domain/razze.js').Tratto} tr
 * @param {boolean} conTesto
 */
function riga(ctx, tr, conTesto) {
  return h('details', { class: 'bsc-card dc-priv', dataset: { tratto: tr.id } }, [
    h('summary', {}, [
      h('span', { class: 'dc-priv__nome' }, tr.nome),
      tr.sottorazza ? h('span', { class: 'bsc-badge' }, tr.sottorazza) : null,
    ]),
    // Dove la fonte non ha il testo lo si dice, invece di aprire su un vuoto —
    // e si dice la ragione giusta: «manca nell'SRD» e «non è materiale che
    // possiamo spedire» sono due assenze diverse, e la seconda non si risolve
    // aspettando che qualcuno estragga meglio.
    h('p', { class: tr.testo ? 'bsc-prose' : 'bsc-lead' },
      tr.testo ?? ctx.t(conTesto ? 'razze.senzaTesto' : 'razze.senzaTestoNonLibero')),
  ])
}
