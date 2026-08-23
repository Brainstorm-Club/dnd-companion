/**
 * Dal builder all'app.  ── Lotto B ──
 *
 * Tre vie, un solo risultato: file JSON, testo incollato, link di condivisione
 * (`…/share/<base64url>`, formato compatto del builder).
 *
 * L'importatore è **tollerante ma esplicito**: campi mancanti diventano valori
 * di default e ogni supplenza finisce fra gli avvisi, che l'utente vede. Ciò
 * che non si può gestire — una variante senza pacchetto — non diventa un
 * import a metà: diventa un rifiuto con una frase che spiega (vedi `packs.js`).
 */

import { packForVariant, missingPackMessage } from './packs.js'
import { isEdition } from './edition.js'
import { ABILITIES, modifier } from './character.js'

/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {{ ok: true, entry: CharacterEntry, warnings: string[] }} ImportOk */
/** @typedef {{ ok: false, reason: 'variante-non-supportata'|'json-non-valido'|'troppo-grande'|'non-e-un-personaggio', message: string }} ImportKo */

/** Tetto sul testo accettato: uguale a quello del builder, per le stesse ragioni. */
export const MAX_INPUT_BYTES = 200_000
/** Tetto sui dati di un link di condivisione. */
export const MAX_SHARE_DATA_LENGTH = 20_000

/**
 * Le chiavi compatte del builder (`utils/shareCharacter.ts`), riscritte qui in
 * vanilla invece che importate: il builder è un altro repo, con un altro build
 * step, e questa tabella è un contratto di formato — non codice condiviso.
 *
 * È anche la **whitelist**: ciò che non compare qui non entra nello snapshot.
 * @type {Record<string, string>}
 */
export const COMPACT_KEYS = {
  variant: 'v',
  name: 'n',
  playerName: 'pn',
  race: 'r',
  subrace: 'sr',
  className: 'c',
  subclass: 'sc',
  level: 'lv',
  background: 'bg',
  alignment: 'al',
  abilityScores: 'as',
  racialBonuses: 'rb',
  skillProficiencies: 'sp',
  savingThrowProficiencies: 'st',
  hitDie: 'hd',
  maxHp: 'hp',
  armor: 'ar',
  shield: 'sh',
  weapons: 'wp',
  cantrips: 'ct',
  spellsKnown: 'sk',
  spellcastingAbility: 'sa',
  spellcastingClass: 'sx',
  equipment: 'eq',
  personalityTraits: 'pt',
  ideals: 'id',
  bonds: 'bo',
  flaws: 'fl',
  backstory: 'bs',
  age: 'ag',
  height: 'ht',
  weight: 'wt',
  eyes: 'ey',
  hair: 'hr',
  skin: 'sn',
  mark: 'mk',
  markSpirit: 'ms',
  virtue: 'vr',
  sin: 'si',
  humanity: 'hu',
  feat: 'fe',
  sessionNotes: 'nt',
  classes: 'cl',
  featuresTraits: 'ft',
  languages: 'lg',
  proficienciesOther: 'po',
  coins: 'co',
  currentHp: 'chp',
  speed: 'spd',
  size: 'sz',
  whacksLevel: 'wl',
  brawlingMoves: 'bm',
  misdeeds: 'md',
  spellsKnownLimit: 'skl',
}

/** chiave breve → chiave piena. */
const CHIAVI_INVERSE = /** @type {Record<string, string>} */ (
  Object.fromEntries(Object.entries(COMPACT_KEYS).map(([k, v]) => [v, k]))
)

/**
 * Chiavi che il formato compatto non trasporta (il builder le salta perché
 * ricostruibili o poco interessanti in un link) ma che lo snapshot pieno ha.
 * Elencate qui perché la normalizzazione accetti anche loro senza scartarle.
 */
const CHIAVI_EXTRA = ['id', 'experiencePoints', 'skillExpertise', 'spellsPrepared', 'tempHp', 'allies', 'treasure']

/** L'insieme di tutto ciò che può entrare in uno snapshot. */
const CHIAVI_AMMESSE = new Set([...Object.keys(COMPACT_KEYS), ...CHIAVI_EXTRA])

/** Chiavi che non devono mai finire in un oggetto, per nessuna via. */
const CHIAVI_VELENOSE = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * @param {string} testo  JSON esportato dal builder
 * @param {import('./packs.js').PackRegistry} registro
 * @param {'file'|'paste'} origine
 * @returns {ImportOk|ImportKo}
 */
export function fromJson(testo, registro, origine) {
  const troppo = oltreIlTetto(testo, MAX_INPUT_BYTES)
  if (troppo) return troppo

  let grezzo
  try {
    grezzo = parseSicuro(testo)
  } catch {
    return ko('json-non-valido', 'Questo testo non è JSON valido. Copia di nuovo l\'esportazione dal builder.')
  }
  return costruisci(grezzo, registro, origine)
}

/**
 * @param {string} url  link di condivisione del builder
 * @param {import('./packs.js').PackRegistry} registro
 * @returns {ImportOk|ImportKo}
 */
export function fromShareUrl(url, registro) {
  const troppo = oltreIlTetto(url, MAX_INPUT_BYTES)
  if (troppo) return troppo

  const dati = pezzoCondiviso(url)
  if (!dati) {
    return ko('non-e-un-personaggio', 'Questo link non contiene un personaggio: manca la parte dopo «/share/».')
  }
  if (dati.length > MAX_SHARE_DATA_LENGTH) {
    return ko('troppo-grande', 'Il link è più lungo di quanto l\'app accetti. Importa il JSON al posto suo.')
  }

  let grezzo
  try {
    grezzo = decodeShareData(dati)
  } catch {
    return ko('json-non-valido', 'Questo link non si lascia leggere: potrebbe essersi spezzato copiandolo.')
  }
  return costruisci(grezzo, registro, 'link')
}

/**
 * Decodifica il formato compatto del builder: base64url → chiavi brevi → chiavi
 * piene, con whitelist. Nessun `eval`, nessuna chiave che non conosciamo.
 * @param {string} encoded
 * @returns {Record<string, unknown>}
 */
export function decodeShareData(encoded) {
  if (encoded.length > MAX_SHARE_DATA_LENGTH) {
    throw new Error('dati del link oltre il massimo consentito')
  }
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const pieno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binario = atob(pieno)
  const bytes = Uint8Array.from(binario, ch => ch.charCodeAt(0))
  const json = new TextDecoder().decode(bytes)
  const compatto = parseSicuro(json)
  if (!oggettoSemplice(compatto)) throw new Error('formato del link non riconosciuto')

  /** @type {Record<string, unknown>} */
  const espanso = {}
  for (const [breve, valore] of Object.entries(compatto)) {
    const piena = CHIAVI_INVERSE[breve]
    // Whitelist: una chiave che non conosciamo non entra. Il link arriva da
    // fuori, e «fuori» include chi ha voglia di provarci.
    if (!piena || !CHIAVI_AMMESSE.has(piena)) continue
    espanso[piena] = valore
  }
  return espanso
}

// ── il cuore: da JSON grezzo a voce di libreria ───────────────────────────

/**
 * @param {unknown} grezzo
 * @param {import('./packs.js').PackRegistry} registro
 * @param {'file'|'paste'|'link'} origine
 * @returns {ImportOk|ImportKo}
 */
function costruisci(grezzo, registro, origine) {
  if (!oggettoSemplice(grezzo)) {
    return ko('non-e-un-personaggio', 'Questo file non contiene un personaggio: mi aspettavo un oggetto JSON.')
  }
  if (!sembraUnPersonaggio(grezzo)) {
    return ko('non-e-un-personaggio', 'Questo file non sembra un personaggio del builder: mancano i campi minimi (caratteristiche, classe, nome).')
  }

  const variante = testo(grezzo['variant'])
  if (!variante) {
    return ko('non-e-un-personaggio', 'Questo personaggio non dichiara con quale gioco è stato creato: senza quello non so quali regole applicargli.')
  }

  // Un pacchetto per variante, e lo decide il registro. È l'unico punto in cui
  // l'import può dire di no, ed è per garbo, non per errore.
  const pack = packForVariant(registro, variante)
  if (!pack) return ko('variante-non-supportata', missingPackMessage(variante))
  if (!isEdition(pack.edizione)) {
    return ko('variante-non-supportata', missingPackMessage(variante))
  }

  /** @type {string[]} */
  const warnings = []
  const snapshot = normalizza(grezzo, warnings)

  /** @type {CharacterEntry} */
  const entry = {
    snapshot: congela(snapshot),
    meta: {
      importedAt: new Date().toISOString(),
      source: origine,
      variant: variante,
      name: testo(snapshot['name']) || 'Senza nome',
      packId: pack.id,
      // L'edizione si deduce dal pacchetto: all'utente non si chiede niente.
      edition: pack.edizione,
    },
    play: statoIniziale(snapshot),
    levels: [],
  }
  return { ok: true, entry, warnings }
}

/**
 * Ripulisce e completa lo snapshot. Ogni supplenza lascia una frase negli
 * avvisi: un default silenzioso è un numero sbagliato che nessuno vede.
 * @param {Record<string, unknown>} grezzo
 * @param {string[]} warnings
 * @returns {Record<string, unknown>}
 */
function normalizza(grezzo, warnings) {
  /** @type {Record<string, unknown>} */
  const s = {}
  for (const [k, v] of Object.entries(grezzo)) {
    if (CHIAVI_VELENOSE.has(k)) continue
    if (CHIAVI_AMMESSE.has(k)) s[k] = v
  }

  s['id'] = testo(s['id']) || nuovoId()

  if (!testo(s['name'])) {
    s['name'] = 'Senza nome'
    warnings.push('Nome assente: il personaggio si chiama «Senza nome» finché non lo rinomini.')
  }

  const livello = numero(s['level'])
  if (livello === null || livello < 1) {
    s['level'] = 1
    warnings.push('Livello assente o fuori scala: impostato a 1.')
  } else {
    s['level'] = Math.min(Math.floor(livello), 20)
  }

  // Caratteristiche: se ne manca una si mette 10, e si dice quale.
  const punteggi = oggettoSemplice(s['abilityScores']) ? s['abilityScores'] : {}
  /** @type {Record<string, number>} */
  const puliti = {}
  /** @type {string[]} */
  const assenti = []
  for (const ab of ABILITIES) {
    const n = numero(punteggi[ab])
    if (n === null) { puliti[ab] = 10; assenti.push(NOMI_CARATTERISTICHE[ab] ?? ab) }
    else puliti[ab] = Math.floor(n)
  }
  s['abilityScores'] = puliti
  if (assenti.length) {
    warnings.push(`Caratteristiche assenti (${assenti.join(', ')}): impostate a 10.`)
  }

  const bonus = oggettoSemplice(s['racialBonuses']) ? s['racialBonuses'] : {}
  /** @type {Record<string, number>} */
  const bonusPuliti = {}
  for (const ab of ABILITIES) {
    const n = numero(bonus[ab])
    if (n !== null) bonusPuliti[ab] = Math.floor(n)
  }
  s['racialBonuses'] = bonusPuliti

  for (const k of ['skillProficiencies', 'skillExpertise', 'savingThrowProficiencies', 'languages',
    'proficienciesOther', 'equipment', 'featuresTraits', 'cantrips', 'spellsKnown', 'spellsPrepared',
    'brawlingMoves', 'classes', 'weapons']) {
    s[k] = Array.isArray(s[k]) ? s[k] : []
  }

  const dadoVita = numero(s['hitDie'])
  if (dadoVita === null || dadoVita <= 0) {
    s['hitDie'] = 8
    warnings.push('Dado vita assente: impostato a d8.')
  }

  const pfMax = numero(s['maxHp'])
  if (pfMax === null || pfMax <= 0) {
    s['maxHp'] = pfDaDadoVita(s)
    warnings.push('PF massimi assenti: calcolati da dado vita e Costituzione.')
  }

  const pfOra = numero(s['currentHp'])
  if (pfOra === null || pfOra < 0) {
    s['currentHp'] = s['maxHp']
    warnings.push('PF correnti assenti: il personaggio parte al massimo.')
  }
  if (numero(s['tempHp']) === null) s['tempHp'] = 0

  const velocita = numero(s['speed'])
  if (velocita === null || velocita <= 0) {
    s['speed'] = 30
    warnings.push('Velocità assente: impostata a 9 metri.')
  }

  const monete = oggettoSemplice(s['coins']) ? s['coins'] : null
  if (!monete) {
    s['coins'] = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
    warnings.push('Monete assenti: borsa a zero.')
  } else {
    /** @type {Record<string, number>} */
    const m = {}
    for (const k of ['cp', 'sp', 'ep', 'gp', 'pp']) m[k] = Math.max(0, Math.floor(numero(monete[k]) ?? 0))
    s['coins'] = m
  }

  if (numero(s['experiencePoints']) === null) s['experiencePoints'] = 0
  if (typeof s['shield'] !== 'boolean') s['shield'] = false

  // Un incantatore senza caratteristica da incantatore: CD e attacco magico
  // resteranno vuoti, ed è meglio dirlo che mostrare un numero inventato.
  const haMagia = lista(s['cantrips']).length + lista(s['spellsKnown']).length > 0
  if (haMagia && !ABILITIES.includes(/** @type {any} */ (testo(s['spellcastingAbility'])))) {
    warnings.push('Caratteristica da incantatore assente: CD e bonus d\'attacco magico non sono calcolabili.')
  }

  return s
}

/**
 * I PF di scorta, con la stessa formula del builder (media, non tiro): dado
 * pieno al 1°, media arrotondata per eccesso ai successivi, più Costituzione.
 * @param {Record<string, unknown>} s
 * @returns {number}
 */
function pfDaDadoVita(s) {
  const dado = numero(s['hitDie']) ?? 8
  const livello = Math.max(1, numero(s['level']) ?? 1)
  const punteggi = oggettoSemplice(s['abilityScores']) ? s['abilityScores'] : {}
  const bonus = oggettoSemplice(s['racialBonuses']) ? s['racialBonuses'] : {}
  const con = modifier((numero(punteggi['con']) ?? 10) + (numero(bonus['con']) ?? 0))
  const primo = dado + con
  const resto = (livello - 1) * (Math.floor(dado / 2) + 1 + con)
  return Math.max(primo + resto, 1)
}

/**
 * Lo stato di gioco al momento zero. Vive fuori dallo snapshot proprio perché
 * cambia: lo snapshot no.
 * @param {Record<string, unknown>} s
 * @returns {import('../storage.js').PlayState}
 */
function statoIniziale(s) {
  const max = numero(s['maxHp']) ?? 1
  const ora = numero(s['currentHp'])
  /** @type {Record<string, number>} */
  const monete = {}
  const c = oggettoSemplice(s['coins']) ? s['coins'] : {}
  for (const k of ['cp', 'sp', 'ep', 'gp', 'pp']) monete[k] = numero(c[k]) ?? 0
  return {
    hp: { cur: ora === null ? max : Math.min(ora, max), temp: numero(s['tempHp']) ?? 0 },
    hitDice: { spent: 0 },
    slots: {},
    conditions: [],
    inspiration: false,
    coins: monete,
    uses: {},
    xp: numero(s['experiencePoints']) ?? 0,
    deaths: { succ: 0, fail: 0 },
    notes: testo(s['sessionNotes']) || '',
  }
}

// ── attrezzi ──────────────────────────────────────────────────────────────

const NOMI_CARATTERISTICHE = /** @type {Record<string, string>} */ ({
  str: 'Forza', dex: 'Destrezza', con: 'Costituzione',
  int: 'Intelligenza', wis: 'Saggezza', cha: 'Carisma',
})

/**
 * Congela in profondità. È la regola numero uno del progetto resa eseguibile:
 * chi provasse a scrivere nello snapshot ottiene un errore, non un silenzio.
 * @template T
 * @param {T} valore
 * @returns {T}
 */
export function congela(valore) {
  if (valore && typeof valore === 'object' && !Object.isFrozen(valore)) {
    Object.freeze(valore)
    for (const v of Object.values(valore)) congela(v)
  }
  return valore
}

/**
 * `JSON.parse` con il reviver che butta via le chiavi velenose: un
 * `__proto__` in un file importato non deve poter toccare niente.
 * @param {string} testo
 * @returns {unknown}
 */
function parseSicuro(testo) {
  return JSON.parse(testo, function (chiave, valore) {
    if (CHIAVI_VELENOSE.has(chiave)) return undefined
    return valore
  })
}

/**
 * Il pezzo codificato di un link `…/share/<base64url>`. Accetta anche il solo
 * blocco codificato incollato da solo, e l'eventuale `#`/`?` in coda.
 * @param {string} url
 * @returns {string|null}
 */
function pezzoCondiviso(url) {
  const pulito = url.trim()
  if (!pulito) return null
  const m = /\/share\/([A-Za-z0-9_-]+)/.exec(pulito)
  if (m && m[1]) return m[1]
  // Nessun `/share/`: forse è già solo il blocco base64url.
  return /^[A-Za-z0-9_-]+$/.test(pulito) ? pulito : null
}

/**
 * @param {string} testo
 * @param {number} tetto
 * @returns {ImportKo|null}
 */
function oltreIlTetto(testo, tetto) {
  // Byte, non caratteri: un nome pieno di accenti pesa più di quanto sembri.
  const bytes = new TextEncoder().encode(testo).length
  if (bytes <= tetto) return null
  return ko('troppo-grande', `Questo file pesa ${Math.round(bytes / 1024)} KB: l'app ne accetta al massimo ${Math.round(tetto / 1024)}.`)
}

/** @param {ImportKo['reason']} reason @param {string} message @returns {ImportKo} */
function ko(reason, message) {
  return { ok: false, reason, message }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function oggettoSemplice(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Il minimo per dire «questo è un personaggio»: almeno uno dei campi che solo
 * una scheda ha. Non è validazione di schema, è un filtro contro il file
 * sbagliato trascinato per errore.
 * @param {Record<string, unknown>} v
 */
function sembraUnPersonaggio(v) {
  return oggettoSemplice(v['abilityScores']) || typeof v['className'] === 'string' || typeof v['level'] === 'number'
}

/** @param {unknown} v @returns {string} */
function testo(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** @param {unknown} v @returns {number|null} */
function numero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** @param {unknown} v @returns {unknown[]} */
function lista(v) {
  return Array.isArray(v) ? v : []
}

/** Un id nuovo, anche dove `crypto.randomUUID` non c'è. @returns {string} */
export function nuovoId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `pg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
