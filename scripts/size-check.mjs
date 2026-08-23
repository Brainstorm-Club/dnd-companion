#!/usr/bin/env node
/**
 * Verifica i budget del PIANO.md § 8. Un budget che nessuno misura è un
 * desiderio: questo script fa fallire la CI.
 *
 * Misura il **gzip** perché è ciò che viaggia davvero: GitHub Pages comprime.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'

/**
 * I moduli che il browser scarica **prima** che l'app sia usabile: si parte da
 * `src/main.js` e si seguono i soli import **statici**. Le viste arrivano da
 * `import()` dinamici e non entrano — che e' tutto il punto di caricarle su
 * richiesta.
 *
 * Prima questa voce contava `src/` per intero, cioe' anche le nove viste: due
 * budget diversi misuravano la stessa cosa, e nessuno dei due il vero avvio.
 * @param {string} [ingresso]
 * @returns {string[]}
 */
function grafoStatico(ingresso = 'src/main.js') {
  const visti = new Set()
  const coda = [resolve(ingresso)]
  while (coda.length) {
    const f = coda.pop()
    if (!f || visti.has(f) || !existsSync(f)) continue
    visti.add(f)
    const src = readFileSync(f, 'utf8')
    // solo `import ... from '...'`: `import('...')` e' dinamico e non conta
    for (const m of src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1]
      if (!spec || !spec.startsWith('.')) continue
      coda.push(resolve(dirname(f), spec))
    }
  }
  return [...visti].map(f => f.replace(process.cwd() + '/', ''))
}

/**
 * Tre numeri, tre cose diverse.
 *
 * **«Avvio»** e' l'unico che protegge davvero l'esperienza: i moduli raggiunti
 * da `src/main.js` per soli import statici, cioe' cio' che si scarica prima
 * che l'app sia usabile. Resta stretto.
 *
 * **«La vista piu' grossa»** e' il tetto contro la crescita disordinata: una
 * vista che nessuno apre non costa niente a chi non la apre, ma una vista che
 * gonfia oltre misura ha smesso di essere una vista.
 *
 * **«JS applicativo»** e' la somma di tutto. Tetto a 200 KB per decisione
 * esplicita dell'utente a fine fase 2: non e' un numero che deve fermare il
 * lavoro, serve a vedere la tendenza. I due tetti che fermano davvero sono
 * quelli sopra, e sono stretti apposta.
 */
/**
 * Un budget si misura in tre modi diversi, e i campi non sono gli stessi:
 * per elenco di file, per il pezzo peggiore, o per percorsi ed estensioni.
 * Dichiararli tutti facoltativi è ciò che permette a un solo oggetto di
 * contenerli — e a `tsc` di non protestare.
 *
 * @typedef {object} Budget
 * @property {number} kb
 * @property {() => string[]} [files]
 * @property {string} [maxSingolo]
 * @property {string[]} [glob]
 * @property {string[]} [ext]
 */

/** @type {Record<string, Budget>} */
const BUDGET = {
  'Avvio (import statici)':    { kb: 40,   files: () => grafoStatico() },
  'La vista piu grossa':       { kb: 20,   maxSingolo: 'src/views' },
  'JS applicativo':            { kb: 200,  glob: ['src'], ext: ['.js'] },
  'CSS (app + design system)': { kb: 22,   glob: ['app.css', 'design-system/tokens.css', 'design-system/components.css'], ext: ['.css'] },
  'Primo caricamento':         { kb: 115,  files: () => [
      'index.html', 'app.css', 'lang/it.json', 'data/packs.json',
      'design-system/tokens.css', 'design-system/components.css',
      ...grafoStatico(),
    ] },
  'Indici dei compendi':       { kb: 55,   glob: ['data/spells/2014/index.json', 'data/spells/2024/index.json'], ext: ['.json'] },
  'Totale installato':         { kb: 1300, glob: ['index.html', 'app.css', 'sw.js', 'src', 'lang', 'data', 'design-system/tokens.css', 'design-system/components.css'], ext: ['.js', '.css', '.html', '.json'] },
}

/** @param {string} p @param {string[]} ext @returns {string[]} */
function file(p, ext) {
  let s
  try { s = statSync(p) } catch { return [] }
  if (s.isFile()) return ext.includes(extname(p)) ? [p] : []
  return readdirSync(p).flatMap(n => file(join(p, n), ext))
}

let fallito = false
console.log('budget         gzip     limite')
for (const [nome, b] of Object.entries(BUDGET)) {
  if (b.maxSingolo) {
    // qui non conta la somma ma il pezzo peggiore
    const tutti = file(b.maxSingolo, ['.js'])
    let peggiore = { f: '-', kb: 0 }
    for (const f of tutti) {
      const kb = gzipSync(readFileSync(f)).length / 1024
      if (kb > peggiore.kb) peggiore = { f, kb }
    }
    const ok2 = peggiore.kb <= b.kb
    if (!ok2) fallito = true
    console.log(`${ok2 ? '  ok ' : ' FAIL'} ${nome.padEnd(26)} ${peggiore.kb.toFixed(1).padStart(7)} KB   ${String(b.kb).padStart(5)} KB   (${peggiore.f})`)
    continue
  }
  const files = b.files ? b.files() : (b.glob ?? []).flatMap(g => file(g, b.ext ?? []))
  const bytes = files.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0)
  const kb = bytes / 1024
  const ok = kb <= b.kb
  if (!ok) fallito = true
  console.log(`${ok ? '  ok ' : ' FAIL'} ${nome.padEnd(26)} ${kb.toFixed(1).padStart(7)} KB   ${String(b.kb).padStart(5)} KB   (${files.length} file)`)
}
process.exit(fallito ? 1 : 0)
