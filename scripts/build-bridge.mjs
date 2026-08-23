#!/usr/bin/env node
/**
 * Il ponte: dagli id inglesi del builder agli incantesimi italiani.
 *   node scripts/build-bridge.mjs [--builder ../../dnd-builder]
 *
 * ── Lotto M ──
 *
 * Il builder salva gli incantesimi di un personaggio come id inglesi
 * (`fire-bolt`, `1-bane`, `2-locate-object`); il compendio è italiano e
 * indicizzato per nome. Senza una tabella in mezzo, una scheda importata mostra
 * dieci righe vuote.
 *
 * L'aggancio **non** passa per il nome: le due traduzioni non ne condividono
 * nemmeno uno. Passa per ciò che è categorico e che le due fonti descrivono
 * allo stesso modo — livello, scuola, classi, componenti, gittata, tempo di
 * lancio, durata — dopo aver convertito piedi in metri e «1 action» in
 * «azione». Chi resta appaiato in modo ambiguo si decide col punteggio più
 * alto; **chi non aggancia finisce nel rapporto a video**, non nel silenzio:
 * l'app lo mostrerà col suo nome inglese e senza testo, dicendo perché.
 *
 * Prodotti: `data/spells/<ed>/ponte.json`, `{ "<id inglese>": "<id italiano>" }`,
 * e `data/spells/<ed>/ponte-residui.json`, l'elenco di chi non aggancia — che è
 * un dato, non un avanzo: è ciò che permette alla scheda di dire *perché* quella
 * riga è senza testo.
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** @typedef {'2014'|'2024'} Edizione */

/**
 * @typedef {object} Inglese
 * @property {string} id
 * @property {string} nome
 * @property {number} livello
 * @property {string} scuola   già tradotta
 * @property {string[]} classi
 * @property {string} tempoDiLancio
 * @property {string} gittata
 * @property {string} componenti
 * @property {string} durata
 * @property {boolean} rituale
 * @property {boolean} concentrazione
 * @property {string} descrizione  il riassunto inglese del builder
 */

/**
 * Le tre cose che sopravvivono alla traduzione anche dentro il testo: i dadi,
 * la caratteristica del tiro salvezza e il tipo di danno. Sono il segnale che
 * distingue *Raggio di gelo* (1d8 da freddo, niente tiro salvezza) da *Fiamma
 * sacra* (1d8 radiosi, tiro su Destrezza), che su livello, scuola, componenti
 * e gittata sono identici.
 */
const CARATTERISTICHE = [
  [/\bstr\b|strength/i, /forza/i], [/\bdex\b|dexterity/i, /destrezza/i],
  [/\bcon\b|constitution/i, /costituzione/i], [/\bint\b|intelligence/i, /intelligenza/i],
  [/\bwis\b|wisdom/i, /saggezza/i], [/\bcha\b|charisma/i, /carisma/i],
]
const DANNI = [
  [/\bacid\b/i, /acido/i], [/\bcold\b/i, /freddo/i], [/\bfire\b/i, /fuoco/i],
  [/\bforce\b/i, /forza\b/i], [/\blightning\b/i, /fulmine/i], [/\bnecrotic\b/i, /necrotic/i],
  [/\bpoison\b/i, /veleno/i], [/\bpsychic\b/i, /psichic/i], [/\bradiant\b/i, /radios/i],
  [/\bthunder\b/i, /tuono/i], [/\bbludgeoning\b/i, /contunden/i], [/\bpiercing\b/i, /perforan/i],
  [/\bslashing\b/i, /taglien/i],
]

/** L'elemento i-esimo, con la garanzia che esista: `noUncheckedIndexedAccess`
 * è acceso, e qui gli indici arrivano da ricerche già andate a buon fine.
 * @template T @param {T[]} a @param {number} i @returns {T}
 */
function at(a, i) {
  const v = a[i]
  if (v === undefined) throw new Error(`indice ${i} fuori intervallo`)
  return v
}

/** @param {string} t @returns {Set<string>} */
function dadi(t) {
  return new Set((t.match(/\b\d{1,2}d\d{1,3}\b/g) ?? []).map(d => d.toLowerCase()))
}

/** @param {RegExp[][]} tavola @param {string} testo @param {0|1} lato @returns {Set<number>} */
function segnali(tavola, testo, lato) {
  /** @type {Set<number>} */
  const s = new Set()
  tavola.forEach((r, i) => { if (at(r, lato).test(testo)) s.add(i) })
  return s
}

/** @param {Set<any>} a @param {Set<any>} b @returns {number} */
function comuni(a, b) {
  let n = 0
  for (const x of a) if (b.has(x)) n += 1
  return n
}

/** @type {Record<string, string>} */
const SCUOLE = {
  Abjuration: 'Abiurazione', Conjuration: 'Evocazione', Divination: 'Divinazione',
  Enchantment: 'Ammaliamento', Evocation: 'Invocazione', Illusion: 'Illusione',
  Necromancy: 'Necromanzia', Transmutation: 'Trasmutazione',
}

/**
 * Gli agganci che il punteggio non sa decidere, decisi a mano — i «residui»
 * del piano. Sono quasi tutti coppie di incantesimi che condividono livello,
 * scuola, componenti, gittata, durata e classi, e che nel riassunto inglese del
 * builder non hanno né dadi né tiri salvezza da confrontare: fissato uno, si
 * sistema anche l'altro.
 *
 * La stringa vuota vuol dire **nessun aggancio**, ed è una decisione, non una
 * mancanza: *Blade Ward* e *Hex* stanno nel Player's Handbook e non nell'SRD
 * 5.1, quindi nel 2014 non hanno un testo da mostrare.
 * @type {Record<Edizione, Record<string, string>>}
 */
const A_MANO = {
  '2014': {
    '2-barkskin': 'pelle-coriacea',
    '2-spider-climb': 'movimenti-del-ragno',
    'blade-ward': '',
    '1-hex': '',
  },
  '2024': {
    '2-barkskin': 'pelle-coriacea',
    '2-spider-climb': 'movimenti-del-ragno',
    '1-hex': 'sortilegio',
    'chill-touch': 'tocco-gelido',
    'spare-the-dying': 'salvare-i-morenti',
    '4-conjure-minor-elementals': 'evoca-elementali-minori',
    '4-conjure-woodland-beings': 'evoca-creature-boschive',
    '4-giant-insect': 'insetto-gigante',
    '5-conjure-elemental': 'evoca-elementale',
    '5-mass-cure-wounds': 'cura-ferite-di-massa',
    '5-raise-dead': 'rianimare-morti',
    '5-reincarnate': 'reincarnazione',
    '9-power-word-kill': 'parola-del-potere-uccidere',
  },
}

/** I piedi degli SRD e i metri con cui li traducono, uno per uno. @type {Record<string, string>} */
const DISTANZE = {
  '5': '1,5', '10': '3', '15': '4,5', '20': '6', '30': '9', '40': '12', '50': '15',
  '60': '18', '90': '27', '100': '30', '120': '36', '150': '45', '300': '90',
  '500': '150', '1000': '300',
}

// ────────────────────────────────────────────────────── la sorgente inglese

/**
 * Il builder tiene un incantesimo per riga. Si legge riga per riga invece che
 * con una sola espressione su tutto il file perché due descrizioni contengono
 * apici e virgolette che a un'espressione sola fanno saltare l'aggancio.
 * @param {string} file @returns {Inglese[]}
 */
function leggiBuilder(file) {
  /** @type {Inglese[]} */
  const fuori = []
  for (const riga of readFileSync(file, 'utf8').split('\n')) {
    const t = riga.trim()
    if (!t.startsWith('{ id:')) continue
    /** @param {string} campo @returns {string|undefined} */
    const stringa = (campo) => {
      const m = new RegExp(`${campo}:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`).exec(t)
      return (m?.[1] ?? m?.[2])?.replace(/\\(['"])/g, '$1')
    }
    const id = stringa('id')
    const nome = stringa('name')
    const scuola = SCUOLE[stringa('school') ?? '']
    const livello = Number(/level:\s*(\d+)/.exec(t)?.[1])
    if (!id || !nome || !scuola || Number.isNaN(livello)) continue
    const durata = stringa('duration') ?? ''
    fuori.push({
      id, nome, livello, scuola,
      classi: [...(/classes:\s*\[([^\]]*)\]/.exec(t)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1] ?? '').sort(),
      tempoDiLancio: stringa('castingTime') ?? '',
      gittata: stringa('range') ?? '',
      componenti: stringa('components') ?? '',
      durata,
      rituale: /ritual:\s*true/.test(t),
      concentrazione: /concentration/i.test(durata),
      descrizione: stringa('description') ?? '',
    })
  }
  return fuori
}

/** La lista del builder per un'edizione. @param {string} radice @param {Edizione} ed @returns {Inglese[]} */
function listaBuilder(radice, ed) {
  const base = [
    ...leggiBuilder(`${radice}/src/data/dnd5e/spells.ts`),
    ...leggiBuilder(`${radice}/src/data/dnd5e/spells-4-9.ts`),
  ]
  if (ed === '2014') return base
  // Il 2024 riusa la lista del 2014 con gli scostamenti dichiarati dal builder:
  // due incantesimi usciti, ventitré entrati, e le liste di classe riscritte.
  const src = readFileSync(`${radice}/src/data/dnd2024/spells.ts`, 'utf8')
  const usciti = new Set([...(/REMOVED_IN_2024 = new Set<string>\(\[([^\]]*)\]/.exec(src)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1] ?? ''))
  /** @type {Record<string, string[]>} */
  const scavalchi = {}
  for (const m of src.matchAll(/^\s*'([^']+)':\s*\[([^\]]*)\],$/gm)) {
    scavalchi[at(m, 1)] = [...at(m, 2).matchAll(/'([^']+)'/g)].map(x => x[1] ?? '').sort()
  }
  const adattati = base
    .filter(s => !usciti.has(s.nome))
    .map(s => ({ ...s, classi: scavalchi[s.nome] ?? s.classi }))
  const noti = new Set(adattati.map(s => s.nome))
  const nuovi = leggiBuilder(`${radice}/src/data/dnd2024/spells-new.ts`).filter(s => !noti.has(s.nome))
  return [...adattati, ...nuovi]
}

// ─────────────────────────────────────────────────────────── normalizzazioni

/** @param {string} t @returns {string} */
function tempo(t) {
  const s = t.toLowerCase()
  if (/bonus/.test(s)) return 'azione bonus'
  if (/reaction|reazione/.test(s)) return 'reazione'
  if (/^1?\s*(action|azione)/.test(s)) return 'azione'
  const m = /(\d+)\s*(minute|minuti|minuto|hour|ore|ora)/.exec(s)
  if (m) return at(m, 1) + (/(minute|minut)/.test(at(m, 2)) ? ' minuti' : ' ore')
  return s
}

/** @param {string} g @returns {string} */
function gittata(g) {
  const s = g.toLowerCase()
  if (/^self|incantatore/.test(s)) return 'incantatore'
  if (/^touch|contatto/.test(s)) return 'contatto'
  if (/mile|chilometr|\bkm\b/.test(s)) return 'lontanissimo'
  if (/sight|vista/.test(s)) return 'vista'
  if (/unlimited|illimitat/.test(s)) return 'illimitata'
  if (/special|speciale/.test(s)) return 'speciale'
  const piedi = /(\d+)\s*(feet|foot)/.exec(s)
  if (piedi) return (DISTANZE[at(piedi, 1)] ?? at(piedi, 1)) + ' metri'
  const metri = /([\d,.]+)\s*metri/.exec(s)
  if (metri) return at(metri, 1) + ' metri'
  return s
}

/** @param {string} c @returns {string} */
function componenti(c) {
  return (c.match(/\b[VSM]\b/g) ?? []).sort().join('')
}

/** @param {string} d @returns {string} */
function durata(d) {
  const s = d.toLowerCase()
  if (/instantaneous|istantanea/.test(s)) return 'istantanea'
  if (/until dispelled|finché non viene dissolt/.test(s)) return 'dissolta'
  if (/special|speciale/.test(s)) return 'speciale'
  const m = /(\d+)\s*(round|minut|hour|ora|ore|day|giorn)/.exec(s)
  if (!m) return s
  const q = at(m, 2)
  const u = /round/.test(q) ? 'round' : /minut/.test(q) ? 'minuti' : /giorn|day/.test(q) ? 'giorni' : 'ore'
  return `${at(m, 1)} ${u}`
}

// ──────────────────────────────────────────────────────────────── l'aggancio

/**
 * Quanto due voci si somigliano, contando solo ciò che sopravvive alla
 * traduzione.
 *
 * La chiave dura è **il solo livello**: fra le due edizioni nessun incantesimo
 * lo cambia, mentre ventitré cambiano scuola — e il builder porta la scuola del
 * 2014 anche nella sua lista 2024, così che pretenderla uguale lascerebbe senza
 * testo *Cura ferite*, *Cecità/Sordità* e altri diciassette. La scuola pesa,
 * ma non esclude.
 * @param {Inglese} a @param {any} b
 * @returns {number}
 */
function punteggio(a, b) {
  if (a.livello !== b.livello) return -1
  let p = 0
  if (a.scuola === b.scuola) p += 6
  if (componenti(a.componenti) === componenti(b.componenti)) p += 3
  if (gittata(a.gittata) === gittata(b.gittata)) p += 3
  if (tempo(a.tempoDiLancio) === tempo(b.tempoDiLancio)) p += 2
  if (durata(a.durata) === durata(b.durata)) p += 2
  if (a.concentrazione === b.concentrazione) p += 1
  if (a.rituale === b.rituale) p += 1
  if (a.classi.join(',') === b.classi.join(',')) p += 4
  const testo = `${b.testo} ${b.aLivelliSuperiori ?? ''}`
  p += 4 * comuni(dadi(a.descrizione), dadi(testo))
  p += 3 * comuni(segnali(CARATTERISTICHE, a.descrizione, 0), segnali(CARATTERISTICHE, testo, 1))
  p += 3 * comuni(segnali(DANNI, a.descrizione, 0), segnali(DANNI, testo, 1))
  return p
}

/**
 * @param {Inglese[]} inglesi
 * @param {any[]} italiani
 * @param {Edizione} ed
 * @returns {{ponte: Record<string, string>, residui: Inglese[], ambigui: string[]}}
 */
function aggancia(inglesi, italiani, ed) {
  /** @type {{p: number, i: number, j: number}[]} */
  const coppie = []
  inglesi.forEach((a, i) => italiani.forEach((b, j) => {
    const p = punteggio(a, b)
    if (p >= 0) coppie.push({ p, i, j })
  }))
  // Assegnazione avida sul punteggio: con questi dati la coppia migliore è
  // quasi sempre unica, e dove non lo è il pareggio si rompe sull'ordine
  // alfabetico, che è deterministico.
  coppie.sort((x, y) => y.p - x.p || x.i - y.i || x.j - y.j)
  /** @type {Set<number>} */
  const presi = new Set()
  /** @type {Set<number>} */
  const usati = new Set()
  /** @type {Record<string, string>} */
  const ponte = {}
  /** @type {string[]} */
  const ambigui = []
  // Prima i pochi agganci decisi a mano: dove il punteggio non basta, comanda
  // la tabella, e la coppia esce dalla gara per entrambi.
  inglesi.forEach((a, i) => {
    const atteso = (A_MANO[ed] ?? {})[a.id]
    if (atteso === undefined) return
    presi.add(i)
    if (!atteso) return
    const j = italiani.findIndex(b => b.id === atteso)
    if (j < 0) throw new Error(`${ed}: l'aggancio a mano ${a.id} → ${atteso} non trova nessun incantesimo`)
    usati.add(j)
    ponte[a.id] = atteso
  })
  for (const c of coppie) {
    if (presi.has(c.i) || usati.has(c.j)) continue
    // Un aggancio che vince per poco va detto: è lì che si annidano gli errori.
    const secondo = coppie.find(x => x.i === c.i && x.j !== c.j && !usati.has(x.j))
    const margine = c.p - (secondo?.p ?? -Infinity)
    if (margine < 3) ambigui.push(`${at(inglesi, c.i).id} → ${at(italiani, c.j).id} (margine ${margine === Infinity ? '∞' : margine} su «${italiani[secondo?.j ?? 0]?.nome}»)`)
    presi.add(c.i); usati.add(c.j)
    ponte[at(inglesi, c.i).id] = at(italiani, c.j).id
  }
  // Residuo è chiunque non abbia un incantesimo italiano: sia chi non aggancia,
  // sia chi la tabella a mano dichiara assente dall'SRD di quell'edizione.
  return { ponte, residui: inglesi.filter(a => !(a.id in ponte)), ambigui }
}

/** @param {Record<string, string>} o */
export function costruisci(o) {
  const radice = o.builder ?? '../dnd-builder'
  /** @type {Record<string, {ponte: Record<string, string>, residui: Inglese[], ambigui: string[], italiani: number}>} */
  const esito = {}
  for (const ed of /** @type {Edizione[]} */ (['2014', '2024'])) {
    const italiani = compendio(ed)
    const inglesi = listaBuilder(radice, ed)
    const r = aggancia(inglesi, italiani, ed)
    writeFileSync(`data/spells/${ed}/ponte.json`, JSON.stringify(Object.fromEntries(Object.entries(r.ponte).sort())) + '\n')
    // I residui non restano solo a video: l'app deve poter dire *perché* un
    // incantesimo della scheda è lì senza testo, e per farlo gli serve un file.
    writeFileSync(`data/spells/${ed}/ponte-residui.json`, JSON.stringify(
      r.residui.map(s => ({
        id: s.id, nome: s.nome, livello: s.livello,
        motivo: (A_MANO[ed] ?? {})[s.id] === '' ? 'non è nell\'SRD di questa edizione' : 'nessun aggancio trovato',
      })), null, 1,
    ) + '\n')
    esito[ed] = { ...r, italiani: italiani.length }
    console.log(`${ed}: ${Object.keys(r.ponte).length} agganci su ${inglesi.length} id del builder, ${italiani.length} incantesimi italiani`)
    if (r.ambigui.length) {
      console.log(`  ${r.ambigui.length} agganciati a pari punteggio (da rileggere se un giorno sbagliano):`)
      for (const a of r.ambigui) console.log(`    · ${a}`)
    }
    if (r.residui.length) {
      console.log(`  ${r.residui.length} senza corrispondenza — l'app li mostrerà col nome e senza testo:`)
      for (const s of r.residui) console.log(`    · ${s.id} (${s.nome}, ${s.livello}° ${s.scuola})`)
    }
  }
  return esito
}

/** Il compendio intero di un'edizione: l'aggancio ha bisogno dei campi, non del solo indice.
 * @param {Edizione} ed @returns {any[]}
 */
function compendio(ed) {
  /** @type {any[]} */
  const fuori = []
  for (let l = 0; l <= 9; l += 1) fuori.push(...JSON.parse(readFileSync(`data/spells/${ed}/l${l}.json`, 'utf8')))
  return fuori
}

if (import.meta.url === `file://${process.argv[1]}`) {
  /** @type {Record<string, string>} */
  const o = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) o[at(argv, i).replace(/^--/, '')] = argv[i + 1] ?? ''
  costruisci(o)
}
