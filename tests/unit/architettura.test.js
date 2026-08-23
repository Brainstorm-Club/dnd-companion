/**
 * Regole che valgono sul codice, non sul comportamento.
 *
 * Servono a proteggere due decisioni che, se marciscono, costano una
 * riscrittura: i pacchetti (la v3 deve essere un'aggiunta) e il «vanilla» (che
 * non deve diventare un framework fatto in casa).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

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
