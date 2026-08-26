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

describe('architettura', () => {
  it('nessun confronto sulla variante di gioco fuori da packs.js', () => {
    // La v3 aggiunge Brancalonia scrivendo una voce nel registro. Se le
    // varianti compaiono sparse nel codice, quella promessa è già rotta.
    const colpevoli = sorgenti()
      .filter(f => !f.endsWith('packs.js'))
      .filter(f => /['"`](brancalonia|apocalisse|dnd5e|dnd2024)['"`]/.test(readFileSync(f, 'utf8')))
    expect(colpevoli).toEqual([])
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

  it('nessun colore o dimensione scritti a mano in app.css', () => {
    const css = readFileSync('app.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')          // via i commenti
      .replace(/--dc-[a-z-]+:[^;]+;/g, '')       // i token locali dichiarano, non usano
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i)
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
