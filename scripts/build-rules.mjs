#!/usr/bin/env node
/**
 * Genera `data/rules/2014.json` e `data/rules/2024.json` dal repo del builder.
 *   node scripts/build-rules.mjs [--builder ../../dnd-builder]
 *
 * ── Lotto C ──
 *
 * Requisiti che il lotto deve rispettare:
 *  · `asiLevels` è **per classe e per edizione** (il guerriero ne ha sei, non
 *    quattro; nel 2024 il 19° è un dono epico e non un ASI);
 *  · nel 2024 `subclassLevel` è 3 per tutte le classi;
 *  · il testo dei privilegi viene dagli SRD italiani, non da traduzioni nostre;
 *  · l'output è deterministico: rigenerare senza modifiche non produce diff.
 *
 * ── Da dove vengono i dati ─────────────────────────────────────────────────
 *
 * **Il builder** (TypeScript, letto senza importarlo: si transpila con il
 * `typescript` che è già una devDependency e si carica il risultato come
 * modulo `data:`). Dà: classi, privilegi, sottoclassi, dadi vita, livelli di
 * sottoclasse, tipo di incantatore, trucchetti per livello, incantesimi
 * conosciuti del 2014, tabelle degli slot del 2014, padronanza d'armi, e i
 * nomi e i testi **italiani** dei privilegi.
 *
 * **I due PDF degli SRD italiani**, che il builder non copre:
 *  · le **condizioni** (nessuna delle due edizioni le ha nel builder);
 *  · il testo dei **tratti razziali** e dei **privilegi di background**: del
 *    builder si prendono gli id e i nomi italiani, del PDF la prosa. Le due
 *    edizioni sono fatte in modo diverso e hanno quindi due strade, come le
 *    condizioni — il 5.1 stampa una sola sottorazza per razza, il 5.2.1 mette
 *    lignaggi e retaggi in tabella e i privilegi di background nei talenti;
 *  · la colonna **Incantesimi preparati** del 2024 — il builder la dichiara
 *    esplicitamente mancante in `src/data/index.ts` e si rifiuta di indovinarla;
 *  · gli **slot dei semi-incantatori del 2024** — il builder riusa la tabella
 *    del 2014, in cui paladino e ranger lanciano dal 2° livello e non dal 1°;
 *  · quante **maestrie d'arma** dà ogni classe, livello per livello.
 *
 * Le tabelle si leggono con `pdftotext -layout`, che sulle tabelle è esatto;
 * la prosa (le condizioni) si legge **senza** `-layout`, perché a due colonne
 * il layout intreccia le righe. È lo stesso mestiere di `build-spells.mjs`,
 * con il flag invertito, e per la stessa ragione.
 *
 * Nulla di ciò che si estrae viene creduto sulla parola: i trucchetti e gli
 * slot letti dal PDF devono coincidere con quelli del builder, altrimenti la
 * generazione si ferma. È l'invariante che fa emergere subito una colonna
 * letta storta, invece che sei mesi dopo in mezzo a una sessione.
 *
 * I PDF non stanno nel repo (`.gitignore` esclude `*.pdf`). Si passano con
 * `--srd2014` e `--srd2024`, o si mettono in una delle posizioni cercate qui
 * sotto. Si scaricano da:
 *   2014 → https://dnd.wizards.com/it/resources/systems-reference-document
 *   2024 → https://www.dndbeyond.com/srd
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
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
const USCITA = resolve(RADICE, ARG['out'] ?? 'data/rules')

/**
 * Il primo percorso che esiste, fra quelli plausibili per un PDF dell'SRD.
 * @param {string|undefined} esplicito
 * @param {string} nome
 * @returns {string}
 */
function trovaPdf(esplicito, nome) {
  const candidati = [
    esplicito,
    join(RADICE, 'srd', nome),
    join(BUILDER, 'manuali/DnD/5E Rulebooks/Core/it', nome),
    join(homedir(), 'Downloads', nome),
  ].filter(/** @returns {p is string} */ p => typeof p === 'string' && p !== 'true')
  for (const p of candidati) if (existsSync(resolve(RADICE, p))) return resolve(RADICE, p)
  throw new Error(
    `PDF dell'SRD non trovato: ${nome}\n` +
    `Cercato in:\n${candidati.map(p => '  ' + p).join('\n')}\n` +
    `Passalo con --srd2014 / --srd2024, oppure mettilo in srd/ — i PDF sono già esclusi da .gitignore.`
  )
}

// ── Il builder è TypeScript: lo si transpila, non lo si compila ─────────────

/**
 * Carica un modulo `.ts` del builder senza toccare il repo del builder: si
 * transpila in memoria e si importa come modulo `data:`.
 *
 * Gli `import type` la transpilazione li cancella da sola. Quelli veri sono
 * tutti relativi, e si risolvono ricorsivamente riscrivendo l'URL: così il
 * builder resta di sola lettura e qui non serve né un bundler né una copia.
 * Un import verso un pacchetto o verso un alias `@/` non c'è, e se comparisse
 * questa funzione lo dice invece di fallire in modo oscuro.
 *
 * @param {string} rel percorso dentro `src/` del builder
 * @returns {Promise<Record<string, any>>}
 */
async function caricaTs(rel) {
  return await import(await urlDati(join(BUILDER, 'src', rel)))
}

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

// ── Igiene del testo ───────────────────────────────────────────────────────

/**
 * Le righe che il PDF fa colare dentro le descrizioni. Il piè di pagina
 * italiano compare 453 volte nell'SRD 5.1 e nel builder è finito dentro undici
 * descrizioni di incantesimi: qui si taglia e si conta, e il conto si stampa.
 * @type {ReadonlyArray<{nome: string, re: RegExp}>}
 */
const SPORCIZIA = [
  { nome: 'Not for resale', re: /\s*Not for resale\.?/gi },
  { nome: 'Permission granted', re: /\s*Permission granted to print or photocopy this document for personal use only\.?/gi },
  { nome: 'Rivendita vietata', re: /\s*Rivendita vietata\.(?:\s*È permesso fotocopiare o stampare questo documento per il solo uso personale\.)?/gi },
  { nome: 'intestazione corrente', re: /\s*System[s]? Reference Document \d+(?:\.\d+)*/gi },
  // Numero di pagina isolato: una cifra sola fra la fine di una frase e
  // l'inizio della successiva. Il vincolo sulle due frasi è ciò che impedisce
  // di mangiarsi «subisce 1d4 danni» o «entro 3 metri».
  { nome: 'numero di pagina', re: /(?<=[.!?…]\s)\d{1,3}(?=\s+[A-ZÀ-Ù])/g },
]

/** Quante volte ogni pattern ha dovuto tagliare. @type {Record<string, number>} */
const tagli = {}

/**
 * Ripulisce una descrizione e tiene il conto di ciò che ha tolto.
 * @param {string} testo
 * @param {string} dove per il rapporto: chi conteneva la sporcizia
 * @returns {string}
 */
function pulisci(testo, dove) {
  let out = testo
  for (const { nome, re } of SPORCIZIA) {
    const trovati = out.match(re)
    if (trovati) {
      tagli[nome] = (tagli[nome] ?? 0) + trovati.length
      sporchi.push(`${dove} — ${nome} ×${trovati.length}`)
      out = out.replace(re, ' ')
    }
  }
  return out.replace(/[ \t ]+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
}

/** @type {string[]} */
const sporchi = []

// ── Le tabelle: quelle che il builder ha già ────────────────────────────────

/** Soglie di PX. Identiche nelle due edizioni. @type {readonly number[]} */
const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
]

/** Ordine canonico delle classi nell'output: alfabetico per id, e basta. */
const per = /** @param {string} a @param {string} b */ (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// ── Estrazione dalle tabelle del PDF (solo con -layout) ────────────────────

/**
 * Il testo del PDF, una volta per modalità. `pdftotext` non è veloce e i due
 * PDF pesano 14 MB in due.
 * @type {Map<string, string[]>}
 */
const cachePdf = new Map()

/**
 * @param {string} pdf
 * @param {boolean} layout
 * @returns {string[]}
 */
function righePdf(pdf, layout) {
  const chiave = `${pdf}|${layout}`
  const gia = cachePdf.get(chiave)
  if (gia) return gia
  const args = ['-enc', 'UTF-8']
  if (layout) args.push('-layout')
  args.push(pdf, '-')
  let testo
  try {
    testo = execFileSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  } catch (e) {
    throw new Error(
      `pdftotext non ha funzionato su ${pdf}. Serve poppler (brew install poppler).\n` +
      (e instanceof Error ? e.message : String(e))
    )
  }
  const righe = testo.split('\n')
  cachePdf.set(chiave, righe)
  return righe
}

/** Bonus di competenza per livello: serve a riconoscere le righe di tabella. */
const COMPETENZA = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]

/**
 * Le venti righe della tabella «Privilegi del/della <classe>», ridotte ai
 * gettoni della coda numerica. La colonna di testo va a capo, quindi si tiene
 * solo la riga che comincia con il numero di livello seguito dal bonus di
 * competenza giusto: è un aggancio che una riga di prosa non può imitare.
 *
 * @param {string[]} righe testo del PDF estratto con -layout
 * @param {string} titolo p.es. «Privilegi del bardo»
 * @returns {string[][]} venti righe di gettoni, dal 1° al 20° livello
 */
function tabellaClasse(righe, titolo) {
  const inizio = righe.findIndex(r => r.trim() === titolo)
  if (inizio < 0) throw new Error(`tabella «${titolo}» non trovata nel PDF`)
  /** @type {string[][]} */
  const out = []
  for (let i = inizio + 1; i < righe.length && out.length < 20; i++) {
    const atteso = out.length + 1
    const m = /^\s*(\d{1,2})\s+\+(\d)\s+(.*)$/.exec(righe[i] ?? '')
    if (!m) continue
    if (Number(m[1]) !== atteso || Number(m[2]) !== COMPETENZA[atteso - 1]) continue
    out.push((m[3] ?? '').trim().split(/\s+/).filter(Boolean))
  }
  if (out.length !== 20) {
    throw new Error(`tabella «${titolo}»: lette ${out.length} righe su 20`)
  }
  return out
}

/** @param {string} t @returns {number|null} un gettone numerico, o null se è un trattino */
function cella(t) {
  if (t === '—' || t === '-' || t === '–') return null
  if (!/^\d+$/.test(t)) throw new Error(`cella non numerica: «${t}»`)
  return Number(t)
}

/**
 * Legge dalla tabella di una classe che lancia incantesimi: trucchetti,
 * incantesimi preparati e slot. Si conta **dalla fine**, perché le colonne di
 * sinistra cambiano da classe a classe (dado bardico, punti stregoneria,
 * incanalare divinità…) mentre la coda è sempre la stessa.
 *
 * @param {string[][]} tabella
 * @param {'full'|'half'|'pact'} tipo
 * @returns {{cantrips: (number|null)[], prepared: number[], slots: number[][]}}
 */
function colonneIncantesimi(tabella, tipo) {
  const larghezza = tipo === 'full' ? 9 : tipo === 'half' ? 5 : 1
  /** @type {(number|null)[]} */ const cantrips = []
  /** @type {number[]} */ const prepared = []
  /** @type {number[][]} */ const slots = []
  for (const riga of tabella) {
    // Il warlock ha una colonna in più dopo gli slot: il livello degli slot.
    const coda = tipo === 'pact' ? riga.slice(0, -1) : riga
    const grezziSlot = coda.slice(coda.length - larghezza)
    slots.push(grezziSlot.map(cella).filter(/** @returns {n is number} */ n => n !== null))
    const p = cella(coda[coda.length - larghezza - 1] ?? '')
    if (p === null) throw new Error('colonna «Incantesimi preparati» vuota')
    prepared.push(p)
    // Paladino e ranger non hanno la colonna dei trucchetti: nel 2024 non ne
    // hanno proprio, li ottengono solo tramite lo stile di combattimento.
    cantrips.push(tipo === 'half' ? null : cella(coda[coda.length - larghezza - 2] ?? ''))
  }
  return { cantrips, prepared, slots }
}

/**
 * La colonna «Padronanza d'armi», che è sempre l'ultima delle classi che ce
 * l'hanno in tabella.
 * @param {string[][]} tabella
 * @returns {number[]}
 */
function colonnaPadronanza(tabella) {
  return tabella.map(r => {
    const v = cella(r[r.length - 1] ?? '')
    if (v === null) throw new Error('colonna «Padronanza d\'armi» vuota')
    return v
  })
}

// ── Le condizioni, dalla prosa dei due SRD ─────────────────────────────────

/**
 * Le quindici condizioni, nell'ordine alfabetico italiano in cui l'SRD le
 * elenca. `id` è lo slug del nome inglese, perché è quello che uno snapshot
 * del builder porterà in `play.conditions`.
 * @type {ReadonlyArray<{id: string, nome: string}>}
 */
const CONDIZIONI = [
  { id: 'blinded', nome: 'Accecato' },
  { id: 'charmed', nome: 'Affascinato' },
  { id: 'grappled', nome: 'Afferrato' },
  { id: 'deafened', nome: 'Assordato' },
  { id: 'poisoned', nome: 'Avvelenato' },
  { id: 'incapacitated', nome: 'Incapacitato' },
  { id: 'exhaustion', nome: 'Indebolimento' },
  { id: 'invisible', nome: 'Invisibile' },
  { id: 'paralyzed', nome: 'Paralizzato' },
  { id: 'petrified', nome: 'Pietrificato' },
  { id: 'unconscious', nome: 'Privo di sensi' },
  { id: 'prone', nome: 'Prono' },
  { id: 'frightened', nome: 'Spaventato' },
  { id: 'stunned', nome: 'Stordito' },
  { id: 'restrained', nome: 'Trattenuto' },
]

/**
 * Le condizioni dell'SRD 5.2.1: stanno nel glossario, ognuna sotto
 * un'intestazione `<Nome> [condizione]`, e il blocco finisce alla prima riga
 * vuota. Le interruzioni di pagina (un numero e l'intestazione corrente) si
 * saltano invece di troncare il testo.
 * @param {string[]} righe
 * @returns {Map<string, string>}
 */
function condizioni2024(righe) {
  /** @type {Map<string, string>} */
  const out = new Map()
  for (const { id, nome } of CONDIZIONI) {
    const titolo = righe.findIndex(r => r.trim() === `${nome} [condizione]`)
    if (titolo < 0) continue
    // Non basta partire dalla riga dopo il titolo: senza `-layout` pdftotext
    // ogni tanto infila lì il paragrafo della voce accanto (succede a
    // «trattenuto», che si becca l'elenco dei tipi di creatura). L'attacco vero
    // del blocco è la formula con cui l'SRD apre ogni condizione, e la si cerca.
    const i = trovaAttacco(righe, titolo)
    if (i < 0) continue
    /** @type {string[]} */
    const corpo = []
    for (let j = i; j < righe.length; j++) {
      const r = (righe[j] ?? '').trim()
      if (!r) {
        // Una riga vuota chiude il blocco, a meno che dopo l'interruzione di
        // pagina il periodo riprenda: o in minuscola, o con un altro effetto
        // in grassetto («Influenza sugli attacchi. …»).
        const dopo = prossimaUtile(righe, j)
        if (dopo !== null && (/^[a-zà-ù(]/.test(dopo) || /^[A-ZÀ-Ù][^.]{1,44}\.\s+\S/.test(dopo))) continue
        break
      }
      if (artefattoDiPagina(r)) continue
      corpo.push(r)
    }
    out.set(id, pulisci(corpo.join(' '), `2024/condizione/${id}`))
  }
  return out
}

/**
 * Le condizioni dell'SRD 5.1: stanno tutte di fila nell'Appendice A, ognuna
 * sotto il proprio nome, e il testo è un elenco puntato che può avere righe
 * vuote in mezzo (le colonne del PDF). Si delimita quindi con il nome della
 * condizione **successiva**, non con la riga vuota.
 * @param {string[]} righe
 * @returns {Map<string, string>}
 */
function condizioni2014(righe) {
  const nomi = CONDIZIONI.map(c => c.nome)
  /** @type {Map<string, number>} */
  const posizioni = new Map()
  const daQui = righe.findIndex(r => r.trim() === 'Condizioni')
  for (let i = Math.max(daQui, 0); i < righe.length; i++) {
    const r = (righe[i] ?? '').trim()
    if (nomi.includes(r) && !posizioni.has(r)) posizioni.set(r, i)
  }
  /** @type {Map<string, string>} */
  const out = new Map()
  const ordinate = [...posizioni.entries()].sort((a, b) => a[1] - b[1])
  for (let k = 0; k < ordinate.length; k++) {
    const voce = ordinate[k]
    if (!voce) continue
    const [nome, inizio] = voce
    const fine = ordinate[k + 1]?.[1] ?? inizio + 60
    const corpo = righe.slice(inizio + 1, fine)
      .map(r => r.trim())
      .filter(r => r && !artefattoDiPagina(r))
      .join(' ')
      .replace(/•\s*/g, '')
    // L'ultima condizione presente finisce dove comincia l'appendice dopo.
    const tagliata = corpo.split(/Appendice\s+[AB]/)[0] ?? corpo
    const id = CONDIZIONI.find(c => c.nome === nome)?.id
    if (id) out.set(id, pulisci(tagliata, `2014/condizione/${id}`))
  }
  return out
}

/**
 * Dove comincia davvero il blocco di una condizione del 2024: la prima riga
 * che apre con la formula fissa dell'SRD, entro una ventina di righe dal
 * titolo e senza scavalcare il titolo della condizione successiva.
 * @param {string[]} righe
 * @param {number} titolo
 * @returns {number} indice della riga d'attacco, o -1
 */
function trovaAttacco(righe, titolo) {
  for (let j = titolo + 1; j < righe.length && j < titolo + 24; j++) {
    const r = (righe[j] ?? '').trim()
    if (/\[condizione\]$/.test(r)) return -1
    if (/^Quando il (?:tuo )?personaggio ha la condizione/.test(r)) return j
  }
  return -1
}

/** @param {string} r @returns {boolean} */
function artefattoDiPagina(r) {
  return /^\d{1,3}$/.test(r)
    || /^System[s]? Reference Document/.test(r)
    || /^Rivendita vietata\./.test(r)
    || /^Not for resale/.test(r)
}

/** @param {string[]} righe @param {number} da @returns {string|null} */
function prossimaUtile(righe, da) {
  for (let j = da; j < righe.length && j < da + 8; j++) {
    const r = (righe[j] ?? '').trim()
    if (!r || artefattoDiPagina(r)) continue
    return r
  }
  return null
}

// ── I tratti razziali e i background, dalla prosa dei due SRD ──────────────

/**
 * @typedef {object} TrattoSrd
 * @property {string} id        id del tratto nel builder
 * @property {string} titolo    come l'SRD scrive il nome del tratto, senza il punto
 * @property {string} [sotto]   id della sottorazza, se il tratto è di una sottorazza
 * @property {{salta: string, riprendi: string}} [ponte] tabella che spezza il tratto in due
 *
 * @typedef {object} BloccoSrd
 * @property {string} titolo    riga isolata con cui l'SRD apre la razza
 * @property {string} razza     id della razza nel builder
 * @property {TrattoSrd[]} tratti
 * @property {string[]} [stop]  altre intestazioni che chiudono un tratto (voci non nostre,
 *                              titoli di tabella): senza di esse l'ultimo tratto del blocco
 *                              si mangerebbe ciò che segue
 *
 * @typedef {object} RigaTabella
 * @property {string} id        id del tratto nel builder
 * @property {string} sotto     id della sottorazza
 * @property {string} etichetta prima cella della riga, com'è scritta sulla *prima* riga fisica
 *
 * @typedef {object} TabellaSrd
 * @property {string} titolo    riga isolata che precede l'intestazione della tabella
 * @property {string[]} colonne intestazioni delle colonne di testo, in ordine
 * @property {string} razza
 * @property {RigaTabella[]} righe
 *
 * @typedef {object} SpecSrd
 * @property {{da: string, a: string}} sezione
 * @property {BloccoSrd[]} blocchi        nell'ordine in cui compaiono nel PDF
 * @property {TabellaSrd[]} [tabelle]
 * @property {Array<{background: string, privilegio: string, da: string, a: string, salta?: string[]}>} background
 */

/**
 * Le voci di contorno che il 5.1 ripete sotto ogni razza. Non sono tratti, ma
 * vanno dichiarate lo stesso: sono ciò che chiude il tratto che le precede.
 * @type {string[]}
 */
const CONTORNO_5_1 = [
  'Incremento dei punteggi di caratteristica', 'Allineamento', 'Età', 'Taglia', 'Velocità',
  'Linguaggi', 'Sottorazze',
]

/**
 * Dove sta, nei due SRD italiani, il testo di ogni tratto razziale.
 *
 * La mappa è esplicita e non euristica, e la ragione è che appaiare per nome
 * produrrebbe il solo errore davvero dannoso qui — il testo giusto sotto il
 * tratto sbagliato. Il builder e il PDF traducono lo stesso tratto in modo
 * diverso («Retaggio fatato» contro «Eredità Fatata»), e lo stesso id compare
 * in razze diverse con testi diversi: `extra-language` è il linguaggio in più
 * dell'alto elfo, non quello dell'umano, e `stonecunning` nel 5.2.1 è la
 * percezione tellurica, non la prova di Storia del 5.1.
 *
 * Ciò che l'SRD non pubblica resta fuori: il 5.1 stampa **una sola sottorazza
 * per razza**, e il 5.2.1 riduce gli antenati draconici a una tabella di soli
 * tipi di danno, che il nome del tratto già dice.
 *
 * @type {Record<'2014'|'2024', SpecSrd>}
 */
const TRATTI_SRD = {
  '2014': {
    sezione: { da: 'Razze', a: 'Barbaro' },
    // Nel 5.1 ogni razza ripete le stesse voci di contorno (Allineamento, Età,
    // Taglia…), che non sono tratti ma chiudono quello prima.
    blocchi: [
      { titolo: 'Elfo', razza: 'elf', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'keen-senses', titolo: 'Sensi acuti' },
        { id: 'fey-ancestry', titolo: 'Retaggio fatato' },
        { id: 'trance', titolo: 'Trance' },
      ] },
      { titolo: 'Elfo alto', razza: 'elf', stop: CONTORNO_5_1, tratti: [
        { id: 'elf-weapon-training', titolo: 'Addestramento nelle armi elfiche', sotto: 'high-elf' },
        { id: 'cantrip', titolo: 'Trucchetto', sotto: 'high-elf' },
        { id: 'extra-language', titolo: 'Linguaggio extra', sotto: 'high-elf' },
      ] },
      { titolo: 'Halfling', razza: 'halfling', stop: CONTORNO_5_1, tratti: [
        { id: 'lucky', titolo: 'Fortunato' },
        { id: 'brave', titolo: 'Coraggioso' },
        { id: 'halfling-nimbleness', titolo: 'Agilità halfling' },
      ] },
      { titolo: 'Piedelesto', razza: 'halfling', stop: CONTORNO_5_1, tratti: [
        { id: 'naturally-stealthy', titolo: 'Furtività innata', sotto: 'lightfoot-halfling' },
      ] },
      { titolo: 'Nano', razza: 'dwarf', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'dwarven-resilience', titolo: 'Resilienza nanica' },
        { id: 'dwarven-combat-training', titolo: 'Addestramento da combattimento nanico' },
        { id: 'tool-proficiency', titolo: 'Competenza negli strumenti' },
        { id: 'stonecunning', titolo: 'Esperto minatore' },
      ] },
      { titolo: 'Nano delle colline', razza: 'dwarf', stop: CONTORNO_5_1, tratti: [
        { id: 'dwarven-toughness', titolo: 'Robustezza nanica', sotto: 'hill-dwarf' },
      ] },
      // L'umano del 5.1 non ha un tratto «Linguaggio extra»: il linguaggio in
      // più è una riga dentro «Linguaggi», e `extra-language` resta senza testo.
      { titolo: 'Umano', razza: 'human', stop: CONTORNO_5_1, tratti: [] },
      { titolo: 'Dragonide', razza: 'dragonborn', stop: CONTORNO_5_1, tratti: [
        { id: 'draconic-ancestry', titolo: 'Discendenza draconica' },
        { id: 'breath-weapon', titolo: 'Soffio' },
        { id: 'damage-resistance', titolo: 'Resistenza ai danni' },
      ] },
      { titolo: 'Gnomo', razza: 'gnome', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'gnome-cunning', titolo: 'Astuzia gnomesca' },
      ] },
      { titolo: 'Gnomo delle rocce', razza: 'gnome', stop: CONTORNO_5_1, tratti: [
        { id: 'artificers-lore', titolo: "Conoscenze dell'artefice", sotto: 'rock-gnome' },
        { id: 'tinker', titolo: 'Inventore', sotto: 'rock-gnome' },
      ] },
      { titolo: 'Mezzelfo', razza: 'half-elf', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'fey-ancestry', titolo: 'Retaggio fatato' },
        { id: 'skill-versatility', titolo: 'Versatilità nelle abilità' },
      ] },
      { titolo: 'Mezzorco', razza: 'half-orc', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'menacing', titolo: 'Minaccioso' },
        { id: 'relentless-endurance', titolo: 'Resistenza implacabile' },
        { id: 'savage-attacks', titolo: 'Attacchi selvaggi' },
      ] },
      { titolo: 'Tiefling', razza: 'tiefling', stop: CONTORNO_5_1, tratti: [
        { id: 'darkvision', titolo: 'Scurovisione' },
        { id: 'hellish-resistance', titolo: 'Resistenza infernale' },
        { id: 'infernal-legacy', titolo: 'Eredità infernale' },
      ] },
    ],
    // Dei tredici background del builder l'SRD 5.1 pubblica solo l'accolito.
    background: [
      { background: 'acolyte', privilegio: 'shelter-of-the-faithful',
        da: 'Privilegio: Rifugio dei Fedeli', a: 'Caratteristiche suggerite' },
    ],
  },
  '2024': {
    sezione: { da: 'Descrizioni delle specie', a: 'Talenti' },
    blocchi: [
      { titolo: 'Dragonide', razza: 'dragonborn', stop: ['Antenati draconici'], tratti: [
        { id: 'draconic-ancestry', titolo: 'Discendenza draconica' },
        { id: 'breath-weapon', titolo: 'Soffio' },
        { id: 'damage-resistance-draconic', titolo: 'Resistenza ai danni' },
        { id: 'darkvision-60', titolo: 'Scurovisione' },
        { id: 'draconic-flight', titolo: 'Volo draconico' },
      ] },
      { titolo: 'Elfo', razza: 'elf', tratti: [
        { id: 'darkvision-60', titolo: 'Scurovisione' },
        // La tabella dei lignaggi è impaginata in mezzo a questo tratto: si
        // salta e si riprende, invece di troncarlo a metà frase.
        { id: 'elven-lineage', titolo: 'Lignaggio elfico',
          ponte: { salta: 'Lignaggi elfici', riprendi: 'gli incantesimi lanciati con questo tratto' } },
        { id: 'fey-ancestry', titolo: 'Retaggio fatato' },
        { id: 'keen-senses', titolo: 'Sensi acuti' },
        { id: 'trance', titolo: 'Trance' },
      ] },
      { titolo: 'Gnomo', razza: 'gnome', tratti: [
        { id: 'gnomish-cunning', titolo: 'Astuzia gnomesca' },
        { id: 'gnomish-lineage', titolo: 'Lignaggio gnomesco' },
        { id: 'gnome-forest-gnome', titolo: 'Gnomo delle foreste', sotto: 'forest-gnome' },
        { id: 'gnome-rock-gnome', titolo: 'Gnomo delle rocce', sotto: 'rock-gnome' },
        { id: 'darkvision-60', titolo: 'Scurovisione' },
      ] },
      { titolo: 'Goliath', razza: 'goliath', tratti: [
        { id: 'powerful-build', titolo: 'Costituzione robusta' },
        { id: 'giant-ancestry', titolo: 'Discendenza gigantica' },
        { id: 'goliath-frosts-chill', titolo: 'Brivido gelante (gigante del gelo)', sotto: 'frosts-chill' },
        { id: 'goliath-hills-tumble', titolo: 'Forza della collina (gigante delle colline)', sotto: 'hills-tumble' },
        { id: 'goliath-fires-burn', titolo: 'Fuoco bruciante (gigante del fuoco)', sotto: 'fires-burn' },
        { id: 'goliath-stones-endurance', titolo: 'Resistenza della pietra (gigante delle pietre)', sotto: 'stones-endurance' },
        { id: 'goliath-clouds-jaunt', titolo: 'Salta-nuvole (gigante delle nuvole)', sotto: 'clouds-jaunt' },
        { id: 'goliath-storms-thunder', titolo: 'Tuono tempestoso (gigante delle tempeste)', sotto: 'storms-thunder' },
        { id: 'large-form', titolo: 'Forma Grande' },
      ] },
      { titolo: 'Halfling', razza: 'halfling', tratti: [
        { id: 'halfling-nimbleness', titolo: 'Agilità halfling' },
        { id: 'brave', titolo: 'Coraggioso' },
        { id: 'luck', titolo: 'Fortuna' },
        { id: 'naturally-stealthy', titolo: 'Furtività innata' },
      ] },
      { titolo: 'Nano', razza: 'dwarf', tratti: [
        { id: 'stonecunning', titolo: 'Esperto minatore' },
        { id: 'dwarven-resilience', titolo: 'Resilienza nanica' },
        { id: 'dwarven-toughness', titolo: 'Robustezza nanica' },
        { id: 'darkvision-120', titolo: 'Scurovisione' },
      ] },
      { titolo: 'Orco', razza: 'orc', tratti: [
        { id: 'relentless-endurance', titolo: 'Resistenza implacabile' },
        { id: 'adrenaline-rush', titolo: 'Scarica di adrenalina' },
        { id: 'darkvision-120', titolo: 'Scurovisione' },
      ] },
      { titolo: 'Tiefling', razza: 'tiefling', stop: ['Retaggi immondi'], tratti: [
        { id: 'fiendish-legacy', titolo: 'Retaggio immondo' },
        { id: 'otherworldly-presence', titolo: 'Presenza ultraterrena' },
        { id: 'darkvision-60', titolo: 'Scurovisione' },
      ] },
      // L'umano è impaginato *dentro* la tabella dei retaggi immondi: senza lo
      // stop, «Versatile» si porterebbe dietro le righe della tabella.
      { titolo: 'Umano', razza: 'human', stop: ['Retaggio'], tratti: [
        { id: 'resourceful', titolo: 'Intraprendente' },
        { id: 'skillful', titolo: 'Pluriabilità' },
        { id: 'versatile', titolo: 'Versatile' },
      ] },
    ],
    tabelle: [
      { titolo: 'Lignaggi elfici', razza: 'elf', colonne: ['Livello 1', 'Livello 3', 'Livello 5'], righe: [
        { id: 'elf-drow', sotto: 'drow', etichetta: 'Drow' },
        { id: 'elf-high-elf', sotto: 'high-elf', etichetta: 'Elfo alto' },
        { id: 'elf-wood-elf', sotto: 'wood-elf', etichetta: 'Elfo dei' },
      ] },
      { titolo: 'Retaggi immondi', razza: 'tiefling', colonne: ['Livello 1', 'Livello 3', 'Livello 5'], righe: [
        { id: 'tiefling-abyssal', sotto: 'abyssal', etichetta: 'Abissale' },
        { id: 'tiefling-chthonic', sotto: 'chthonic', etichetta: 'Ctonio' },
        { id: 'tiefling-infernal', sotto: 'infernal', etichetta: 'Infernale' },
      ] },
    ],
    // I quattro background del 5.2.1 concedono un talento, e il testo del
    // talento sta nel capitolo «Talenti». «Iniziato alla magia» è un talento
    // solo: il builder lo sdoppia per lista, l'SRD la fa scegliere.
    background: [
      { background: 'soldier', privilegio: 'savage-attacker',
        da: 'Aggressore selvaggio', a: 'Allerta', salta: ['Talento Origini'] },
      { background: 'criminal', privilegio: 'alert',
        da: 'Allerta', a: 'Iniziato alla magia', salta: ['Talento Origini'] },
      { background: 'acolyte', privilegio: 'magic-initiate-cleric',
        da: 'Iniziato alla magia', a: 'Talenti Generali', salta: ['Talento Origini'] },
      { background: 'sage', privilegio: 'magic-initiate-wizard',
        da: 'Iniziato alla magia', a: 'Talenti Generali', salta: ['Talento Origini'] },
    ],
  },
}

/**
 * Vero se la riga apre il paragrafo di `titolo`. Il vincolo sulla riga
 * precedente è ciò che distingue un'intestazione da un nome di tratto che
 * chiude una frase: nel 5.2.1 «Resistenza ai danni» finisce con «…del tipo
 * determinato dal tratto / Discendenza draconica.», che a inizio riga è
 * indistinguibile da un'intestazione.
 * @param {string} riga
 * @param {string} titolo
 * @param {string|null} precedente ultima riga utile raccolta, o null se siamo all'inizio
 * @returns {boolean}
 */
function apreParagrafo(riga, titolo, precedente) {
  if (riga !== `${titolo}.` && !riga.startsWith(`${titolo}. `)) return false
  return precedente === null || /[.:!?»")\]]$/.test(precedente)
}

/**
 * Il testo dei tratti razziali di un'edizione, indicizzato
 * `razza/sottorazza/idTratto` (la sottorazza è vuota per i tratti della razza).
 * Un tratto che non si trova non viene indovinato: manca dalla mappa e a valle
 * resta `description: null`.
 *
 * @param {string[]} flat    PDF estratto **senza** -layout: a due colonne è
 *                           l'unico che rispetta l'ordine di lettura e ricuce
 *                           le parole spezzate dalla sillabazione
 * @param {string[]} layout  PDF estratto **con** -layout, per le tabelle
 * @param {SpecSrd} spec
 * @param {string} edizione
 * @param {string[]} mancanti  vi si accumula ciò che non si è trovato
 * @returns {Map<string, string>}
 */
function trattiRazziali(flat, layout, spec, edizione, mancanti) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const inizio = flat.findIndex(r => r.trim() === spec.sezione.da)
  const fine = flat.findIndex((r, i) => i > inizio && r.trim() === spec.sezione.a)
  if (inizio < 0 || fine < 0) {
    throw new Error(`${edizione}: sezione delle razze non trovata («${spec.sezione.da}» → «${spec.sezione.a}»)`)
  }

  // I blocchi sono dichiarati nell'ordine del PDF: cercarli in avanti impedisce
  // che «Nano» agganci l'occorrenza dentro un'altra razza.
  /** @type {number[]} */
  const posizioni = []
  let cursore = inizio
  for (const b of spec.blocchi) {
    const p = flat.findIndex((r, i) => i > cursore && i < fine && r.trim() === b.titolo)
    posizioni.push(p)
    if (p >= 0) cursore = p
    else mancanti.push(`${edizione}/${b.razza}: blocco «${b.titolo}» non trovato`)
  }

  for (let k = 0; k < spec.blocchi.length; k++) {
    const b = spec.blocchi[k]
    const p = posizioni[k]
    if (b === undefined || p === undefined || p < 0) continue
    const f = posizioni.slice(k + 1).find(q => q !== undefined && q > p) ?? fine
    const titoli = [...b.tratti.map(t => t.titolo), ...(b.stop ?? [])]
    for (const t of b.tratti) {
      /** @type {string[]} */
      const corpo = []
      /** @type {string|null} */
      let precedente = null
      let dentro = false
      let saltando = false
      // Dopo il titolo di una tabella le righe sono celle, e una cella non
      // chiude una frase: senza questo, l'intestazione che segue la tabella
      // non verrebbe riconosciuta come tale.
      let fraLeCelle = false
      for (let i = p + 1; i < f; i++) {
        const r = (flat[i] ?? '').trim()
        if (saltando) {
          if (t.ponte && r.startsWith(t.ponte.riprendi)) { saltando = false; corpo.push(r); precedente = r }
          continue
        }
        if (!r || artefattoDiPagina(r)) continue
        if (!dentro) {
          if ((b.stop ?? []).includes(r)) { fraLeCelle = true; precedente = null; continue }
          if (apreParagrafo(r, t.titolo, precedente)) {
            dentro = true
            fraLeCelle = false
            const resto = r.slice(t.titolo.length + 1).trim()
            if (resto) corpo.push(resto)
            precedente = resto || r
            continue
          }
          if (!fraLeCelle) precedente = r
          continue
        }
        if (t.ponte && r === t.ponte.salta) { saltando = true; continue }
        if (titoli.some(x => apreParagrafo(r, x, precedente)) || (b.stop ?? []).includes(r)) break
        corpo.push(r)
        precedente = r
      }
      if (!dentro || corpo.length === 0) {
        mancanti.push(`${edizione}/${b.razza}${t.sotto ? '/' + t.sotto : ''}/${t.id}: «${t.titolo}» non trovato`)
        continue
      }
      out.set(`${b.razza}/${t.sotto ?? ''}/${t.id}`,
        pulisci(corpo.join(' '), `${edizione}/razza/${b.razza}/${t.id}`))
    }
  }

  for (const tab of spec.tabelle ?? []) {
    for (const [chiave, testo] of tabellaTratti(layout, tab, edizione, mancanti)) out.set(chiave, testo)
  }
  return out
}

/**
 * Le sottorazze che il 5.2.1 pubblica come righe di tabella (lignaggi elfici,
 * retaggi immondi). Qui serve `-layout`: senza, le celle escono in colonna e
 * non si sa più quale beneficio appartiene a quale riga.
 *
 * Le colonne si ricavano dalle posizioni delle intestazioni, e si verifica che
 * nessuna parola scavalchi un confine — è il modo in cui una tabella letta
 * storta si fa notare subito invece di uscire come testo plausibile.
 *
 * @param {string[]} layout
 * @param {TabellaSrd} tab
 * @param {string} edizione
 * @param {string[]} mancanti
 * @returns {Map<string, string>}
 */
function tabellaTratti(layout, tab, edizione, mancanti) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const titolo = layout.findIndex(r => r.trim() === tab.titolo)
  if (titolo < 0) { mancanti.push(`${edizione}: tabella «${tab.titolo}» non trovata`); return out }
  const intestazione = titolo + 1
  const riga = layout[intestazione] ?? ''
  const bordi = tab.colonne.map(c => riga.indexOf(c))
  if (bordi.some(b => b < 0)) {
    mancanti.push(`${edizione}/${tab.titolo}: intestazione delle colonne illeggibile`)
    return out
  }
  let fine = intestazione + 1
  while (fine < layout.length && (layout[fine] ?? '').trim() !== '') fine++

  /** @param {string} r @param {number} n @returns {string} */
  const cella = (r, n) => {
    const bordo = bordi[n]
    const successivo = n + 1 < bordi.length ? bordi[n + 1] : undefined
    return r.slice(bordo, successivo).trim()
  }

  for (const b of bordi) {
    for (let i = intestazione + 1; i < fine; i++) {
      const r = layout[i] ?? ''
      if (r.length > b && r[b - 1] !== ' ' && r[b - 1] !== undefined) {
        mancanti.push(`${edizione}/${tab.titolo}: una parola scavalca il confine di colonna ${b}`)
        return out
      }
    }
  }

  const inizi = tab.righe.map(v =>
    layout.findIndex((r, i) => i > intestazione && i < fine && r.slice(0, bordi[0]).trim() === v.etichetta))
  for (let k = 0; k < tab.righe.length; k++) {
    const v = tab.righe[k]
    const da = inizi[k]
    if (v === undefined || da === undefined || da < 0) {
      if (v) mancanti.push(`${edizione}/${tab.titolo}: riga «${v.etichetta}» non trovata`)
      continue
    }
    const a = inizi.slice(k + 1).find(q => q !== undefined && q > da) ?? fine
    /** @type {string[][]} */
    const colonne = tab.colonne.map(() => [])
    for (let i = da; i < a; i++) {
      for (let n = 0; n < tab.colonne.length; n++) {
        const c = cella(layout[i] ?? '', n)
        if (c) (colonne[n] ?? []).push(c)
      }
    }
    // Le tre colonne diventano una frase sola, etichettata con le intestazioni
    // della tabella: è l'unico modo di non perdere quale beneficio arriva a
    // quale livello, e non aggiunge una parola che l'SRD non abbia già scritto.
    const testo = tab.colonne
      .map((c, n) => `${c}: ${(colonne[n] ?? []).join(' ').replace(/\.?$/, '.')}`)
      .join(' ')
    out.set(`${tab.razza}/${v.sotto}/${v.id}`, pulisci(testo, `${edizione}/tabella/${tab.titolo}/${v.id}`))
  }
  return out
}

/**
 * Il testo dei privilegi di background, indicizzato `background/privilegio`.
 * @param {string[]} flat
 * @param {SpecSrd} spec
 * @param {string} edizione
 * @param {string[]} mancanti
 * @returns {Map<string, string>}
 */
function privilegiBackground(flat, spec, edizione, mancanti) {
  /** @type {Map<string, string>} */
  const out = new Map()
  for (const b of spec.background) {
    const da = flat.findIndex(r => r.trim() === b.da)
    const a = flat.findIndex((r, i) => i > da && r.trim() === b.a)
    if (da < 0 || a < 0) {
      mancanti.push(`${edizione}/${b.background}/${b.privilegio}: «${b.da}» non trovato`)
      continue
    }
    const corpo = flat.slice(da + 1, a)
      .map(r => r.trim())
      .filter(r => r && !artefattoDiPagina(r) && !(b.salta ?? []).includes(r))
    if (corpo.length === 0) {
      mancanti.push(`${edizione}/${b.background}/${b.privilegio}: blocco vuoto`)
      continue
    }
    out.set(`${b.background}/${b.privilegio}`,
      pulisci(corpo.join(' '), `${edizione}/background/${b.background}`))
  }
  return out
}

// ── Costruzione di un pacchetto ────────────────────────────────────────────

/**
 * @typedef {object} Fonti
 * @property {readonly any[]} classi        le classi del builder, edizione giusta
 * @property {Record<string, string>} testi id del privilegio → testo italiano
 * @property {Record<string, string>} nomi  nome inglese → nome italiano
 * @property {Record<string, string>} nomiSottoclasse
 * @property {Record<string, string>} nomiClasse
 */

/**
 * I livelli di ASI di una classe, letti dai suoi privilegi invece che
 * indovinati: sono lì, uno per livello, e leggerli è l'unico modo per cui
 * guerriero e ladro vengono giusti senza un caso speciale.
 * @param {any} cls
 * @returns {number[]}
 */
function asiLevels(cls) {
  return cls.features
    .filter(/** @param {any} f */ f => /^Ability Score Improvement/i.test(f.name))
    .map(/** @param {any} f @returns {number} */ f => Number(f.level))
    .sort(/** @param {number} a @param {number} b */ (a, b) => a - b)
}

/** @param {any} cls @returns {number|null} */
function epicBoonLevel(cls) {
  const f = cls.features.find(/** @param {any} f */ f => /^Epic Boon/i.test(f.name))
  return f ? Number(f.level) : null
}

/**
 * Un privilegio, con il nome e il testo italiani. `nameEn` resta perché è
 * l'unico ponte con gli snapshot del builder, che elencano i privilegi con il
 * nome inglese e non con l'id.
 * @param {any} f
 * @param {Fonti} fonti
 * @param {string} dove
 * @returns {{id: string, level: number, name: string, nameEn: string, description: string|null}}
 */
function privilegio(f, fonti, dove) {
  const testo = fonti.testi[f.id]
  return {
    id: String(f.id),
    level: Number(f.level),
    name: fonti.nomi[f.name] ?? String(f.name),
    nameEn: String(f.name),
    description: testo ? pulisci(testo, `${dove}/${f.id}`) : null,
  }
}

/**
 * @param {'2014'|'2024'} edizione
 * @param {Fonti} fonti
 * @param {Record<string, any>} extra  quanto si è letto dai PDF per il 2024
 * @returns {Record<string, any>}
 */
function costruisciClassi(edizione, fonti, extra) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const cls of [...fonti.classi].sort((a, b) => per(a.id, b.id))) {
    /** @type {Record<string, any>} */
    const sottoclassi = {}
    for (const s of [...cls.subclasses].sort((a, b) => per(a.id, b.id))) {
      sottoclassi[s.id] = {
        id: String(s.id),
        name: fonti.nomiSottoclasse[s.id] ?? String(s.name),
        nameEn: String(s.name),
        features: s.features
          .map(/** @param {any} f */ f => privilegio(f, fonti, `${edizione}/${cls.id}/${s.id}`))
          .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
      }
    }
    const asi = asiLevels(cls)
    const boon = epicBoonLevel(cls)
    out[cls.id] = {
      id: String(cls.id),
      name: fonti.nomiClasse[cls.name] ?? String(cls.name),
      nameEn: String(cls.name),
      hitDie: Number(cls.hitDie),
      savingThrows: [...cls.savingThrows],
      subclassLevel: Number(cls.subclassLevel),
      subclassName: String(cls.subclassName),
      casterType: cls.spellcasting?.casterType ?? null,
      spellcastingAbility: cls.spellcasting?.ability ?? null,
      asiLevels: asi,
      epicBoonLevel: boon,
      weaponMastery: extra['padronanza']?.[cls.id] ?? null,
      features: cls.features
        .map(/** @param {any} f */ f => privilegio(f, fonti, `${edizione}/${cls.id}`))
        .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
      subclasses: sottoclassi,
    }
  }
  return out
}

/**
 * Le razze con i loro tratti. `featuresTraits` di uno snapshot vero mescola
 * privilegi di classe, tratti razziali e privilegi di background: se il
 * pacchetto porta solo le classi, un terzo di quella lista resta in inglese o
 * in kebab-case sulla scheda. Da cui questa chiave e la prossima.
 *
 * Il builder tiene i tratti come soli id, e i **nomi** italiani sono in
 * `traitNamesIt`; il testo no, in nessuna delle due edizioni. Quello arriva
 * dai PDF degli SRD, appaiato tratto per tratto da `TRATTI_SRD`; dove l'SRD
 * non pubblica il tratto, `description` resta `null`.
 *
 * @param {readonly any[]} razze
 * @param {Record<string, string>} nomiRazza     nome inglese → italiano
 * @param {Record<string, string>} nomiSottorazza
 * @param {Record<string, string>} nomiTratto    id → italiano
 * @param {Map<string, string>} testi            `razza/sottorazza/idTratto` → testo
 * @returns {Record<string, any>}
 */
function costruisciRazze(razze, nomiRazza, nomiSottorazza, nomiTratto, testi) {
  /**
   * @param {string} razza
   * @param {string} sotto
   * @returns {(id: any) => {id: string, name: string, nameEn: string, description: string|null}}
   */
  const tratto = (razza, sotto) => id => ({
    id: String(id),
    name: nomiTratto[id] ?? leggibile(String(id)),
    nameEn: leggibile(String(id)),
    description: testi.get(`${razza}/${sotto}/${id}`) ?? null,
  })
  /** @type {Record<string, any>} */
  const out = {}
  for (const r of [...razze].sort((a, b) => per(a.id, b.id))) {
    /** @type {Record<string, any>} */
    const sottorazze = {}
    for (const s of [...r.subraces].sort((a, b) => per(a.id, b.id))) {
      sottorazze[s.id] = {
        id: String(s.id),
        name: nomiSottorazza[s.name] ?? String(s.name),
        nameEn: String(s.name),
        traits: [...s.traits].sort(per).map(tratto(String(r.id), String(s.id))),
      }
    }
    out[r.id] = {
      id: String(r.id),
      name: nomiRazza[r.name] ?? String(r.name),
      nameEn: String(r.name),
      traits: [...r.traits].sort(per).map(tratto(String(r.id), '')),
      subraces: sottorazze,
    }
  }
  return out
}

/**
 * I background con il loro privilegio. Il testo italiano non c'è nel builder e
 * viene dai PDF; l'inglese sì, e resta in un campo che dichiara di esserlo,
 * così chi lo mostra sa cosa sta mostrando.
 * @param {readonly any[]} background
 * @param {Record<string, string>} nomiBackground
 * @param {Record<string, string>} nomiPrivilegio
 * @param {Map<string, string>} testi  `background/privilegio` → testo italiano
 * @returns {Record<string, any>}
 */
function costruisciBackground(background, nomiBackground, nomiPrivilegio, testi) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const b of [...background].sort((a, b) => per(a.id, b.id))) {
    const f = b.feature
    const id = f ? slug(String(f.name)) : ''
    out[b.id] = {
      id: String(b.id),
      name: nomiBackground[b.name] ?? String(b.name),
      nameEn: String(b.name),
      features: f ? [{
        id,
        name: nomiPrivilegio[f.name] ?? String(f.name),
        nameEn: String(f.name),
        description: testi.get(`${b.id}/${id}`) ?? null,
        descriptionEn: pulisci(String(f.description ?? ''), `background/${b.id}`) || null,
      }] : [],
    }
  }
  return out
}

/**
 * Le armature. Il builder salva sulla scheda il **nome inglese** («Chain
 * Mail»), non lo slug: il pacchetto porta tutti e due, altrimenti un guerriero
 * in cotta di maglia finisce con CA 11 invece di 16 senza che nulla lo dica.
 * @param {readonly any[]} armature
 * @param {Record<string, string>} nomiArmatura
 * @returns {Record<string, any>}
 */
function costruisciArmature(armature, nomiArmatura) {
  const TIPI = { light: 'leggera', medium: 'media', heavy: 'pesante', shield: 'scudo' }
  /** @type {Record<string, any>} */
  const out = {}
  for (const a of [...armature].sort((x, y) => per(x.name, y.name))) {
    const id = slug(String(a.name))
    out[id] = {
      id,
      name: String(a.name),                                   // com'è scritto nello snapshot
      nome: nomiArmatura[a.name] ?? String(a.name),           // com'è scritto sulla scheda
      ca: Number(a.baseAC),
      tipo: TIPI[/** @type {keyof typeof TIPI} */ (a.type)] ?? String(a.type),
      maxDex: a.maxDexBonus === null ? null : Number(a.maxDexBonus),
      furtivita: !a.stealthDisadvantage,
    }
  }
  return out
}

/** @param {string} v @returns {string} */
function slug(v) {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** `draconic-ancestry` → `Draconic Ancestry`. Ripiego, non traduzione. @param {string} v */
function leggibile(v) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return v
  return v.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

// ── Serializzazione deterministica ─────────────────────────────────────────

/**
 * JSON con le chiavi in ordine, sempre. Senza questo «rigenerare non produce
 * diff» dipenderebbe dall'ordine di inserzione, che è un dettaglio.
 * @param {unknown} v
 * @returns {unknown}
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

// ── Il lavoro ──────────────────────────────────────────────────────────────

/**
 * La data del commit del builder, non l'ora di adesso: `generatedAt` serve a
 * dire *da cosa* è stato generato il pacchetto, e tenendolo agganciato alla
 * sorgente la rigenerazione resta byte per byte identica.
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

/**
 * Il piè di pagina dell'SRD non è colato nelle descrizioni dei privilegi — è
 * colato in quelle degli **incantesimi**, che sono del lotto M. Qui non si
 * tocca niente: si conta e si dice, sia perché il numero va riportato, sia
 * perché è l'unica prova positiva che il sanificatore funziona (sui privilegi
 * non ha niente da tagliare, e uno zero da solo non distingue «pulito» da
 * «pattern rotto»).
 */
async function sondaSporcizia() {
  /** @type {string[]} */
  const colpiti = []
  for (const rel of ['data/dnd5e/spells.ts', 'data/dnd5e/spells-4-9.ts', 'data/dnd2024/spells-new.ts']) {
    if (!existsSync(join(BUILDER, 'src', rel))) continue
    const mod = await caricaTs(rel)
    for (const valore of Object.values(mod)) {
      if (!Array.isArray(valore)) continue
      for (const voce of valore) {
        const d = voce?.description
        if (typeof d !== 'string') continue
        if (SPORCIZIA.some(({ re }) => (re.lastIndex = 0, re.test(d)))) {
          colpiti.push(`${rel}:${voce.id}`)
        }
      }
    }
  }
  console.log(
    `  sonda sugli incantesimi del builder (lotto M): ${colpiti.length} descrizioni sporche` +
    (colpiti.length ? `\n    ${colpiti.join(', ')}` : '')
  )
}

async function main() {
  const pdf2014 = trovaPdf(ARG['srd2014'], 'SRD_CC_v5.1_IT.pdf')
  const pdf2024 = trovaPdf(ARG['srd2024'], 'IT_SRD_CC_v5.2.1.pdf')
  const src = sorgente()

  const cls2014 = await caricaTs('data/dnd5e/classes.ts')
  const cls2024 = await caricaTs('data/dnd2024/classes.ts')
  const it2014 = await caricaTs('data/dnd5e/classes-it.ts')
  const it2024 = await caricaTs('data/dnd2024/classes-it.ts')
  const termini = await caricaTs('i18n/gameTerms.ts')
  const tabelle = await caricaTs('data/dnd5e/rules.ts')
  const mastery = await caricaTs('data/dnd2024/mastery.ts')
  const razze2014 = await caricaTs('data/dnd5e/races.ts')
  const razze2024 = await caricaTs('data/dnd2024/races.ts')
  const bg2014 = await caricaTs('data/dnd5e/backgrounds.ts')
  const bg2024 = await caricaTs('data/dnd2024/backgrounds.ts')
  const equip = await caricaTs('data/dnd5e/equipment.ts')

  // Le armature sono le stesse nelle due edizioni: l'SRD 5.2.1 non ne ha
  // cambiato né i valori né i nomi, e il builder infatti non ne ha una copia
  // per il 2024. La tabella va quindi in tutti e due i pacchetti.
  const armature = costruisciArmature(equip['armor'], termini['armorNamesIt'])

  /** @type {Fonti} */
  const fonti2014 = {
    classi: cls2014['classes'],
    testi: it2014['dnd5eFeatureDescriptionsIt'],
    nomi: termini['featureNamesIt'],
    nomiSottoclasse: termini['subclassNamesIt'],
    nomiClasse: termini['classNamesIt'],
  }
  /** @type {Fonti} */
  const fonti2024 = {
    classi: cls2024['dnd2024Classes'],
    testi: it2024['dnd2024FeatureDescriptionsIt'],
    nomi: termini['featureNamesIt'],
    nomiSottoclasse: termini['subclassNamesIt'],
    nomiClasse: termini['classNamesIt'],
  }

  // ── 2024: le colonne che il builder non ha, lette dalle tabelle del PDF ──
  const layout = righePdf(pdf2024, true)
  /** Titolo della tabella e articolo, come li scrive l'SRD italiano. */
  const TITOLI = {
    barbarian: 'Privilegi del barbaro', bard: 'Privilegi del bardo',
    cleric: 'Privilegi del chierico', druid: 'Privilegi del druido',
    fighter: 'Privilegi del guerriero', monk: 'Privilegi del monaco',
    paladin: 'Privilegi del paladino', ranger: 'Privilegi del ranger',
    rogue: 'Privilegi del ladro', sorcerer: 'Privilegi dello stregone',
    warlock: 'Privilegi del warlock', wizard: 'Privilegi del mago',
  }

  /** @type {Record<string, number[]>} */ const preparati2024 = {}
  /** @type {Record<string, number[][]>} */ const slot2024 = {}
  /** @type {Record<string, number[]>} */ const padronanza2024 = {}
  /** @type {string[]} */ const controlli = []

  for (const cls of fonti2024.classi) {
    const titolo = TITOLI[/** @type {keyof typeof TITOLI} */ (cls.id)]
    if (!titolo) continue
    const tab = tabellaClasse(layout, titolo)
    const tipo = cls.spellcasting?.casterType ?? null
    if (tipo === 'full' || tipo === 'half' || tipo === 'pact') {
      const { cantrips, prepared, slots } = colonneIncantesimi(tab, tipo)
      preparati2024[cls.id] = prepared
      slot2024[cls.id] = slots
      // Invariante: i trucchetti letti dalla tabella devono coincidere con
      // quelli del builder. Se non coincidono ho letto la colonna sbagliata.
      if (tipo !== 'half') {
        const attesi = cls.spellcasting.cantripsKnown
        const letti = cantrips.map(/** @param {number|null} n */ n => n ?? 0)
        if (JSON.stringify(letti) !== JSON.stringify(attesi)) {
          throw new Error(
            `${cls.id}: i trucchetti letti dal PDF non coincidono con il builder\n` +
            `  PDF     ${letti.join(',')}\n  builder ${attesi.join(',')}`
          )
        }
        controlli.push(`${cls.id}: trucchetti ✓`)
      }
    }
    // Solo barbaro, guerriero e ladro hanno la padronanza in tabella. Paladino
    // e ranger la ottengono al 1° e non cresce: il numero sta nel testo del
    // privilegio, non in una colonna.
    if (cls.id === 'barbarian' || cls.id === 'fighter') {
      padronanza2024[cls.id] = colonnaPadronanza(tab)
    } else if (cls.id === 'rogue' || cls.id === 'paladin' || cls.id === 'ranger') {
      padronanza2024[cls.id] = Array(20).fill(2)
    }
  }

  // Gli slot dei semi-incantatori del 2024 vengono dal PDF: nel builder
  // paladino e ranger usano ancora la tabella del 2014, che parte dal 2°.
  const slotHalf2024 = slot2024['paladin'] ?? []
  if (JSON.stringify(slotHalf2024) !== JSON.stringify(slot2024['ranger'])) {
    throw new Error('paladino e ranger dovrebbero avere gli stessi slot nel 2024')
  }
  if ((slotHalf2024[0] ?? []).length !== 1) {
    throw new Error('nel 2024 i semi-incantatori lanciano già dal 1° livello: la tabella letta dice di no')
  }
  // I lanciatori pieni e il warlock, invece, il builder li ha giusti: qui si
  // verifica soltanto che il PDF confermi, e poi si usa la tabella del builder.
  for (const [id, atteso] of /** @type {[string, unknown][]} */ ([
    ['bard', tabelle['FULL_CASTER_SLOTS']],
    ['wizard', tabelle['FULL_CASTER_SLOTS']],
  ])) {
    if (JSON.stringify(slot2024[id]) !== JSON.stringify(atteso)) {
      throw new Error(`${id}: gli slot letti dal PDF non coincidono con la tabella del builder`)
    }
    controlli.push(`${id}: slot ✓`)
  }

  // ── Condizioni ────────────────────────────────────────────────────────────
  const flat2014 = righePdf(pdf2014, false)
  const flat2024 = righePdf(pdf2024, false)
  const cond2014 = condizioni2014(flat2014)
  const cond2024 = condizioni2024(flat2024)

  // ── Tratti razziali e privilegi di background, dalla prosa dei due SRD ────
  /** @type {string[]} */
  const scoperti = []
  const tratti2014 = trattiRazziali(flat2014, righePdf(pdf2014, true), TRATTI_SRD['2014'], '2014', scoperti)
  const tratti2024 = trattiRazziali(flat2024, layout, TRATTI_SRD['2024'], '2024', scoperti)
  const bgTesti2014 = privilegiBackground(flat2014, TRATTI_SRD['2014'], '2014', scoperti)
  const bgTesti2024 = privilegiBackground(flat2024, TRATTI_SRD['2024'], '2024', scoperti)

  /** @param {Map<string, string>} mappa @returns {any[]} */
  const elencoCondizioni = mappa => CONDIZIONI.map(c => ({
    id: c.id,
    name: c.nome,
    description: mappa.get(c.id) ?? null,
  }))

  // ── Slot, trucchetti, incantesimi ─────────────────────────────────────────

  /** @param {'2014'|'2024'} ed @param {Fonti} fonti @returns {Record<string, any>} */
  function cantripsKnown(ed, fonti) {
    /** @type {Record<string, number[]>} */
    const out = {}
    for (const c of fonti.classi) {
      if (c.spellcasting) out[c.id] = [...c.spellcasting.cantripsKnown]
    }
    return out
  }

  /**
   * Quanti incantesimi si portano. Le due edizioni non rispondono nello stesso
   * modo, e il campo lo dice invece di appiattire: nel 2014 chi prepara usa la
   * formula «modificatore + livello», nel 2024 c'è una colonna in tabella.
   * @param {'2014'|'2024'} ed
   * @param {Fonti} fonti
   * @returns {Record<string, any>}
   */
  function preparedSpells(ed, fonti) {
    /** @type {Record<string, any>} */
    const out = {}
    for (const c of fonti.classi) {
      if (!c.spellcasting) continue
      if (ed === '2024') {
        out[c.id] = { mode: 'prepared', table: preparati2024[c.id] ?? null }
      } else if (c.spellcasting.spellsKnown) {
        out[c.id] = { mode: 'known', table: [...c.spellcasting.spellsKnown] }
      } else {
        out[c.id] = { mode: 'prepared', formula: 'mod+livello', table: null }
      }
    }
    return out
  }

  /** @param {'2014'|'2024'} ed @returns {Record<string, any>} */
  function spellSlots(ed) {
    const pact = tabelle['PACT_MAGIC_SLOTS'].map(/** @param {any} r */ r =>
      ({ slots: r.slots, slotLevel: r.slotLevel }))
    return {
      full: tabelle['FULL_CASTER_SLOTS'].map(/** @param {number[]} r */ r => [...r]),
      half: ed === '2024' ? slotHalf2024 : tabelle['HALF_CASTER_SLOTS'].map(/** @param {number[]} r */ r => [...r]),
      third: tabelle['THIRD_CASTER_SLOTS'].map(/** @param {number[]} r */ r => [...r]),
      pact,
    }
  }

  const padronanza = {
    properties: [...mastery['masteryProperties']]
      .sort(/** @param {any} a @param {any} b */ (a, b) => per(a.id, b.id))
      .map(/** @param {any} p */ p => ({
        id: p.id,
        name: p.nameIt,
        nameEn: p.name,
        description: pulisci(p.description, `2024/padronanza/${p.id}`),
      })),
    weapons: mastery['weaponMastery'],
    perClass: padronanza2024,
  }

  // ── I due pacchetti ───────────────────────────────────────────────────────

  /** @type {Array<{edizione: '2014'|'2024', srd: string, fonti: Fonti, condizioni: Map<string, string>, extra: Record<string, any>, razze: Record<string, any>, background: Record<string, any>}>} */
  const pacchetti = [
    {
      edizione: '2014', srd: '5.1', fonti: fonti2014, condizioni: cond2014, extra: {},
      razze: costruisciRazze(razze2014['races'], termini['raceNamesIt'], termini['subraceNamesIt'], termini['traitNamesIt'], tratti2014),
      background: costruisciBackground(bg2014['backgrounds'], termini['backgroundNamesIt'], termini['featureNamesIt'], bgTesti2014),
    },
    {
      edizione: '2024', srd: '5.2.1', fonti: fonti2024, condizioni: cond2024, extra: { padronanza: padronanza2024 },
      razze: costruisciRazze(razze2024['dnd2024Species'], termini['raceNamesIt'], termini['subraceNamesIt'], termini['traitNamesIt'], tratti2024),
      background: costruisciBackground(bg2024['dnd2024Backgrounds'], termini['backgroundNamesIt'], termini['featureNamesIt'], bgTesti2024),
    },
  ]

  mkdirSync(USCITA, { recursive: true })
  /** @type {any[]} */
  const indice = []
  /** @type {string[]} */
  const rapporto = []

  for (const p of pacchetti) {
    const classi = costruisciClassi(p.edizione, p.fonti, p.extra)
    /** @type {Record<string, unknown>} */
    const pacchetto = {
      edizione: p.edizione,
      srd: p.srd,
      generatedAt: src.at,
      sourceCommit: src.commit,
      xpThresholds: [...XP_THRESHOLDS],
      classes: classi,
      races: p.razze,
      backgrounds: p.background,
      armature,
      spellSlots: spellSlots(p.edizione),
      cantripsKnown: cantripsKnown(p.edizione, p.fonti),
      preparedSpells: preparedSpells(p.edizione, p.fonti),
      conditions: elencoCondizioni(p.condizioni),
    }
    if (p.edizione === '2024') pacchetto['weaponMastery'] = padronanza

    const testo = JSON.stringify(ordina(pacchetto), null, 0) + '\n'
    const file = join(USCITA, `${p.edizione}.json`)
    writeFileSync(file, testo)

    const bytes = Buffer.byteLength(testo)
    indice.push({
      id: p.edizione === '2014' ? 'srd-2014' : 'srd-2024',
      edizione: p.edizione,
      srd: p.srd,
      file: `${p.edizione}.json`,
      version: createHash('sha256').update(testo).digest('hex').slice(0, 12),
      bytes,
    })

    const nClassi = Object.keys(classi).length
    let nPriv = 0, nSub = 0, nSubPriv = 0, senzaTesto = 0
    for (const c of Object.values(classi)) {
      nPriv += c.features.length
      senzaTesto += c.features.filter(/** @param {any} f */ f => f.description === null).length
      for (const s of Object.values(c.subclasses)) {
        nSub++
        nSubPriv += s.features.length
        senzaTesto += s.features.filter(/** @param {any} f */ f => f.description === null).length
      }
    }
    const condVuote = elencoCondizioni(p.condizioni).filter(c => c.description === null).length
    const razze = Object.values(p.razze)
    const nSottorazze = razze.reduce((n, r) => n + Object.keys(r.subraces).length, 0)
    const nTratti = razze.reduce(
      (n, r) => n + r.traits.length + Object.values(r.subraces).reduce(
        /** @param {number} m @param {any} s */ (m, s) => m + s.traits.length, 0),
      0)
    const nBg = Object.keys(p.background).length
    const nBgPriv = Object.values(p.background).reduce((n, b) => n + b.features.length, 0)
    /** @param {any[]} v @returns {number} */
    const conTesto = v => v.filter(x => x.description !== null).length
    const trattiConTesto = razze.reduce(
      (n, r) => n + conTesto(r.traits) + Object.values(r.subraces).reduce(
        /** @param {number} m @param {any} s */ (m, s) => m + conTesto(s.traits), 0),
      0)
    const bgConTesto = Object.values(p.background).reduce((n, b) => n + conTesto(b.features), 0)
    rapporto.push(
      `${p.edizione} (SRD ${p.srd}) — ${nClassi} classi, ${nPriv} privilegi di classe, ` +
      `${nSub} sottoclassi con ${nSubPriv} privilegi, ${bytes} byte` +
      `\n    ${razze.length} razze (${nSottorazze} sottorazze, ${nTratti} tratti), ` +
      `${nBg} background (${nBgPriv} privilegi), ${Object.keys(armature).length} armature` +
      (senzaTesto ? `\n    ⚠ ${senzaTesto} privilegi di classe senza testo italiano` : '') +
      `\n    testo dall'SRD: ${trattiConTesto}/${nTratti} tratti razziali, ` +
      `${bgConTesto}/${nBgPriv} privilegi di background` +
      (condVuote ? `\n    ⚠ ${condVuote} condizioni su ${CONDIZIONI.length} senza testo nel PDF` : '')
    )
  }

  const testoIndice = JSON.stringify(ordina({ v: 1, packs: indice }), null, 2) + '\n'
  writeFileSync(join(USCITA, 'index.json'), testoIndice)

  // ── Rapporto ──────────────────────────────────────────────────────────────
  console.log(`builder: ${BUILDER} @ ${src.commit} (${src.at})`)
  console.log(`SRD 5.1:   ${pdf2014}`)
  console.log(`SRD 5.2.1: ${pdf2024}`)
  console.log('')
  for (const r of rapporto) console.log('  ' + r)
  console.log('')
  console.log('  controlli incrociati PDF↔builder: ' + controlli.join(', '))
  if (scoperti.length) {
    console.log(`  tratti e privilegi non agganciati nei PDF: ${scoperti.length}`)
    for (const s of scoperti) console.log(`    · ${s}`)
  }
  await sondaSporcizia()
  const totaleTagli = Object.values(tagli).reduce((a, b) => a + b, 0)
  if (totaleTagli === 0) {
    console.log('  igiene del testo: nessun taglio (0 descrizioni sporche)')
  } else {
    console.log(`  igiene del testo: ${totaleTagli} tagli`)
    for (const [nome, n] of Object.entries(tagli).sort((a, b) => per(a[0], b[0]))) {
      console.log(`    · ${nome}: ${n}`)
    }
    for (const s of sporchi.slice(0, 20)) console.log(`      ${s}`)
  }
  console.log('')
  console.log(`  scritti ${indice.map(i => i.file).join(', ')} e index.json in ${USCITA}`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
