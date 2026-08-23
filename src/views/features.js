/**
 * Il compendio dei privilegi di classe: tutti, non solo i propri.
 *
 * È il gemello del compendio degli incantesimi, e per la stessa ragione: al
 * tavolo capita di dover leggere cosa fa un privilegio che non è il tuo —
 * quello del compagno che ha appena dichiarato qualcosa, o quello che stai per
 * prendere salendo di livello.
 *
 * Come per gli incantesimi, se c'è un personaggio aperto si parte dalla sua
 * classe: è quasi sempre quella che si sta cercando.
 */

import { h, clear } from '../dom.js'
import { EDITION_LABELS, resolveEdition } from '../domain/edition.js'
import { privilegiDiClasse, classiDelPacchetto } from '../domain/privilegi.js'
import { loadRegistry } from '../domain/packs.js'

/** @typedef {import('./index.js').ViewCtx} ViewCtx */
/** @typedef {import('../domain/edition.js').Edition} Edition */

/** Quale classe si sta guardando. Sopravvive all'andata e ritorno, come i filtri del compendio. */
let classeScelta = ''

/** @type {Map<string, unknown>} */
const PACCHETTI = new Map()

/** @type {import('./index.js').View} */
export default {
  async render(contenitore, ctx) {
    const ed = edizione(ctx)
    const rules = await regole(ed)
    disegna(contenitore, ctx, ed, rules)
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
 * @param {Edition} ed
 * @returns {Promise<unknown>}
 */
async function regole(ed) {
  if (PACCHETTI.has(ed)) return PACCHETTI.get(ed)
  try {
    const registro = await loadRegistry()
    const pack = registro.packs.find(p => p.edizione === ed)
    const res = pack ? await fetch(pack.regole) : null
    PACCHETTI.set(ed, res?.ok ? await res.json() : null)
  } catch {
    PACCHETTI.set(ed, null)
  }
  return PACCHETTI.get(ed)
}

/**
 * @param {HTMLElement} contenitore
 * @param {ViewCtx} ctx
 * @param {Edition} ed
 * @param {unknown} rules
 */
function disegna(contenitore, ctx, ed, rules) {
  const t = ctx.t
  const classi = classiDelPacchetto(rules)
  const attivo = ctx.state.activeId ? ctx.state.characters[ctx.state.activeId] : undefined
  const sua = typeof attivo?.snapshot?.['className'] === 'string' ? attivo.snapshot['className'] : ''

  // La prima volta si parte dalla classe del personaggio aperto: è quasi
  // sempre quella che si sta cercando.
  if (!classeScelta) classeScelta = sua || classi[0]?.id || ''

  const elenco = h('div', { class: 'dc-elenco' })
  const chip = h('div', { class: 'dc-chip-riga', role: 'group', 'aria-label': t('priv.classe') })

  // Cambiare classe deve ridisegnare **anche** i chip: prima cambiava solo
  // l'elenco, e chi guardava non vedeva quale classe stesse leggendo.
  const mostraChip = () => {
    clear(chip)
    for (const c of classi) {
      const acceso = c.id === classeScelta
      chip.appendChild(h('button', {
        class: ['bsc-chip', acceso && 'bsc-chip--on'],
        type: 'button', 'aria-pressed': acceso ? 'true' : 'false',
        'data-classe': c.id,
        onclick: () => { classeScelta = c.id; mostraChip(); mostra() },
      }, c.id === sua ? `${c.nome} ★` : c.nome))
    }
  }

  const mostra = () => {
    clear(elenco)
    const voci = privilegiDiClasse(rules, classeScelta)
    if (!voci.length) {
      elenco.appendChild(h('p', { class: 'bsc-lead' }, t('priv.nessuno')))
      return
    }
    let ultimo = -1
    for (const p of voci) {
      if (p.livello !== ultimo) {
        ultimo = p.livello
        elenco.appendChild(h('h2', { class: 'bsc-label' },
          p.livello <= 1 ? t('priv.iniziale') : t('priv.livello', { n: p.livello })))
      }
      elenco.appendChild(riga(ctx, p))
    }
  }

  clear(contenitore)
  contenitore.appendChild(h('section', { class: 'dc-vista', 'data-vista': 'privilegi' }, [
    h('h1', { class: 'bsc-display' }, t('priv.titolo')),
    h('p', { class: 'bsc-badge' }, `${t(`edizione.${ed}`)} · ${EDITION_LABELS[ed].srd}`),

    h('div', { class: 'dc-gruppo' }, [
      h('span', { class: 'bsc-field-label' }, t('priv.classe')),
      chip,
    ]),

    elenco,
  ]))

  mostraChip()
  mostra()
}

/**
 * @param {ViewCtx} ctx
 * @param {import('../domain/privilegi.js').Privilegio} p
 */
function riga(ctx, p) {
  return h('details', { class: 'bsc-card dc-priv', dataset: { privilegio: p.id } }, [
    h('summary', {}, [
      h('span', { class: 'dc-priv__nome' }, p.nome),
      p.sottoclasse ? h('span', { class: 'bsc-badge' }, p.sottoclasse) : null,
    ]),
    // Dove la fonte non ha il testo lo si dice, invece di aprire su un vuoto.
    h('p', { class: p.testo ? 'bsc-prose' : 'bsc-lead' },
      p.testo ?? ctx.t('priv.senzaTesto')),
  ])
}
