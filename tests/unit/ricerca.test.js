/**
 * Ricerca e confronto fra edizioni — lotto N.
 *
 * Come `spells.test.js`, questi test girano sui **JSON generati**: la ricerca
 * che conta è quella sui 319 e 339 incantesimi veri, non su tre finti scritti
 * per far passare l'asserzione.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { search, counterpart, loadIndex, _reset } from '../../src/domain/spells.js'

const leggi = (/** @type {string} */ p) => JSON.parse(readFileSync(p, 'utf8'))
const indice = (/** @type {string} */ ed) => leggi(`data/spells/${ed}/index.json`)

/** Un `fetch` che legge dal disco, e tiene il conto di cosa ha letto. */
function dalDisco() {
  /** @type {string[]} */
  const chiamate = []
  const fetcher = async (/** @type {string} */ url) => {
    chiamate.push(url)
    return /** @type {any} */ ({ ok: true, status: 200, json: async () => leggi(url) })
  }
  return { fetcher, chiamate }
}

/** Lo stesso, ma con un elenco di file che «non si riescono a leggere». */
function conGuasto(/** @type {RegExp} */ rotto) {
  const { fetcher, chiamate } = dalDisco()
  return {
    chiamate,
    fetcher: async (/** @type {string} */ url) => {
      if (rotto.test(url)) return /** @type {any} */ ({ ok: false, status: 503, json: async () => ({}) })
      return fetcher(url)
    },
  }
}

describe('lotto N — ricerca', () => {
  const IDX = indice('2024')

  it('senza filtri torna tutto, ma non l\'indice stesso', () => {
    const tutti = search(IDX, {})
    expect(tutti.length).toBe(339)
    // Chi riceve un elenco lo ordina, e ordinare l'indice condiviso vuol dire
    // riordinarlo per tutte le viste dell'app.
    expect(tutti).not.toBe(IDX)
    expect(tutti).toEqual(IDX)
    expect(search(IDX, { testo: '', livelli: [], classi: [], scuole: [] }).length).toBe(339)
  })

  it('il testo ignora maiuscole e accenti, nei due sensi', () => {
    const per = (/** @type {string} */ t) => search(IDX, { testo: t }).map(s => s.nome)
    expect(per('PALLA DI FUOCO')).toContain('Palla di fuoco')
    // «Invisibilità» si deve trovare senza saper dove sta l'accento — e chi
    // l'accento lo scrive non deve essere punito per averlo fatto.
    expect(per('invisibilita')).toContain('Invisibilità')
    expect(per('INVISIBILITÀ')).toContain('Invisibilità')
  })

  it('i termini si combinano in e, in qualunque ordine', () => {
    expect(search(IDX, { testo: 'fuoco palla' }).map(s => s.id)).toContain('palla-di-fuoco')
    expect(search(IDX, { testo: 'palla fuoco' }).map(s => s.id)).toContain('palla-di-fuoco')
    expect(search(IDX, { testo: 'palla ghiaccio' })).toEqual([])
  })

  it('il testo digitato non diventa mai un\'espressione regolare', () => {
    // Se lo diventasse, «.*» troverebbe tutto e «(» farebbe saltare la vista
    // a ogni tasto premuto. Qui sono due ricerche letterali che non trovano
    // niente, ed è esattamente ciò che devono essere.
    expect(search(IDX, { testo: '.*' })).toEqual([])
    expect(search(IDX, { testo: '(' })).toEqual([])
    expect(() => search(IDX, { testo: '[a-' })).not.toThrow()
    // E un carattere che nei nomi c'è davvero si trova lo stesso.
    expect(search(IDX, { testo: 'cecità/sordità' }).map(s => s.id)).toEqual(['cecita-sordita'])
  })

  it('livelli, classi e scuole filtrano in o dentro e in e fra loro', () => {
    const trucchetti = search(IDX, { livelli: [0] })
    expect(trucchetti.length).toBe(27)
    expect(trucchetti.every(s => s.livello === 0)).toBe(true)

    const primoESecondo = search(IDX, { livelli: [1, 2] })
    expect(primoESecondo.length).toBe(57 + 57)

    const bardi = search(IDX, { classi: ['bardo'] })
    expect(bardi.length).toBeGreaterThan(0)
    expect(bardi.every(s => s.classi.includes('bardo'))).toBe(true)

    const invocazione = search(IDX, { scuole: ['Invocazione'] })
    expect(invocazione.every(s => s.scuola === 'Invocazione')).toBe(true)

    // Fra facce diverse è un'intersezione, non un'unione.
    const incrocio = search(IDX, { livelli: [3], classi: ['mago'], scuole: ['Invocazione'] })
    expect(incrocio.length).toBeGreaterThan(0)
    expect(incrocio.length).toBeLessThan(invocazione.length)
    expect(incrocio.every(s => s.livello === 3 && s.classi.includes('mago') && s.scuola === 'Invocazione')).toBe(true)
    expect(incrocio.map(s => s.id)).toContain('palla-di-fuoco')
  })

  it('le scuole e le classi si confrontano come il testo: senza maiuscole', () => {
    // Nel 5.1 le intestazioni di scuola erano scritte a caso («Trucchetto di
    // necromanzia»): un filtro che dipende dal maiuscolo è un filtro che un
    // giorno smette di funzionare.
    expect(search(IDX, { scuole: ['invocazione'] }).length).toBe(search(IDX, { scuole: ['Invocazione'] }).length)
    expect(search(IDX, { classi: ['MAGO'] }).length).toBe(search(IDX, { classi: ['mago'] }).length)
  })

  it('l\'ordine dell\'indice si conserva', () => {
    // L'elenco raggruppa per livello: riordinare per «pertinenza» spezzerebbe
    // i gruppi sotto le loro intestazioni.
    const atteso = IDX.filter((/** @type {any} */ s) => s.classi.includes('druido')).map((/** @type {any} */ s) => s.id)
    expect(search(IDX, { classi: ['druido'] }).map(s => s.id)).toEqual(atteso)
  })

  it('regge 339 record senza fatica, ricerca dopo ricerca', () => {
    // Il costo per tasto premuto deve restare piatto: i nomi si normalizzano
    // una volta per incantesimo, non una per ricerca. Il limite è largo di
    // proposito — serve a scoprire un ordine di grandezza sbagliato, non a
    // misurare la macchina della CI.
    const parziali = ['p', 'pa', 'pal', 'pall', 'palla', 'palla ', 'palla d', 'palla di', 'palla di f']
    const inizio = performance.now()
    for (let i = 0; i < 200; i++) {
      for (const t of parziali) search(IDX, { testo: t, livelli: [1, 2, 3], classi: ['mago'] })
    }
    const ms = performance.now() - inizio
    expect(ms, `1800 ricerche in ${Math.round(ms)} ms`).toBeLessThan(2000)
  })
})

describe('lotto N — la controparte nell\'altra edizione', () => {
  beforeEach(() => { _reset() })

  it('un incantesimo che c\'è in tutte e due torna col testo dell\'altra', async () => {
    const { fetcher } = dalDisco()
    const esito = await counterpart('2014', 'palla-di-fuoco', fetcher)
    expect(esito.presente).toBe(true)
    if (!esito.presente) return
    expect(esito.spell.nome).toBe('Palla di fuoco')
    expect(esito.spell.edizione).toBe('2024')
    expect(esito.spell.fonte).toBe('SRD 5.2.1 IT')
    expect(esito.spell.testo.length).toBeGreaterThan(40)
  })

  it('e si torna indietro dall\'altra parte', async () => {
    const { fetcher } = dalDisco()
    const esito = await counterpart('2024', 'palla-di-fuoco', fetcher)
    expect(esito.presente).toBe(true)
    if (!esito.presente) return
    expect(esito.spell.edizione).toBe('2014')
    expect(esito.spell.fonte).toBe('SRD 5.1 IT')
  })

  it('un incantesimo assente dice perché, e non è null', async () => {
    const { fetcher, chiamate } = dalDisco()
    // *Regressione mentale* è nell'SRD 5.1 e non è passata nel 5.2.1.
    const esito = await counterpart('2014', 'regressione-mentale', fetcher)
    expect(esito).not.toBeNull()
    expect(esito.presente).toBe(false)
    if (esito.presente) return
    expect(esito.motivo).toMatch(/SRD 5\.2\.1/)
    // E dirlo non costa un download: l'assenza sta già nell'indice.
    expect(chiamate.filter(u => /l\d\.json$/.test(u))).toEqual([])
    expect(chiamate.filter(u => /2024/.test(u))).toEqual([])
  })

  it('lo stesso incantesimo con due nomi diversi si ritrova lo stesso', async () => {
    // *Saltare* nel 5.1 è *Salto* nel 5.2.1: due traduzioni indipendenti, due
    // id diversi, un incantesimo solo. L'id inglese del builder è il ponte.
    const { fetcher } = dalDisco()
    const avanti = await counterpart('2014', 'saltare', fetcher)
    expect(avanti.presente).toBe(true)
    if (avanti.presente) expect(avanti.spell.id).toBe('salto')

    _reset()
    const indietro = await counterpart('2024', 'salto', dalDisco().fetcher)
    expect(indietro.presente).toBe(true)
    if (indietro.presente) expect(indietro.spell.id).toBe('saltare')
  })

  it('anche quando la differenza è solo di una lettera', async () => {
    const { fetcher } = dalDisco()
    const esito = await counterpart('2014', 'conoscenza-delle-legende', fetcher)
    expect(esito.presente).toBe(true)
    if (esito.presente) expect(esito.spell.id).toBe('conoscenza-delle-leggende')
  })

  it('un id che nel compendio non c\'è non produce un incantesimo vuoto', async () => {
    const { fetcher } = dalDisco()
    const esito = await counterpart('2014', 'incantesimo-che-non-esiste', fetcher)
    expect(esito.presente).toBe(false)
    if (!esito.presente) expect(esito.motivo).toBeTruthy()
  })

  it('un guasto di lettura non si traveste da assenza', async () => {
    // È la distinzione che serve a chi disegna il selettore: «non esiste in
    // quell'edizione» si scrive accanto al lato spento, «non sono riuscito a
    // leggerlo» si riprova. Se le due cose arrivassero nella stessa forma,
    // nessuna vista potrebbe distinguerle.
    const { fetcher } = conGuasto(/2024\/index\.json$/)
    await expect(counterpart('2014', 'palla-di-fuoco', fetcher)).rejects.toThrow(/non leggibile/)

    _reset()
    const { fetcher: f2 } = conGuasto(/2024\/l3\.json$/)
    await expect(counterpart('2014', 'palla-di-fuoco', f2)).rejects.toThrow(/non leggibile/)
  })

  it('ogni incantesimo dei due compendi sa dire dov\'è finito nell\'altro', async () => {
    // La verifica che conta davvero: nessuno dei 658 deve cadere in mezzo —
    // o c'è, o si dice perché no, e mai un `null` da interpretare.
    const { fetcher } = dalDisco()
    /** @type {string[]} */
    const muti = []
    for (const ed of /** @type {const} */ (['2014', '2024'])) {
      const idx = await loadIndex(ed, fetcher)
      for (const voce of idx) {
        const assente = voce.cambiamenti.includes('assente')
        // Gli assenti si riconoscono dall'indice e non costano rete: si
        // provano tutti. Gli altri leggerebbero un blocco a testa, e 634
        // blocchi non sono un test, sono un'attesa — se ne prova un campione.
        if (!assente && !['palla-di-fuoco', 'saltare', 'salto'].includes(voce.id)) continue
        const esito = await counterpart(ed, voce.id, fetcher)
        if (esito === null || esito === undefined) { muti.push(`${ed}/${voce.id}: null`); continue }
        if (assente && esito.presente) muti.push(`${ed}/${voce.id}: dato per presente`)
        if (!esito.presente && !esito.motivo) muti.push(`${ed}/${voce.id}: assente senza motivo`)
      }
    }
    expect(muti).toEqual([])
  })
})
