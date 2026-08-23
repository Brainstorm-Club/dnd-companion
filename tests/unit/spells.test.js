/**
 * Il compendio — lotto M.
 *
 * Questi test girano sui **JSON generati**, non sui PDF: i PDF non stanno nel
 * repo e la CI non li ha. È il punto: se un giorno il generatore si rompe, a
 * fallire dev'essere il dato spedito, non l'estrazione.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_LOADED_LEVELS, loadIndex, loadLevel, getSpell, loadBridge, getSpellByBuilderId,
  _loadedLevels, _reset,
} from '../../src/domain/spells.js'

const EDIZIONI = /** @type {const} */ (['2014', '2024'])

const SCUOLE = ['Abiurazione', 'Ammaliamento', 'Divinazione', 'Evocazione', 'Illusione', 'Invocazione', 'Necromanzia', 'Trasmutazione']
const CLASSI = ['bardo', 'chierico', 'druido', 'mago', 'paladino', 'ranger', 'stregone', 'warlock']

/** I conteggi che il PIANO dichiara, e che `DATA-SOURCES.md` ripete: 319 e 339. */
const ATTESI = {
  '2014': { totale: 319, perLivello: [24, 49, 54, 42, 31, 37, 31, 20, 16, 15] },
  '2024': { totale: 339, perLivello: [27, 57, 57, 42, 34, 38, 31, 20, 17, 16] },
}

const leggi = (p) => JSON.parse(readFileSync(p, 'utf8'))
const indice = (ed) => leggi(`data/spells/${ed}/index.json`)
const blocco = (ed, l) => leggi(`data/spells/${ed}/l${l}.json`)
const tutti = (ed) => Array.from({ length: 10 }, (_, l) => blocco(ed, l)).flat()

/** Un `fetch` che legge dal disco: qui non c'è un server, e non serve. */
function dalDisco() {
  const chiamate = []
  const fetcher = async (url) => {
    chiamate.push(url)
    return /** @type {any} */ ({ ok: true, status: 200, json: async () => leggi(url) })
  }
  return { fetcher, chiamate }
}

describe('lotto M — conteggi', () => {
  it('2024: 27 trucchetti + 312 livellati = 339', () => {
    const idx = indice('2024')
    expect(idx.length).toBe(339)
    expect(idx.filter(s => s.livello === 0).length).toBe(27)
    expect(idx.filter(s => s.livello > 0).length).toBe(312)
  })

  it('2014: le intestazioni tornano coi blocchi di campi (discrepanza di uno risolta)', () => {
    // La discrepanza era una riga sola: l'intestazione di *Dominare persone*
    // usciva come «Ammaliamento di 5° li Eroismoello». Riparata quella, ogni
    // incantesimo ha i suoi quattro campi — ed è questo che il test verifica,
    // perché è la conseguenza osservabile sul dato spedito.
    const idx = indice('2014')
    expect(idx.length).toBe(319)
    const dominare = tutti('2014').find(s => s.id === 'dominare-persone')
    expect(dominare).toBeDefined()
    expect(dominare.livello).toBe(5)
    expect(dominare.scuola).toBe('Ammaliamento')
    for (const s of tutti('2014')) {
      expect(s.tempoDiLancio, s.nome).toBeTruthy()
      expect(s.gittata, s.nome).toBeTruthy()
      expect(s.componenti, s.nome).toBeTruthy()
      expect(s.durata, s.nome).toBeTruthy()
    }
  })

  it.each(EDIZIONI)('%s: la distribuzione per livello è quella dichiarata', (ed) => {
    const conteggi = Array.from({ length: 10 }, (_, l) => blocco(ed, l).length)
    expect(conteggi).toEqual(ATTESI[ed].perLivello)
    expect(conteggi.reduce((a, b) => a + b, 0)).toBe(ATTESI[ed].totale)
  })

  it.each(EDIZIONI)('%s: indice e blocchi contengono esattamente gli stessi id', (ed) => {
    const daIndice = indice(ed).map(s => s.id).sort()
    const daBlocchi = tutti(ed).map(s => s.id).sort()
    expect(daBlocchi).toEqual(daIndice)
    expect(new Set(daIndice).size).toBe(daIndice.length)
  })
})

describe('lotto M — sanificazione', () => {
  it.each(EDIZIONI)('%s: nessun testo contiene «Rivendita vietata» o «Not for resale»', (ed) => {
    const sporchi = tutti(ed).filter(s => /Rivendita vietata|Not for resale/i.test(
      `${s.testo} ${s.aLivelliSuperiori ?? ''} ${s.tempoDiLancio} ${s.gittata} ${s.componenti} ${s.durata}`,
    ))
    expect(sporchi.map(s => s.nome)).toEqual([])
  })

  it.each(EDIZIONI)('%s: nessun testo contiene numeri di pagina o intestazioni correnti', (ed) => {
    const sporchi = []
    for (const s of tutti(ed)) {
      const testo = `${s.testo}\n${s.aLivelliSuperiori ?? ''}`
      if (/Reference Document/i.test(testo)) sporchi.push(`${s.nome}: intestazione corrente`)
      // Le tabelle dentro gli incantesimi hanno righe che sono solo un numero
      // (i risultati di un d10, le taglie degli oggetti animati): sono dato, non
      // sporco. I numeri di pagina di questi due SRD stanno tutti sopra il 100.
      for (const riga of testo.split('\n')) {
        if (/^\s*\d{3}\s*$/.test(riga)) sporchi.push(`${s.nome}: «${riga.trim()}» sembra un numero di pagina`)
      }
    }
    expect(sporchi).toEqual([])
  })

  it.each(EDIZIONI)('%s: ogni record ha scuola fra le otto e classi fra quelle dell\'edizione', (ed) => {
    const cattivi = []
    for (const s of tutti(ed)) {
      if (!SCUOLE.includes(s.scuola)) cattivi.push(`${s.nome}: scuola «${s.scuola}»`)
      if (!s.classi.length) cattivi.push(`${s.nome}: nessuna classe`)
      for (const c of s.classi) if (!CLASSI.includes(c)) cattivi.push(`${s.nome}: classe «${c}»`)
      if (s.classi.join(',') !== [...s.classi].sort().join(',')) cattivi.push(`${s.nome}: classi non ordinate`)
    }
    expect(cattivi).toEqual([])
  })

  it.each(EDIZIONI)('%s: ogni record ha un testo vero, non un frammento', (ed) => {
    // Il più corto dei due compendi è *Vita falsata* del 2024, 54 caratteri:
    // sotto i quaranta non c'è un incantesimo, c'è un pezzo di riga sfuggito.
    const corti = tutti(ed).filter(s => s.testo.length < 40).map(s => `${s.nome} (${s.testo.length})`)
    expect(corti).toEqual([])
  })
})

describe('lotto M — differisce', () => {
  const CLASSI_CAMBIATE = 58 // il builder dichiara «58 liste di classe cambiate» nel suo DATA-SOURCES.md

  it('58 incantesimi cambiano lista di classe fra le due edizioni — lo stesso numero del builder', () => {
    // Due strade indipendenti: il builder l'ha trascritto a mano dagli SRD
    // inglesi, questo compendio lo ricava dai due PDF italiani. Se l'estrattore
    // sbagliasse una lista, questo numero non tornerebbe.
    for (const ed of EDIZIONI) {
      const n = indice(ed).filter(s => s.cambiamenti.includes('classi')).length
      expect(n, ed).toBe(CLASSI_CAMBIATE)
    }
  })

  it('differisce è vero solo dove le regole divergono davvero', () => {
    const a = new Map(indice('2014').map(s => [s.id, s]))
    const b = new Map(indice('2024').map(s => [s.id, s]))
    let uguali = 0
    for (const [id, s] of a) {
      const altro = b.get(id)
      if (!altro) continue
      const atteso = []
      if (s.livello !== altro.livello) atteso.push('livello')
      if (s.scuola.toLowerCase() !== altro.scuola.toLowerCase()) atteso.push('scuola')
      if (s.rituale !== altro.rituale) atteso.push('rituale')
      if (s.concentrazione !== altro.concentrazione) atteso.push('concentrazione')
      if (s.classi.join(',') !== altro.classi.join(',')) atteso.push('classi')
      expect(s.cambiamenti, s.nome).toEqual(atteso)
      expect(s.differisce, s.nome).toBe(atteso.length > 0)
      if (!atteso.length) uguali += 1
    }
    // Un segnale che si accende su tutto non dice niente: la maggioranza degli
    // incantesimi deve risultare *invariata*.
    expect(uguali).toBeGreaterThan(a.size / 2)
  })

  it('un incantesimo assente da un\'edizione risulta mancante, non vuoto', async () => {
    const { fetcher } = dalDisco()
    const soloNel2014 = indice('2014').find(s => s.cambiamenti.includes('assente'))
    expect(soloNel2014).toBeDefined()
    expect(soloNel2014.differisce).toBe(true)
    // Nel 2014 c'è, col suo testo; nel 2024 non c'è affatto — e `getSpell`
    // risponde `null`, che è diverso da un record con `testo: ''`.
    const presente = await getSpell('2014', soloNel2014.id, fetcher)
    expect(presente?.testo.length).toBeGreaterThan(40)
    expect(await getSpell('2024', soloNel2014.id, fetcher)).toBeNull()
  })
})

describe('lotto M — il ponte', () => {
  const FIXTURE = ['dnd2024-mago-5.json', 'reale-dnd5e-chierico-3.json', 'reale-dnd2024-guerriero-3.json', 'reale-dnd5e-barbaro-10.json']

  /** Gli id che il builder salva in una scheda, con l'edizione a cui appartengono. */
  function idDaFixture(file) {
    const c = leggi(`tests/fixtures/${file}`)
    const ed = c.variant === 'dnd2024' ? '2024' : '2014'
    return { ed, ids: [...(c.cantrips ?? []), ...(c.spellsKnown ?? []), ...(c.spellsPrepared ?? [])] }
  }

  it.each(FIXTURE)('il ponte copre tutti gli incantesimi di %s', (file) => {
    const { ed, ids } = idDaFixture(file)
    const ponte = leggi(`data/spells/${ed}/ponte.json`)
    const scoperti = [...new Set(ids)].filter(id => !(id in ponte))
    expect(scoperti).toEqual([])
  })

  it.each(FIXTURE)('%s: il livello nell\'id inglese torna col livello dell\'incantesimo italiano', (file) => {
    // `2-locate-object` deve agganciare un incantesimo di 2° livello e
    // `fire-bolt`, senza prefisso, un trucchetto. È una verifica gratuita
    // dell'aggancio, e non costa nemmeno una riga di dati in più.
    const { ed, ids } = idDaFixture(file)
    const ponte = leggi(`data/spells/${ed}/ponte.json`)
    const perId = new Map(indice(ed).map(s => [s.id, s]))
    const storti = []
    for (const id of new Set(ids)) {
      const atteso = Number(/^(\d)-/.exec(id)?.[1] ?? 0)
      const italiano = perId.get(ponte[id])
      if (!italiano) { storti.push(`${id}: nessun incantesimo`); continue }
      if (italiano.livello !== atteso) storti.push(`${id} → ${italiano.nome} (${italiano.livello}° invece di ${atteso}°)`)
    }
    expect(storti).toEqual([])
  })

  it('chi non lancia incantesimi non ne riceve nessuno', () => {
    for (const file of ['reale-dnd2024-guerriero-3.json', 'reale-dnd5e-barbaro-10.json']) {
      const { ids } = idDaFixture(file)
      expect(ids, file).toEqual([])
    }
  })

  it.each(EDIZIONI)('%s: il ponte non inventa e non duplica', (ed) => {
    const ponte = leggi(`data/spells/${ed}/ponte.json`)
    const validi = new Set(indice(ed).map(s => s.id))
    const valori = Object.values(ponte)
    expect(valori.filter(v => !validi.has(v))).toEqual([])
    expect(new Set(valori).size, 'due id inglesi sullo stesso incantesimo italiano').toBe(valori.length)
  })

  it('lo stesso id inglese porta allo stesso incantesimo in tutte e due le edizioni', () => {
    // La prova migliore che il ponte non stia tirando a indovinare: costruito
    // due volte su due compendi diversi, deve dare la stessa risposta.
    const a = leggi('data/spells/2014/ponte.json')
    const b = leggi('data/spells/2024/ponte.json')
    const alias = { saltare: 'salto', salto: 'saltare', 'conoscenza-delle-legende': 'conoscenza-delle-leggende', 'conoscenza-delle-leggende': 'conoscenza-delle-legende' }
    const incoerenti = Object.keys(a).filter(k => k in b && b[k] !== a[k] && b[k] !== alias[a[k]])
    expect(incoerenti).toEqual([])
  })

  it('i residui del ponte finiscono in un rapporto, non nel silenzio', () => {
    const residui = leggi('data/spells/2014/ponte-residui.json')
    // *Blade Ward* e *Hex* stanno nel Player's Handbook, non nell'SRD 5.1:
    // l'app li mostra col nome e senza testo, e questo file le dice perché.
    expect(residui.map(r => r.id).sort()).toEqual(['1-hex', 'blade-ward'])
    for (const r of residui) expect(r.motivo, r.id).toBeTruthy()
    const ponte = leggi('data/spells/2014/ponte.json')
    expect(residui.filter(r => r.id in ponte)).toEqual([])
  })

  it('un id sconosciuto al ponte non produce un incantesimo vuoto', async () => {
    const { fetcher } = dalDisco()
    expect(await getSpellByBuilderId('2014', 'blade-ward', fetcher)).toBeNull()
    expect(await getSpellByBuilderId('2014', 'non-esiste-affatto', fetcher)).toBeNull()
    expect((await getSpellByBuilderId('2014', '3-fireball', fetcher))?.nome).toBe('Palla di fuoco')
  })
})

describe('lotto M — caricamento', () => {
  beforeEach(() => { _reset() })

  it('l\'indice si scarica una volta sola', async () => {
    const { fetcher, chiamate } = dalDisco()
    const a = await loadIndex('2024', fetcher)
    const b = await loadIndex('2024', fetcher)
    expect(b).toBe(a)
    expect(chiamate.filter(u => u.endsWith('2024/index.json')).length).toBe(1)
  })

  it('due richieste contemporanee dello stesso blocco fanno un download solo', async () => {
    const { fetcher, chiamate } = dalDisco()
    const [a, b] = await Promise.all([loadLevel('2014', 3, fetcher), loadLevel('2014', 3, fetcher)])
    expect(b).toBe(a)
    expect(chiamate.length).toBe(1)
  })

  it(`non tiene vivi più di ${MAX_LOADED_LEVELS} blocchi di testo`, async () => {
    const { fetcher } = dalDisco()
    for (const l of [1, 2, 3, 4]) await loadLevel('2024', l, fetcher)
    expect(_loadedLevels().length).toBe(MAX_LOADED_LEVELS)
    expect(_loadedLevels()).toEqual(['2024:3', '2024:4'])
  })

  it('un blocco riusato non viene buttato via per primo', async () => {
    const { fetcher } = dalDisco()
    await loadLevel('2024', 1, fetcher)
    await loadLevel('2024', 2, fetcher)
    await loadLevel('2024', 1, fetcher)
    await loadLevel('2024', 3, fetcher)
    expect(_loadedLevels()).toEqual(['2024:1', '2024:3'])
  })

  it('getSpell restituisce il record intero, e null per un id che non c\'è', async () => {
    const { fetcher, chiamate } = dalDisco()
    const s = await getSpell('2024', 'palla-di-fuoco', fetcher)
    expect(s?.nome).toBe('Palla di fuoco')
    expect(s?.livello).toBe(3)
    expect(s?.edizione).toBe('2024')
    expect(s?.fonte).toBe('SRD 5.2.1 IT')
    expect(s?.aLivelliSuperiori).toBeTruthy()
    expect(await getSpell('2024', 'incantesimo-che-non-esiste', fetcher)).toBeNull()
    // Un id sconosciuto non deve far scaricare dieci blocchi per scoprirlo.
    expect(chiamate.filter(u => /l\d\.json$/.test(u)).length).toBe(1)
  })

  it('un livello fuori scala è un errore, non un download', async () => {
    const { fetcher, chiamate } = dalDisco()
    await expect(loadLevel('2014', 10, fetcher)).rejects.toThrow(/livello fuori scala/)
    expect(chiamate).toEqual([])
  })

  it('il ponte si carica come gli indici, una volta sola', async () => {
    const { fetcher, chiamate } = dalDisco()
    const a = await loadBridge('2014', fetcher)
    expect(await loadBridge('2014', fetcher)).toBe(a)
    expect(chiamate.filter(u => u.endsWith('ponte.json')).length).toBe(1)
  })
})
