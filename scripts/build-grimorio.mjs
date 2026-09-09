#!/usr/bin/env node
/**
 * Genera il pacchetto «brancalonia-brainstorm» dal Grimorio di Bassa Lega.
 *
 *   node scripts/build-grimorio.mjs [--grimorio ../brancalonia/regole/grimorio-bassa-lega.md]
 *
 * Scrive `data/rules/brancalonia-brainstorm.json` e il compendio
 * `data/spells/brancalonia-brainstorm/`. La voce nel registro (`data/packs.json`)
 * si aggiunge a mano una volta sola: questo generatore non la tocca.
 *
 * ── Che cos'è questo pacchetto ─────────────────────────────────────────────
 *
 * Brancalonia con le regole di casa di una campagna: «L'Impero Randella
 * Ancora», tavolo Brainstorm. Non sostituisce Brancalonia, ci si appoggia
 * sopra — `base: "brancalonia"`, che a sua volta poggia su `srd-2014`. È la
 * prima catena a tre del registro, ed è il motivo per cui `packChain` la
 * gestisce.
 *
 * Porta due cose:
 *
 * 1. **Gli incantesimi del Regno** con il testo della campagna. Il grimorio
 *    li riassume di proposito («in caso di dubbio fa fede il manuale»): sono
 *    quindi testi *diversi* da quelli del pacchetto base, non una copia — ed
 *    è giusto che si sovrappongano, perché al tavolo vale il grimorio.
 *
 * 2. **La magia scadente**: cilecca, patatrac, ingredienti, forzatura. Non
 *    solo la prosa da leggere, ma i numeri in forma leggibile da un
 *    programma, così l'app può *farla* invece di limitarsi a mostrarla.
 *
 * ── L'appaiamento, che è la parte che può sbagliare ────────────────────────
 *
 * Il pacchetto base chiama gli incantesimi con la traduzione del builder, il
 * grimorio con la propria: «Dito del Fato» e «Dito della Sorte» sono lo stesso
 * incantesimo. Appaiarli per nome non funziona; si appaia per **livello e
 * classi**, che nessuna traduzione cambia, e la **scuola fa da controprova**.
 *
 * Dove la controprova non torna, il generatore **si ferma e lo dice** invece
 * di scegliere: un incantesimo appaiato male è un testo sbagliato attribuito a
 * un nome giusto, cioè l'errore che nessuno vede finché non fa danno.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QUI = dirname(fileURLToPath(import.meta.url))
const RADICE = join(QUI, '..')
const PREDEFINITO = join(RADICE, '..', 'brancalonia', 'regole', 'grimorio-bassa-lega.md')

const ID = 'brancalonia-brainstorm'
const BASE = 'brancalonia'
const USCITA_REGOLE = join(RADICE, 'data', 'rules', `${ID}.json`)
const USCITA_INCANTESIMI = join(RADICE, 'data', 'spells', ID)

/** Il grimorio effettivamente letto: serve alla data di generazione. */
let PERCORSO_USATO = PREDEFINITO

/** Le sigle delle fonti, come le scrive il grimorio. */
const FONTI = {
  MAC: 'Brancalonia — Macaronicon',
  IRA: 'Brancalonia — L\'Impero Randella Ancora',
  ATL: 'Brancalonia — Atlante del Regno',
  DdR: 'Brancalonia — Dispacci dal Regno',
  MdA: 'Brancalonia — Manuale di Ambientazione',
}

/** Dal nome italiano della classe al suo id, come li scrive il compendio. */
const CLASSI = {
  bardo: 'bardo', chierico: 'chierico', druido: 'druido', mago: 'mago',
  ranger: 'ranger', stregone: 'stregone', warlock: 'warlock', paladino: 'paladino',
  monaco: 'monaco', ladro: 'ladro', guerriero: 'guerriero', barbaro: 'barbaro',
  // Il cuocomante è una classe dell'Atlante che il builder non conosce: resta
  // com'è scritta, perché toglierla vorrebbe dire perdere sei incantesimi.
  cuocomante: 'cuocomante',
}

function main() {
  const arg = process.argv.indexOf('--grimorio')
  const percorso = arg > 0 ? process.argv[arg + 1] : PREDEFINITO
  if (!percorso || !existsSync(percorso)) {
    console.error(`Grimorio non trovato: ${percorso}`)
    console.error('Passa il percorso con --grimorio, oppure genera il markdown dalla campagna.')
    process.exit(1)
  }

  PERCORSO_USATO = percorso
  const testo = readFileSync(percorso, 'utf8')
  const incantesimi = leggiIncantesimi(testo)
  const regole = leggiRegole(testo)
  appaiaAlPacchettoBase(incantesimi)

  scriviCompendio(incantesimi)
  scriviRegole(regole, incantesimi.length)

  console.log(`${incantesimi.length} incantesimi, ${Object.keys(regole.magiaScadente).length} blocchi di regole`)
  for (const s of incantesimi) {
    if (!s.testo) console.log(`  senza testo: ${s.nome}`)
  }
}

/* ── Gli incantesimi ───────────────────────────────────────────────────── */

/**
 * @typedef {object} Incantesimo
 * @property {string} id
 * @property {string} nome
 * @property {number} livello
 * @property {string} scuola
 * @property {string[]} classi
 * @property {string|null} notaClassi  quando il grimorio dice una categoria, non un elenco
 * @property {string} fonte
 * @property {string|null} tempoDiLancio
 * @property {string|null} gittata
 * @property {string|null} componenti
 * @property {string|null} durata
 * @property {string|null} testo
 * @property {boolean} rituale
 * @property {boolean} concentrazione
 */

/**
 * @param {string} md
 * @returns {Incantesimo[]}
 */
function leggiIncantesimi(md) {
  // L'appendice A finisce dove comincia la B: oltre ci sono le liste di
  // sottoclasse, che sono rimandi e non incantesimi da schedare.
  const inizio = md.indexOf('# Appendice A.')
  const fine = md.indexOf('# Appendice B.')
  if (inizio < 0) throw new Error('Appendice A non trovata: il grimorio ha cambiato forma')
  const appendice = md.slice(inizio, fine > 0 ? fine : undefined)

  const tabella = leggiTabella(appendice)
  const voci = []

  // Ogni scheda è `### Nome`, poi la riga in corsivo, poi i campi in grassetto,
  // poi la prosa fino alla scheda dopo.
  const schede = appendice.split(/\n### /).slice(1)
  for (const scheda of schede) {
    const righe = scheda.split('\n')
    const nome = (righe[0] ?? '').trim()
    const corpo = righe.slice(1).join('\n')

    const corsivo = /^\*([^*]+)\*/m.exec(corpo)
    if (!corsivo) throw new Error(`«${nome}»: manca la riga di intestazione in corsivo`)
    const { livello, scuola, fonte, classi, notaClassi } = leggiIntestazione(nome, corsivo[1] ?? '')

    const dalla = tabella.get(normalizza(nome))
    if (dalla && dalla.livello !== livello) {
      throw new Error(`«${nome}»: la tabella dice livello ${dalla.livello}, la scheda ${livello}`)
    }

    // L'ultimo incantesimo di ogni sezione si portava dentro il titolo della
    // sezione dopo — «## Incantesimi di 2° livello» — e l'ultimo di tutti la
    // riga di chiusura del documento. Lo stesso errore, in un altro
    // generatore, che si è mangiato una razza intera: un blocco che non sa
    // dove finire prosegue.
    const prosa = corpo
      .slice(corsivo.index + corsivo[0].length)
      .replace(/^[\s\S]*?\*\*Durata:\*\*[^\n]*\n/, '')   // via i campi in grassetto
      .split(/\n(?=#{1,6}\s)/)[0] ?? ''                   // fino al titolo dopo
      .replace(/\n-{3,}\s*$/, '')                         // e non oltre la fine del documento
      .trim()

    voci.push({
      id: slug(nome),
      nome,
      livello,
      scuola,
      classi,
      notaClassi,
      fonte,
      tempoDiLancio: campo(corpo, 'Tempo di lancio'),
      gittata: campo(corpo, 'Gittata'),
      componenti: campo(corpo, 'Componenti'),
      durata: campo(corpo, 'Durata'),
      testo: prosa ? ripulisci(prosa) : null,
      rituale: /rituale/i.test(campo(corpo, 'Tempo di lancio') ?? ''),
      concentrazione: /concentrazione/i.test(campo(corpo, 'Durata') ?? ''),
    })
  }

  // Ogni riga di tabella deve avere la sua scheda: una voce elencata e non
  // descritta è una svista del grimorio, non un caso da ignorare.
  for (const [chiave, riga] of tabella) {
    if (!voci.some(v => normalizza(v.nome) === chiave)) {
      throw new Error(`«${riga.nome}» è in tabella ma non ha una scheda`)
    }
  }
  return voci
}

/**
 * La riga in corsivo: «Trasmutazione di 1° livello (MAC). Mago.» oppure
 * «Trucchetto di divinazione (IRA). Bardo, Chierico…»
 * @param {string} nome @param {string} riga
 */
function leggiIntestazione(nome, riga) {
  const m = /^(?:Trucchetto di (\p{L}+)|(\p{L}+) di (\d)° livello)\s*\(([^)]+)\)\.\s*(.*?)\.?\s*$/u.exec(riga.trim())
  if (!m) throw new Error(`«${nome}»: intestazione non riconosciuta: «${riga}»`)
  const livello = m[3] ? Number(m[3]) : 0
  const scuola = maiuscola(m[1] ?? m[2] ?? '')
  const sigla = (m[4] ?? '').trim()
  const fonte = FONTI[/** @type {keyof typeof FONTI} */ (sigla)]
  if (!fonte) throw new Error(`«${nome}»: sigla di fonte sconosciuta «${sigla}»`)

  // Qualche incantesimo non ha una lista di classi ma una categoria — «gli
  // incantatori arcani, a discrezione del Condottiero». Non è un dato mancante
  // ed è sbagliato ridurlo a un elenco: si porta com'è scritto, e chi filtra
  // per classe semplicemente non lo trova.
  const grezze = (m[5] ?? '').split(/,\s*/).map(c => c.trim()).filter(Boolean)
  const note = []
  const classi = []
  for (const c of grezze) {
    const id = CLASSI[/** @type {keyof typeof CLASSI} */ (c.toLowerCase())]
    if (id) classi.push(id)
    else note.push(c)
  }
  if (!classi.length && !note.length) throw new Error(`«${nome}»: nessuna classe né nota`)
  return { livello, scuola, fonte, classi, notaClassi: note.length ? note.join(', ') : null }
}

/** La tabella riassuntiva dell'appendice, per controprova. @param {string} md */
function leggiTabella(md) {
  /** @type {Map<string, {nome: string, livello: number}>} */
  const out = new Map()
  const blocco = /\| Liv \| Incantesimo[\s\S]*?\n\n/.exec(md)
  if (!blocco) throw new Error('tabella dell\'appendice A non trovata')
  for (const riga of blocco[0].split('\n')) {
    const celle = riga.split('|').map(c => c.trim())
    if (celle.length < 6 || celle[1] === 'Liv' || celle[1]?.startsWith('-')) continue
    const liv = celle[1] === 'T' ? 0 : Number((celle[1] ?? '').replace('°', ''))
    const nome = celle[2] ?? ''
    if (nome) out.set(normalizza(nome), { nome, livello: liv })
  }
  return out
}

/** @param {string} corpo @param {string} etichetta @returns {string|null} */
function campo(corpo, etichetta) {
  const m = new RegExp(`\\*\\*${etichetta}:\\*\\*\\s*([^*\\n]+(?:\\n(?!\\*\\*|\\n)[^*\\n]+)*)`).exec(corpo)
  return m ? ripulisci(m[1] ?? '').replace(/\.$/, '') : null
}

/**
 * Dà agli incantesimi del grimorio l'id che hanno nel pacchetto base.
 *
 * Il compendio sovrappone le cartelle **per id**: se il grimorio chiamasse
 * «dito-della-sorte» quello che il pacchetto base chiama «dito-del-fato», in
 * elenco comparirebbero due volte lo stesso incantesimo con due nomi diversi —
 * che è peggio di non averlo affatto, perché al tavolo si litiga su quale dei
 * due vale.
 *
 * L'appaiamento è per **livello e insieme delle classi**: sono i due dati che
 * nessuna traduzione cambia. La **scuola fa da controprova** e i disaccordi si
 * segnalano invece di risolverli in silenzio — perché un disaccordo vuol dire
 * che uno dei due dati è sbagliato, e va guardato da un umano.
 *
 * Se due incantesimi del base sono ugualmente plausibili, il generatore si
 * ferma: meglio non generare che generare un abbinamento inventato.
 *
 * @param {Incantesimo[]} incantesimi  modificati sul posto
 */
function appaiaAlPacchettoBase(incantesimi) {
  const indice = join(RADICE, 'data', 'spells', BASE, 'index.json')
  if (!existsSync(indice)) {
    console.log(`(pacchetto «${BASE}» assente: gli id restano quelli del grimorio)`)
    return
  }
  const base = JSON.parse(readFileSync(indice, 'utf8'))

  for (const s of incantesimi) {
    const mie = [...s.classi].sort().join(',')
    let candidati = base.filter((/** @type {any} */ b) =>
      b.livello === s.livello && [...b.classi].sort().join(',') === mie)

    // Livello e classi da soli non bastano sempre: «Fandonizzare» e «Illusione
    // Fiscale» sono tutt'e due di 1° e per le stesse quattro classi. Lì
    // decide la scuola, che è un dato indipendente dalla traduzione.
    if (candidati.length > 1) {
      const perScuola = candidati.filter((/** @type {any} */ b) => b.scuola === s.scuola)
      if (perScuola.length === 1) candidati = perScuola
    }

    if (candidati.length > 1) {
      throw new Error(`«${s.nome}»: ${candidati.length} incantesimi del pacchetto base sono ugualmente plausibili `
        + `(${candidati.map((/** @type {any} */ c) => c.nome).join(', ')}). Appaialo a mano.`)
    }
    const b = candidati[0]
    if (!b) continue   // incantesimo che il base non ha: resta con l'id suo

    if (b.scuola !== s.scuola) {
      console.log(`  scuola discorde: «${s.nome}» è ${s.scuola} nel grimorio e ${b.scuola} nel pacchetto base (id ${b.id})`)
    }
    if (b.id !== s.id) console.log(`  «${s.nome}» prende l'id del base: ${b.id} (là si chiama «${b.nome}»)`)
    s.id = b.id
  }
}

/* ── Le regole di casa ─────────────────────────────────────────────────── */

/**
 * I numeri della magia scadente, in forma leggibile da un programma.
 *
 * Non si estraggono dalla prosa: si leggono dal «bugiardino», che è la
 * tabella che il grimorio tiene apposta in fondo, e si verificano contro il
 * testo. Estrarli a espressioni regolari da sei paragrafi diversi sarebbe
 * fragile per guadagnare niente — questi numeri cambiano una volta l'anno, il
 * testo attorno cambia a ogni sessione.
 * @param {string} md
 */
function leggiRegole(md) {
  const bugiardino = md.slice(md.indexOf('# 7. Il bugiardino'))
  if (!bugiardino) throw new Error('bugiardino non trovato')

  // Controprova: la formula deve essere ancora quella che stiamo codificando.
  if (!/2 × \(livello \+ 1\)/.test(bugiardino)) {
    throw new Error('la formula della cilecca nel bugiardino non è più «2 × (livello + 1)»: rileggi il grimorio prima di rigenerare')
  }

  /** @type {Record<string, number>} */
  const soglie = {}
  for (let liv = 0; liv <= 9; liv++) soglie[String(liv)] = 2 * (liv + 1)

  return {
    magiaScadente: {
      nome: 'Grimorio di Bassa Lega',
      cilecca: {
        dado: '1d20',
        formula: '2 × (livello + 1)',
        soglie,
        // conta il livello *a cui si lancia*, non quello stampato
        suSlot: true,
        nonTirano: ['rituali', 'capacità di classe che non sono incantesimi', 'oggetti magici'],
      },
      patatrac: {
        su: 1,
        dado: '1d6',
        maiSulleCure: true,
        voci: leggiPatatrac(md),
      },
      ingredienti: {
        maxPerLivello: 3,
        azzeraLaCilecca: true,
        costo: { 1: 3, 2: 12, 3: 40 },
        raccoltaCd: { 1: 12, 2: 15, 3: 18 },
      },
      forzare: {
        unaVoltaPer: 'sessione',
        sommaSlot: 'livello + 1',
        raddoppiaLaCilecca: true,
        conIngredienteTornaNormale: true,
      },
      malocchio: { raddoppiaLaCilecca: true, finoA: 'riposo lungo' },
    },
  }
}

/** @param {string} md */
function leggiPatatrac(md) {
  const blocco = /\| d6 \| Patatrac \|[\s\S]*?\n\n/.exec(md)
  if (!blocco) throw new Error('tabella del patatrac non trovata')
  const voci = []
  for (const riga of blocco[0].split('\n')) {
    const celle = riga.split('|').map(c => c.trim())
    const n = Number(celle[1])
    if (!Number.isInteger(n) || n < 1 || n > 6) continue
    const testo = celle[2] ?? ''
    const nome = /\*\*([^*]+)\*\*/.exec(testo)
    voci.push({
      d6: n,
      nome: (nome?.[1] ?? '').replace(/\.$/, ''),
      testo: ripulisci(testo.replace(/\*\*[^*]+\*\*\s*/, '')),
    })
  }
  if (voci.length !== 6) throw new Error(`patatrac: attese 6 voci, trovate ${voci.length}`)
  return voci
}

/* ── Scrittura ─────────────────────────────────────────────────────────── */

/** @param {Incantesimo[]} incantesimi */
function scriviCompendio(incantesimi) {
  mkdirSync(USCITA_INCANTESIMI, { recursive: true })
  const indice = incantesimi
    .map(s => ordina({
      id: s.id, nome: s.nome, livello: s.livello, scuola: s.scuola, classi: s.classi,
      notaClassi: s.notaClassi, rituale: s.rituale, concentrazione: s.concentrazione,
      differisce: false, cambiamenti: [],
    }))
    .sort((a, b) => a.livello - b.livello || a.nome.localeCompare(b.nome, 'it'))
  writeFileSync(join(USCITA_INCANTESIMI, 'index.json'), JSON.stringify(indice) + '\n')

  for (let liv = 0; liv <= 9; liv++) {
    const del = incantesimi
      .filter(s => s.livello === liv)
      // `differisce` e `cambiamenti` non servono a questo pacchetto — sono il
      // confronto fra le due edizioni SRD, e qui l'edizione è una sola — ma il
      // compendio li legge senza chiedere permesso (`voce.cambiamenti.includes`),
      // e una voce che non li ha fa cadere la scheda quando la si apre.
      .map(s => ordina({ ...s, edizione: '2014', differisce: false, cambiamenti: [] }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
    writeFileSync(join(USCITA_INCANTESIMI, `l${liv}.json`), JSON.stringify(del) + '\n')
  }
}

/** @param {Record<string, unknown>} regole @param {number} quanti */
function scriviRegole(regole, quanti) {
  const pacchetto = ordina({
    variante: ID,
    base: BASE,
    edizione: '2014',
    fonte: 'Grimorio di Bassa Lega — regole di casa della campagna «L\'Impero Randella Ancora»',
    // La data del grimorio, non l'ora di adesso: due rigenerazioni dello stesso
    // documento devono dare lo stesso file, altrimenti l'hash del pacchetto
    // cambia da solo e invalida la cache di chi non ha visto niente di nuovo.
    generatedAt: dataDelGrimorio(),
    incantesimiDelRegno: quanti,
    ...regole,
  })
  writeFileSync(USCITA_REGOLE, JSON.stringify(pacchetto) + '\n')
}

/* ── attrezzi ──────────────────────────────────────────────────────────── */

/** L'ultima modifica del grimorio: è la sua data, e non cambia da sola. */
function dataDelGrimorio() {
  try { return statSync(PERCORSO_USATO).mtime.toISOString() } catch { return '1970-01-01T00:00:00.000Z' }
}

/** @param {string} v */
function slug(v) {
  return v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** @param {string} v */
function normalizza(v) {
  return slug(v.replace(/\*/g, ''))
}

/** @param {string} v */
function maiuscola(v) {
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
}

/**
 * Il markdown va a capo dove serve a lui: nel JSON un capoverso è una riga.
 * Le liste puntate restano tali, perché in un incantesimo elencano opzioni e
 * appiattirle vorrebbe dire perderne una.
 * @param {string} v
 */
function ripulisci(v) {
  return v
    .replace(/\r/g, '')
    // Il grassetto e il corsivo se ne vanno tutt'e due: prima cadeva solo il
    // grassetto, e i titoli degli incantesimi citati restavano fra asterischi
    // — a schermo si leggeva «*illusione minore*», asterischi compresi.
    .replace(/\*\*/g, '')
    .replace(/(?<![A-Za-zÀ-ù0-9])\*(?=\S)|(?<=\S)\*(?![A-Za-zÀ-ù0-9])/g, '')
    .replace(/(?<!\n)\n(?![\n\-•])/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Chiavi in ordine, così due rigenerazioni danno lo stesso file.
 * @param {any} o
 * @returns {any}
 */
function ordina(o) {
  if (Array.isArray(o)) return o.map(ordina)
  if (o && typeof o === 'object') {
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, ordina(o[k])]))
  }
  return o
}

main()
