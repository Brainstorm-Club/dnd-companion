/**
 * Service worker scritto a mano. Nessun Workbox: sono un centinaio di righe, e
 * una dipendenza per un centinaio di righe non si giustifica.
 *
 * Precache in tre tempi (PIANO.md § 7):
 *   1. shell + i due indici dei compendi → l'app è usabile e già si cerca
 *   2. regole e blocchi di testo dell'edizione in uso
 *   3. l'altra edizione, in coda
 *
 * Il tempo 1 sta in `install`, gli altri due partono da un messaggio della
 * pagina (`{tipo:'precarica'}`): metterli in `activate` bloccherebbe le fetch
 * fino alla fine del download, che è esattamente il contrario di ciò che
 * serve. La pagina dice anche quale edizione viene prima, perché il service
 * worker non può leggere localStorage.
 *
 * I file dei compendi e delle regole li generano altri lotti e possono ancora
 * non esistere: **niente `addAll`**, che fallisce tutto se manca un file solo.
 * Uno per uno, con `allSettled`, e i mancanti finiscono a console.
 */

const VERSION = 'v11'
const CACHE = `dndc-${VERSION}`

/** Le due edizioni, nell'ordine di default se la pagina non dice la sua. */
/**
 * Il precache lungo non conosce le edizioni: legge il **registro**.
 *
 * Prima questa era una lista di due edizioni scritta a mano, e i pacchetti che
 * non sono un'edizione — Brancalonia, il grimorio del tavolo — avevano in
 * cache il solo indice: a rete spenta l'app mostrava i nomi degli incantesimi
 * e, al posto del testo, la frase sulla licenza. Cioè dava la colpa al
 * permesso di pubblicare per un file che non era stato scaricato.
 *
 * Era anche una crepa nella promessa dell'architettura — «aggiungere una
 * variante è scrivere una voce nel registro» — perché bisognava anche
 * ricordarsi di editare questo file.
 */
const REGISTRO = 'data/packs.json'

/** Quanti blocchi di testo per edizione: i livelli da 0 (trucchetti) a 9. */
const LIVELLI = 10

/**
 * L'elenco della shell è scritto a mano, e va tenuto in passo con i file che
 * esistono davvero: un modulo nuovo che nessuno aggiunge qui non viene
 * precaricato — funziona lo stesso, perché la strategia `fetch` mette in cache
 * tutto ciò che passa, ma solo dopo che l'utente ci è passato una volta.
 */

/** Tempo 1 — la shell. Tutto ciò che serve per disegnare la prima schermata. */
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'src/main.js', 'src/dom.js', 'src/router.js', 'src/store.js', 'src/storage.js', 'src/i18n.js',
  'src/views/index.js', 'src/views/library.js', 'src/views/sheet.js', 'src/views/dice.js',
  'src/views/checks.js', 'src/views/spells.js', 'src/views/progress.js', 'src/views/levelup.js',
  'src/views/settings.js', 'src/views/parti.js', 'src/views/features.js', 'src/views/scan.js',
  'src/views/races.js',
  'src/gestures.js', 'src/anima-dadi.js', 'src/schermo.js', 'src/components/dice-tray.js',
  'src/domain/character.js', 'src/domain/check.js', 'src/domain/dice.js', 'src/domain/edition.js', 'src/domain/errata.js',
  'src/domain/importer.js', 'src/domain/packs.js', 'src/domain/progress.js', 'src/domain/rng.js',
  'src/domain/session.js', 'src/domain/spells.js', 'src/domain/reimport.js', 'src/domain/privilegi.js', 'src/domain/rules.js',
  'src/domain/razze.js',
  // Il lettore di QR: pesa, e si carica solo inquadrando — ma va precaricato
  // lo stesso, perché al tavolo si importa una scheda anche senza campo.
  'src/domain/qr/index.js', 'src/domain/qr/immagine.js', 'src/domain/qr/moduli.js',
  'design-system/tokens.css', 'design-system/components.css',
  'design-system/theme.js', 'design-system/tokens.js',
  'design-system/assets/favicon.svg', 'design-system/assets/favicon.png',
  'lang/it.json', 'lang/en.json', 'data/packs.json', 'data/rules/index.json',
  // I due indici: senza, il compendio non si può nemmeno elencare.
  'data/spells/2014/index.json', 'data/spells/2024/index.json',
  // Le due varianti Acheron: le regole servono a leggere la scheda, e senza
  // l'indice il compendio non si elenca. Gli **altri** pacchetti non stanno
  // qui: li dà il registro, ai tempi 2 e 3, catena compresa.
]

/**
 * Tempi 2 e 3 — un pacchetto per intero: le regole e i dieci blocchi di testo
 * del suo compendio, se ne ha uno.
 * @param {{regole?: string, incantesimi?: string}} pack
 * @returns {string[]}
 */
function filePacchetto(pack) {
  const lista = pack.regole ? [pack.regole] : []
  const inc = pack.incantesimi
  if (inc) {
    lista.push(`${inc}index.json`, `${inc}ponte.json`)
    for (let l = 0; l < LIVELLI; l++) lista.push(`${inc}l${l}.json`)
  }
  return lista
}

/** I pacchetti dichiarati nel registro. @returns {Promise<any[]>} */
async function pacchetti() {
  try {
    const c = await caches.open(CACHE)
    const res = (await c.match(REGISTRO)) ?? (await fetch(REGISTRO))
    const reg = await res.json()
    return Array.isArray(reg.packs) ? reg.packs : []
  } catch {
    return []
  }
}

/**
 * Mette in cache una lista tollerando i buchi: un file che ancora non esiste
 * non deve far fallire l'installazione.
 * @param {string[]} lista
 * @param {string} tempo  solo per il messaggio a console
 */
async function precache(lista, tempo) {
  const c = await caches.open(CACHE)
  const esiti = await Promise.allSettled(lista.map(u => c.add(u)))
  const mancanti = lista.filter((_, i) => esiti[i].status === 'rejected')
  if (mancanti.length) {
    console.info(`[sw] ${tempo}: ${lista.length - mancanti.length}/${lista.length} in cache, non ancora generati → ${mancanti.join(', ')}`)
  }
  return mancanti
}

self.addEventListener('install', (e) => {
  // Nessuno `skipWaiting()` qui: l'aggiornamento lo chiede l'utente dal toast.
  e.waitUntil(precache(SHELL, 'tempo 1 (shell)'))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

/** Un solo precache lungo alla volta: due in parallelo si rubano la banda. */
let inCorso = null

/**
 * Tempi 2 e 3, in sequenza: prima il pacchetto in uso e tutta la sua catena —
 * un pacchetto che eredita senza il suo base è mezzo pacchetto — poi gli altri.
 * @param {string|null} suo  l'id del pacchetto del personaggio aperto
 */
function precaricaPacchetti(suo) {
  if (inCorso) return inCorso
  inCorso = (async () => {
    const packs = await pacchetti()
    if (!packs.length) return

    /** @param {string|null} id @returns {string[]} */
    const catena = (id) => {
      const out = []
      let corrente = id
      while (corrente && !out.includes(corrente)) {
        const p = packs.find(x => x.id === corrente)
        if (!p) break
        out.push(p.id)
        corrente = p.base ?? null
      }
      return out
    }

    const primi = catena(suo)
    const ordine = [...primi, ...packs.map(p => p.id).filter(id => !primi.includes(id))]
    let n = 2
    for (const id of ordine) {
      const p = packs.find(x => x.id === id)
      if (p) await precache(filePacchetto(p), `tempo ${n++} (${id})`)
    }
  })().finally(() => { inCorso = null })
  return inCorso
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  e.respondWith((async () => {
    const c = await caches.open(CACHE)
    // Le navigazioni possono portarsi dietro una query (`?sw=1`): la pagina è
    // la stessa, e ignorarla evita una copia inutile in cache.
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' })
    if (hit) return hit
    try {
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') c.put(req, res.clone())
      return res
    } catch (err) {
      // Il ripiego su `index.html` vale **solo** per le navigazioni. Darlo
      // anche a un modulo JavaScript o a un JSON significa rispondere HTML a
      // chi aspetta codice: il browser rifiuta per MIME type, il modulo non
      // carica, e l'app resta su «Caricamento…» senza dire perché. Meglio
      // fallire pulito: chi chiama sa gestire una richiesta andata male.
      if (req.mode !== 'navigate') throw err
      const fallback = await c.match('index.html')
      if (fallback) return fallback
      throw err
    }
  })())
})

self.addEventListener('message', (e) => {
  const d = e.data
  if (d === 'skip-waiting' || (d && d.tipo === 'skip-waiting')) { self.skipWaiting(); return }
  if (d && d.tipo === 'precarica') e.waitUntil(precaricaPacchetti(d.pacchetto ?? null))
})
