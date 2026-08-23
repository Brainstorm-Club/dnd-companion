#!/usr/bin/env node
/**
 * Estrae i due compendi dai PDF degli SRD italiani.
 *   node scripts/build-spells.mjs --srd51 <file.pdf> --srd521 <file.pdf>
 *
 * ── Lotto M ──
 *
 * Quello che l'esplorazione ha già stabilito, e che il lotto non deve riscoprire:
 *
 *  · `pdftotext` **senza** `-layout`. Con `-layout` le due colonne si
 *    intrecciano riga per riga e il testo esce inservibile — è quasi
 *    certamente l'origine del difetto noto del builder («sessanta su 307
 *    illeggibili»).
 *  · **Due parser, non uno.** Le intestazioni differiscono:
 *      2014  `Trucchetto di <Scuola>` · `<Scuola> di 2° livello`   ordinale ° U+00B0
 *      2024  `Trucchetto di <Scuola> (classi)` · `<Scuola> di 2º livello (classi)`  ordinale º U+00BA
 *    Nel 2014 le classi **non** sono nell'intestazione: si prendono dalle
 *    «Liste degli incantesimi» che l'SRD 5.1 stampa per ognuna delle otto
 *    classi, ed è da lì che il ponte le riprende.
 *  · **Invarianti**, verificate prima di scrivere qualunque file:
 *      2024  27 trucchetti + 312 livellati = 339 = righe `Tempo di lancio:`
 *      2014  24 trucchetti + 295 livellati = 319 = righe `Tempo di lancio:`
 *  · **Sanificazione.** «Rivendita vietata. È permesso fotocopiare o stampare
 *    questo documento per il solo uso personale.» compare 453 volte nel PDF
 *    5.1 e finisce dentro il flusso del testo: è la versione italiana della
 *    riga colata dentro undici descrizioni del builder. Vanno tolti anche
 *    numeri di pagina e intestazioni correnti, e la CI fallisce se ne resta uno.
 *  · `differisce` si calcola qui: la scheda non deve fare confronti a runtime
 *    sul telefono. **Non** sul testo, però — vedi `segnaDifferenze`.
 *  · I PDF **non** entrano nel repo: si committa solo il JSON generato.
 *
 * ── Due cose che l'implementazione ha dovuto aggiungere ──
 *
 * 1. **`-bbox-layout`, non l'estrazione piatta.** Senza `-layout` l'ordine di
 *    lettura è giusto quasi ovunque, ma su una ventina di pagine per edizione
 *    il riquadro colorato dell'intestazione di scuola esce dal flusso e finisce
 *    a valle del corpo: nel 5.1 «Spruzzo velenoso» si ritrova l'intestazione
 *    di «Spruzzo prismatico», e via così per una ventina di incantesimi per
 *    edizione. `-bbox-layout` dà le coordinate di ogni riga: si separano le due
 *    colonne per ascissa e si ordinano per ordinata, e i due compendi tornano
 *    perfettamente allineati (2024: 339 intestazioni contro 339 blocchi di
 *    campi, zero disallineamenti). Il rientro della prima riga di capoverso,
 *    che l'estrazione piatta butta via, serve a ricostruire i paragrafi.
 * 2. **La discrepanza di uno del 5.1 è una riga sola, e sta qui sotto**
 *    (`RIPARAZIONI`): l'intestazione di *Dominare persone* esce come
 *    `Ammaliamento di 5° li Eroismoello`, con il nome dell'incantesimo
 *    successivo — *Eroismo* — infilato dentro la parola «livello» perché nel
 *    PDF i due testi si sovrappongono. Riparata quella riga, 319 intestazioni
 *    contro 319 blocchi di campi.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** @typedef {'2014'|'2024'} Edizione */

/** Le otto scuole, come le scrivono i due SRD italiani. */
export const SCUOLE = ['Abiurazione', 'Ammaliamento', 'Divinazione', 'Evocazione', 'Illusione', 'Invocazione', 'Necromanzia', 'Trasmutazione']

/** Le otto classi incantatrici, minuscole, come le scrive l'SRD 5.2.1. */
export const CLASSI = ['bardo', 'chierico', 'druido', 'mago', 'paladino', 'ranger', 'stregone', 'warlock']

/** @type {Record<Edizione, {ordinale: string, fonte: string, srd: string}>} */
const EDIZIONI = {
  '2014': { ordinale: '°', fonte: 'SRD 5.1 IT', srd: '5.1' },
  '2024': { ordinale: 'º', fonte: 'SRD 5.2.1 IT', srd: '5.2.1' },
}

/**
 * Righe da riparare a mano, per edizione. Una sola, e con la sua ragione:
 * vedi il commento di testa.
 * @type {Record<Edizione, Record<string, string>>}
 */
const RIPARAZIONI = {
  '2014': { 'Ammaliamento di 5° li Eroismoello': 'Ammaliamento di 5° livello' },
  '2024': {},
}

/**
 * Lo stesso incantesimo con due nomi italiani diversi nelle due traduzioni.
 * Solo questi due: tutti gli altri scarti fra i due elenchi sono incantesimi
 * davvero entrati o usciti dall'SRD. La tabella è simmetrica.
 * @type {Record<string, string>}
 */
export const RIBATTEZZATI = {
  'saltare': 'salto',
  'salto': 'saltare',
  'conoscenza-delle-legende': 'conoscenza-delle-leggende',
  'conoscenza-delle-leggende': 'conoscenza-delle-legende',
}

/** Quel che va tolto dal flusso: piè di pagina e intestazioni correnti. */
const BOILERPLATE = [
  /^Rivendita vietata\./,
  /^Systems? Reference Document/,
  /^Not for resale\./,
]

// ─────────────────────────────────────────────────────────── lettura del PDF

/**
 * @typedef {object} Riga
 * @property {number} pagina
 * @property {number} colonna  1 = sinistra, 2 = destra, 0 = a tutta pagina
 * @property {number} x
 * @property {number} y
 * @property {string} testo
 * @property {boolean} rientro  prima riga di capoverso (rientrata rispetto alla colonna)
 */

/** L'elemento i-esimo, con la garanzia che esista: `noUncheckedIndexedAccess`
 * è acceso, e qui gli indici sono già stati calcolati.
 * @template T @param {T[]} a @param {number} i @returns {T}
 */
function at(a, i) {
  const v = a[i]
  if (v === undefined) throw new Error(`indice ${i} fuori intervallo`)
  return v
}

/** @param {string} s @returns {string} */
function entita(s) {
  return s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Il PDF, riga per riga, nell'ordine di lettura vero: colonna sinistra dall'alto
 * al basso, poi colonna destra. È l'unico modo per non farsi intrecciare le due
 * colonne dai riquadri di intestazione, che nel flusso del PDF stanno altrove.
 *
 * @param {string} pdf
 * @param {Edizione} ed
 * @returns {Riga[]}
 */
function righeDaPdf(pdf, ed) {
  const dir = mkdtempSync(join(tmpdir(), 'srd-'))
  const xmlPath = join(dir, 'bbox.html')
  try {
    execFileSync('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', pdf, xmlPath], { stdio: ['ignore', 'ignore', 'inherit'] })
    const xml = readFileSync(xmlPath, 'utf8')
    /** @type {Riga[]} */
    const fuori = []
    const pagine = xml.split('<page ').slice(1)
    pagine.forEach((p, indice) => {
      const larghezza = Number(/width="([\d.]+)"/.exec(p)?.[1] ?? 0)
      const altezza = Number(/height="([\d.]+)"/.exec(p)?.[1] ?? 0)
      const mezzo = larghezza / 2
      /** @type {{x: number, y: number, xMax: number, testo: string}[]} */
      const grezze = []
      const reRiga = /<line xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="[\d.-]+">([\s\S]*?)<\/line>/g
      let m
      while ((m = reRiga.exec(p))) {
        let testo = entita([...at(m, 4).matchAll(/<word [^>]*>([\s\S]*?)<\/word>/g)].map(w => w[1] ?? '').join(' '))
        testo = testo.replace(/­/g, '').replace(/\s+/g, ' ').trim()
        if (!testo) continue
        const x = Number(at(m, 1)), y = Number(at(m, 2)), xMax = Number(at(m, 3))
        // Piè di pagina, intestazione corrente e numero di pagina: fuori dal
        // flusso, e con la prova doppia (posizione in fondo + forma della riga).
        const inFondo = y > altezza - 55
        if (BOILERPLATE.some(r => r.test(testo))) continue
        if (inFondo && /^\d{1,4}$/.test(testo)) continue
        grezze.push({ x, y, xMax, testo })
      }
      /** @type {(typeof grezze[0] & {colonna: number})[]} */
      const conColonna = grezze.map(l => ({ ...l, colonna: (l.xMax > mezzo + 6 && l.x < mezzo - 6) ? 0 : (l.x < mezzo ? 1 : 2) }))
      conColonna.sort((a, b) => (a.colonna - b.colonna) || (a.y - b.y) || (a.x - b.x))
      // Il margine di ogni colonna: serve a riconoscere il rientro di capoverso,
      // che è l'unico segnale di paragrafo rimasto (fra un capoverso e l'altro
      // questi PDF non lasciano spazio verticale).
      /** @type {Record<number, number>} */
      const margine = {}
      for (const l of conColonna) margine[l.colonna] = Math.min(margine[l.colonna] ?? Infinity, l.x)
      for (const l of conColonna) {
        fuori.push({
          pagina: indice + 1,
          colonna: l.colonna,
          x: l.x,
          y: l.y,
          testo: (RIPARAZIONI[ed] ?? {})[l.testo] ?? l.testo,
          rientro: l.x > (margine[l.colonna] ?? 0) + 3,
        })
      }
    })
    return fuori
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────────── il compendio

/** @param {string} nome @returns {string} */
export function slug(nome) {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Le righe di un'intestazione di scuola, che nel 2024 può andare a capo per
 * fare stare la lista di classi.
 * @param {Riga[]} righe @param {number} i @returns {{testo: string, fine: number}}
 */
function intestazioneIntera(righe, i) {
  let testo = at(righe, i).testo
  let fine = i
  while (testo.includes('(') && !testo.includes(')') && fine + 1 < righe.length) {
    fine += 1
    testo += ' ' + at(righe, fine).testo
  }
  return { testo, fine }
}

/**
 * Ricompone un blocco di righe in paragrafi: sillabazione sciolta, righe unite,
 * capoverso nuovo dove il PDF rientra la prima riga.
 * @param {Riga[]} righe @returns {string}
 */
function paragrafi(righe) {
  /** @type {string[][]} */
  const blocchi = []
  righe.forEach((r, i) => {
    // Il capoverso lo segna il rientro, non il cambio di colonna: una frase che
    // scavalca la fine della pagina resta una frase sola.
    if (i === 0 || r.rientro) blocchi.push([])
    at(blocchi, blocchi.length - 1).push(r.testo)
  })
  return blocchi
    .map(b => b.reduce((acc, riga) => {
      if (!acc) return riga
      // Sillabazione: trattino a fine riga seguito da minuscola.
      if (/[a-zà-ù]-$/.test(acc) && /^[a-zà-ù]/.test(riga)) return acc.slice(0, -1) + riga
      return acc + ' ' + riga
    }, ''))
    .map(p => p.trim())
    .filter(Boolean)
    .join('\n')
}

/** Le liste per classe dell'SRD 5.1: le classi del 2014 stanno lì, non nell'intestazione.
 * @param {Riga[]} righe @returns {Map<string, string[]>} nome italiano → classi
 */
function classiDalleListe(righe) {
  /** @type {Map<string, Set<string>>} */
  const mappa = new Map()
  let classe = null
  for (const r of righe) {
    const m = /^Incantesimi da ([a-zà-ù]+)$/i.exec(r.testo)
    if (m && CLASSI.includes(at(m, 1).toLowerCase())) { classe = at(m, 1).toLowerCase(); continue }
    if (!classe) continue
    if (/^Liste degli incantesimi$/i.test(r.testo)) continue
    if (/^(Trucchetti \(livello 0\)|[1-9]° livello)$/i.test(r.testo)) continue
    // La sezione finisce dove comincia il compendio vero, cioè al primo blocco
    // di campi.
    if (/^Tempo di lancio:/.test(r.testo)) break
    if (r.testo.length > 45 || /[.:,]$/.test(r.testo)) { classe = null; continue }
    // Chiave sullo slug: le liste per classe non sono sempre d'accordo con il
    // compendio sulle maiuscole («Dardo Tracciante» contro «Dardo tracciante»).
    const k = slug(r.testo)
    if (!mappa.has(k)) mappa.set(k, new Set())
    mappa.get(k)?.add(classe)
  }
  return new Map([...mappa].map(([k, v]) => [k, [...v].sort()]))
}

/**
 * Dove finisce l'ultimo incantesimo del compendio. Non c'è un'intestazione
 * successiva a fare da confine, e senza questo il testo di *Zona di verità* si
 * porterebbe dietro tutti i capitoli che seguono: si taglia al primo titolo,
 * cioè alla prima riga corta, staccata e senza punteggiatura finale.
 * @param {Riga[]} righe @param {number} inizio @returns {number}
 */
function fineCompendio(righe, inizio) {
  for (let i = inizio + 1; i < righe.length; i += 1) {
    const r = at(righe, i), p = at(righe, i - 1)
    const staccata = r.pagina !== p.pagina || r.colonna !== p.colonna || r.y - p.y > 15
    if (staccata && !r.rientro && r.testo.length < 45 && !/[.,:;]$/.test(r.testo)) return i
  }
  return righe.length
}

/**
 * @typedef {object} Incantesimo
 * @property {string} id
 * @property {string} nome
 * @property {number} livello
 * @property {string} scuola
 * @property {string[]} classi
 * @property {boolean} rituale
 * @property {boolean} concentrazione
 * @property {boolean} differisce
 * @property {string[]} cambiamenti  cosa cambia nell'altra edizione
 * @property {string} tempoDiLancio
 * @property {string} gittata
 * @property {string} componenti
 * @property {string} durata
 * @property {string} testo
 * @property {string} [aLivelliSuperiori]
 * @property {Edizione} edizione
 * @property {string} fonte
 */

/**
 * Il parser di un'edizione. Ce ne sono due perché le intestazioni sono due
 * cose diverse, non la stessa con un condizionale.
 * @param {Riga[]} righe @param {Edizione} ed @returns {Incantesimo[]}
 */
function analizza(righe, ed) {
  const { ordinale, fonte } = EDIZIONI[ed]
  const scuole = SCUOLE.join('|')
  const reTrucchetto = new RegExp(`^Trucchetto di (${scuole})\\b`, 'i')
  const reLivellato = new RegExp(`^(${scuole}) di ([1-9])${ordinale} livello\\b`, 'i')
  const classiPerNome = ed === '2014' ? classiDalleListe(righe) : new Map()

  /** @type {number[]} */
  const capi = []
  righe.forEach((r, i) => { if (reTrucchetto.test(r.testo) || reLivellato.test(r.testo)) capi.push(i) })

  const campi = righe.filter(r => /^Tempo di lancio:/.test(r.testo)).length
  if (capi.length !== campi) {
    throw new Error(`${ed}: ${capi.length} intestazioni contro ${campi} blocchi di campi — la discrepanza va chiusa, non ignorata`)
  }

  /** @type {Incantesimo[]} */
  const fuori = []
  capi.forEach((i, k) => {
    const { testo: intestazione, fine } = intestazioneIntera(righe, i)
    const nome = at(righe, i - 1).testo.trim()
    const t = reTrucchetto.exec(intestazione)
    const l = reLivellato.exec(intestazione)
    const livello = t ? 0 : Number(l?.[2])
    const grezza = (t?.[1] ?? l?.[1] ?? '')
    const scuola = SCUOLE.find(s => s.toLowerCase() === grezza.toLowerCase())
    if (!scuola) throw new Error(`${ed}: scuola sconosciuta in «${intestazione}»`)
    const parentesi = /\(([^)]*)\)/.exec(intestazione)?.[1] ?? ''

    // I campi. Le righe che seguono l'etichetta e le stanno attaccate ne sono
    // la continuazione; fra l'ultimo campo e il corpo il PDF lascia mezza riga
    // di spazio in più, ed è quello a segnare la fine del blocco.
    /** @type {Record<string, string>} */
    const valori = {}
    let j = fine + 1
    let etichetta = null
    for (; j < righe.length; j += 1) {
      const r = at(righe, j)
      // «Componente:» al singolare è un refuso del 5.1 (Contagio), non un campo diverso.
      const m = /^(Tempo di lancio|Gittata|Component[ie]|Durata):\s*(.*)$/.exec(r.testo)
      if (m) {
        etichetta = at(m, 1) === 'Componente' ? 'Componenti' : at(m, 1)
        valori[etichetta] = at(m, 2)
        continue
      }
      const prec = at(righe, j - 1)
      const attaccata = r.pagina === prec.pagina && r.colonna === prec.colonna && r.y - prec.y < 15
      // Prima di `Durata:` una riga attaccata è per forza la coda del campo
      // precedente (le reazioni del 5.1 occupano tre righe). Dopo `Durata:`
      // comincia il corpo, che a volte parte senza stacco: lì l'unico segnale
      // rimasto è il rientro, che la coda di un campo ha e il corpo no.
      if (etichetta && attaccata && (etichetta !== 'Durata' || r.rientro)) {
        valori[etichetta] = (valori[etichetta] ?? '') + ' ' + r.testo
        continue
      }
      break
    }
    for (const atteso of ['Tempo di lancio', 'Gittata', 'Componenti', 'Durata']) {
      if (!(atteso in valori)) throw new Error(`${ed}: «${nome}» non ha il campo ${atteso}`)
    }

    const finePrecedente = k + 1 < capi.length ? at(capi, k + 1) - 1 : fineCompendio(righe, j)
    const corpo = paragrafi(righe.slice(j, finePrecedente))

    // Il paragrafo dello slot superiore ha due nomi diversi nelle due edizioni.
    const reSuperiori = ed === '2014'
      ? /^Ai livelli superiori\.\s*/
      : /^(Utilizzo di uno slot incantesimo di livello superiore|Trucchetto potenziato)\.\s*/i
    /** @type {string[]} */
    const restanti = []
    let superiori
    for (const p of corpo.split('\n')) {
      if (reSuperiori.test(p)) superiori = p.replace(reSuperiori, '').trim()
      else restanti.push(p)
    }

    const durata = valori['Durata'] ?? ''
    const tempo = valori['Tempo di lancio'] ?? ''
    /** @type {Incantesimo} */
    const inc = {
      id: slug(nome),
      nome,
      livello,
      scuola,
      classi: ed === '2024'
        ? parentesi.split(',').map(c => c.trim().toLowerCase()).filter(c => CLASSI.includes(c)).sort()
        : (classiPerNome.get(slug(nome)) ?? []),
      rituale: /rituale/i.test(parentesi) || /\brituale\b/i.test(tempo),
      concentrazione: /concentrazione/i.test(durata),
      differisce: false,
      cambiamenti: [],
      tempoDiLancio: tempo,
      gittata: valori['Gittata'] ?? '',
      componenti: valori['Componenti'] ?? '',
      durata,
      testo: restanti.join('\n'),
      ...(superiori ? { aLivelliSuperiori: superiori } : {}),
      edizione: ed,
      fonte,
    }
    fuori.push(inc)
  })
  return fuori
}

// ───────────────────────────────────────────────────────────────── scrittura

/**
 * `differisce` si calcola qui, una volta sola: la scheda non deve rifarlo sul
 * telefono a ogni apertura.
 *
 * **E non confronta i due testi.** I due SRD italiani sono traduzioni
 * indipendenti, quindi la prosa cambia anche dove la regola è identica: il
 * confronto sul testo normalizzato accende la spia su 308 incantesimi comuni
 * su 315, e una spia che si accende su tutto non dice niente. *Allarme* ha
 * «un cubo di 6 metri» nel 2014 e «un cubo con spigolo di 6 metri» nel 2024 —
 * stessa regola, parole diverse — e lo stesso vale per i campi strutturati
 * (`1 azione` contro `azione`).
 *
 * Si confronta perciò solo ciò che è categorico: livello, scuola, rituale,
 * concentrazione e la lista di classi. `cambiamenti` dice *cosa* è cambiato,
 * così la scheda può essere precisa invece che generica.
 *
 * @param {Incantesimo[]} a @param {Incantesimo[]} b
 */
function segnaDifferenze(a, b) {
  const perId = new Map(b.map(s => [s.id, s]))
  for (const s of a) {
    const altro = perId.get(s.id) ?? perId.get(RIBATTEZZATI[s.id] ?? '')
    if (!altro) { s.differisce = true; s.cambiamenti = ['assente']; continue }
    /** @type {string[]} */
    const cambiamenti = []
    if (s.livello !== altro.livello) cambiamenti.push('livello')
    if (s.scuola.toLowerCase() !== altro.scuola.toLowerCase()) cambiamenti.push('scuola')
    if (s.rituale !== altro.rituale) cambiamenti.push('rituale')
    if (s.concentrazione !== altro.concentrazione) cambiamenti.push('concentrazione')
    if (s.classi.join(',') !== altro.classi.join(',')) cambiamenti.push('classi')
    s.cambiamenti = cambiamenti
    s.differisce = cambiamenti.length > 0
  }
}

/** @param {Edizione} ed @param {Incantesimo[]} incantesimi */
function scrivi(ed, incantesimi) {
  const dir = `data/spells/${ed}`
  mkdirSync(dir, { recursive: true })
  const ordinati = [...incantesimi].sort((x, y) => x.livello - y.livello || x.nome.localeCompare(y.nome, 'it'))
  const indice = ordinati.map(s => ({
    id: s.id, nome: s.nome, livello: s.livello, scuola: s.scuola, classi: s.classi,
    rituale: s.rituale, concentrazione: s.concentrazione, differisce: s.differisce,
    cambiamenti: s.cambiamenti,
  }))
  writeFileSync(`${dir}/index.json`, JSON.stringify(indice) + '\n')
  for (let l = 0; l <= 9; l += 1) {
    writeFileSync(`${dir}/l${l}.json`, JSON.stringify(ordinati.filter(s => s.livello === l)) + '\n')
  }
  return ordinati
}

// ───────────────────────────────────────────────────────────────────── avvio

/** @param {string[]} argv @returns {Record<string, string>} */
function opzioni(argv) {
  /** @type {Record<string, string>} */
  const o = {}
  for (let i = 0; i < argv.length; i += 2) o[at(argv, i).replace(/^--/, '')] = argv[i + 1] ?? ''
  return o
}

/** @param {Record<string, string>} o */
export function costruisci(o) {
  /** @type {Record<Edizione, Incantesimo[]>} */
  const compendi = {
    '2014': analizza(righeDaPdf(o.srd51 ?? '', '2014'), '2014'),
    '2024': analizza(righeDaPdf(o.srd521 ?? '', '2024'), '2024'),
  }
  segnaDifferenze(compendi['2014'], compendi['2024'])
  segnaDifferenze(compendi['2024'], compendi['2014'])
  /** @type {Record<string, Incantesimo[]>} */
  const scritti = {}
  for (const ed of /** @type {Edizione[]} */ (['2014', '2024'])) {
    const ordinati = scrivi(ed, compendi[ed])
    scritti[ed] = ordinati
    const perLivello = ordinati.reduce((/** @type {Record<number, number>} */ acc, s) => {
      acc[s.livello] = (acc[s.livello] ?? 0) + 1; return acc
    }, {})
    console.log(`${ed}: ${ordinati.length} incantesimi — ` + Object.entries(perLivello).map(([l, n]) => `l${l}:${n}`).join(' '))
    const senzaClassi = ordinati.filter(s => s.classi.length === 0)
    if (senzaClassi.length) console.log(`  senza classi (${senzaClassi.length}): ${senzaClassi.map(s => s.nome).join(', ')}`)
  }
  return scritti
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = opzioni(process.argv.slice(2))
  if (!o.srd51 || !o.srd521) {
    console.error('uso: node scripts/build-spells.mjs --srd51 <SRD_CC_v5.1_IT.pdf> --srd521 <IT_SRD_CC_v5.2.1.pdf>')
    console.error('i due PDF sono CC-BY-4.0 e si scaricano da https://dnd.wizards.com/it/resources/systems-reference-document')
    console.error('e da https://www.dndbeyond.com/srd — nel repo non entrano.')
    process.exit(1)
  }
  costruisci(o)
}
