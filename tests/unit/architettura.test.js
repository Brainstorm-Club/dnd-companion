/**
 * Regole che valgono sul codice, non sul comportamento.
 *
 * Servono a proteggere due decisioni che, se marciscono, costano una
 * riscrittura: i pacchetti (la v3 deve essere un'aggiunta) e il «vanilla» (che
 * non deve diventare un framework fatto in casa).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'

/** @returns {string[]} */
function sorgenti(dir = 'src') {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sorgenti(p) : extname(p) === '.js' ? [p] : []
  })
}

/**
 * Il sorgente senza commenti.
 *
 * Grezzo di proposito: non distingue un `//` dentro una stringa, e va bene —
 * l'unico effetto sarebbe nascondere una riga a un controllo, e per farlo
 * bisognerebbe scrivere apposta una stringa che contiene `//` e il nome di una
 * variante. Chi lo facesse sta già barando.
 * @param {string} src
 */
function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('architettura', () => {
  it('nessun confronto sulla variante di gioco fuori da packs.js', () => {
    // La v3 aggiunge Brancalonia scrivendo una voce nel registro. Se le
    // varianti compaiono sparse nel codice, quella promessa è già rotta.
    // I commenti si tolgono prima di guardare. La regola vieta di *confrontare*
    // la variante, non di nominarla: la spiegazione più chiara del perché il
    // motore non debba conoscerle è proprio quella che ne nomina una, e un test
    // che vieta di scriverla punisce chi documenta.
    const colpevoli = sorgenti()
      .filter(f => !f.endsWith('packs.js'))
      .filter(f => /['"`](brancalonia|apocalisse|dnd5e|dnd2024)['"`]/.test(senzaCommenti(readFileSync(f, 'utf8'))))
    expect(colpevoli).toEqual([])
  })

  /**
   * La promessa dell'architettura è che aggiungere una variante sia scrivere
   * una voce nel registro. Non era vera: il service worker elencava i
   * pacchetti a mano, e uno aggiunto senza toccarlo aveva in cache il solo
   * indice — a rete spenta i nomi degli incantesimi c'erano e il testo no,
   * con l'app che dava la colpa alla licenza invece che al file mancante.
   */
  it('il service worker non elenca i pacchetti a mano: li legge dal registro', () => {
    const sw = readFileSync('sw.js', 'utf8')
    const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))
    const citati = registro.packs
      .filter((/** @type {any} */ p) => p.base)   // i due SRD stanno nella shell, ed è giusto
      .flatMap((/** @type {any} */ p) => [p.regole, p.incantesimi].filter(Boolean))
      .filter((/** @type {string} */ percorso) => sw.includes(percorso))
    expect(citati).toEqual([])
    // e la strada che li carica passa dal registro
    expect(sw).toMatch(/data\/packs\.json/)
  })

  it('i fogli di stile si leggono per intero', () => {
    // Un commento senza apertura, o una graffa in più, non danno nessun errore:
    // il browser smette di leggere da lì in poi e il resto del foglio non
    // esiste. È già successo traslocando i componenti nel design system, e a
    // vederlo è stato un end-to-end che misurava dove stava la barra — non
    // l'occhio, che su un testo orfano legge un commento come gli altri.
    for (const f of ['app.css', 'design-system/tokens.css', 'design-system/components.css']) {
      const css = readFileSync(f, 'utf8')

      // Si scorre come farebbe il parser, invece di contare i marcatori: un
      // «/*» dentro un commento è legittimo e ricorrente nella prosa dei
      // commenti, e contarlo darebbe falsi allarmi. Quello che si cerca è un
      // commento che non si chiude — o, come è successo, che si apre due volte
      // e si mangia la regola che segue.
      let dentro = false, apertoA = 0
      for (let i = 0; i < css.length; i++) {
        if (!dentro && css.startsWith('/*', i)) { dentro = true; apertoA = i; i++ }
        else if (dentro && css.startsWith('*/', i)) { dentro = false; i++ }
        else if (dentro && css.startsWith('/*', i)) {
          const riga = css.slice(0, i).split('\n').length
          expect.unreachable(`${f}:${riga}: «/*» dentro un commento — la regola che segue è testo morto`)
        }
      }
      expect(dentro, `${f}: commento aperto a ${css.slice(0, apertoA).split('\n').length} e mai chiuso`).toBe(false)

      let profondita = 0
      for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
        if (c === '{') profondita++
        else if (c === '}') profondita--
        expect(profondita, `${f}: graffa di chiusura di troppo`).toBeGreaterThanOrEqual(0)
      }
      expect(profondita, `${f}: graffe non bilanciate`).toBe(0)
    }
  })

  it('i componenti che l\'app usa stanno nel design system, non in casa', () => {
    // La regola 4 del progetto: se una classe `.bsc-` è definita in `app.css`
    // e non a monte, il design system ha un buco e l'app se lo sta tappando da
    // sola — che è come si finisce con due app dello stesso club che si
    // somigliano solo di lontano.
    const app = readFileSync('app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const ds = readFileSync('design-system/components.css', 'utf8')

    // Una definizione è una regola che apre un blocco su un selettore che
    // *comincia* con la classe: `.bsc-kv { … }`. Non lo sono le varianti
    // (`.bsc-kv--mia`), gli stati, né i discendenti (`.bsc-tabs a`), che sono
    // il modo legittimo con cui un'app rifinisce un componente di monte.
    const definite = [...app.matchAll(/^(\.bsc-[a-z0-9-]+)\s*\{/gm)].map(m => m[1])
    const orfane = [...new Set(definite)].filter(c => !ds.includes(`${c} `) && !ds.includes(`${c}{`) && !ds.includes(`${c},`))
    expect(orfane).toEqual([])
  })

  it('dom.js resta sotto le cento righe', () => {
    const righe = readFileSync('src/dom.js', 'utf8').split('\n').length
    expect(righe).toBeLessThanOrEqual(100)
  })

  it('nessuna dipendenza a runtime: niente import da node_modules', () => {
    const cattivi = sorgenti().filter(f => {
      const src = readFileSync(f, 'utf8')
      return /^\s*import\s[^'"]*['"][a-z@][^'"./]*['"]/m.test(src)
    })
    expect(cattivi).toEqual([])
  })

  /**
   * La regola 4 per intero.
   *
   * Prima questo test cercava solo `#hex` e `rgb()`/`hsl()`: `color: red`,
   * `background: papayawhip` e `oklch(...)` passavano, e delle **spaziature**
   * — che il titolo della regola nomina — non sapeva niente. `padding: 13px`
   * era verde. Un design system che vale solo per i colori non è un design
   * system, è una tavolozza.
   */
  it('nessun colore o dimensione scritti a mano in app.css', () => {
    const css = readFileSync('app.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')          // via i commenti
      .replace(/--dc-[a-z-]+:[^;]+;/g, '')       // i token locali dichiarano, non usano

    expect(css, 'colore esadecimale').not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css, 'funzione di colore').not.toMatch(/\b(rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/i)
    // I nomi CSS dei colori: si cercano dove un colore può stare, per non
    // inciampare in `border: 1px solid var(--x)` o in una parola qualunque.
    // `none`, `transparent`, `inherit` e `currentColor` non sono colori
    // scelti: sono il modo di dire «nessuno» e «quello di sopra».
    const NEUTRI = new Set(['none', 'transparent', 'inherit', 'currentcolor', 'initial', 'unset', 'revert', 'auto'])
    const perNome = [...css.matchAll(
      /(?:^|[;{])\s*(color|background(?:-color)?|border-color|outline-color|fill|stroke)\s*:\s*([a-z]{3,})\s*[;}]/gim)]
      .filter(m => !NEUTRI.has((m[2] ?? '').toLowerCase()))
      .map(m => `${m[1]}: ${m[2]}`)
    expect(perNome, 'colori per nome').toEqual([])

    // Le spaziature: px, rem ed em dove si misura uno spazio. Restano fuori i
    // bordi da un pixel e le misure che i token non coprono (`0`, le
    // percentuali, `dvh`), e ogni valore che arrivi da una `var()`.
    const spaziature = [...css.matchAll(
      /(?:^|[;{])\s*(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-[a-z-]+)?\s*:\s*([^;{}]+)[;}]/gim)]
      // Uno zero non è una spaziatura scelta: `env(safe-area-inset-*, 0px)` e
      // `max(0px, …)` dicono «se il sistema non si prenota niente, niente».
      .map(m => ({ dove: m[1] ?? '', valore: (m[2] ?? '').replace(/\b0(px|rem|em)\b/g, '0') }))
      .filter(x => /\b\d+(?:\.\d+)?(px|rem|em)\b/.test(x.valore))
      .map(x => `${x.dove}: ${x.valore.trim()}`)
    expect(spaziature, 'spaziature scritte a mano').toEqual([])
  })
})

describe('service worker', () => {
  /** I moduli raggiunti da `main.js` per soli import statici. */
  function grafoStatico(ingresso = 'src/main.js') {
    const visti = new Set()
    const coda = [ingresso]
    while (coda.length) {
      const f = coda.pop()
      if (!f || visti.has(f)) continue
      visti.add(f)
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
        const spec = m[1]
        if (!spec?.startsWith('.')) continue
        coda.push(join(dirname(f), spec))
      }
    }
    return [...visti]
  }

  it('precarica ogni modulo dell\'app, non solo quelli d\'avvio', () => {
    // Prima questo controllo guardava soltanto il grafo statico da `main.js`, e
    // i moduli caricati su richiesta — le viste e ciò che importano — restavano
    // scoperti: offline la scheda si apriva su «Qualcosa non ha funzionato».
    const sw = readFileSync('sw.js', 'utf8')
    const tutti = sorgenti('src')
    const mancanti = tutti.filter(f => !sw.includes(`'${f}'`))
    expect(mancanti).toEqual([])
  })

  it('ripiega su index.html solo per le navigazioni', () => {
    // Rispondere HTML a un modulo JavaScript lo fa rifiutare per MIME type, e
    // l'errore che arriva a chi guarda non somiglia alla causa.
    const sw = readFileSync('sw.js', 'utf8')
    expect(sw).toMatch(/req\.mode !== 'navigate'/)
  })
})
