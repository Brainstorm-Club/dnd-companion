#!/usr/bin/env node
/**
 * Genera i pacchetti delle due varianti Acheron — Brancalonia e Apocalisse —
 * dal repo del builder e, per Brancalonia, dai suoi tre manuali:
 *
 *   node scripts/build-varianti.mjs [--builder ../../dnd-builder]
 *                                   [--manuali ../manuali/Brancalonia]
 *                                   [--senza-manuali]
 *
 * Scrive `data/rules/brancalonia.json`, `data/rules/apocalisse.json`,
 * il compendio `data/spells/brancalonia/`, e aggiorna le due voci in
 * `data/packs.json` (le due voci SRD non si toccano).
 *
 * ── Le due varianti non stanno sullo stesso piano ──────────────────────────
 *
 * Né Brancalonia né Apocalisse sono SRD, e nessuna delle due è CC-BY: sono di
 * Acheron Games. Ma **per Brancalonia il proprietario del progetto ha deciso
 * di pubblicare i testi**, avendone i manuali; per Apocalisse no.
 *
 * Da cui:
 *
 * · **Brancalonia** porta le descrizioni dei privilegi di classe e
 *   sottoclasse, dei tratti di razza e sottorazza, dei background, dei talenti
 *   e degli incantesimi propri, estratte dai tre PDF con `pdftotext`. Non le
 *   porta tutte: dove l'estrazione non è sicura la voce esce `null`, l'app
 *   dice che il testo non c'è, e il rapporto qui sotto elenca cosa manca.
 *   Meglio un privilegio senza testo che un privilegio con il testo di un
 *   altro, che è un errore che nessuno si accorge di avere.
 *
 * · **Apocalisse** resta com'era: nomi, id, numeri e parole chiave, e ogni
 *   campo descrittivo `null`. Lo verifica
 *   `tests/unit/varianti-senza-testo.test.js`: se un giorno si rigenera anche
 *   quello con i testi, quel test deve fallire e costringere a decidere.
 *
 * Restano fuori da tutti e due, perché questo lotto non li ha toccati: i
 * testi delle mosse da rissa, delle batoste, delle Emeriticenze, delle Virtù,
 * dei Peccati e degli Spiriti dei Marchi, e l'equipaggiamento iniziale dei
 * background (nel builder è una frase, non un elenco di id).
 *
 * ── I manuali ──────────────────────────────────────────────────────────────
 *
 * I PDF non stanno nel repo (`.gitignore` esclude `*.pdf`): si committa solo
 * il JSON generato. Se non ci sono il generatore si ferma e dice dove li
 * cercava; `--senza-manuali` rigenera senza descrizioni, ma è una scelta da
 * fare a voce alta perché cancella quelle già estratte.
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
const MANUALI_DIR = resolve(RADICE, ARG['manuali'] ?? '../manuali/Brancalonia')
// L'unico modo di rigenerare senza i testi, e va chiesto a voce alta: il
// default è che i manuali ci siano, perché senza il diff cancella le
// descrizioni già estratte senza che nessuno l'abbia deciso.
const SENZA_MANUALI = ARG['senza-manuali'] === 'true'
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

// ── I manuali di Brancalonia ───────────────────────────────────────────────
//
// I testi delle regole di Brancalonia non stanno nel builder: stanno nei tre
// manuali di Acheron Games, e da lì si estraggono con `pdftotext`. I PDF non
// entrano nel repo (`.gitignore` esclude `*.pdf`): si committa solo il JSON.

/**
 * I tre volumi, nell'edizione italiana da cui vengono i testi. La versione fa
 * parte del nome del file apposta: l'attribuzione nel registro dichiara quale
 * edizione si è letta, e due edizioni diverse non dicono le stesse cose.
 * @type {ReadonlyArray<{id: string, file: string}>}
 */
const MANUALI = [
  { id: 'ambientazione', file: 'Brancalonia_-_Manuale_di_Ambientazione_ITA_2.6.pdf' },
  { id: 'macaronicon', file: 'Brancalonia_-_Macaronicon_ITA_2.2.pdf' },
  { id: 'impero', file: 'Brancalonia_-_Limpero_Randella_Ancora_1.0.pdf' },
]

/**
 * Il testo di un PDF, con o senza `-layout`. Le due modalità servono a due
 * cose diverse e si leggono entrambe: vedi `caricaManuali`.
 * @param {string} pdf @param {boolean} layout @returns {string}
 */
function pdftotext(pdf, layout) {
  const args = ['-enc', 'UTF-8']
  if (layout) args.push('-layout')
  args.push(pdf, '-')
  try {
    return execFileSync('pdftotext', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch (e) {
    throw new Error(
      `pdftotext non ha funzionato su ${pdf}. Serve poppler (brew install poppler).\n` +
      (e instanceof Error ? e.message : String(e))
    )
  }
}

/** Apostrofi tipografici, spazi unificatori e spazi doppi: via tutti. @param {string} s */
function norm(s) {
  return s.replace(/[’ʼ´`]/g, "'").replace(/[“”]/g, '"')
    .replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** La chiave con cui si confrontano due titoli. @param {string} s */
function chiave(s) {
  // «E' Già Morto!» nel builder, «È Già Morto!» sul manuale: la vocale
  // accentata scritta con l'apostrofo è la stessa lettera, e vanno confrontate
  // uguali o il tratto resta senza testo per un dettaglio tipografico.
  /** @type {Record<string, string>} */
  const acc = { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù' }
  return norm(s).toLowerCase()
    .replace(/\b([aeiou])'(?=\s|$)/g, (_, v) => acc[v] ?? v)
    .replace(/[.,;:!?]+$/, '')
}

/** La filigrana personale del PDF acquistato: non deve finire da nessuna parte. */
const FILIGRANA = /\(Order\s*#\d+\)/

/** «- 42 -», e le due metà che ne restano quando il taglio fra le colonne ci passa in mezzo. */
const NUMERO_DI_PAGINA = /^(?:[-–]\s*\d{1,3}\s*[-–]?|\d{1,3}\s*[-–])$/

/**
 * Le colonne di una pagina letta con `-layout`. Si cercano i corridoi
 * verticali — colonne di caratteri quasi sempre vuote, larghe almeno sei — e
 * si taglia lì. È l'unico modo per non far intrecciare due colonne di testo:
 * senza `-layout` poppler a volte mette in fila il primo paragrafo di sinistra
 * e il secondo di destra, e un privilegio si ritrova la descrizione di un altro.
 *
 * Una riga che scavalca un corridoio (un titolo a tutta pagina, una riga di
 * tabella) non si spezza a metà: resta intera nella prima banda che tocca.
 *
 * @param {string[]} righe @returns {string[][]}
 */
function bande(righe) {
  const utili = righe.filter(r => r.trim())
  if (utili.length < 6) return [righe]
  const larghezza = Math.max(...utili.map(r => r.length))
  const pieno = new Array(larghezza + 1).fill(0)
  for (const r of utili) for (let x = 0; x < r.length; x++) if (r[x] !== ' ') pieno[x]++
  const soglia = Math.max(1, Math.floor(utili.length * 0.15))
  /** @type {number[]} */
  const tagli = []
  let x = 0
  while (x <= larghezza) {
    if ((pieno[x] ?? 0) <= soglia) {
      let y = x
      while (y <= larghezza && (pieno[y] ?? 0) <= soglia) y++
      if (y - x >= 6 && x > 0 && y <= larghezza) tagli.push(Math.floor((x + y) / 2))
      x = y
    } else x++
  }
  if (!tagli.length) return [righe]
  const limiti = [0, ...tagli, larghezza + 1]
  /** @type {string[][]} */
  const out = limiti.slice(0, -1).map(() => [])
  for (const r of righe) {
    const scavalca = tagli.some(c => r[c - 1]?.trim() && r[c]?.trim() && r[c + 1]?.trim())
    let messa = false
    for (let i = 0; i < limiti.length - 1; i++) {
      const pezzo = r.slice(limiti[i], limiti[i + 1] ?? undefined)
      if (scavalca) {
        out[i]?.push(!messa && pezzo.trim() ? r.trim() : '')
        if (pezzo.trim()) messa = true
      } else out[i]?.push(pezzo.trimEnd())
    }
  }
  return out
}

/**
 * Un manuale ridotto a un flusso di righe: via la filigrana, via il numero di
 * pagina, via l'intestazione corrente, e una riga vuota a segnare ogni confine
 * di pagina o di colonna.
 *
 * L'intestazione corrente non si elenca a mano: è la prima riga utile che si
 * ripete su almeno tre pagine. Una lista scritta a mano invecchierebbe al
 * primo manuale nuovo.
 *
 * L'intestazione può occupare due righe («Nuovo Equipaggiamento / e Nuovi
 * Incantesimi»): si contano le prime due righe utili di ogni pagina, e si
 * toglie ciò che si ripete. Un titolo che il pacchetto usa non si tocca mai,
 * anche se capita in cima a due pagine: sarebbe il modo di perdere una voce.
 *
 * @param {string} testo uscita di pdftotext
 * @param {boolean} perColonne se dividere ogni pagina nelle sue colonne
 * @param {Set<string>} protetti chiavi che non sono mai mobilia di pagina
 * @returns {{righe: Array<{t: string, pag: number}>}}
 */
function flusso(testo, perColonne, protetti) {
  const pagine = testo.split('\f').map(p => p.split('\n'))
  /** @type {Map<string, number>} */
  const conta = new Map()
  for (const p of pagine) {
    const utili = p.map(norm).filter(Boolean).slice(0, 2)
    for (const r of utili) conta.set(r, (conta.get(r) ?? 0) + 1)
  }
  const teste = new Set([...conta]
    .filter(([r, n]) => n >= 2 && r.length < 60 && !FILIGRANA.test(r) && !protetti.has(chiave(r)))
    .map(([r]) => r))
  /** @type {Array<{t: string, pag: number}>} */
  const righe = []
  pagine.forEach((p, ip) => {
    for (const banda of perColonne ? bande(p) : [p]) {
      const pulite = banda.map(norm)
        .filter(r => !FILIGRANA.test(r) && !NUMERO_DI_PAGINA.test(r))
      let i = 0
      while (i < pulite.length && !pulite[i]) i++
      let salti = 0
      while (i < pulite.length && salti < 3 && teste.has(pulite[i] ?? '')) {
        i++; salti++
        while (i < pulite.length && !pulite[i]) i++
      }
      const dentro = pulite.slice(i).map(t => ({ t, pag: ip }))
      while (dentro.length && !dentro[dentro.length - 1]?.t) dentro.pop()
      if (dentro.length) { righe.push(...dentro, { t: '', pag: ip }) }
    }
  })
  return { righe }
}

/**
 * I tre manuali, ciascuno letto due volte.
 *
 * `-layout` conserva le colonne — e tagliandole a mano si ottiene l'ordine di
 * lettura vero — ma spezza le parole a fine riga e ogni tanto, dove il
 * corridoio fra le colonne non è netto, mescola due righe in una.
 * Senza `-layout` poppler ricuce le parole da sé ma ogni tanto sbaglia
 * l'ordine dei paragrafi.
 *
 * Nessuna delle due è affidabile da sola, e le due sbagliano in modo diverso:
 * si estrae con tutte e due e si spedisce solo ciò su cui concordano. È il
 * motivo per cui questo lotto non attribuisce in silenzio il testo sbagliato.
 *
 * @param {string} cartella
 * @param {Set<string>} protetti chiavi che non vanno scambiate per mobilia
 */
function caricaManuali(cartella, protetti) {
  const sillabate = new Set()
  const libri = MANUALI.map(m => {
    const pdf = join(cartella, m.file)
    if (!existsSync(pdf)) throw new Error(mancanoIManuali(cartella, m.file))
    const piano = pdftotext(pdf, false)
    // Le parole che portano il trattino per davvero («anti-magia»): le si
    // impara dall'estrazione senza -layout, che le sillabazioni le ha già
    // ricucite. Serve a ricucire quelle di -layout senza incollare «antimagia».
    for (const w of piano.matchAll(/[A-Za-zà-ùÀ-Ù]+-[a-zà-ù]+/g)) sillabate.add(w[0].toLowerCase())
    return { ...m, colonne: flusso(pdftotext(pdf, true), true, protetti), piano: flusso(piano, false, protetti) }
  })
  return { libri, sillabate }
}

/** @param {string} cartella @param {string} file */
function mancanoIManuali(cartella, file) {
  return `Manuale di Brancalonia non trovato: ${file}\n` +
    `Cercato in: ${cartella}\n` +
    `Passa la cartella con --manuali <percorso>. I PDF non stanno nel repo:\n` +
    `sono i manuali di Acheron Games, e si committa solo il JSON generato.\n` +
    `Per rigenerare i pacchetti senza i testi (e azzerare quelli già estratti)\n` +
    `usa --senza-manuali, sapendo che il diff toglierà ogni descrizione.`
}

/**
 * L'attacco in neretto di un tratto: un nome breve chiuso da un punto, da solo
 * su una riga o seguito da una maiuscola. Il manuale non lo scrive tutto in
 * maiuscolo — «Costrutto di fanfaluco», «Magico ma sempre legno» — quindi la
 * maiuscola non può essere il criterio.
 */
const ATTACCO = /^([A-ZÀ-Ù][^.;?!]{1,58})[.!](?:\s+[A-ZÀ-Ù0-9«"]|$)/

/**
 * Il nome dell'attacco, o `null` se quella riga è la fine di una frase.
 *
 * Un nome può contenere una virgola («Tirare le Sole, non le Cuoia»), e allora
 * la forma da sola non lo distingue da «Se lo supera, l'incantesimo termina.»:
 * solo lì si chiede anche che sia scritto come un nome, cioè con almeno metà
 * delle parole in maiuscola.
 * Quando il neretto sta da solo su una riga la forma non dice più niente —
 * qualunque riga di prosa che finisca il periodo le somiglia — e allora si
 * chiede che la riga prima abbia chiuso la sua, perché un attacco apre sempre
 * un capoverso. Senza questo, «Recupera i Dadi / Vita spesi quando completa un
 * riposo lungo.» diventava un tratto di nome «Vita spesi quando…».
 *
 * @param {string} riga @param {string} precedente @returns {string|null}
 */
function attaccoDi(riga, precedente) {
  const m = ATTACCO.exec(riga)
  if (!m) return null
  const nome = m[1] ?? ''
  if (nome.length + 1 >= riga.length && precedente && !/[.!?…:»"]$/.test(precedente)) return null
  const parole = nome.split(/\s+/).filter(Boolean)
  if (parole.length > 8) return null
  if (!nome.includes(',')) return nome
  const maiuscole = parole.filter(w => /^[A-ZÀ-Ù]/.test(w)).length
  return maiuscole * 2 >= parole.length ? nome : null
}

/** Una riga che ha l'aria di un titolo e non di un capoverso. @param {string} r */
function titoloLike(r) {
  return r.length < 55 && !/[.,;:!?)»"'-]$/.test(r) && !/^[a-zà-ù•]/.test(r)
}

/**
 * Il blocco di testo che segue un titolo.
 *
 * Si ferma alla prima riga vuota — che qui segna anche il confine di una
 * colonna o di una pagina — e la scavalca solo quando il testo è visibilmente
 * tagliato a metà: ultima riga senza punteggiatura finale e ripresa in
 * minuscola. Fermarsi troppo presto perde un capoverso; tirare dritto si mangia
 * la sezione successiva, e un privilegio con addosso il testo di un altro è
 * l'errore che nessuno si accorge di avere.
 *
 * @param {Array<{t: string}>} righe
 * @param {number} i indice del titolo
 * @param {Set<string>} titoli gli altri titoli noti, che chiudono il blocco
 * @returns {string[]}
 */
function bloccoDopo(righe, i, titoli) {
  let j = i + 1
  while (j < righe.length && !righe[j]?.t) j++
  /** @type {string[]} */
  const out = []
  while (j < righe.length) {
    const r = righe[j]
    if (!r) break
    if (!r.t) {
      let k = j + 1
      while (k < righe.length && !righe[k]?.t) k++
      const p = righe[k]
      const ultima = out[out.length - 1] ?? ''
      if (!p || /[.!?…:»"]$/.test(ultima)) break
      if (titoli.has(chiave(p.t)) || titoloLike(p.t)) break
      if (!/^[a-zà-ù•(]/.test(p.t)) break
      j = k
      continue
    }
    if (out.length && titoli.has(chiave(r.t))) break
    out.push(r.t)
    j++
  }
  return out
}

/**
 * La coda di un testo interrotto, o `null` se quel capoverso comincia altro.
 *
 * Se l'ultima riga si è fermata a metà parola, la ripresa è per forza in
 * minuscola: tutto ciò che sta in mezzo è intestazione di pagina, e si salta —
 * anche quella che compare una volta sola e che il conteggio non riconosce.
 * @param {string} ultima @param {string[]} par @returns {string[]|null}
 */
function riprende(ultima, par) {
  if (!/[a-zà-ù]-$/.test(ultima)) return titoloLike(par[0] ?? '') ? null : par
  for (let i = 0; i < par.length && i < 3; i++) if (/^[a-zà-ù]/.test(par[i] ?? '')) return par.slice(i)
  return null
}

/**
 * Righe → testo unico. Le parole spezzate a fine riga da `-layout` si
 * ricuciono, tranne quelle che il trattino ce l'hanno per davvero.
 * @param {string[]} righe @param {Set<string>} sillabate
 */
function unisci(righe, sillabate) {
  let out = ''
  for (const r of righe) {
    if (!out) { out = r; continue }
    const m = /([A-Za-zà-ùÀ-Ù]+)-$/.exec(out)
    const n = /^([a-zà-ù]+)/.exec(r)
    if (m && n && !sillabate.has(`${m[1]}-${n[1]}`.toLowerCase())) out = out.slice(0, -1) + r
    else out += ' ' + r
  }
  return norm(out).replace(/\s+([,.;:!?])/g, '$1')
}

/**
 * Un testo è spedibile solo se è un capoverso intero: comincia da maiuscola e
 * finisce con la punteggiatura. Un frammento che comincia a metà frase è il
 * segno che una colonna è stata letta storta, e va scartato.
 * @param {string} t
 */
function testoIntero(t) {
  // Le citazioni a effetto del manuale finiscono con la riga di chi le dice,
  // fra trattini: sono impaginate come un capoverso ma non sono regole.
  if (/[-–]\s[^-–]{3,60}\s?[-–]$/.test(t)) return false
  return t.length >= 60 && /^[A-ZÀ-Ù«"•]/.test(t) && /[.!?…»")]$/.test(t)
}

/**
 * I nomi che il builder e i manuali scrivono in modo diverso. Non sono
 * scelte: sono divergenze vere fra le due fonti — a volte perché il manuale
 * stesso si contraddice fra la tabella dei livelli e il titolo del paragrafo
 * («Canzone Sottintesa» nella tabella, «Canzonetta Sottintesa» nel testo), a
 * volte perché il builder ha tradotto per conto suo. Senza questa tabella
 * quelle voci resterebbero senza testo.
 * @type {Record<string, string>}
 */
const NOMI_SUL_MANUALE = {
  // privilegi di sottoclasse
  'Canzone Sottintesa': 'Canzonetta Sottintesa',
  'Violenza Beneinesa': 'Violenza Benintesa',
  'Dettami del Cavalier Servente': "Dettami d'Amore",
  'Via della Regola Manesca': 'Via della Condotta Manesca',
  // background
  'Polverista': 'Polveriere',
  // incantesimi: il builder li ha ribattezzati, il manuale li chiama così
  'Storia Spaventosa': 'Racconto Agghiacciante',
  'Banchetto del Pezzente': 'Banchetto dei Poveri',
  'Bonificare': 'Mondare',
  'Dito del Fato': 'Dito della Sorte',
  'Pelle Fandonica': 'Fandonizzare',
  'Tributo Illusorio': 'Illusione Fiscale',
  'Chex': 'Emettere Fattura',
  'Arrostire': 'Infamare',
}

/**
 * Il cercatore di testi: tiene i due flussi di ogni manuale, l'insieme dei
 * titoli noti (che è ciò che chiude un blocco) e il registro di che cosa non
 * ha trovato, perché il rapporto finale lo dica invece di tacerlo.
 */
class Testi {
  /** @param {{libri: any[], sillabate: Set<string>}} manuali @param {Iterable<string>} titoli */
  constructor(manuali, titoli) {
    this.libri = manuali.libri
    this.sillabate = manuali.sillabate
    this.titoli = new Set([...titoli].map(chiave))
    /** @type {string[]} */
    this.scoperti = []
    /** Dove il builder e il manuale dicono due cose diverse. @type {string[]} */
    this.divergenze = []
    this.presi = 0
    this.chiesti = 0
    /** @type {Map<string, any[]>} */
    this.cache = new Map()
    /** @type {Map<string, {colonne: Map<string, string>, piano: Map<string, string>}>} */
    this.sezioni = new Map()
    /** @type {{colonne: Map<string, any>, piano: Map<string, any>}|null} */
    this.schedeCache = null
  }

  /** @param {string} nome @returns {string} */
  sulManuale(nome) { return NOMI_SUL_MANUALE[nome] ?? nome }

  /**
   * Tutte le occorrenze di un titolo, in tutti i manuali e in tutti e due i
   * flussi, con il blocco che ciascuna si porta dietro.
   * @param {string} nome
   * @returns {Array<{libro: any, flusso: 'colonne'|'piano', i: number, testo: string}>}
   */
  occorrenze(nome) {
    const k = chiave(this.sulManuale(nome))
    const gia = this.cache.get(k)
    if (gia) return gia
    /** @type {Array<{libro: any, flusso: 'colonne'|'piano', i: number, testo: string}>} */
    const out = []
    for (const libro of this.libri) {
      for (const f of /** @type {const} */ (['colonne', 'piano'])) {
        libro[f].righe.forEach(/** @param {{t: string}} r @param {number} i */ (r, i) => {
          if (chiave(r.t) === k) {
            out.push({ libro, flusso: f, i, testo: unisci(bloccoDopo(libro[f].righe, i, this.titoli), this.sillabate) })
          }
        })
      }
    }
    this.cache.set(k, out)
    return out
  }

  /**
   * Dove sta, nel manuale, il gruppo di voci che si chiamano così.
   *
   * Un titolo come «Competenze Bonus» compare sotto due sottoclassi diverse, e
   * il nome da solo non basta a scegliere. Si guarda invece dove i titoli di
   * uno stesso gruppo si addensano: quel punto è la sezione giusta, e le
   * occorrenze lontane si scartano.
   *
   * @param {readonly string[]} nomi
   * @returns {{libro: any, colonne: number, piano: number}|null}
   */
  ancora(nomi) {
    /** @type {Map<any, {colonne: {i: number, n: number}, piano: {i: number, n: number}}>} */
    const per = new Map()
    const occ = nomi.map(n => this.occorrenze(n))
    for (const gruppo of occ) {
      for (const o of gruppo) {
        const quanti = occ.filter(g => g.some(x => x.libro === o.libro && x.flusso === o.flusso && Math.abs(x.i - o.i) <= 400)).length
        const v = per.get(o.libro) ?? { colonne: { i: 0, n: -1 }, piano: { i: 0, n: -1 } }
        if (quanti > v[o.flusso].n) v[o.flusso] = { i: o.i, n: quanti }
        per.set(o.libro, v)
      }
    }
    let meglio = null
    for (const [libro, v] of per) {
      const forza = v.colonne.n + v.piano.n
      if (!meglio || forza > meglio.forza) meglio = { forza, libro, colonne: v.colonne.i, piano: v.piano.i }
    }
    return meglio ? { libro: meglio.libro, colonne: meglio.colonne, piano: meglio.piano } : null
  }

  /**
   * I tratti che stanno sotto un'apertura di sezione («Tratti degli umani», o
   * il nome di una sottorazza).
   *
   * Qui il manuale non usa titoli su una riga a sé: mette l'attacco in neretto
   * dentro il capoverso («Accozzaglia. Un arcimboldo è animato da…»), e un
   * tratto finisce dove comincia il successivo. La sezione finisce alla prima
   * riga che ha l'aria di un titolo dopo una frase chiusa.
   *
   * @param {string} apertura
   * @returns {{colonne: Map<string, string>, piano: Map<string, string>}}
   */
  sezioneTratti(apertura) {
    const gia = this.sezioni.get(apertura)
    if (gia) return gia
    const out = { colonne: new Map(), piano: new Map() }
    for (const libro of this.libri) {
      for (const f of /** @type {const} */ (['colonne', 'piano'])) {
        const righe = libro[f].righe
        const inizio = righe.findIndex(/** @param {{t: string}} r */ r => chiave(r.t) === chiave(apertura))
        if (inizio < 0) continue
        /** @type {{nome: string, righe: string[]}|null} */
        let corrente = null
        // Si indicizza anche senza la parentesi di coda: il manuale scrive
        // «Diverse fogge (Sottorazze)», il pacchetto «Diverse Fogge».
        const chiudi = () => {
          if (!corrente) return
          // Via l'attacco dall'inizio del testo: il nome lo porta già la voce,
          // e i pacchetti SRD non lo ripetono dentro la descrizione.
          const testo = unisci(corrente.righe, this.sillabate)
            .replace(new RegExp('^' + corrente.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.!]\\s*'), '')
          for (const k of [chiave(corrente.nome), chiave(corrente.nome.replace(/\s*\([^)]*\)\s*$/, ''))]) {
            if (!out[f].has(k)) out[f].set(k, testo)
          }
        }
        for (let j = inizio + 1; j < righe.length && j < inizio + 160; j++) {
          const t = righe[j]?.t ?? ''
          if (!t) continue
          const attacco = attaccoDi(t, corrente?.righe[corrente.righe.length - 1] ?? '')
          if (attacco) { chiudi(); corrente = { nome: attacco, righe: [t] }; continue }
          const prima = corrente?.righe[corrente.righe.length - 1] ?? ''
          // La riga subito dopo un attacco è il suo corpo, anche quando è corta
          // e sembra un titolo: un tratto senza testo non esiste. Senza questa
          // eccezione «Privilegio da Rissa: Versatilità.» chiudeva la sezione
          // invece di aprire l'ultimo tratto.
          const appenaAperto = corrente?.righe.length === 1
          // Per il resto la sezione finisce dove il manuale cambia discorso: un
          // titolo, un nome che il pacchetto conosce, o una delle citazioni a
          // effetto che aprono le virgolette. Sempre e solo dopo una frase chiusa.
          if (!appenaAperto && /[.!?…]$/.test(prima) && (titoloLike(t) || this.titoli.has(chiave(t)) || /^["«]/.test(t))) break
          if (corrente) corrente.righe.push(t)
        }
        chiudi()
      }
    }
    this.sezioni.set(apertura, out)
    return out
  }

  /**
   * Il testo di un tratto, cercato per attacco dentro una sezione.
   * @param {string} apertura
   * @param {string} nome
   * @param {string} dove
   * @returns {string|null}
   */
  perAttacco(apertura, nome, dove) {
    this.chiesti++
    const sez = this.sezioneTratti(apertura)
    // Il pacchetto disambigua i nomi che il manuale ripete — «Influsso
    // Fandonico (Ortolano)», «Tipologia Creatura: Costrutto» — mentre il
    // manuale scrive solo «Influsso fandonico». Si prova prima il nome intero.
    const varianti = [nome, nome.replace(/\s*\([^)]*\)\s*$/, ''), nome.replace(/:.*$/, '')]
      .map(chiave).filter((v, i, a) => v && a.indexOf(v) === i)
    /** @param {Map<string, string>} m */
    const prendi = m => { for (const v of varianti) { const t = m.get(v); if (t) return t } return null }
    const a = prendi(sez.colonne)
    const b = prendi(sez.piano)
    if (!a && !b) { this.scoperti.push(`${dove} — «${nome}» non è fra i tratti di «${apertura}»`); return null }
    if (a && b && nocciolo(a).slice(0, 120) !== nocciolo(b).slice(0, 120)) {
      this.scoperti.push(`${dove} — le due letture del PDF non concordano su «${nome}»`)
      return null
    }
    const t = /** @type {string} */ (b ?? a)
    if (!/[.!?…»")]$/.test(t)) { this.scoperti.push(`${dove} — «${nome}» esce troncato`); return null }
    this.presi++
    return t
  }

  /**
   * Il privilegio di un background.
   *
   * Nel pacchetto quattordici di questi privilegi hanno solo il nome inglese —
   * il builder non li traduce — e cercarli per nome non funzionerebbe. Il
   * manuale però ne mette esattamente uno per background, sotto «Privilegio:
   * <nome>»: si cerca quindi il background, e dentro la sua sezione il primo
   * privilegio che si incontra.
   *
   * @param {string} background nome italiano del background
   * @param {string} dove
   * @returns {{testo: string|null, nome: string|null}}
   */
  privilegioDiBackground(background, dove) {
    this.chiesti++
    /** @type {{colonne: Array<{nome: string, testo: string}>, piano: Array<{nome: string, testo: string}>}} */
    const trovati = { colonne: [], piano: [] }
    const cercato = this.sulManuale(background)
    for (const libro of this.libri) {
      for (const f of /** @type {const} */ (['colonne', 'piano'])) {
        const righe = libro[f].righe
        righe.forEach(/** @param {{t: string}} r @param {number} i */ (r, i) => {
          if (chiave(r.t) !== chiave(cercato)) return
          for (let j = i + 1; j < righe.length && j < i + 220; j++) {
            const m = /^Privilegio:\s*(.+)$/.exec(righe[j]?.t ?? '')
            if (!m) continue
            trovati[f].push({ nome: norm(m[1] ?? ''), testo: unisci(bloccoDopo(righe, j, this.titoli), this.sillabate) })
            return
          }
        })
      }
    }
    const scegli = /** @param {Array<{nome: string, testo: string}>} v */ v => v.find(x => testoIntero(x.testo)) ?? null
    const a = scegli(trovati.colonne)
    const b = scegli(trovati.piano)
    if (!a && !b) { this.scoperti.push(`${dove} — nessun privilegio sotto il background «${background}»`); return { testo: null, nome: null } }
    if (a && b && (chiave(a.nome) !== chiave(b.nome) || nocciolo(a.testo).slice(0, 120) !== nocciolo(b.testo).slice(0, 120))) {
      this.scoperti.push(`${dove} — le due letture del PDF non concordano sul privilegio di «${background}»`)
      return { testo: null, nome: null }
    }
    const v = /** @type {{nome: string, testo: string}} */ (b ?? a)
    this.presi++
    return { testo: v.testo, nome: v.nome }
  }

  /**
   * Il testo di una voce, o `null`.
   *
   * Le due letture del PDF devono concordare sull'inizio: è il controllo che
   * scopre la colonna letta storta. Dove concordano si spedisce la lettura
   * senza `-layout`, che è quella che non spezza le parole; dove una sola delle
   * due produce un capoverso intero si spedisce quella; dove divergono si
   * spedisce `null`, e la voce finisce nel rapporto.
   *
   * @param {string} nome
   * @param {{dove: string, vicino?: {libro: any, colonne: number, piano: number}|null, deve?: RegExp}} opz
   * @returns {string|null}
   */
  perTitolo(nome, opz) {
    this.chiesti++
    let occ = this.occorrenze(nome)
    if (opz.vicino) {
      const v = opz.vicino
      const vicine = occ.filter(o => o.libro === v.libro && Math.abs(o.i - v[o.flusso]) <= 400)
      if (vicine.length) occ = vicine
    }
    const buone = occ.filter(o => testoIntero(o.testo) && (!opz.deve || opz.deve.test(o.testo)))
    if (!buone.length) { this.scoperti.push(`${opz.dove} — nessun capoverso sotto «${this.sulManuale(nome)}»`); return null }
    const perFlusso = /** @param {'colonne'|'piano'} f */ f => {
      const c = buone.filter(o => o.flusso === f).sort((a, b) => b.testo.length - a.testo.length)
      return c[0]?.testo ?? null
    }
    const a = perFlusso('colonne')
    const b = perFlusso('piano')
    if (a && b) {
      const na = nocciolo(a).slice(0, 120)
      const nb = nocciolo(b).slice(0, 120)
      if (na !== nb) { this.scoperti.push(`${opz.dove} — le due letture del PDF non concordano su «${this.sulManuale(nome)}»`); return null }
      this.presi++
      return b
    }
    this.presi++
    return /** @type {string} */ (a ?? b)
  }

  /**
   * I testi degli incantesimi, indicizzati per scheda invece che per nome.
   *
   * Le pagine degli incantesimi sono la parte peggiore dei manuali: nome,
   * scuola, scheda e testo stanno in quattro blocchi separati, e su una pagina
   * a due colonne escono in fila i due nomi, le due schede e i due testi. Il
   * nome, insomma, non dice a quale testo appartiene.
   *
   * La scheda invece sì: tempo di lancio, gittata, componenti e durata sono
   * sei campi che il pacchetto ha già, tradotti dal builder, e insieme fanno
   * una chiave. Si indicizza per quella, si controlla che la riga della scuola
   * sia lì accanto, e un incantesimo che non torna esce senza testo.
   *
   * @returns {{colonne: Map<string, {testo: string, scuole: string[]}>, piano: Map<string, {testo: string, scuole: string[]}>}}
   */
  schede() {
    if (this.schedeCache) return this.schedeCache
    const out = { colonne: new Map(), piano: new Map() }
    for (const libro of this.libri) {
      for (const f of /** @type {const} */ (['colonne', 'piano'])) {
        for (const [k, v] of schedeDelFlusso(libro[f].righe, this.sillabate)) {
          if (!out[f].has(k)) out[f].set(k, v)
        }
      }
    }
    this.schedeCache = out
    return out
  }

  /**
   * Il testo di un incantesimo.
   * @param {{nome: string, livello: number, scuola: string, tempoDiLancio: string, gittata: string, componenti: string, durata: string}} v
   * @param {string} dove
   * @returns {string|null}
   */
  incantesimo(v, dove) {
    this.chiesti++
    const k = chiaveScheda(v.tempoDiLancio, v.gittata, v.componenti, v.durata)
    const sch = this.schede()
    // La riga della scuola del manuale, se è lì accanto. Il livello deve
    // tornare — è il controllo che lega la scheda all'incantesimo giusto — ma
    // la scuola no: su un incantesimo il builder e il manuale non vanno
    // d'accordo, e la divergenza si dichiara invece di scartare il testo.
    const riga = /** @param {string[]} scuole */ scuole => scuole
      .map(x => /^(?:(\p{Lu}[\p{L}]+) di (\d)° livello|Trucchetto (\p{Lu}[\p{L}]+))$/u.exec(norm(x)))
      .find(m => m && Number(m[2] ?? 0) === v.livello)
    /** @param {'colonne'|'piano'} f */
    const prendi = f => {
      const c = sch[f].get(k)
      if (!c || !testoIntero(c.testo)) return null
      const m = riga(c.scuole)
      if (!m) return null
      const scuolaSulManuale = m[1] ?? m[3] ?? ''
      if (chiave(scuolaSulManuale) !== chiave(v.scuola)) {
        this.divergenze.push(`${dove} — il builder dice «${v.scuola}», il manuale «${scuolaSulManuale}»`)
      }
      return c.testo
    }
    const a = prendi('colonne')
    const b = prendi('piano')
    if (!a && !b) { this.scoperti.push(`${dove} — nessuna scheda che torni con «${v.nome}»`); return null }
    if (a && b && nocciolo(a).slice(0, 120) !== nocciolo(b).slice(0, 120)) {
      this.scoperti.push(`${dove} — le due letture del PDF non concordano su «${v.nome}»`)
      return null
    }
    this.presi++
    return /** @type {string} */ (b ?? a)
  }
}

/** I quattro campi della scheda, ridotti a una chiave sola. */
function chiaveScheda(/** @type {string} */ tempo, /** @type {string} */ gittata, /** @type {string} */ componenti, /** @type {string} */ durata) {
  // «18 m» sul manuale, «18 metri» nel pacchetto; e il tempo di lancio di una
  // reazione porta dietro il suo innesco, che è una frase e nel pacchetto non c'è.
  const g = norm(gittata).replace(/\b(\d+(?:,\d+)?)\s*m\b\.?/i, '$1 metri')
  const t = /^1 reazione/i.test(tempo) ? '1 reazione' : norm(tempo)
  return [t, g, norm(componenti).replace(/\s*\([^)]*\)/g, ''), norm(durata)].map(x => x.toLowerCase()).join(' | ')
}

/** Le righe che aprono i campi della scheda di un incantesimo. */
const CAMPI_SCHEDA = /^(Tempo di Lancio|Gittata|Componenti|Durata):\s*(.*)$/

/**
 * Le schede di un flusso, ciascuna con il testo che le tocca.
 *
 * L'accoppiamento è per posizione: su una pagina che intreccia due
 * incantesimi, la prima scheda va con il primo capoverso di prosa, la seconda
 * con il secondo. Una scheda che ha già il testo attaccato (il caso normale)
 * se lo prende subito.
 *
 * @param {Array<{t: string}>} righe
 * @param {Set<string>} sillabate
 * @returns {Map<string, {testo: string, scuole: string[]}>}
 */
function schedeDelFlusso(righe, sillabate) {
  /** @type {Map<string, {testo: string, scuole: string[]}>} */
  const out = new Map()
  /** @type {Set<string>} */
  const ambigue = new Set()
  /** @type {Array<{chiave: string, scuole: string[], corpo: string[]}>} */
  const pendenti = []
  /** @type {{chiave: string, scuole: string[], corpo: string[]}|null} */
  let corrente = null
  let assorbiti = 0
  /** @param {string[]} par */
  const prosa = par => {
    if (pendenti.length) { corrente = pendenti.shift() ?? null; assorbiti = 0; if (corrente) corrente.corpo = par }
    // Un capoverso che segue senza una scheda in attesa è la coda del testo
    // precedente — il manuale spezza le descrizioni fra due colonne — a meno
    // che non apra con un titolo, e allora comincia un'altra cosa.
    else if (corrente && assorbiti < 2) {
      const coda = riprende(corrente.corpo[corrente.corpo.length - 1] ?? '', par)
      if (!coda) { corrente = null; return }
      corrente.corpo = [...corrente.corpo, ...coda]
      assorbiti++
    }
    else corrente = null
  }
  for (let i = 0; i < righe.length;) {
    // il capoverso che comincia qui
    if (!righe[i]?.t) { i++; continue }
    /** @type {string[]} */
    const par = []
    let j = i
    while (j < righe.length && righe[j]?.t) { par.push(righe[j]?.t ?? ''); j++ }
    // dov'è, dentro il capoverso, la scheda
    const inizio = par.findIndex(r => /^Tempo di Lancio:/.test(r))
    if (inizio >= 0) {
      let fine = inizio
      while (fine < par.length && !/^Durata:/.test(par[fine] ?? '')) fine++
      /** @type {Record<string, string>} */
      const campi = {}
      let ultimo = ''
      for (const r of par.slice(inizio, fine + 1)) {
        const m = CAMPI_SCHEDA.exec(r)
        if (m) { ultimo = m[1] ?? ''; campi[ultimo] = m[2] ?? '' }
        else if (ultimo) campi[ultimo] += ' ' + r
      }
      // La riga «Scuola di N° livello» sta accanto alla scheda, ma non sempre
      // prima: nelle pagine a due colonne intrecciate le due righe di scuola
      // finiscono in fondo, dopo i due testi. Si guarda in un intorno.
      const scuole = righe.slice(Math.max(0, i - 8), i + par.length + 25)
        .map(/** @param {{t: string}} r */ r => r.t).filter(Boolean)
      const voce = {
        chiave: chiaveScheda(campi['Tempo di Lancio'] ?? '', campi['Gittata'] ?? '', campi['Componenti'] ?? '', campi['Durata'] ?? ''),
        scuole,
        corpo: [],
      }
      pendenti.push(voce)
      corrente = null
      const coda = par.slice(fine + 1)
      if (coda.length) prosa(coda)
      // le schede si registrano man mano: il corpo può ancora crescere, e
      // l'oggetto è lo stesso. Due schede identiche non si possono distinguere:
      // si segnano ambigue e non escono.
      if (out.has(voce.chiave)) ambigue.add(voce.chiave)
      else out.set(voce.chiave, /** @type {any} */ (voce))
    } else if (par.every(titoloLike) || /^[-–]\s+.+\s+[-–]$/.test(par[par.length - 1] ?? '')) {
      corrente = null
    } else prosa(par)
    i = j
  }
  /** @type {Map<string, {testo: string, scuole: string[]}>} */
  const finito = new Map()
  for (const [k, v] of out) {
    if (ambigue.has(k)) continue
    finito.set(k, { testo: unisci(/** @type {any} */ (v).corpo, sillabate), scuole: v.scuole })
  }
  return finito
}

/** Solo lettere e cifre: serve a confrontare due letture dello stesso testo. @param {string} s */
function nocciolo(s) { return s.toLowerCase().replace(/[^a-zà-ù0-9]+/g, '') }

// ── Costruzione: classi, razze, background, talenti ─────────────────────────

/**
 * Un privilegio. `nameEn` resta perché è l'unico ponte con gli snapshot del
 * builder, che elencano i privilegi con il nome — non con l'id.
 * @param {any} f
 * @param {{perId: Record<string, string>, perNome: Record<string, string>}} nomi
 * @param {string} dove
 * @param {{testi: Testi|null, vicino?: any}} [ctx]
 * @returns {{id: string, level: number, name: string, nameEn: string, description: string|null}}
 */
function privilegio(f, nomi, dove, ctx) {
  // Il builder tiene i nomi dei privilegi di variante per id, ma quelli
  // comuni a tutte le classi (l'aumento dei punteggi) stanno nella tabella
  // generale, che e' per nome inglese: si guarda in tutte e due.
  const name = nomi.perId[f.id] ?? nomeIt(nomi.perNome, String(f.name), String(f.name), `${dove}/privilegio`)
  return {
    id: String(f.id),
    level: Number(f.level),
    name,
    nameEn: String(f.name),
    description: ctx?.testi ? ctx.testi.perTitolo(name, { dove: `${dove}/${f.id}`, vicino: ctx.vicino }) : null,
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
 * @param {Testi|null} testi
 * @returns {Record<string, any>}
 */
function costruisciClassi(sottoclassi, nomiPrivilegio, classeNuova, nomiClasse, variante, testi) {
  /** I nomi con cui cercare la sezione giusta: quelli dei privilegi del gruppo. @param {any} s */
  const vicino = s => testi?.ancora([
    ...s.features.map(/** @param {any} f */ f => nomiPrivilegio.perId[f.id] ?? String(f.name)),
    s.nameOriginal ? String(s.nameOriginal) : String(s.name),
  ]) ?? null
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
        .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${padre}/${s.id}`, { testi, vicino: vicino(s) }))
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
          .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${classeNuova.id}/${s.id}`, { testi, vicino: vicino(s) }))
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
        .map(/** @param {any} f */ f => privilegio(f, nomiPrivilegio, `${variante}/${classeNuova.id}`, { testi, vicino: vicino(classeNuova) }))
        .sort(/** @param {any} a @param {any} b */ (a, b) => a.level - b.level || per(a.id, b.id)),
      subclasses: sotto,
    }
  }
  return out
}

/**
 * Sotto quale titolo il manuale elenca i tratti di ogni razza. Scritto a mano
 * perché è irregolare («degli umani», «delle marionette», «dei paraguli») e
 * indovinare il plurale italiano da un id inglese produrrebbe silenziosamente
 * la sezione sbagliata.
 * @type {Record<string, string>}
 */
const TRATTI_SUL_MANUALE = {
  arcimboldo: 'Tratti degli arcimboldi',
  gifted: 'Tratti dei dotati',
  human: 'Tratti degli umani',
  jackrabid: 'Tratti dei bieconigli',
  malebranche: 'Tratti dei malebranche',
  marionette: 'Tratti delle marionette',
  morgant: 'Tratti dei morganti',
  nonexistent: 'Tratti degli inesistenti',
  pantegan: 'Tratti dei pantegani',
  paraghoul: 'Tratti dei paraguli',
  sylvan: 'Tratti dei selvatici',
  wolfcat: 'Tratti dei gatti lupeschi',
}

/**
 * Le razze con i loro tratti, nella forma dei pacchetti SRD. Il builder tiene
 * i tratti come soli id e i nomi italiani in `traitNamesIt`; il testo viene
 * dal manuale, dove ogni tratto è un attacco in neretto dentro la sezione
 * della razza (o della sottorazza).
 * @param {readonly any[]} razze
 * @param {Record<string, string>} nomiSottorazza
 * @param {Record<string, string>} nomiTratto
 * @param {string} variante
 * @param {Testi|null} testi
 * @returns {Record<string, any>}
 */
function costruisciRazze(razze, nomiSottorazza, nomiTratto, variante, testi) {
  /**
   * @param {string} apertura sotto quale titolo cercarlo nel manuale
   * @param {string} dove
   * @returns {(id: any) => {id: string, name: string, nameEn: string, description: string|null}}
   */
  const tratto = (apertura, dove) => id => {
    const name = nomeIt(nomiTratto, String(id), leggibile(String(id)), `${variante}/tratto`)
    return {
      id: String(id),
      name,
      nameEn: leggibile(String(id)),
      description: testi && apertura ? testi.perAttacco(apertura, name, `${dove}/${id}`) : null,
    }
  }
  /** @type {Record<string, any>} */
  const out = {}
  for (const r of [...razze].sort((a, b) => per(a.id, b.id))) {
    const apertura = TRATTI_SUL_MANUALE[String(r.id)] ?? ''
    /** @type {Record<string, any>} */
    const sottorazze = {}
    for (const s of [...(r.subraces ?? [])].sort((a, b) => per(a.id, b.id))) {
      const nomeSotto = s.nameOriginal ? String(s.nameOriginal)
        : nomeIt(nomiSottorazza, String(s.name), String(s.name), `${variante}/sottorazza`)
      sottorazze[s.id] = {
        id: String(s.id),
        name: nomeSotto,
        nameEn: String(s.name),
        // La sottorazza apre la sua sezione con il proprio nome, e i suoi
        // tratti stanno lì: cercarli nella sezione della razza madre
        // prenderebbe quelli di una sorella.
        traits: [...(s.traits ?? [])].sort(per).map(tratto(nomeSotto, `${variante}/${r.id}/${s.id}`)),
      }
    }
    out[r.id] = {
      id: String(r.id),
      name: r.nameOriginal ? String(r.nameOriginal) : String(r.name),
      nameEn: String(r.name),
      traits: [...(r.traits ?? [])].sort(per).map(tratto(apertura, `${variante}/${r.id}`)),
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
 * @param {Testi|null} testi
 * @returns {Record<string, any>}
 */
function costruisciBackground(background, nomiPrivilegio, variante, testi) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const b of [...background].sort((a, b) => per(a.id, b.id))) {
    const f = b.feature
    const nomeB = b.nameOriginal ? String(b.nameOriginal) : String(b.name)
    const dal = f && testi ? testi.privilegioDiBackground(nomeB, `${variante}/background/${b.id}`) : null
    out[b.id] = {
      id: String(b.id),
      name: nomeB,
      nameEn: String(b.name),
      skillProficiencies: [...(b.skillProficiencies ?? [])].sort(per),
      features: f ? [{
        id: slug(String(f.name)),
        name: nomeIt(nomiPrivilegio, String(f.name), String(f.name), `${variante}/background`),
        nameEn: String(f.name),
        description: dal?.testo ?? null,
        descriptionEn: null,
      }] : [],
    }
  }
  return out
}

/**
 * I talenti. Tutti e sedici stanno nell'Impero Randella Ancora, in fila
 * alfabetica: il nome è il titolo del paragrafo, e sotto c'è il testo.
 * @param {readonly any[]} talenti
 * @param {Testi|null} testi
 * @returns {Record<string, any>}
 */
function costruisciTalenti(talenti, testi) {
  const nomi = talenti.map(/** @param {any} t */ t => (t.nameOriginal ? String(t.nameOriginal) : String(t.name)))
  const vicino = testi?.ancora(nomi) ?? null
  /** @type {Record<string, any>} */
  const out = {}
  for (const t of [...talenti].sort((a, b) => per(a.id, b.id))) {
    const nome = t.nameOriginal ? String(t.nameOriginal) : String(t.name)
    out[t.id] = {
      id: String(t.id),
      name: nome,
      nameEn: String(t.name),
      description: testi ? testi.perTitolo(nome, { dove: `brancalonia/talento/${t.id}`, vicino }) : null,
    }
  }
  return out
}

/**
 * Tutti i titoli che il pacchetto porta: sono loro a dire a un blocco di testo
 * dove finire. Si raccolgono dal pacchetto già costruito invece che a mano,
 * così una voce nuova nel builder entra nell'elenco da sé.
 * @param {Record<string, any>} pacchetto
 * @returns {string[]}
 */
function titoliDelPacchetto(pacchetto) {
  /** @type {string[]} */
  const out = []
  for (const c of Object.values(pacchetto['classes'] ?? {})) {
    for (const f of c.features ?? []) out.push(f.name)
    for (const sc of Object.values(c.subclasses ?? {})) {
      out.push(sc.name)
      for (const f of sc.features) out.push(f.name)
    }
  }
  for (const r of Object.values(pacchetto['races'] ?? {})) {
    out.push(r.name)
    for (const s of Object.values(r.subraces ?? {})) out.push(s.name)
  }
  for (const b of Object.values(pacchetto['backgrounds'] ?? {})) out.push(b.name)
  for (const t of Object.values(pacchetto['talenti'] ?? {})) out.push(t.name)
  return [...new Set(out.flatMap(n => [n, NOMI_SUL_MANUALE[n] ?? n]))]
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
 * @param {Testi|null} testi
 * @returns {{indice: any[], blocchi: any[][], ponte: Record<string, string>}}
 */
function costruisciCompendio(incantesimi, nomiIncantesimo, volumi, etichettaFonte, testi) {
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
    const scheda = {
      tempoDiLancio: tempoIt(String(s.castingTime)),
      gittata: gittataIt(String(s.range)),
      componenti: componentiIt(String(s.components)),
      durata,
    }
    ;(blocchi[Number(s.level)] ?? []).push({
      ...voce,
      ...scheda,
      testo: testi ? testi.incantesimo({ nome, livello: Number(s.level), scuola, ...scheda }, `brancalonia/incantesimo/${id}`) : null,
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

  /**
   * Il pacchetto di Brancalonia. Si costruisce due volte: la prima senza
   * manuali, per sapere quali titoli esistono — perché è l'elenco dei titoli
   * che dice a un blocco dove finire — la seconda con i testi.
   * @param {Testi|null} testi
   */
  const facciaBrancalonia = (testi) => ({
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
      testi,
    ),
    races: costruisciRazze(bRazze['brancaloniaRaces'], nomiSottorazza, nomiTratto, 'brancalonia', testi),
    backgrounds: costruisciBackground(bBackground['brancaloniaBackgrounds'], nomiPrivilegio, 'brancalonia', testi),
    talenti: costruisciTalenti(bTalenti['brancaloniaFeats'], testi),
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
  })

  // I titoli che chiudono un blocco: tutti i nomi che questo pacchetto porta,
  // più quelli con cui il manuale li chiama.
  const primoGiro = facciaBrancalonia(null)
  const titoli = titoliDelPacchetto(primoGiro)
  const manuali = SENZA_MANUALI ? null : caricaManuali(MANUALI_DIR, new Set(titoli.map(chiave)))
  const testi = manuali ? new Testi(manuali, titoli) : null
  const brancalonia = testi ? facciaBrancalonia(testi) : primoGiro

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
      // Apocalisse resta senza testi: i manuali non ci sono, e il pacchetto
      // continua a dire nomi, struttura e numeri.
      null,
    ),
    races: costruisciRazze(aRazze['apocalisseRaces'], nomiSottorazza, nomiTratto, 'apocalisse', null),
    backgrounds: costruisciBackground(aBackground['apocalisseBackgrounds'], nomiPrivilegio, 'apocalisse', null),
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
    bSpells['brancaloniaSpells'], termini['spellNamesIt'], volumi, 'Brancalonia', testi)
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

  // Le due varianti non stanno più sullo stesso piano, e l'attribuzione deve
  // dirlo: di Brancalonia il proprietario del progetto ha deciso di pubblicare
  // i testi, avendo i manuali; di Apocalisse no, e quel pacchetto continua a
  // portare solo nomi, struttura e numeri. Nessuna delle due è CC-BY, e
  // nessuna delle due lo diventa perché il testo adesso c'è.
  aggiornaRegistro([
    {
      id: 'brancalonia',
      nome: 'Brancalonia',
      edizione: '2014',
      varianti: ['brancalonia'],
      incluso: true,
      base: 'srd-2014',
      licenza: 'Materiale non libero — di Acheron Games',
      kb: Math.ceil((pesi['brancalonia'] ?? 0) / 1024),
      regole: 'data/rules/brancalonia.json',
      incantesimi: 'data/spells/brancalonia/',
      attribuzione: 'Brancalonia è un\'ambientazione di Acheron Games. Non è materiale SRD e non è ' +
        'distribuito sotto licenza Creative Commons. I testi di regole riportati in questo pacchetto ' +
        'sono tratti dalle edizioni italiane dei manuali — Manuale di Ambientazione 2.6, Macaronicon ' +
        '2.2, L\'Impero Randella Ancora 1.0 — e sono opera di Acheron Games e dei suoi autori. ' +
        'Marchi, testi e contenuti restano di Acheron Games: questo pacchetto non concede su di essi ' +
        'alcun diritto, serve a giocare una scheda al tavolo e non sostituisce il manuale. Dove il ' +
        'testo non è stato riportato l\'app lo dichiara.',
    },
    {
      id: 'apocalisse',
      nome: 'Apocalisse',
      edizione: '2014',
      varianti: ['apocalisse'],
      incluso: true,
      base: 'srd-2014',
      licenza: 'Materiale non libero — citato per nome, senza testo',
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
  if (testi) console.log(`manuali: ${MANUALI_DIR}`)
  console.log('')
  for (const p of [brancalonia, apocalisse]) {
    const sub = Object.values(p.classes).flatMap(/** @param {any} c */ c => Object.values(c.subclasses ?? {}))
    const priv = Object.values(p.classes).flatMap(/** @param {any} c */ c => c.features ?? [])
      .concat(sub.flatMap(/** @param {any} s */ s => s.features))
    const tratti = Object.values(p.races).flatMap(/** @param {any} r */ r => [
      ...r.traits, ...Object.values(r.subraces ?? {}).flatMap(/** @param {any} s */ s => s.traits)])
    const bg = Object.values(p.backgrounds).flatMap(/** @param {any} b */ b => b.features)
    const tal = Object.values(/** @type {Record<string, any>} */ (p)['talenti'] ?? {})
    /** @param {readonly any[]} v @param {string} campo */
    const quanti = (v, campo = 'description') => `${v.filter(x => x[campo]).length}/${v.length}`
    console.log(
      `  ${p.variante} (base ${p.base}, edizione ${p.edizione}) — ${pesi[p.variante]} byte\n` +
      `    ${Object.keys(p.classes).length} classi toccate, ${sub.length} sottoclassi\n` +
      `    con il testo: ${quanti(priv)} privilegi, ${quanti(tratti)} tratti, ` +
      `${quanti(bg)} privilegi di background, ${quanti(tal)} talenti`
    )
  }
  const conTesto = blocchi.flat().filter(/** @param {any} s */ s => s.testo).length
  console.log(`    Brancalonia: ${indice.length} incantesimi propri (${conTesto} con il testo), ${bytesCompendio} byte di compendio`)
  console.log('    Apocalisse: nessun incantesimo proprio — la cartella non esiste')
  console.log('')
  if (testi) {
    console.log(`  testi estratti dai manuali: ${testi.presi} voci su ${testi.chiesti}`)
    if (testi.divergenze.length) {
      const unici = [...new Set(testi.divergenze)].sort(per)
      console.log(`  ⚠ ${unici.length} divergenze fra il builder e il manuale:`)
      for (const s of unici) console.log(`      ${s}`)
    }
    if (testi.scoperti.length) {
      console.log(`  ⚠ ${testi.scoperti.length} voci restano senza testo:`)
      for (const s of [...testi.scoperti].sort(per)) console.log(`      ${s}`)
    }
  } else {
    console.log('  ⚠ generato con --senza-manuali: nessuna descrizione, in nessuna delle due varianti')
  }
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
