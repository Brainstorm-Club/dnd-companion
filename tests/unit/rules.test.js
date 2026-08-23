/**
 * I pacchetti regole e l'aumento di livello.  ── Lotto C ──
 *
 * I `it.todo` di `contratti.test.js` sotto «lotto C» sono diventati i test qui
 * sotto. Si leggono i **file generati**, non il generatore: `build-rules.mjs`
 * ha bisogno dei due PDF degli SRD, che non stanno nel repo, mentre i JSON sì.
 * Quello che qui si verifica è perciò il contratto del dato — che è anche
 * l'unica cosa di cui il resto dell'app si fida.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { planLevelUp } from '../../src/domain/progress.js'

/** @param {string} f */
const leggi = f => readFileSync(`data/rules/${f}`, 'utf8')
const crudo = { '2014': leggi('2014.json'), '2024': leggi('2024.json') }
const pack = { '2014': JSON.parse(crudo['2014']), '2024': JSON.parse(crudo['2024']) }
const indice = JSON.parse(leggi('index.json'))

/** Le stesse chiavi in ordine con cui il generatore scrive. */
function ordina(v) {
  if (Array.isArray(v)) return v.map(ordina)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = ordina(v[k])
    return out
  }
  return v
}

/** Ogni stringa dentro un valore, per pescarci dentro. */
function testi(v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) testi(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) testi(x, out)
  return out
}

describe('pacchetti regole', () => {
  it('i due pacchetti esistono, si leggono e dichiarano la propria edizione', () => {
    expect(pack['2014'].edizione).toBe('2014')
    expect(pack['2014'].srd).toBe('5.1')
    expect(pack['2024'].edizione).toBe('2024')
    expect(pack['2024'].srd).toBe('5.2.1')
  })

  it('hanno la forma documentata in PIANO.md § 6.1', () => {
    for (const ed of ['2014', '2024']) {
      const p = pack[ed]
      expect(p.xpThresholds).toHaveLength(20)
      expect(p.xpThresholds[19]).toBe(355000)
      expect(Object.keys(p.classes)).toHaveLength(12)
      expect(p.spellSlots.full).toHaveLength(20)
      expect(Object.keys(p.cantripsKnown).length).toBeGreaterThan(0)
      expect(Object.keys(p.preparedSpells).length).toBeGreaterThan(0)
      expect(p.conditions).toHaveLength(15)
      for (const c of Object.values(p.classes)) {
        expect(typeof c.hitDie).toBe('number')
        expect(typeof c.subclassLevel).toBe('number')
        expect(Array.isArray(c.asiLevels)).toBe(true)
        expect(c.features.every(f => typeof f.level === 'number' && typeof f.name === 'string')).toBe(true)
        expect(typeof c.subclasses).toBe('object')
      }
    }
    // La padronanza d'armi è del 2024 e basta: nel 2014 non esiste, e un campo
    // vuoto sarebbe peggio di un campo assente.
    expect(pack['2024'].weaponMastery.properties).toHaveLength(8)
    expect(pack['2014'].weaponMastery).toBeUndefined()
  })

  it('genera due pacchetti deterministici: chiavi in ordine e nessun dato che cambia da solo', () => {
    for (const ed of ['2014', '2024']) {
      // Se le chiavi sono già ordinate, riserializzare rende identico il file:
      // è la proprietà che fa sì che rigenerare non produca diff.
      expect(JSON.stringify(ordina(pack[ed])) + '\n').toBe(crudo[ed])
    }
    // `generatedAt` viene dal commit del builder, non dall'orologio: i due
    // pacchetti nati dalla stessa sorgente portano la stessa data.
    expect(pack['2014'].generatedAt).toBe(pack['2024'].generatedAt)
    expect(pack['2014'].sourceCommit).toBe(pack['2024'].sourceCommit)
    expect(Date.now() - Date.parse(pack['2014'].generatedAt)).not.toBeLessThan(0)
  })

  it('index.json elenca i due pacchetti con versione e dimensione in byte', () => {
    expect(indice.packs).toHaveLength(2)
    for (const voce of indice.packs) {
      expect(voce.version).toMatch(/^[0-9a-f]{12}$/)
      expect(voce.bytes).toBe(Buffer.byteLength(crudo[voce.edizione]))
    }
    expect(indice.packs.map(p => p.id).sort()).toEqual(['srd-2014', 'srd-2024'])
  })

  it('nessuna descrizione contiene il boilerplate dei PDF', () => {
    // Il piè di pagina dell'SRD 5.1 compare 453 volte nel PDF e nel builder è
    // colato dentro undici descrizioni di incantesimi. Qui non deve entrarne
    // nemmeno una, in nessuna delle due edizioni.
    for (const ed of ['2014', '2024']) {
      const tutti = testi(pack[ed])
      expect(tutti.filter(t => /Not for resale/i.test(t))).toEqual([])
      expect(tutti.filter(t => /Permission granted/i.test(t))).toEqual([])
      expect(tutti.filter(t => /Rivendita vietata/i.test(t))).toEqual([])
      expect(tutti.filter(t => /System[s]? Reference Document \d/i.test(t))).toEqual([])
    }
  })

  it('nessuna descrizione contiene un numero di pagina isolato', () => {
    for (const ed of ['2014', '2024']) {
      const colpevoli = testi(pack[ed]).filter(t => /[.!?…]\s\d{1,3}\s+[A-ZÀ-Ù]/.test(t))
      expect(colpevoli).toEqual([])
    }
  })
})

describe('asiLevels e dono epico', () => {
  it('asiLevels è per classe: il guerriero ne ha sei, il ladro cinque', () => {
    // Sei e cinque sono i numeri del 2024, dove il 19° è il dono epico.
    expect(pack['2024'].classes.fighter.asiLevels).toEqual([4, 6, 8, 12, 14, 16])
    expect(pack['2024'].classes.fighter.asiLevels).toHaveLength(6)
    expect(pack['2024'].classes.rogue.asiLevels).toEqual([4, 8, 10, 12, 16])
    expect(pack['2024'].classes.rogue.asiLevels).toHaveLength(5)
    for (const [id, c] of Object.entries(pack['2024'].classes)) {
      if (id === 'fighter' || id === 'rogue') continue
      expect(c.asiLevels).toEqual([4, 8, 12, 16])
    }
  })

  it('asiLevels è anche per edizione: nel 2014 il 19° è un ASI in più', () => {
    expect(pack['2014'].classes.fighter.asiLevels).toEqual([4, 6, 8, 12, 14, 16, 19])
    expect(pack['2014'].classes.rogue.asiLevels).toEqual([4, 8, 10, 12, 16, 19])
    for (const [id, c] of Object.entries(pack['2014'].classes)) {
      if (id === 'fighter' || id === 'rogue') continue
      expect(c.asiLevels).toEqual([4, 8, 12, 16, 19])
    }
  })

  it('nel 2024 il 19° dà un dono epico, nel 2014 un ASI', () => {
    for (const c of Object.values(pack['2024'].classes)) {
      expect(c.epicBoonLevel).toBe(19)
      expect(c.asiLevels).not.toContain(19)
    }
    for (const c of Object.values(pack['2014'].classes)) {
      expect(c.epicBoonLevel).toBeNull()
      expect(c.asiLevels).toContain(19)
    }
  })
})

describe('livello di sottoclasse', () => {
  it('nel 2024 la sottoclasse arriva al 3° per tutte le classi', () => {
    for (const [id, c] of Object.entries(pack['2024'].classes)) {
      expect(`${id}:${c.subclassLevel}`).toBe(`${id}:3`)
    }
  })

  it('nel 2014 varia da classe a classe: 1°, 2° o 3°', () => {
    const per = Object.fromEntries(
      Object.entries(pack['2014'].classes).map(([id, c]) => [id, c.subclassLevel]))
    expect(per).toEqual({
      barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3,
      paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2,
    })
    expect(new Set(Object.values(per))).toEqual(new Set([1, 2, 3]))
  })
})

describe('tabelle di lancio', () => {
  it('nel 2024 i semi-incantatori lanciano già dal 1° livello, nel 2014 dal 2°', () => {
    expect(pack['2024'].spellSlots.half[0]).toEqual([2])
    expect(pack['2014'].spellSlots.half[0]).toEqual([])
    expect(pack['2014'].spellSlots.half[1]).toEqual([2])
  })

  it('nel 2024 ogni incantatore ha la colonna degli incantesimi preparati', () => {
    for (const [id, v] of Object.entries(pack['2024'].preparedSpells)) {
      expect(`${id}:${v.mode}`).toBe(`${id}:prepared`)
      expect(v.table, id).toHaveLength(20)
      // Non decresce mai: è una colonna di tabella, non una stima.
      for (let i = 1; i < 20; i++) expect(v.table[i]).toBeGreaterThanOrEqual(v.table[i - 1])
    }
  })

  it('nel 2014 chi conosce ha una tabella, chi prepara ha una formula', () => {
    expect(pack['2014'].preparedSpells.bard.mode).toBe('known')
    expect(pack['2014'].preparedSpells.bard.table).toHaveLength(20)
    expect(pack['2014'].preparedSpells.wizard.mode).toBe('prepared')
    expect(pack['2014'].preparedSpells.wizard.formula).toBe('mod+livello')
  })
})

describe('condizioni, razze, background, armature', () => {
  it('porta le quindici condizioni dell\'SRD, e dice quali non hanno testo invece di inventarlo', () => {
    for (const ed of ['2014', '2024']) {
      expect(pack[ed].conditions.map(c => c.id)).toContain('prone')
      for (const c of pack[ed].conditions) {
        expect(typeof c.name).toBe('string')
        expect(c.description === null || typeof c.description === 'string').toBe(true)
      }
    }
    // Il 2024 le ha tutte; l'SRD 5.1 italiano si ferma a «privo di sensi».
    expect(pack['2024'].conditions.filter(c => c.description === null)).toEqual([])
    expect(pack['2014'].conditions.filter(c => c.description === null).map(c => c.id))
      .toEqual(['prone', 'frightened', 'stunned', 'restrained'])
  })

  it('porta razze e background con id, nome italiano e nome inglese', () => {
    for (const ed of ['2014', '2024']) {
      const razze = Object.values(pack[ed].races)
      expect(razze.length).toBe(9)
      for (const r of razze) {
        expect(r.id && r.name && r.nameEn).toBeTruthy()
        for (const t of r.traits) expect(t.id && t.name && t.nameEn).toBeTruthy()
      }
      for (const b of Object.values(pack[ed].backgrounds)) {
        expect(b.id && b.name && b.nameEn).toBeTruthy()
      }
    }
    expect(pack['2014'].races.dragonborn.name).toBe('Dragonide')
    expect(pack['2014'].backgrounds.acolyte.name).toBe('Accolito')
  })

  it('le armature si trovano sia per slug sia per nome inglese dello snapshot', () => {
    for (const ed of ['2014', '2024']) {
      const a = pack[ed].armature['chain-mail']
      // Il builder salva «Chain Mail», non «chain-mail»: senza il nome inglese
      // un guerriero in cotta di maglia finirebbe con CA 11 invece di 16.
      expect(a.name).toBe('Chain Mail')
      expect(a.ca).toBe(16)
      expect(a.maxDex).toBe(0)
      expect(a.tipo).toBe('pesante')
      expect(pack[ed].armature['leather'].maxDex).toBeNull()
      expect(Object.keys(pack[ed].armature)).toHaveLength(13)
    }
  })
})

// ── planLevelUp ────────────────────────────────────────────────────────────

/** Congela in profondità, così una mutazione accidentale esplode invece di passare. */
function congela(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(congela); Object.freeze(v) }
  return v
}

/** @param {Record<string, unknown>} snapshot */
function scheda(snapshot) {
  return congela({
    snapshot: {
      abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      racialBonuses: {},
      classes: [],
      ...snapshot,
    },
    meta: { importedAt: '', source: 'file', variant: '', name: '', packId: '', edition: '2014' },
    play: {},
    levels: [],
  })
}

describe('piano di avanzamento', () => {
  it('elenca i privilegi nuovi col testo, gli slot e le scelte da fare', () => {
    // Mago 2024 che passa al 3°: privilegi del 3°, sottoclasse da scegliere,
    // uno slot di 2° nuovo, e due incantesimi preparati in più.
    const p = planLevelUp({
      entry: scheda({ className: 'wizard', subclass: '', level: 2, hitDie: 6 }),
      rules: pack['2024'], edition: '2024', classId: 'wizard',
    })
    expect(p.da).toBe(2)
    expect(p.a).toBe(3)
    expect(p.livelloClasse).toBe(3)
    expect(p.privilegi.length).toBeGreaterThan(0)
    expect(p.privilegi.every(f => f.livello === 3)).toBe(true)
    expect(p.privilegi.some(f => typeof f.testo === 'string' && f.testo.length > 40)).toBe(true)
    expect(p.sottoclasse?.obbligatoria).toBe(true)
    expect(p.sottoclasse?.scelte.map(s => s.id)).toContain('evoker')
    expect(p.slot.prima).toEqual([3])
    expect(p.slot.dopo).toEqual([4, 2])
    expect(p.slot.nuovi).toEqual([1, 2])
    expect(p.incantesimi?.incantesimi).toEqual({ prima: 5, dopo: 6 })
    expect(p.asi).toBe(false)
    expect(p.donoEpico).toBe(false)
  })

  it('dà i PF con la media fissa e con l\'opzione tiro', () => {
    const p = planLevelUp({
      entry: scheda({ className: 'barbarian', subclass: 'berserker', level: 5, hitDie: 12 }),
      rules: pack['2014'], edition: '2014', classId: 'barbarian',
    })
    // d12, Costituzione 14 → +2. Media 12/2 + 1 + 2 = 9.
    expect(p.pf).toEqual({
      dado: 12, modificatoreCostituzione: 2, media: 9, tiro: '1d12+2', minimo: 1,
    })
  })

  it('al 4° annuncia l\'ASI, al 19° il dono epico solo nel 2024', () => {
    const asi = planLevelUp({
      entry: scheda({ className: 'cleric', subclass: 'life-domain', level: 3 }),
      rules: pack['2024'], edition: '2024', classId: 'cleric',
    })
    expect(asi.asi).toBe(true)
    expect(asi.donoEpico).toBe(false)

    const epico = planLevelUp({
      entry: scheda({ className: 'cleric', subclass: 'life-domain', level: 18 }),
      rules: pack['2024'], edition: '2024', classId: 'cleric',
    })
    expect(epico.donoEpico).toBe(true)
    expect(epico.asi).toBe(false)

    const vecchio = planLevelUp({
      entry: scheda({ className: 'cleric', subclass: 'life', level: 18 }),
      rules: pack['2014'], edition: '2014', classId: 'cleric',
    })
    expect(vecchio.donoEpico).toBe(false)
    expect(vecchio.asi).toBe(true)
  })

  it('dice quante maestrie d\'arma si guadagnano, e nel 2014 che non se ne guadagnano', () => {
    const g = planLevelUp({
      entry: scheda({ className: 'fighter', subclass: 'champion', level: 3 }),
      rules: pack['2024'], edition: '2024', classId: 'fighter',
    })
    // Il guerriero passa da tre a quattro maestrie al 4° livello.
    expect(g.maestrieArmi).toEqual({ prima: 3, dopo: 4, nuove: 1 })

    const vecchio = planLevelUp({
      entry: scheda({ className: 'fighter', subclass: 'champion', level: 3 }),
      rules: pack['2014'], edition: '2014', classId: 'fighter',
    })
    expect(vecchio.maestrieArmi).toBeNull()
  })

  it('porta i privilegi della sottoclasse già scelta insieme a quelli di classe', () => {
    const p = planLevelUp({
      entry: scheda({ className: 'barbarian', subclass: 'path-of-the-berserker', level: 5 }),
      rules: pack['2024'], edition: '2024', classId: 'barbarian',
    })
    const dallaSottoclasse = p.privilegi.filter(f => f.sottoclasse === 'path-of-the-berserker')
    expect(dallaSottoclasse.length).toBe(1)
    expect(dallaSottoclasse[0].nome).toBe('Ira insensata')
    expect(p.privilegi.some(f => f.sottoclasse === null)).toBe(true)
  })

  it('la sottoclasse non si chiede due volte, e resta da scegliere se è stata saltata', () => {
    const scelta = planLevelUp({
      entry: scheda({ className: 'wizard', subclass: 'evoker', level: 3 }),
      rules: pack['2024'], edition: '2024', classId: 'wizard',
    })
    expect(scelta.sottoclasse).toBeNull()

    const saltata = planLevelUp({
      entry: scheda({ className: 'wizard', subclass: '', level: 5 }),
      rules: pack['2024'], edition: '2024', classId: 'wizard',
    })
    expect(saltata.sottoclasse?.obbligatoria).toBe(true)
  })

  it('non muta lo snapshot: descrive il diff, non lo applica', () => {
    const entry = scheda({ className: 'rogue', subclass: 'thief', level: 4 })
    const prima = JSON.stringify(entry)
    const p = planLevelUp({ entry, rules: pack['2014'], edition: '2014', classId: 'rogue' })

    // Lo snapshot è congelato: se `planLevelUp` scrivesse, in modalità strict
    // (i moduli ESM lo sono) lancerebbe. E comunque non è cambiato niente.
    expect(JSON.stringify(entry)).toBe(prima)
    expect(entry.snapshot.level).toBe(4)
    expect(entry.levels).toEqual([])

    // Ciò che restituisce è il materiale del diff, non lo stato nuovo.
    expect(p.da).toBe(4)
    expect(p.a).toBe(5)
    expect(p).toHaveProperty('privilegi')
    expect(p).toHaveProperty('slot')
    expect(p).toHaveProperty('pf')
  })

  it('multiclasse: sale nella classe indicata e avvisa sugli slot combinati', () => {
    const entry = scheda({
      className: 'fighter', subclass: 'champion', level: 5,
      classes: [
        { classId: 'fighter', subclass: 'champion', level: 3 },
        { classId: 'wizard', subclass: 'evoker', level: 2 },
      ],
    })
    const p = planLevelUp({ entry, rules: pack['2014'], edition: '2014', classId: 'wizard' })
    expect(p.classe).toBe('wizard')
    expect(p.livelloClasse).toBe(3)
    expect(p.a).toBe(6)
    expect(p.avvisi.some(a => /multiclasse/i.test(a))).toBe(true)
  })

  it('se il pacchetto è dell\'edizione sbagliata lo dice invece di rispondere a caso', () => {
    const p = planLevelUp({
      entry: scheda({ className: 'wizard', subclass: 'evoker', level: 2 }),
      rules: pack['2014'], edition: '2024', classId: 'wizard',
    })
    expect(p.avvisi.some(a => /2014/.test(a) && /2024/.test(a))).toBe(true)
  })

  it('una classe che il pacchetto non conosce non fa esplodere il piano', () => {
    const p = planLevelUp({
      entry: scheda({ className: 'burattinaio', subclass: '', level: 2 }),
      rules: pack['2014'], edition: '2014', classId: 'burattinaio',
    })
    expect(p.privilegi).toEqual([])
    expect(p.avvisi.length).toBeGreaterThan(0)
    expect(p.pf.dado).toBe(8)
  })
})
