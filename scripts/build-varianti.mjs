#!/usr/bin/env node
/**
 * Genera i pacchetti delle due varianti Acheron — Brancalonia e Apocalisse —
 * dal repo del builder:
 *
 *   node scripts/build-varianti.mjs [--builder ../../dnd-builder]
 *
 * Scrive `data/rules/brancalonia.json`, `data/rules/apocalisse.json`,
 * il compendio `data/spells/brancalonia/`, e aggiorna le due voci in
 * `data/packs.json` (le due voci SRD non si toccano).
 *
 * ── Il vincolo che decide tutto ────────────────────────────────────────────
 *
 * **Nessun testo di regole.** Brancalonia e Apocalisse non sono SRD e non sono
 * CC-BY: sono di Acheron Games, e il permesso di ripubblicarne il testo non
 * c'è. Escono quindi nomi, id, numeri e parole chiave — cioè quanto basta a
 * riconoscere il personaggio e a fare i conti — e **ogni campo descrittivo
 * esce `null`**: `description`, `descriptionEn`, `blurb`, `mechanicalEffect`,
 * `benefit`, `speakers`, `durata` delle regole di riposo, `testo` degli
 * incantesimi. Lo verifica `tests/unit/varianti-senza-testo.test.js`, con la
 * lista dei campi scritta a mano: se un giorno arriva il permesso e si
 * rigenera con i testi, quel test deve fallire e costringere a decidere.
 *
 * Restano fuori per lo stesso motivo: equipaggiamento iniziale e competenze in
 * strumenti dei background (sono frasi, non elenchi di id), i benefici dei
 * talenti, i testi dei privilegi, delle mosse da rissa, delle Virtù, dei
 * Peccati e degli Spiriti dei Marchi. Il pacchetto dice *che cosa* esiste e
 * *come si chiama*; *cosa fa* resta sul manuale.
 *
 * ── Cosa contiene un pacchetto di variante ─────────────────────────────────
 *
 * **Solo ciò che la variante aggiunge al D&D 2014.** Le due varianti poggiano
 * entrambe sul 5e 2014 (il builder lo dice esplicitamente: in
 * `src/data/index.ts` ogni variante che non sia `dnd2024` carica le condizioni,
 * le classi, gli slot e l'equipaggiamento del 2014), da cui `"base":
 * "srd-2014"`. Tabelle degli slot, condizioni, armature, soglie di PX,
 * privilegi delle dodici classi: non si copiano, si ereditano.
 *
 * Da cui una conseguenza sulla forma: una classe che la variante si limita ad
 * arricchire di sottoclassi esce **parziale** — solo `id` e `subclasses` — e
 * l'ereditarietà la fonde con quella del pacchetto base. Una classe nuova per
 * davvero (il Burattinaio) esce invece intera, nella stessa forma delle classi
 * SRD.
 *
 * ── Come si legge il builder ───────────────────────────────────────────────
 *
 * Il builder è TypeScript e resta **di sola lettura**: si transpila in memoria
 * con il `typescript` che è già una devDependency di questo repo e si importa
 * il risultato come modulo `data:`. È lo stesso meccanismo di
 * `build-rules.mjs`, per la stessa ragione: nessuna copia, nessun bundler,
 * nessun file scritto nel repo altrui.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const QUI = dirname(fileURLToPath(import.meta.url))
const RADICE = resolve(QUI, '..')

// ── Argomenti ──────────────────────────────────────────────────────────────

/** @param {string[]} argv @returns {Record<string, string>} */
function argomenti(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (typeof a === 'string' && a.startsWith('--')) {
      const v = argv[i + 1]
      out[a.slice(2)] = typeof v === 'string' && !v.startsWith('--') ? (i++, v) : 'true'
    }
  }
  return out
}

const ARG = argomenti(process.argv.slice(2))
const BUILDER = resolve(RADICE, ARG['builder'] ?? '../../dnd-builder')
const USCITA_REGOLE = resolve(RADICE, ARG['out'] ?? 'data/rules')
const USCITA_SPELLS = resolve(RADICE, 'data/spells')
const REGISTRO = resolve(RADICE, 'data/packs.json')

// ── Il builder è TypeScript: lo si transpila, non lo si compila ─────────────

/** @type {Map<string, string>} */
const moduliCaricati = new Map()

/** @param {string} percorso @returns {Promise<string>} */
async function urlDati(percorso) {
  const gia = moduliCaricati.get(percorso)
  if (gia) return gia
  const file = ['', '.ts', '/index.ts'].map(s => percorso + s).find(p => existsSync(p) && !p.endsWith('/'))
  if (!file) throw new Error(`modulo del builder non trovato: ${percorso}`)
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  let codice = outputText
  for (const m of [...outputText.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
    const spec = m[1] ?? ''
    if (!spec.startsWith('.')) throw new Error(`${file}: import non relativo «${spec}», non so risolverlo`)
    codice = codice.replace(m[0], `from '${await urlDati(resolve(dirname(file), spec))}'`)
  }
  // In base64 e non in percent-encoding: un URL percent-encoded contiene
  // apostrofi, e un modulo che ne importa un altro se lo ritroverebbe dentro
  // la stringa dell'import, spezzandola.
  const url = 'data:text/javascript;base64,' + Buffer.from(codice, 'utf8').toString('base64')
  moduliCaricati.set(percorso, url)
  return url
}

/** @param {string} rel percorso dentro `src/` del builder @returns {Promise<Record<string, any>>} */
async function caricaTs(rel) {
  return await import(await urlDati(join(BUILDER, 'src', rel)))
}

// ── Utilità ────────────────────────────────────────────────────────────────

/** Ordine canonico: alfabetico, e basta. */
const per = /** @param {string} a @param {string} b */ (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** @param {string} v @returns {string} */
function slug(v) {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Quante volte si è dovuto ripiegare sul nome inglese. @type {string[]} */
const senzaItaliano = []

/**
 * I pochi termini **generici** che il builder non traduce e che non sono di
 * Acheron: i tagli di moneta e i due riposi sono vocabolario D&D, e lasciarli
 * in inglese in un pacchetto italiano è solo un buco. Tutto ciò che invece è
 * un nome proprio dell'ambientazione — un privilegio di background, una
 * Emeriticenza — resta in inglese e finisce nel rapporto: inventarne la
 * traduzione sarebbe peggio che non averla.
 * @type {Record<string, string>}
 */
const TERMINI_GENERICI = {
  'Copper Piece': 'Moneta di rame',
  'Silver Piece': 'Moneta d\'argento',
  'Iron Piece': 'Moneta di ferro',
  'Gold Piece': 'Moneta d\'oro',
  'Short Rest': 'Riposo breve',
  'Long Rest (Rollicking)': 'Riposo lungo',
}

/**
 * Il nome italiano, o quello inglese se il builder non ce l'ha. Il ripiego si
 * annota: un pacchetto metà in inglese va visto, non subito.
 * @param {Record<string, string>|undefined} mappa
 * @param {string} chiave
 * @param {string} ripiego
 * @param {string} dove
 * @returns {string}
 */
function nomeIt(mappa, chiave, ripiego, dove) {
  const v = mappa?.[chiave] ?? TERMINI_GENERICI[chiave]
  if (v) return v
  senzaItaliano.push(`${dove}: ${chiave}`)
  return ripiego
}

/**
 * JSON con le chiavi in ordine, sempre: senza questo «rigenerare non produce
 * diff» dipenderebbe dall'ordine di inserzione, che è un dettaglio.
 * @param {unknown} v @returns {unknown}
 */
function ordina(v) {
  if (Array.isArray(v)) return v.map(ordina)
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const k of Object.keys(/** @type {Record<string, unknown>} */ (v)).sort(per)) {
      out[k] = ordina(/** @type {Record<string, unknown>} */ (v)[k])
    }
    return out
  }
  return v
}

/**
 * La data del commit del builder, non l'ora di adesso: `generatedAt` dice *da
 * cosa* è stato generato il pacchetto, e tenendolo agganciato alla sorgente la
 * rigenerazione resta byte per byte identica.
 * @returns {{commit: string, at: string}}
 */
function sorgente() {
  try {
    const opz = { cwd: BUILDER, encoding: /** @type {const} */ ('utf8') }
    return {
      commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], opz).trim(),
      at: execFileSync('git', ['log', '-1', '--format=%cI'], opz).trim(),
    }
  } catch {
    return { commit: 'sconosciuto', at: '1970-01-01T00:00:00Z' }
  }
}

// ── Costruzione: classi, razze, background, talenti ─────────────────────────

/**
 * Un privilegio. `nameEn` resta perché è l'unico ponte con gli snapshot del
 * builder, che elencano i privilegi con il nome — non con l'id.
 * @param {any} f
 * @param {{perId: Record<string, string>, perNome: Record<string, string>}} nomi
 * @param {string} dove
 * @returns {{id: string, level: number, name: string, nameEn: string, description: null}}
 */
function privilegio(f, nomi, dove) {
  return {
    id: String(f.id),
    level: Number(f.level),
    // Il builder tiene i nomi dei privilegi di variante per id, ma quelli
    // comuni a tutte le classi (l'aumento dei punteggi) stanno nella tabella
    // generale, che e' per nome inglese: si guarda in tutte e due.
    name: nomi.perId[f.id] ?? nomeIt(nomi.perNome, String(f.name), String(f.name), `${dove}/privilegio`),
    nameEn: String(f.name),
    description: null,
  }
}

/**
 * Le classi. Quelle che la variante si limita ad arricchire escono parziali —
 * `id` e `subclasses` — perché tutto il resto lo eredita dal pacchetto base.
 * @param {readonly any[]} sottoclassi
 * @param {{perId: Record<string, string>, perNome: Record<string, string>}} nomiPrivilegio
 * @param {any|null} classeNuova   il Burattinaio, o null
 * @param {Record<string, string>} nomiClasse
 * @param {string} variante
 * @returns {Record<string, any>}
 */
function costruisciClassi(sottoclassi, nomiPrivilegio, classeNuova, nomiClasse, variante) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const s of [...sottoclassi].sort((a, b) => per(a.parentClassId, b.parentClassId) || per(a.id, b.id))) {
    const padre = String(s.parentClassId)
    const classe = out[padre] ?? (out[padre] = { id: padre, subclasses: {} })
    classe.subclasses[s.id] = {
      id: String(s.id),
      // Le sottoclassi delle varianti portano già il nome italiano addosso:
      // `nameOriginal` è l'originale del manuale, `name` la sua traduzione.
      name: s.nameOriginal ? String(s.nameOriginal) : String(s.name),
      nameEn: String(s.name),
      features: s.features
        .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${padre}/${s.id}`))
        .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
    }
  }
  if (classeNuova) {
    /** @type {Record<string, any>} */
    const sotto = {}
    for (const s of [...(classeNuova.subclasses ?? [])].sort((a, b) => per(a.id, b.id))) {
      sotto[s.id] = {
        id: String(s.id),
        name: String(s.name),
        nameEn: String(s.name),
        features: s.features
          .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${classeNuova.id}/${s.id}`))
          .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
      }
    }
    out[classeNuova.id] = {
      id: String(classeNuova.id),
      name: nomeIt(nomiClasse, String(classeNuova.id), String(classeNuova.name), `${variante}/classe`),
      nameEn: String(classeNuova.name),
      hitDie: Number(classeNuova.hitDie),
      savingThrows: [...classeNuova.savingThrows],
      subclassLevel: Number(classeNuova.subclassLevel),
      subclassName: String(classeNuova.subclassName),
      casterType: classeNuova.spellcasting?.casterType ?? null,
      spellcastingAbility: classeNuova.spellcasting?.ability ?? null,
      asiLevels: classeNuova.features
        .filter(/** @param {any} f */ f => /^Ability Score Improvement/i.test(f.name))
        .map(/** @param {any} f @returns {number} */ f => Number(f.level))
        .sort(/** @param {number} a @param {number} b */ (a, b) => a - b),
      epicBoonLevel: null,
      weaponMastery: null,
      features: classeNuova.features
        .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${classeNuova.id}`))
        .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
      subclasses: sotto,
    }
  }
  return out
}

/**
 * Le razze con i loro tratti, nella forma dei pacchetti SRD. Il builder tiene
 * i tratti come soli id e i nomi italiani in `traitNamesIt`; il testo lo ha,
 * ma è testo di regole e non esce.
 * @param {readonly any[]} razze
 * @param {Record<string, string>} nomiSottorazza
 * @param {Record<string, string>} nomiTratto
 * @param {string} variante
 * @returns {Record<string, any>}
 */
function costruisciRazze(razze, nomiSottorazza, nomiTratto, variante) {
  /** @param {any} id @returns {{id: string, name: string, nameEn: string, description: null}} */
  const tratto = id => ({
    id: String(id),
    name: nomeIt(nomiTratto, String(id), leggibile(String(id)), `${variante}/tratto`),
    nameEn: leggibile(String(id)),
    description: null,
  })
  /** @type {Record<string, any>} */
  const out = {}
  for (const r of [...razze].sort((a, b) => per(a.id, b.id))) {
    /** @type {Record<string, any>} */
    const sottorazze = {}
    for (const s of [...(r.subraces ?? [])].sort((a, b) => per(a.id, b.id))) {
      sottorazze[s.id] = {
        id: String(s.id),
        name: s.nameOriginal ? String(s.nameOriginal)
          : nomeIt(nomiSottorazza, String(s.name), String(s.name), `${variante}/sottorazza`),
        nameEn: String(s.name),
        traits: [...(s.traits ?? [])].sort(per).map(tratto),
      }
    }
    out[r.id] = {
      id: String(r.id),
      name: r.nameOriginal ? String(r.nameOriginal) : String(r.name),
      nameEn: String(r.name),
      traits: [...(r.traits ?? [])].sort(per).map(tratto),
      subraces: sottorazze,
    }
  }
  return out
}

/**
 * I background. Restano fuori equipaggiamento e competenze in strumenti: nel
 * builder sono frasi («una borsa con 15 ma»), non elenchi di id, e una frase è
 * testo. `skillProficiencies` invece sono chiavi, e passano.
 * @param {readonly any[]} background
 * @param {Record<string, string>} nomiPrivilegio
 * @param {string} variante
 * @returns {Record<string, any>}
 */
function costruisciBackground(background, nomiPrivilegio, variante) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const b of [...background].sort((a, b) => per(a.id, b.id))) {
    const f = b.feature
    out[b.id] = {
      id: String(b.id),
      name: b.nameOriginal ? String(b.nameOriginal) : String(b.name),
      nameEn: String(b.name),
      skillProficiencies: [...(b.skillProficiencies ?? [])].sort(per),
      features: f ? [{
        id: slug(String(f.name)),
        name: nomeIt(nomiPrivilegio, String(f.name), String(f.name), `${variante}/background`),
        nameEn: String(f.name),
        description: null,
        descriptionEn: null,
      }] : [],
    }
  }
  return out
}

/**
 * I talenti. `benefits` è l'elenco di cosa fanno: è testo di regole e non esce.
 * @param {readonly any[]} talenti
 * @returns {Record<string, any>}
 */
function costruisciTalenti(talenti) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const t of [...talenti].sort((a, b) => per(a.id, b.id))) {
    out[t.id] = {
      id: String(t.id),
      name: t.nameOriginal ? String(t.nameOriginal) : String(t.name),
      nameEn: String(t.name),
      description: null,
    }
  }
  return out
}

/**
 * Gli id che la variante riusa da un pacchetto base, cioè le **ridefinizioni
 * volute**. Una collisione di id non è di per sé un guasto — l'Umano di
 * Brancalonia si chiama `human` come quello SRD e ne prende il posto apposta —
 * ma deve essere dichiarata, altrimenti è indistinguibile da una svista.
 * Si calcola confrontando i due pacchetti, invece di scriverla a mano: una
 * lista scritta a mano invecchia al primo id nuovo.
 *
 * @param {Record<string, any>} pacchetto
 * @param {Record<string, any>} base
 * @returns {Record<string, string[]>}
 */
function ridefinizioni(pacchetto, base) {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const sezione of ['races', 'backgrounds', 'talenti']) {
    const comuni = Object.keys(pacchetto[sezione] ?? {}).filter(k => base[sezione]?.[k]).sort(per)
    if (comuni.length) out[sezione] = comuni
  }
  /** @type {string[]} */
  const sottoclassi = []
  for (const [idClasse, classe] of Object.entries(pacchetto['classes'] ?? {})) {
    for (const idSotto of Object.keys(classe.subclasses ?? {})) {
      if (base['classes']?.[idClasse]?.subclasses?.[idSotto]) sottoclassi.push(`${idClasse}/${idSotto}`)
    }
  }
  if (sottoclassi.length) out['subclasses'] = sottoclassi.sort(per)
  return out
}

/** `draconic-ancestry` → `Draconic Ancestry`. Ripiego, non traduzione. @param {string} v */
function leggibile(v) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return v
  return v.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

// ── Il compendio delle varianti ────────────────────────────────────────────

/** @type {Record<string, string>} */
const SCUOLE = {
  Abjuration: 'Abiurazione', Conjuration: 'Evocazione', Divination: 'Divinazione',
  Enchantment: 'Ammaliamento', Evocation: 'Invocazione', Illusion: 'Illusione',
  Necromancy: 'Necromanzia', Transmutation: 'Trasmutazione',
}

/** @type {Record<string, string>} */
const CLASSI_INCANTATRICI = {
  bard: 'bardo', cleric: 'chierico', druid: 'druido', paladin: 'paladino',
  ranger: 'ranger', sorcerer: 'stregone', warlock: 'warlock', wizard: 'mago',
}

/** @type {Record<string, string>} */
const TEMPI = {
  '1 action': '1 azione', '1 bonus action': '1 azione bonus', '1 minute': '1 minuto',
  '1 hour': '1 ora', '10 minutes': '10 minuti', '12 hours': '12 ore',
  '8 hours': '8 ore', '24 hours': '24 ore',
}

/** @type {Record<string, string>} */
const DURATE = {
  Instantaneous: 'Istantanea', 'Until dispelled': 'Finché non viene dissolto',
  '1 round': '1 round', '1 minute': '1 minuto', '10 minutes': '10 minuti',
  '1 hour': '1 ora', '8 hours': '8 ore', '24 hours': '24 ore',
  '10 days': '10 giorni', '30 days': '30 giorni', Special: 'Speciale',
}

/**
 * Piedi → metri con la scala del manuale italiano (5 ft = 1,5 m), che non è la
 * conversione esatta ma è quella stampata: un incantesimo con gittata «27
 * metri» accanto a uno SRD con «27 metri» deve leggere uguale.
 * @param {string} g @returns {string}
 */
function gittataIt(g) {
  if (g === 'Touch') return 'Contatto'
  if (g === 'Self') return 'Incantatore'
  if (g === 'Sight') return 'Vista'
  if (g === 'Unlimited') return 'Illimitata'
  if (g === 'Special') return 'Speciale'
  const m = /^(\d+) (?:feet|foot)$/.exec(g)
  if (m) {
    const metri = (Number(m[1]) / 5) * 1.5
    return `${Number.isInteger(metri) ? metri : String(metri).replace('.', ',')} metri`
  }
  const km = /^(\d+) miles?$/.exec(g)
  if (km) return `${(Number(km[1]) * 1.5).toString().replace('.', ',')} km`
  throw new Error(`gittata che non so tradurre: «${g}»`)
}

/** @param {string} t @returns {string} */
function tempoIt(t) {
  // Il trigger di una reazione («when you see a creature make a saving throw»)
  // è testo di regole: resta «1 reazione» e il resto sta sul manuale.
  if (/^1 reaction/.test(t)) return '1 reazione'
  const v = TEMPI[t]
  if (!v) throw new Error(`tempo di lancio che non so tradurre: «${t}»`)
  return v
}

/** @param {string} d @returns {string} */
function durataIt(d) {
  const conc = /^Concentration, up to (.+)$/.exec(d)
  if (conc) {
    const resto = DURATE[conc[1] ?? '']
    if (!resto) throw new Error(`durata che non so tradurre: «${d}»`)
    return `Concentrazione, fino a ${resto}`
  }
  const v = DURATE[d]
  if (!v) throw new Error(`durata che non so tradurre: «${d}»`)
  return v
}

/**
 * Le componenti. Le lettere V/S/M sono le stesse in italiano; la parentesi che
 * elenca il materiale è una frase del manuale, e si taglia.
 * @param {string} c @returns {string}
 */
function componentiIt(c) {
  return c.replace(/\s*\([^)]*\)/g, '').trim()
}

/**
 * Da quale volume viene ogni incantesimo. Il builder lo dice nei commenti di
 * sezione di `spells.ts` (`// ═══ Macaronicon ═══`), ed è l'unico posto dove
 * l'informazione esiste: `fonte` deve dire da dove viene il nome, quindi la si
 * legge di lì invece di inventarla.
 * @returns {Map<string, string>} id dell'incantesimo → volume
 */
function fontiDegliIncantesimi() {
  const file = join(BUILDER, 'src/data/brancalonia/spells.ts')
  const righe = readFileSync(file, 'utf8').split('\n')
  /** @type {Map<string, string>} */
  const out = new Map()
  let volume = ''
  for (const r of righe) {
    const sezione = /^\s*\/\/\s*═+\s*(.+?)\s*═+\s*$/.exec(r)
    if (sezione) { volume = (sezione[1] ?? '').trim(); continue }
    const id = /^\s*id:\s*'([^']+)'/.exec(r)
    if (id && volume) out.set(id[1] ?? '', volume)
  }
  if (!out.size) throw new Error('nessuna sezione di provenienza trovata in brancalonia/spells.ts')
  return out
}

/**
 * Il compendio di una variante, nella forma di quello SRD: un indice sempre
 * vivo e dieci blocchi di testo. I blocchi vuoti si scrivono lo stesso — sono
 * tre byte l'uno, e chi sovrappone le cartelle di una catena di pacchetti
 * chiede `l0…l9` senza sapere quali esistono.
 *
 * @param {readonly any[]} incantesimi
 * @param {Record<string, string>} nomiIncantesimo
 * @param {Map<string, string>} volumi
 * @param {string} etichettaFonte
 * @returns {{indice: any[], blocchi: any[][], ponte: Record<string, string>}}
 */
function costruisciCompendio(incantesimi, nomiIncantesimo, volumi, etichettaFonte) {
  /** @type {any[]} */
  const indice = []
  /** @type {any[][]} */
  const blocchi = Array.from({ length: 10 }, () => [])
  /** @type {Record<string, string>} */
  const ponte = {}
  for (const s of [...incantesimi].sort((a, b) => a.level - b.level || per(a.name, b.name))) {
    const nome = nomeIt(nomiIncantesimo, String(s.name), String(s.name), 'brancalonia/incantesimo')
    const id = slug(nome)
    const scuola = SCUOLE[s.school]
    if (!scuola) throw new Error(`scuola sconosciuta: «${s.school}»`)
    const durata = durataIt(String(s.duration))
    const voce = {
      id,
      nome,
      livello: Number(s.level),
      scuola,
      classi: [...s.classes].map(/** @param {string} c */ c => {
        const v = CLASSI_INCANTATRICI[c]
        if (!v) throw new Error(`classe incantatrice sconosciuta: «${c}»`)
        return v
      }).sort(per),
      rituale: !!s.ritual,
      concentrazione: /^Concentrazione/.test(durata),
      // `differisce` confronta le due edizioni dell'SRD: per un incantesimo che
      // esiste solo qui non c'è niente da confrontare.
      differisce: false,
      cambiamenti: [],
    }
    indice.push(voce)
    const volume = volumi.get(String(s.id))
    ;(blocchi[Number(s.level)] ?? []).push({
      ...voce,
      tempoDiLancio: tempoIt(String(s.castingTime)),
      gittata: gittataIt(String(s.range)),
      componenti: componentiIt(String(s.components)),
      durata,
      testo: null,
      edizione: '2014',
      fonte: volume ? `${etichettaFonte} — ${volume}` : etichettaFonte,
    })
    ponte[String(s.id)] = id
  }
  indice.sort((a, b) => a.livello - b.livello || per(a.id, b.id))
  for (const b of blocchi) b.sort((x, y) => per(x.id, y.id))
  return { indice, blocchi, ponte }
}

// ── Il registro ────────────────────────────────────────────────────────────

/**
 * Aggiorna (o inserisce) le due voci di variante in `data/packs.json` senza
 * toccare le due SRD. `kb` è il peso vero appena misurato: un peso dichiarato a
 * mano invecchia al primo rigeneramento, e serve proprio a decidere se
 * scaricare.
 * @param {Array<Record<string, unknown>>} voci
 */
function aggiornaRegistro(voci) {
  const registro = JSON.parse(readFileSync(REGISTRO, 'utf8'))
  for (const voce of voci) {
    const i = registro.packs.findIndex(/** @param {any} p */ p => p.id === voce['id'])
    if (i >= 0) registro.packs[i] = voce
    else registro.packs.push(voce)
  }
  writeFileSync(REGISTRO, JSON.stringify(registro, null, 2) + '\n')
}

// ── Il lavoro ──────────────────────────────────────────────────────────────

async function main() {
  const src = sorgente()
  const termini = await caricaTs('i18n/gameTerms.ts')

  const bClassi = await caricaTs('data/brancalonia/classes.ts')
  const bClassiIt = await caricaTs('data/brancalonia/classes-it.ts')
  const bBurattinaio = await caricaTs('data/brancalonia/burattinaio.ts')
  const bRazze = await caricaTs('data/brancalonia/races.ts')
  const bBackground = await caricaTs('data/brancalonia/backgrounds.ts')
  const bTalenti = await caricaTs('data/brancalonia/feats.ts')
  const bRegole = await caricaTs('data/brancalonia/rules.ts')
  const bRisse = await caricaTs('data/brancalonia/brawl.ts')
  const bSpells = await caricaTs('data/brancalonia/spells.ts')

  const aClassi = await caricaTs('data/apocalisse/classes.ts')
  const aClassiIt = await caricaTs('data/apocalisse/classes-it.ts')
  const aRazze = await caricaTs('data/apocalisse/races.ts')
  const aBackground = await caricaTs('data/apocalisse/backgrounds.ts')
  const aRegole = await caricaTs('data/apocalisse/rules.ts')

  const nomiTratto = termini['traitNamesIt']
  const nomiSottorazza = termini['subraceNamesIt']
  const nomiPrivilegio = termini['featureNamesIt']
  const nomiLingua = termini['languageNamesIt']

  // ── Brancalonia ───────────────────────────────────────────────────────────

  const regoleB = bRegole['brancaloniaRules']

  /** @param {any} v @param {string} dove @returns {{id: string, nome: string, nomeEn: string}} */
  const voceRissa = (v, dove) => ({
    id: String(v.id ?? slug(String(v.name))),
    nome: v.nameOriginal ? String(v.nameOriginal) : nomeIt(nomiPrivilegio, String(v.name), String(v.name), dove),
    nomeEn: String(v.name),
  })

  const brancalonia = {
    variante: 'brancalonia',
    edizione: '2014',
    base: 'srd-2014',
    fonte: 'Brancalonia (Acheron Games)',
    generatedAt: src.at,
    sourceCommit: src.commit,
    livelloMassimo: Number(regoleB.maxLevel),
    classes: costruisciClassi(
      bClassi['brancaloniaSubclasses'],
      { perId: bClassiIt['brancaloniaFeatureNamesIt'], perNome: nomiPrivilegio },
      bBurattinaio['burattinaioBrancaloniaClass'],
      termini['brancaloniaClassNamesIt'],
      'brancalonia',
    ),
    races: costruisciRazze(bRazze['brancaloniaRaces'], nomiSottorazza, nomiTratto, 'brancalonia'),
    backgrounds: costruisciBackground(bBackground['brancaloniaBackgrounds'], nomiPrivilegio, 'brancalonia'),
    talenti: costruisciTalenti(bTalenti['brancaloniaFeats']),
    monete: {
      standard: String(regoleB.currencyStandard),
      elenco: regoleB.currencies.map(/** @param {any} c */ c => ({
        sigla: String(c.abbreviation),
        nome: nomeIt(termini['equipmentNamesIt'], String(c.name), String(c.name), 'brancalonia/moneta'),
        nomeEn: String(c.name),
        valoreInArgento: Number(c.valueInSilver),
      })),
    },
    batoste: regoleB.whacksLevels.map(/** @param {any} w */ w => ({
      livello: Number(w.level),
      nome: nomeIt(nomiPrivilegio, String(w.name), String(w.name), 'brancalonia/batosta'),
      nomeEn: String(w.name),
      descrizione: null,
      effetto: null,
    })),
    equipaggiamentoScadente: regoleB.shoddyEquipment.map(/** @param {any} s */ s => ({
      id: String(s.condition),
      descrizione: null,
      effetto: null,
    })),
    riposi: regoleB.restRules.map(/** @param {any} r */ r => ({
      tipo: String(r.type),
      nome: nomeIt(nomiPrivilegio, String(r.name), String(r.name), 'brancalonia/riposo'),
      nomeEn: String(r.name),
      // «1 week of rollicking» è una frase del manuale, non un numero: esce
      // null come tutto il resto del testo.
      durata: null,
      descrizione: null,
    })),
    lingue: regoleB.languages.map(/** @param {any} l */ l => ({
      id: String(l.id),
      nome: nomeIt(nomiLingua, String(l.name), String(l.name), 'brancalonia/lingua'),
      nomeEn: String(l.name),
      descrizione: null,
      parlanti: null,
    })),
    risse: {
      progressione: bRisse['brawlFeatures'].map(/** @param {any} f */ f => ({
        livello: Number(f.level),
        slotMossa: Number(f.moveSlots),
        // `feature` e `featureOriginal` sono la riga della tabella per esteso,
        // parentesi esplicativa compresa: è testo, e non esce.
        privilegio: null,
      })),
      mosse: bRisse['brawlMoves'].map(/** @param {any} m */ m => ({
        ...voceRissa(m, 'brancalonia/mossa'),
        genere: String(m.kind),
        costo: String(m.cost),
        caratteristiche: [...(m.abilities ?? [])],
        descrizione: null,
      })),
      mosseDiClasse: bRisse['brawlClassFeatures'].map(/** @param {any} m */ m => ({
        ...voceRissa(m, 'brancalonia/mossa-di-classe'),
        classi: [...m.classes].sort(per),
        descrizione: null,
      })),
      assi: bRisse['brawlAces'].map(/** @param {any} m */ m => ({
        ...voceRissa(m, 'brancalonia/asso'),
        classi: [...m.classes].sort(per),
        descrizione: null,
      })),
    },
    avanzamentoOltreIlMassimo: {
      descrizione: null,
      opzioni: bRegole['postLevelAdvancement'].options.map(/** @param {string} o */ o => {
        const nomeEn = (o.split(':')[0] ?? o).trim()
        return {
          id: slug(nomeEn),
          nome: nomeIt(nomiPrivilegio, nomeEn, nomeEn, 'brancalonia/emeriticenza'),
          nomeEn,
          descrizione: null,
        }
      }),
    },
  }

  // ── Apocalisse ────────────────────────────────────────────────────────────

  const regoleA = aRegole['apocalisseRules']

  const apocalisse = {
    variante: 'apocalisse',
    edizione: '2014',
    base: 'srd-2014',
    fonte: 'Apocalisse (Acheron Games)',
    generatedAt: src.at,
    sourceCommit: src.commit,
    livelloMassimo: Number(regoleA.maxLevel),
    classes: costruisciClassi(
      aClassi['apocalisseSubclasses'],
      { perId: aClassiIt['apocalisseFeatureNamesIt'], perNome: nomiPrivilegio },
      null,
      termini['apocalisseClassNamesIt'],
      'apocalisse',
    ),
    races: costruisciRazze(aRazze['apocalisseRaces'], nomiSottorazza, nomiTratto, 'apocalisse'),
    backgrounds: costruisciBackground(aBackground['apocalisseBackgrounds'], nomiPrivilegio, 'apocalisse'),
    umanita: {
      iniziale: Number(regoleA.humanityStarting),
      minima: Number(regoleA.humanityMin),
    },
    dadoDelMarchio: regoleA.markDiceProgression.map(/** @param {any} p */ p => ({
      da: Number(p.levelRange[0]),
      a: Number(p.levelRange[1]),
      dado: String(p.die),
    })),
    virtu: regoleA.virtues.map(/** @param {any} v */ v => ({
      id: String(v.id),
      nome: String(v.nameOriginal ?? v.name),
      nomeEn: String(v.name),
      tiriSalvezza: [...(v.saveAdvantages ?? [])],
      resistenza: v.damageResistance ? String(v.damageResistance) : null,
      descrizione: null,
      beneficio: null,
    })),
    peccati: regoleA.sins.map(/** @param {any} s */ s => ({
      id: String(s.id),
      nome: String(s.nameOriginal ?? s.name),
      nomeEn: String(s.name),
      descrizione: null,
      beneficio: null,
    })),
    marchi: regoleA.marks.map(/** @param {any} m */ m => ({
      id: String(m.id),
      nome: String(m.nameOriginal ?? m.name),
      nomeEn: String(m.name),
      descrizione: null,
      spiriti: m.spirits.map(/** @param {any} s */ s => ({
        id: String(s.id),
        nome: String(s.nameOriginal ?? s.name),
        nomeEn: String(s.name),
        descrizione: null,
      })),
    })),
    lingue: regoleA.languages.map(/** @param {any} l */ l => ({
      id: slug(String(l.name)),
      nome: String(l.nameOriginal ?? l.name),
      nomeEn: String(l.name),
      descrizione: null,
      parlanti: null,
    })),
  }

  // ── Scrittura ─────────────────────────────────────────────────────────────

  mkdirSync(USCITA_REGOLE, { recursive: true })
  const base = JSON.parse(readFileSync(join(USCITA_REGOLE, '2014.json'), 'utf8'))
  /** @type {Record<string, number>} */
  const pesi = {}
  for (const pacchetto of [brancalonia, apocalisse]) {
    Object.assign(pacchetto, { ridefinisce: ridefinizioni(pacchetto, base) })
    const testo = JSON.stringify(ordina(pacchetto), null, 0) + '\n'
    writeFileSync(join(USCITA_REGOLE, `${pacchetto.variante}.json`), testo)
    pesi[pacchetto.variante] = Buffer.byteLength(testo)
  }

  // Il compendio: solo Brancalonia ne ha uno. Apocalisse non aggiunge
  // incantesimi propri — i suoi Marchi non sono incantesimi — e la cartella
  // non si crea per simmetria.
  const volumi = fontiDegliIncantesimi()
  const { indice, blocchi, ponte } = costruisciCompendio(
    bSpells['brancaloniaSpells'], termini['spellNamesIt'], volumi, 'Brancalonia')
  const cartella = join(USCITA_SPELLS, 'brancalonia')
  mkdirSync(cartella, { recursive: true })
  let bytesCompendio = 0
  /** @param {string} nome @param {unknown} dati */
  const scrivi = (nome, dati) => {
    const t = JSON.stringify(ordina(dati), null, 0) + '\n'
    writeFileSync(join(cartella, nome), t)
    bytesCompendio += Buffer.byteLength(t)
  }
  scrivi('index.json', indice)
  blocchi.forEach((b, i) => scrivi(`l${i}.json`, b))
  scrivi('ponte.json', ponte)
  pesi['brancalonia'] = (pesi['brancalonia'] ?? 0) + bytesCompendio

  // ── Il registro ───────────────────────────────────────────────────────────

  const LICENZA = 'Materiale non libero — citato per nome, senza testo'
  aggiornaRegistro([
    {
      id: 'brancalonia',
      nome: 'Brancalonia',
      edizione: '2014',
      varianti: ['brancalonia'],
      incluso: true,
      base: 'srd-2014',
      licenza: LICENZA,
      kb: Math.ceil((pesi['brancalonia'] ?? 0) / 1024),
      regole: 'data/rules/brancalonia.json',
      incantesimi: 'data/spells/brancalonia/',
      attribuzione: 'Brancalonia è un\'ambientazione di Acheron Games (Setting Book, Macaronicon, ' +
        'L\'Impero Randella Ancora). Non è materiale SRD e non è distribuito sotto licenza Creative ' +
        'Commons: questo pacchetto ne riporta soltanto nomi, struttura e valori numerici, necessari a ' +
        'leggere una scheda già creata. Nessun testo di regole è incluso, e per giocare serve il ' +
        'manuale. Marchi e contenuti restano di Acheron Games.',
    },
    {
      id: 'apocalisse',
      nome: 'Apocalisse',
      edizione: '2014',
      varianti: ['apocalisse'],
      incluso: true,
      base: 'srd-2014',
      licenza: LICENZA,
      kb: Math.ceil((pesi['apocalisse'] ?? 0) / 1024),
      regole: 'data/rules/apocalisse.json',
      incantesimi: '',
      attribuzione: 'Apocalisse è un\'ambientazione di Acheron Games. Non è materiale SRD e non è ' +
        'distribuito sotto licenza Creative Commons: questo pacchetto ne riporta soltanto nomi, ' +
        'struttura e valori numerici, necessari a leggere una scheda già creata. Nessun testo di ' +
        'regole è incluso, e per giocare serve il manuale. Marchi e contenuti restano di Acheron Games.',
    },
  ])

  // ── Rapporto ──────────────────────────────────────────────────────────────

  console.log(`builder: ${BUILDER} @ ${src.commit} (${src.at})`)
  console.log('')
  for (const p of [brancalonia, apocalisse]) {
    const nSub = Object.values(p.classes).reduce((n, c) => n + Object.keys(c.subclasses).length, 0)
    const nPriv = Object.values(p.classes).reduce((n, c) =>
      n + (c.features?.length ?? 0) +
      Object.values(c.subclasses).reduce(/** @param {number} m @param {any} s */(m, s) => m + s.features.length, 0), 0)
    const nTratti = Object.values(p.races).reduce((n, r) => n + r.traits.length +
      Object.values(r.subraces).reduce(/** @param {number} m @param {any} s */(m, s) => m + s.traits.length, 0), 0)
    console.log(
      `  ${p.variante} (base ${p.base}, edizione ${p.edizione}) — ${pesi[p.variante]} byte\n` +
      `    ${Object.keys(p.classes).length} classi toccate, ${nSub} sottoclassi, ${nPriv} privilegi (tutti senza testo)\n` +
      `    ${Object.keys(p.races).length} razze (${nTratti} tratti), ${Object.keys(p.backgrounds).length} background`
    )
  }
  console.log(`    Brancalonia: ${indice.length} incantesimi propri, ${bytesCompendio} byte di compendio (testo: nessuno)`)
  console.log('    Apocalisse: nessun incantesimo proprio — la cartella non esiste')
  console.log('')
  if (senzaItaliano.length) {
    const unici = [...new Set(senzaItaliano)].sort(per)
    console.log(`  ⚠ ${unici.length} nomi senza traduzione italiana nel builder, ripiegati sull'inglese:`)
    for (const s of unici) console.log(`      ${s}`)
  } else {
    console.log('  tutti i nomi hanno la loro versione italiana')
  }
  console.log('')
  console.log(`  scritti brancalonia.json e apocalisse.json in ${USCITA_REGOLE},`)
  console.log(`  il compendio in ${join(USCITA_SPELLS, 'brancalonia')}, e le due voci in data/packs.json`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
