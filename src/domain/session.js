/**
 * Lo stato che cambia durante il gioco.  ── Lotto G ──
 *
 * Ogni funzione è pura: prende un `PlayState` e ne restituisce uno nuovo. Serve
 * a poter annullare («ho premuto riposo lungo per sbaglio») senza tenere una
 * seconda copia dello stato in giro.
 */

/** @typedef {import('../storage.js').PlayState} PlayState */

/**
 * La copia su cui lavorano tutte le funzioni di questo file.
 *
 * È la promessa in cima al file resa eseguibile: ogni struttura che qualcuno
 * potrebbe mutare viene rifatta, così chi tiene il vecchio stato — la vista,
 * per il tasto «annulla» — non se lo vede cambiare sotto le mani. Ricopiare
 * anche i campi che la funzione non tocca costa qualche microsecondo e toglie
 * una classe intera di difetti.
 *
 * Normalizza anche: uno stato arrivato da un import strano (`temp: null`) non
 * deve propagare `NaN` fino ai punti ferita.
 * @param {PlayState} play
 * @returns {PlayState}
 */
function copia(play) {
  /** @type {Record<string, {used: number}>} */
  const slots = {}
  for (const [k, v] of Object.entries(play.slots ?? {})) slots[k] = { used: Math.max(0, intero(v?.used)) }
  return {
    hp: { cur: intero(play.hp?.cur), temp: Math.max(0, intero(play.hp?.temp)) },
    hitDice: { spent: Math.max(0, intero(play.hitDice?.spent)) },
    slots,
    conditions: [...(play.conditions ?? [])],
    inspiration: play.inspiration === true,
    coins: { ...(play.coins ?? {}) },
    // Solo se c'era: un campo facoltativo che si materializza da solo farebbe
    // risultare «cambiato» uno stato che nessuno ha toccato.
    ...(play.oggetti ? { oggetti: [...play.oggetti] } : {}),
    uses: { ...(play.uses ?? {}) },
    xp: intero(play.xp),
    deaths: { succ: intero(play.deaths?.succ), fail: intero(play.deaths?.fail) },
    notes: typeof play.notes === 'string' ? play.notes : '',
  }
}

/** Le cinque monete, dalla più preziosa alla meno. */
export const MONETE = /** @type {const} */ (['pp', 'gp', 'ep', 'sp', 'cp'])

/** Un oggetto raccolto non può essere una riga vuota né un romanzo. */
export const MAX_OGGETTO = 120
/** Tetto sullo zaino: al tavolo si segna il bottino, non si tiene un magazzino. */
export const MAX_OGGETTI = 200

/**
 * Aggiunge un oggetto a quelli raccolti.
 *
 * L'equipaggiamento iniziale sta nello snapshot e non si tocca: quello che si
 * raccoglie giocando vive qui accanto, ed è l'unico che si può togliere. Le due
 * liste restano distinte perché sono due cose diverse — una dice da dove parte
 * il personaggio, l'altra cosa gli è successo.
 *
 * @param {PlayState} play
 * @param {string} testo
 * @returns {PlayState}
 */
export function aggiungiOggetto(play, testo) {
  const pulito = String(testo ?? '').trim().slice(0, MAX_OGGETTO)
  const out = copia(play)
  if (!pulito || (out.oggetti?.length ?? 0) >= MAX_OGGETTI) return out
  out.oggetti = [...(out.oggetti ?? []), pulito]
  return out
}

/**
 * Toglie l'oggetto in quella posizione. Fuori dai margini non fa niente:
 * un indice sbagliato non deve cancellare l'ultimo della lista.
 * @param {PlayState} play
 * @param {number} indice
 * @returns {PlayState}
 */
export function togliOggetto(play, indice) {
  const out = copia(play)
  const lista = out.oggetti ?? []
  if (!Number.isInteger(indice) || indice < 0 || indice >= lista.length) return out
  out.oggetti = lista.filter((_, i) => i !== indice)
  return out
}

/**
 * Aggiunge (o toglie, con delta negativo) monete di un taglio.
 *
 * Non converte fra tagli: chi cambia dieci argenti in un oro lo fa da sé,
 * perché le regole del cambio non sono le stesse a ogni tavolo.
 * @param {PlayState} play
 * @param {string} taglio
 * @param {number} delta
 * @returns {PlayState}
 */
export function cambiaMonete(play, taglio, delta) {
  const out = copia(play)
  if (!MONETE.includes(/** @type {any} */ (taglio))) return out
  const attuale = intero(out.coins?.[taglio])
  out.coins = { ...out.coins, [taglio]: Math.max(0, attuale + intero(delta)) }
  return out
}

/**
 * Il danno: prima i temporanei, poi i punti ferita, e mai sotto zero.
 *
 * `pfMax` serve solo a riportare dentro i limiti uno stato che ne fosse già
 * fuori (uno snapshot importato con `currentHp` più alto del massimo): il danno
 * non può far salire i punti ferita, ma non deve nemmeno lasciarli sopra il
 * tetto quando li tocca.
 * @param {PlayState} play @param {number} danno @param {number} pfMax @returns {PlayState}
 */
export function applyDamage(play, danno, pfMax) {
  const out = copia(play)
  const n = Math.max(0, intero(danno))
  if (n <= 0) return out
  const max = Math.max(0, intero(pfMax))
  const daiTemporanei = Math.min(out.hp.temp, n)
  out.hp.temp -= daiTemporanei
  const partenza = max > 0 ? Math.min(out.hp.cur, max) : out.hp.cur
  out.hp.cur = Math.max(0, partenza - (n - daiTemporanei))
  return out
}

/**
 * La cura: non supera i punti ferita massimi e **non** ripristina i temporanei
 * — quelli si ricevono da un effetto, non si curano.
 *
 * Chi risale sopra lo zero smette di essere morente: i tiri salvezza contro
 * morte si azzerano, come dice l'SRD. Al tavolo è la casella che tutti si
 * dimenticano di cancellare.
 * @param {PlayState} play @param {number} cura @param {number} pfMax @returns {PlayState}
 */
export function heal(play, cura, pfMax) {
  const out = copia(play)
  const n = Math.max(0, intero(cura))
  if (n <= 0) return out
  out.hp.cur = curaFinoA(out.hp.cur, n, pfMax)
  if (play.hp.cur <= 0 && out.hp.cur > 0) out.deaths = { succ: 0, fail: 0 }
  return out
}

/**
 * Consuma uno slot del livello indicato.
 *
 * «Non consuma uno slot che non c'è» ha un significato preciso con la forma di
 * `PlayState`: il tetto non è in `slots` (che tiene solo gli usati), quindi
 * l'unico «non c'è» che questa funzione può conoscere è **il livello assente**.
 * Chi disegna i pallini conosce il tetto — glielo dà `slotsMassimi()` — e non
 * offre il tap su uno slot già speso. Vedi il rapporto del lotto: è l'unica
 * ambiguità del contratto che non si risolve dentro la firma.
 * @param {PlayState} play
 * @param {number} livello
 * @param {number} [max]  quanti ne ha a quel livello: senza, non ne inventa
 * @returns {PlayState}
 */
export function useSlot(play, livello, max = 0) {
  const out = copia(play)
  const n = Math.trunc(livello)
  if (!Number.isFinite(n) || n < 1) return out
  const chiave = String(n)
  const tetto = Math.max(0, intero(max))
  const stato = out.slots[chiave]

  // Uno stato appena importato ha la mappa degli slot vuota: se ci si limita a
  // incrementare una voce che deve già esistere, il primo incantesimo della
  // partita non consuma niente, e non lo dice a nessuno. Ma la voce si crea
  // solo se a quel livello il personaggio gli slot ce li ha davvero — un mago
  // senza slot di 9° non deve ritrovarsene uno speso.
  if (!stato) {
    if (tetto <= 0) return out
    out.slots[chiave] = { used: 1 }
    return out
  }
  if (tetto > 0 && stato.used >= tetto) return out
  stato.used += 1
  return out
}

/**
 * L'inverso: un tap su uno slot già consumato lo restituisce. Serve perché al
 * tavolo si sbaglia pallino, non perché esista una regola che li ridà.
 * @param {PlayState} play @param {number} livello @returns {PlayState}
 */
export function restoreSlot(play, livello) {
  const out = copia(play)
  const stato = out.slots[String(Math.trunc(livello))]
  if (stato) stato.used = Math.max(0, stato.used - 1)
  return out
}

/**
 * Accende o spegne una condizione. L'id è quello del pacchetto regole
 * (`prone`, `frightened`): il nome italiano lo porta il pacchetto, non noi.
 * @param {PlayState} play @param {string} id @returns {PlayState}
 */
export function toggleCondition(play, id) {
  const out = copia(play)
  const i = out.conditions.indexOf(id)
  if (i >= 0) out.conditions.splice(i, 1)
  else out.conditions.push(id)
  return out
}

/**
 * L'unico modo consentito di cambiare a mano ciò che le funzioni qui sopra non
 * coprono: ispirazione, monete, temporanei, dadi vita spesi, tiri contro morte.
 * Copia, muta la copia, restituisce — l'immutabilità resta qui dentro invece di
 * essere ricopiata a mano in ogni gestore della vista.
 * @param {PlayState} play
 * @param {(p: PlayState) => void} muta
 * @returns {PlayState}
 */
export function modifica(play, muta) {
  const out = copia(play)
  muta(out)
  return out
}

/**
 * Riposo breve: si spendono dadi vita, si recuperano i privilegi che lo prevedono.
 *
 * I tiri arrivano da fuori — la funzione non tira, così i test sono
 * deterministici e il tiro può finire nello storico dei dadi come tutti gli
 * altri. `tiri` sono i punti ferita già calcolati per ciascun dado speso
 * (dado + modificatore di Costituzione), non i valori grezzi dei dadi.
 *
 * `pfMax` è facoltativo e non era nel contratto: senza, la cura di un riposo
 * breve non ha un tetto e supera i punti ferita massimi. È l'aggiunta minima
 * che rende la funzione giusta; chi non lo passa ottiene il comportamento di
 * prima. Vedi il rapporto del lotto.
 * @param {PlayState} play @param {{dadiSpesi: number, tiri: number[], pfMax?: number}} p @param {unknown} rules @returns {PlayState}
 */
export function shortRest(play, p, rules) {
  const out = copia(play)
  out.hitDice.spent += Math.max(0, intero(p?.dadiSpesi))
  const cura = lista(p?.tiri).reduce((/** @type {number} */ n, t) => n + Math.max(0, intero(t)), 0)
  if (cura > 0) {
    out.hp.cur = curaFinoA(out.hp.cur, cura, p?.pfMax ?? 0)
    if (play.hp.cur <= 0 && out.hp.cur > 0) out.deaths = { succ: 0, fail: 0 }
  }
  for (const id of recuperabili(rules, 'breve')) delete out.uses[id]
  return out
}

/**
 * Riposo lungo: PF pieni, metà dei dadi vita, slot pieni, usi azzerati.
 *
 * Metà **arrotondata per difetto e almeno uno**: al 1° livello la metà di un
 * dado è zero, e un riposo lungo che non restituisce niente non è un riposo.
 * I temporanei se ne vanno (durano fino al riposo lungo, non oltre) e i tiri
 * contro morte si azzerano insieme ai punti ferita.
 *
 * Le condizioni **non** si toccano: nessuna edizione le fa cadere tutte con un
 * riposo, e l'indebolimento scende di un grado — una regola che il pacchetto
 * non dichiara e che qui non si inventa.
 *
 * `rules` non serve — un riposo lungo azzera tutto e non ha bisogno di chiedere
 * cosa si recuperi — ma resta nella firma perché un pacchetto con le regole
 * «spartane» dirà che il riposo lungo non riempie gli slot, e sarà qui che lo
 * si leggerà.
 * @param {PlayState} play @param {{pfMax: number, dadiVitaTotali: number}} p @param {unknown} rules @returns {PlayState}
 */
export function longRest(play, p, rules) {
  const out = copia(play)
  out.hp.cur = Math.max(0, intero(p?.pfMax))
  out.hp.temp = 0
  const restituiti = Math.max(1, Math.floor(Math.max(0, intero(p?.dadiVitaTotali)) / 2))
  out.hitDice.spent = Math.max(0, out.hitDice.spent - restituiti)
  for (const k of Object.keys(out.slots)) {
    const s = out.slots[k]
    if (s) s.used = 0
  }
  out.uses = {}
  out.deaths = { succ: 0, fail: 0 }
  return out
}

/**
 * Quanti slot per livello ha il personaggio, secondo il pacchetto. L'indice 0
 * è il 1° livello.
 *
 * Il patto del warlock ha una forma sua nel pacchetto — pochi slot, tutti dello
 * stesso livello — e va tradotta nella stessa forma degli altri, altrimenti la
 * vista dovrebbe conoscere l'eccezione.
 *
 * Il multiclasse vero (un livello da incantatore combinato) non è qui: il
 * builder esporta una classe sola nella stragrande maggioranza dei casi, e
 * inventare una tabella che il pacchetto non porta sarebbe peggio che
 * mostrarne una prudente. Con più classi si prende il massimo per livello.
 * @param {unknown} rules
 * @param {Record<string, unknown>} snapshot
 * @returns {number[]}
 */
export function slotsMassimi(rules, snapshot) {
  const tabelle = oggetto(oggetto(rules)['spellSlots'])
  const classi = oggetto(oggetto(rules)['classes'])
  /** @type {number[]} */
  const out = []
  for (const v of vociDiClasse(snapshot)) {
    const tipo = oggetto(classi[v.classId])['casterType']
    if (typeof tipo !== 'string' || !tipo) continue
    const riga = lista(tabelle[tipo])[Math.min(Math.max(v.livello, 1), 20) - 1]
    rigaSlot(riga).forEach((n, i) => { out[i] = Math.max(out[i] ?? 0, n) })
  }
  return out
}

/**
 * Cosa il pacchetto dichiara recuperabile a un riposo.
 *
 * Due forme, in ordine: una lista esplicita (`rules.recupero.breve`), oppure il
 * campo `recupero` sul singolo privilegio (`"recupero": "breve"`). **Nessuno
 * dei due pacchetti SRD la porta ancora** — il generatore non estrae quel dato
 * dal PDF — quindi oggi un riposo breve non restituisce usi. È voluto: meglio
 * niente che una lista di privilegi indovinata da noi. Quando il pacchetto la
 * dichiarerà, questa funzione la leggerà senza che la vista cambi.
 * @param {unknown} rules
 * @param {'breve'|'lungo'} quando
 * @returns {Set<string>}
 */
function recuperabili(rules, quando) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const id of lista(oggetto(oggetto(rules)['recupero'])[quando])) {
    if (typeof id === 'string' && id) out.add(id)
  }
  if (out.size) return out
  for (const classe of Object.values(oggetto(oggetto(rules)['classes']))) {
    const c = oggetto(classe)
    const gruppi = [c['features'], ...Object.values(oggetto(c['subclasses'])).map(s => oggetto(s)['features'])]
    for (const g of gruppi) {
      for (const f of lista(g)) {
        const o = oggetto(f)
        const id = o['id']
        if (o['recupero'] === quando && typeof id === 'string' && id) out.add(id)
      }
    }
  }
  return out
}

// ── attrezzi ───────────────────────────────────────────────────────────────

/**
 * Curare non può far scendere i punti ferita: se lo stato è già oltre il tetto
 * — succede con uno snapshot importato a mano — una cura lo lascia dov'è.
 * `pfMax` a zero o assente significa «nessun tetto noto».
 * @param {number} cur @param {number} quanto @param {number} pfMax @returns {number}
 */
function curaFinoA(cur, quanto, pfMax) {
  const max = Math.max(0, intero(pfMax))
  if (max <= 0) return cur + quanto
  return Math.max(cur, Math.min(max, cur + quanto))
}

/**
 * Le classi del personaggio col loro livello. Uno snapshot monoclasse tiene
 * tutto nei campi in cima e ha `classes: []`: i due casi si appianano qui.
 * @param {Record<string, unknown>} s
 * @returns {Array<{classId: string, livello: number}>}
 */
function vociDiClasse(s) {
  const multi = lista(s['classes']).map(c => oggetto(c))
    .filter(o => typeof o['classId'] === 'string' && o['classId'])
    .map(o => ({ classId: String(o['classId']), livello: intero(o['level']) }))
  if (multi.length) return multi
  const id = s['className']
  return typeof id === 'string' && id
    ? [{ classId: id, livello: Math.max(1, intero(s['level'])) }]
    : []
}

/** @param {unknown} riga @returns {number[]} */
function rigaSlot(riga) {
  if (Array.isArray(riga)) return riga.map(n => Math.max(0, intero(n)))
  const patto = oggetto(riga)
  const quanti = Math.max(0, intero(patto['slots']))
  const quale = Math.max(1, intero(patto['slotLevel']))
  if (!quanti) return []
  /** @type {number[]} */
  const out = new Array(quale).fill(0)
  out[quale - 1] = quanti
  return out
}

/** @param {unknown} v @returns {number} */
function intero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
}

/** @param {unknown} v @returns {unknown[]} */
function lista(v) {
  return Array.isArray(v) ? v : []
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}
