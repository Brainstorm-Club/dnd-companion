/**
 * Punti esperienza e aumento di livello.  ── Lotto C ──
 *
 * Le soglie sono identiche nelle due edizioni: è una delle poche cose che il
 * 2024 non ha toccato.
 */

import { modifier, proficiencyBonus, diceModifier } from './character.js'

/** @typedef {import('./edition.js').Edition} Edition */

/** Soglie di PX per livello, indice 0 = livello 1. Fonte: SRD. */
export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
]

/** @param {number} xp @returns {number} livello da 1 a 20 */
export function levelForXp(xp) {
  let l = 1
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= /** @type {number} */ (XP_THRESHOLDS[i])) l = i + 1
  }
  return l
}

/**
 * Quanti PX mancano al livello successivo, e a che punto si è nella barra.
 * @param {number} xp
 * @returns {{livello: number, prossimo: number|null, mancano: number|null, frazione: number}}
 */
export function xpProgress(xp) {
  const livello = levelForXp(xp)
  if (livello >= 20) return { livello, prossimo: null, mancano: null, frazione: 1 }
  const base = /** @type {number} */ (XP_THRESHOLDS[livello - 1])
  const prossimo = /** @type {number} */ (XP_THRESHOLDS[livello])
  const mancano = prossimo - xp
  return { livello, prossimo, mancano, frazione: (xp - base) / (prossimo - base) }
}

/**
 * Un privilegio che si guadagna salendo.
 * @typedef {object} PrivilegioNuovo
 * @property {string} id
 * @property {string} nome
 * @property {string|null} testo         null quando l'SRD italiano non lo porta
 * @property {number} livello
 * @property {string|null} sottoclasse   id della sottoclasse che lo concede, null se è di classe
 */

/**
 * @typedef {object} PianoLivello
 * @property {number} da                  livello totale di adesso
 * @property {number} a                   livello totale dopo
 * @property {string} classe              id della classe in cui si sale
 * @property {string} nomeClasse
 * @property {number} livelloClasse       livello raggiunto **in quella classe**
 * @property {number} competenza          bonus di competenza dopo
 * @property {boolean} competenzaCambiata
 * @property {PrivilegioNuovo[]} privilegi
 * @property {{obbligatoria: boolean, scelte: Array<{id: string, nome: string}>}|null} sottoclasse
 * @property {boolean} asi                tocca un aumento dei punteggi (o un talento)
 * @property {boolean} donoEpico          tocca un dono epico: solo nel 2024, al 19°
 * @property {{prima: number[], dopo: number[], nuovi: number[]}} slot  slot per livello di incantesimo
 * @property {{prima: number, dopo: number, nuove: number}|null} maestrieArmi
 * @property {{modo: string, trucchetti: {prima: number, dopo: number}, incantesimi: {prima: number|null, dopo: number|null}}|null} incantesimi
 * @property {{dado: number, modificatoreCostituzione: number, media: number, tiro: string, minimo: number}} pf
 * @property {string[]} avvisi            ciò che il piano non sa fare, detto invece che nascosto
 */

/**
 * Cosa cambia salendo di livello: privilegi nuovi, ASI o dono epico, slot,
 * sottoclasse da scegliere, maestrie d'arma. Dipende dall'edizione: nel 2024 la
 * sottoclasse arriva al 3° per tutte le classi, e il 19° dà un dono epico
 * invece di un ASI.
 *
 * **Descrive soltanto.** Non tocca lo snapshot, non tocca lo stato di gioco:
 * restituisce il piano, e chi lo conferma ne fa uno snapshot nuovo. È la prima
 * delle cinque regole del progetto, e qui è anche la ragione per cui la
 * funzione si può testare senza montare niente.
 *
 * @param {object} p
 * @param {import('../storage.js').CharacterEntry} p.entry
 * @param {unknown} p.rules
 * @param {Edition} p.edition
 * @param {string} p.classId   in quale classe salire (multiclasse)
 * @returns {PianoLivello} il piano dell'avanzamento, passo per passo
 */
export function planLevelUp({ entry, rules, edition, classId }) {
  const s = entry.snapshot
  /** @type {string[]} */
  const avvisi = []

  const edizionePacchetto = stringa(leggi(rules, 'edizione'))
  if (edizionePacchetto && edizionePacchetto !== edition) {
    avvisi.push(`Il pacchetto regole è dell'edizione ${edizionePacchetto}, la scheda chiede la ${edition}.`)
  }

  const da = Math.min(Math.max(intero(s['level'], 1), 1), 20)
  const a = Math.min(da + 1, 20)
  if (da >= 20) avvisi.push('Il personaggio è già di 20° livello: non c\'è altro da salire.')

  const dati = oggetto(oggetto(leggi(rules, 'classes'))[classId])
  if (!Object.keys(dati).length) {
    avvisi.push(`Il pacchetto regole non conosce la classe «${classId}»: il piano è quello che si può dire senza di lei.`)
  }

  const voci = vociDiClasse(s)
  const attuale = voci.find(v => v.classId === classId)
  const livelloClasse = Math.min((attuale?.level ?? 0) + 1, 20)
  if (!attuale) {
    avvisi.push(`Prima multiclasse in «${classId}»: i prerequisiti di punteggio non li verifica l'app.`)
  }
  if (voci.length > 1) {
    avvisi.push('Personaggio multiclasse: gli slot qui sotto sono quelli della sola classe in cui si sale, non quelli combinati.')
  }

  const competenzaPrima = proficiencyBonus(da)
  const competenza = proficiencyBonus(a)

  // ── Privilegi nuovi: quelli di classe, più quelli della sottoclasse già
  //    scelta. Se la sottoclasse si sceglie proprio adesso, i suoi privilegi di
  //    questo livello arrivano con la scelta, quindi si elencano lo stesso.
  const sottoclasseScelta = attuale?.subclass || stringa(s['subclass'])
  const sottoclassi = oggetto(dati['subclasses'])
  /** @type {PrivilegioNuovo[]} */
  const privilegi = []
  for (const f of lista(dati['features'])) {
    const o = oggetto(f)
    if (intero(o['level'], 0) !== livelloClasse) continue
    privilegi.push(voce(o, null))
  }
  const livelloSottoclasse = intero(dati['subclassLevel'], 0)
  // Si sceglie al livello giusto — e resta da scegliere se a quel livello non
  // è stato fatto, invece di sparire dalla procedura per sempre.
  const daScegliere = livelloSottoclasse > 0 && livelloClasse >= livelloSottoclasse && !sottoclasseScelta
  const idSottoclasse = sottoclasseScelta || null
  if (idSottoclasse) {
    const sc = oggetto(sottoclassi[idSottoclasse])
    for (const f of lista(sc['features'])) {
      const o = oggetto(f)
      if (intero(o['level'], 0) !== livelloClasse) continue
      privilegi.push(voce(o, idSottoclasse))
    }
  }

  const scelte = Object.keys(sottoclassi).sort().map(id => ({
    id,
    nome: stringa(oggetto(sottoclassi[id])['name']) || id,
  }))
  const sottoclasse = daScegliere || (!idSottoclasse && livelloSottoclasse > 0 && livelloClasse > livelloSottoclasse)
    ? { obbligatoria: livelloClasse >= livelloSottoclasse, scelte }
    : null
  if (sottoclasse && !scelte.length) {
    avvisi.push('Il pacchetto non porta sottoclassi per questa classe: la scelta va fatta sul builder.')
  }

  // ── ASI e dono epico. Nel 2014 il 19° è un ASI in più; nel 2024 è il dono
  //    epico, e per questo `asiLevels` sta per classe **e** per edizione.
  const asiLevels = numeri(dati['asiLevels'])
  const donoEpicoA = leggi(dati, 'epicBoonLevel')
  const asi = asiLevels.includes(livelloClasse)
  const donoEpico = typeof donoEpicoA === 'number' && donoEpicoA === livelloClasse

  // ── Slot: si guarda la stessa tabella prima e dopo, e si mostra il delta.
  const tipo = stringa(dati['casterType'])
  const slotPrima = slotAlLivello(rules, tipo, livelloClasse - 1)
  const slotDopo = slotAlLivello(rules, tipo, livelloClasse)
  const nuovi = slotDopo.map((n, i) => n - (slotPrima[i] ?? 0))

  // ── Maestrie d'arma: esistono solo dove il pacchetto le porta.
  const tabellaMaestrie = numeri(dati['weaponMastery'])
  const maestrieArmi = tabellaMaestrie.length
    ? {
        prima: tabellaMaestrie[livelloClasse - 2] ?? 0,
        dopo: tabellaMaestrie[livelloClasse - 1] ?? 0,
        nuove: (tabellaMaestrie[livelloClasse - 1] ?? 0) - (tabellaMaestrie[livelloClasse - 2] ?? 0),
      }
    : null

  // ── Incantesimi: trucchetti sempre da tabella, il resto secondo il modo che
  //    il pacchetto dichiara — nel 2014 chi prepara usa una formula, nel 2024
  //    tutti leggono una colonna.
  const incantesimi = tipo ? contoIncantesimi(rules, s, classId, livelloClasse, avvisi) : null

  // ── PF: la media fissa, e il tiro per chi preferisce il dado.
  const dado = intero(dati['hitDie'], intero(s['hitDie'], 8))
  const modCon = modificatoreCostituzione(s)
  const pf = {
    dado,
    modificatoreCostituzione: modCon,
    media: Math.max(1, Math.floor(dado / 2) + 1 + modCon),
    tiro: `1d${dado}${diceModifier(modCon)}`,
    minimo: 1,
  }

  return {
    da,
    a,
    classe: classId,
    nomeClasse: stringa(dati['name']) || classId,
    livelloClasse,
    competenza,
    competenzaCambiata: competenza !== competenzaPrima,
    privilegi,
    sottoclasse,
    asi,
    donoEpico,
    slot: { prima: slotPrima, dopo: slotDopo, nuovi },
    maestrieArmi,
    incantesimi,
    pf,
    avvisi,
  }
}

/**
 * @param {Record<string, unknown>} o
 * @param {string|null} sottoclasse
 * @returns {PrivilegioNuovo}
 */
function voce(o, sottoclasse) {
  const testo = o['description']
  return {
    id: stringa(o['id']),
    nome: stringa(o['name']) || stringa(o['nome']) || stringa(o['id']),
    testo: typeof testo === 'string' && testo ? testo : null,
    livello: intero(o['level'], 0),
    sottoclasse,
  }
}

/**
 * Le classi del personaggio con il loro livello. Uno snapshot monoclasse ha
 * `classes: []` e tiene tutto nei campi in cima: i due casi si appianano qui,
 * una volta sola.
 * @param {Record<string, unknown>} s
 * @returns {Array<{classId: string, subclass: string, level: number}>}
 */
function vociDiClasse(s) {
  const multi = lista(s['classes']).map(c => {
    const o = oggetto(c)
    return {
      classId: stringa(o['classId']),
      subclass: stringa(o['subclass']),
      level: intero(o['level'], 0),
    }
  }).filter(v => v.classId)
  if (multi.length) return multi
  const id = stringa(s['className'])
  return id ? [{ classId: id, subclass: stringa(s['subclass']), level: intero(s['level'], 1) }] : []
}

/**
 * Gli slot di un incantatore a un dato livello di classe, come li scrive il
 * pacchetto. Il patto del warlock ha una forma sua — pochi slot, tutti dello
 * stesso livello — e va tradotto nella stessa forma degli altri, altrimenti la
 * vista dovrebbe conoscere l'eccezione.
 * @param {unknown} rules
 * @param {string} tipo
 * @param {number} livello
 * @returns {number[]}
 */
function slotAlLivello(rules, tipo, livello) {
  if (!tipo || livello < 1) return []
  const tabelle = oggetto(leggi(rules, 'spellSlots'))
  const riga = lista(tabelle[tipo])[Math.min(livello, 20) - 1]
  if (Array.isArray(riga)) return riga.map(n => intero(n, 0))
  const patto = oggetto(riga)
  if (patto['slots'] === undefined) return []
  const quanti = intero(patto['slots'], 0)
  const quale = intero(patto['slotLevel'], 1)
  const out = Array(quale).fill(0)
  out[quale - 1] = quanti
  return out
}

/**
 * Quanti trucchetti e quanti incantesimi si portano, prima e dopo.
 * @param {unknown} rules
 * @param {Record<string, unknown>} s
 * @param {string} classId
 * @param {number} livello
 * @param {string[]} avvisi
 * @returns {{modo: string, trucchetti: {prima: number, dopo: number}, incantesimi: {prima: number|null, dopo: number|null}}}
 */
function contoIncantesimi(rules, s, classId, livello, avvisi) {
  const trucchetti = numeri(oggetto(leggi(rules, 'cantripsKnown'))[classId])
  const conta = oggetto(oggetto(leggi(rules, 'preparedSpells'))[classId])
  const modo = stringa(conta['mode']) || 'none'
  const tabella = numeri(conta['table'])

  /** @param {number} lv @returns {number|null} */
  const quanti = lv => {
    if (lv < 1) return 0
    if (tabella.length) return tabella[Math.min(lv, 20) - 1] ?? null
    if (stringa(conta['formula']) === 'mod+livello') {
      const ab = stringa(oggetto(oggetto(leggi(rules, 'classes'))[classId])['spellcastingAbility'])
      const mod = modificatore(s, ab)
      if (mod === null) return null
      return Math.max(1, mod + lv)
    }
    return null
  }

  const prima = quanti(livello - 1)
  const dopo = quanti(livello)
  if (dopo === null) {
    avvisi.push('Il pacchetto non sa dire quanti incantesimi si portano a questo livello: il numero va letto sul manuale.')
  }
  return {
    modo,
    trucchetti: {
      prima: trucchetti[Math.max(livello - 2, 0)] ?? 0,
      dopo: trucchetti[livello - 1] ?? 0,
    },
    incantesimi: { prima, dopo },
  }
}

/** @param {Record<string, unknown>} s @returns {number} */
function modificatoreCostituzione(s) {
  return modificatore(s, 'con') ?? 0
}

/**
 * Il modificatore di una caratteristica dello snapshot, bonus razziali inclusi.
 * @param {Record<string, unknown>} s
 * @param {string} ab
 * @returns {number|null}
 */
function modificatore(s, ab) {
  if (!ab) return null
  const base = oggetto(s['abilityScores'])[ab]
  if (typeof base !== 'number') return null
  return modifier(base + intero(oggetto(s['racialBonuses'])[ab], 0))
}

// ── letture difensive: lo snapshot arriva da fuori, e `rules` pure ─────────

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

/** @param {unknown} v @returns {number[]} */
function numeri(v) {
  return lista(v).filter(/** @returns {n is number} */ n => typeof n === 'number')
}

/** @param {unknown} v @returns {string} */
function stringa(v) {
  return typeof v === 'string' ? v : ''
}

/** @param {unknown} v @param {number} dflt @returns {number} */
function intero(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
}
