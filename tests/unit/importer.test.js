/**
 * I contratti del lotto B, lato import (`tests/unit/contratti.test.js`).
 *
 * Le fixture sono di due specie e servono a due cose diverse: quelle scritte a
 * mano descrivono i casi che ci interessano, quelle `reale-*` sono export veri
 * del builder e servono a scoprire ciò che non avevamo previsto.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  fromJson, fromShareUrl, decodeShareData,
  COMPACT_KEYS, MAX_INPUT_BYTES, MAX_SHARE_DATA_LENGTH,
} from '../../src/domain/importer.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

/** @param {string} nome */
function fixture(nome) {
  return readFileSync(`tests/fixtures/${nome}.json`, 'utf8')
}

/** Codifica come fa `shareCharacter.ts`: chiavi compatte, base64url, senza `=`. */
function linkDi(/** @type {Record<string, unknown>} */ obj) {
  /** @type {Record<string, unknown>} */
  const compatto = {}
  for (const [piena, breve] of Object.entries(COMPACT_KEYS)) {
    const v = obj[piena]
    if (v === undefined || v === null || v === '' || v === 0 || v === false) continue
    if (Array.isArray(v) && v.length === 0) continue
    compatto[breve] = v
  }
  return base64url(JSON.stringify(compatto))
}

/** @param {string} json */
function base64url(json) {
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('lotto B — import', () => {
  it('importa il JSON esportato dal builder per le due edizioni SRD', () => {
    const mago = fromJson(fixture('dnd2024-mago-5'), registro, 'file')
    expect(mago.ok).toBe(true)
    if (!mago.ok) return
    expect(mago.entry.meta.name).toBe('Vittoria Sacchi')
    expect(mago.entry.meta.edition).toBe('2024')
    expect(mago.entry.meta.packId).toBe('srd-2024')
    expect(mago.entry.meta.source).toBe('file')
    expect(mago.warnings).toEqual([])

    const guerriero = fromJson(fixture('dnd5e-guerriero-3'), registro, 'paste')
    expect(guerriero.ok).toBe(true)
    if (!guerriero.ok) return
    expect(guerriero.entry.meta.edition).toBe('2014')
    expect(guerriero.entry.meta.packId).toBe('srd-2014')
    expect(guerriero.warnings).toEqual([])
  })

  it('importa senza avvisi anche gli export veri del builder', () => {
    for (const nome of ['reale-dnd2024-guerriero-3', 'reale-dnd5e-barbaro-10', 'reale-dnd5e-chierico-3']) {
      const r = fromJson(fixture(nome), registro, 'file')
      expect(r.ok, nome).toBe(true)
      if (!r.ok) continue
      expect(r.warnings, nome).toEqual([])
    }
  })

  it('lo stato di gioco parte dallo snapshot ma vive a parte', () => {
    const r = fromJson(fixture('reale-dnd5e-barbaro-10'), registro, 'file')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry.play.hp).toEqual({ cur: 85, temp: 0 })
    expect(r.entry.play.coins.gp).toBe(18)
    expect(r.entry.play.hitDice.spent).toBe(0)
    expect(r.entry.play.deaths).toEqual({ succ: 0, fail: 0 })
    expect(r.entry.levels).toEqual([])
  })

  it('deduce l\'edizione dalla variante senza chiederlo', () => {
    // Nessun parametro «edizione» in ingresso: la si legge dal pacchetto.
    const a = fromJson(fixture('reale-dnd2024-guerriero-3'), registro, 'file')
    const b = fromJson(fixture('reale-dnd5e-chierico-3'), registro, 'file')
    expect(a.ok && a.entry.meta.edition).toBe('2024')
    expect(b.ok && b.entry.meta.edition).toBe('2014')
  })

  it('importa dal formato compatto di un link di condivisione', () => {
    const originale = JSON.parse(fixture('dnd2024-mago-5'))
    const r = fromShareUrl(`https://esempio.test/dnd-character-builder/share/${linkDi(originale)}`, registro)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry.meta.name).toBe('Vittoria Sacchi')
    expect(r.entry.meta.edition).toBe('2024')
    expect(r.entry.meta.source).toBe('link')
    expect(r.entry.snapshot['abilityScores']).toEqual(originale.abilityScores)
    expect(r.entry.snapshot['level']).toBe(5)
  })

  it('accetta anche il solo blocco codificato, incollato senza il link intorno', () => {
    const originale = JSON.parse(fixture('dnd5e-guerriero-3'))
    const r = fromShareUrl(linkDi(originale), registro)
    expect(r.ok && r.entry.meta.name).toBe('Baldo di Faenza')
  })

  it('rifiuta un link più lungo di MAX_SHARE_DATA_LENGTH', () => {
    const lungo = 'A'.repeat(MAX_SHARE_DATA_LENGTH + 1)
    const r = fromShareUrl(`https://esempio.test/share/${lungo}`, registro)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('troppo-grande')
    // e la funzione di basso livello si rifiuta da sé, non solo per gentilezza
    expect(() => decodeShareData(lungo)).toThrow()
  })

  it('rifiuta un testo più grande di MAX_INPUT_BYTES', () => {
    const enorme = JSON.stringify({ variant: 'dnd5e', level: 1, backstory: 'x'.repeat(MAX_INPUT_BYTES) })
    const r = fromJson(enorme, registro, 'file')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('troppo-grande')
  })

  it('scarta le chiavi che non sono nella whitelist', () => {
    // JSON scritto a mano: `__proto__` in un letterale JS cambierebbe il
    // prototipo invece di diventare una chiave, e il caso da provare è l'altro.
    const veleno = '{"n":"Prova","lv":3,"v":"dnd5e","zz":"chiave che non esiste",'
      + '"__proto__":{"inquinato":true},"constructor":"no"}'
    const espanso = decodeShareData(base64url(veleno))
    expect(espanso['name']).toBe('Prova')
    expect(espanso['level']).toBe(3)
    expect(Object.keys(espanso).sort()).toEqual(['level', 'name', 'variant'])
    expect(/** @type {any} */ ({}).inquinato).toBeUndefined()
  })

  it('un JSON malformato è «json-non-valido», non un\'eccezione in faccia', () => {
    const r = fromJson('{ questo non è json', registro, 'paste')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('json-non-valido')
  })

  it('un file che non è un personaggio lo dice', () => {
    const r = fromJson(JSON.stringify({ titolo: 'la mia lista della spesa' }), registro, 'file')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('non-e-un-personaggio')

    const senzaVariante = fromJson(JSON.stringify({ name: 'Tizio', level: 2 }), registro, 'file')
    expect(senzaVariante.ok).toBe(false)
    if (!senzaVariante.ok) expect(senzaVariante.reason).toBe('non-e-un-personaggio')
  })

  it('rifiuta Brancalonia con il messaggio del registro, non con un errore', () => {
    const r = fromJson(fixture('brancalonia-rifiuto'), registro, 'file')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('variante-non-supportata')
    expect(r.message).toContain('Brancalonia')
    expect(r.message).toContain('prossima versione')
    expect(r.message).not.toMatch(/errore|error/i)
    // niente import a metà: non esiste nessuna voce da salvare
    expect(/** @type {any} */ (r).entry).toBeUndefined()
  })

  it('supplisce ai campi mancanti e mette ogni supplenza fra gli avvisi', () => {
    const scarno = {
      variant: 'dnd5e',
      className: 'fighter',
      hitDie: 10,
      abilityScores: { str: 16, dex: 12, con: 14 },   // ne mancano tre
    }
    const r = fromJson(JSON.stringify(scarno), registro, 'paste')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.entry.snapshot['name']).toBe('Senza nome')
    expect(r.entry.snapshot['level']).toBe(1)
    expect(r.entry.snapshot['abilityScores']).toEqual({ str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 })
    // 1° livello, d10, Cos 14 (+2) → 12
    expect(r.entry.snapshot['maxHp']).toBe(12)
    expect(r.entry.play.hp.cur).toBe(12)
    expect(r.entry.snapshot['speed']).toBe(30)

    // ogni supplenza ha lasciato una frase, in italiano
    expect(r.warnings).toContain('PF massimi assenti: calcolati da dado vita e Costituzione.')
    expect(r.warnings.some(w => w.includes('Nome assente'))).toBe(true)
    expect(r.warnings.some(w => w.includes('Livello assente'))).toBe(true)
    expect(r.warnings.some(w => w.includes('Intelligenza'))).toBe(true)
    expect(r.warnings.some(w => w.includes('Velocità assente'))).toBe(true)
    for (const w of r.warnings) expect(w).toMatch(/[a-zà-ù]/)
  })

  it('lo snapshot importato è congelato in profondità', () => {
    const r = fromJson(fixture('dnd2024-mago-5'), registro, 'file')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = r.entry.snapshot
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s['abilityScores'])).toBe(true)
    expect(Object.isFrozen(s['weapons'])).toBe(true)
    expect(Object.isFrozen(/** @type {any[]} */ (s['weapons'])[0])).toBe(true)
    // i moduli ESM sono in strict mode: scrivere lancia, non fallisce in silenzio
    expect(() => { /** @type {any} */ (s).name = 'altro' }).toThrow()
  })

  it('la tabella delle chiavi compatte non ha due chiavi uguali', () => {
    // Una chiave breve usata due volte farebbe sparire un campo dal link,
    // silenziosamente. Nel builder c'è lo stesso test, per lo stesso motivo.
    const brevi = Object.values(COMPACT_KEYS)
    expect(new Set(brevi).size).toBe(brevi.length)
  })
})
