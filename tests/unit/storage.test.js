import { describe, it, expect, beforeEach } from 'vitest'
import { emptyState, migrate, load, save, SCHEMA_VERSION, MIGRATIONS, STORAGE_KEY, BACKUP_KEY } from '../../src/storage.js'

/** localStorage finto: il dominio non deve dipendere dal browser per essere testato. */
function fakeStore(iniziale = null) {
  let v = iniziale
  return {
    getItem: () => v,
    setItem: (_k, val) => { if (val.length > 5_000_000) throw new Error('QuotaExceededError'); v = val },
    removeItem: () => { v = null },
    key: () => null, clear: () => { v = null }, length: 0,
  }
}

describe('persistenza', () => {
  it('parte da uno stato vuoto sensato', () => {
    const s = emptyState()
    expect(s.v).toBe(SCHEMA_VERSION)
    expect(s.characters).toEqual({})
    expect(s.settings.edition).toBe('auto')
    expect(s.settings.lang).toBe('it')
  })

  it('legge quello che ha scritto', () => {
    const store = fakeStore()
    const s = emptyState()
    s.settings.xpMode = 'milestone'
    expect(save(s, store).ok).toBe(true)
    expect(load(store).settings.xpMode).toBe('milestone')
  })

  it('sopravvive a JSON corrotto invece di rompersi', () => {
    expect(load(fakeStore('{non json'))).toEqual(emptyState())
  })

  it('sopravvive a localStorage pieno', () => {
    const store = fakeStore()
    const s = emptyState()
    s.characters = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [String(i), { grosso: 'x'.repeat(40_000) }]),
    )
    const r = save(s, store)
    expect(r.ok).toBe(false)
  })

  it('applica le migrazioni in catena', () => {
    expect(migrate(emptyState()).v).toBe(SCHEMA_VERSION)
    // ogni versione dalla 0 alla penultima deve sapere come arrivare alla dopo:
    // un buco nella catena vuol dire uno stato salvato che non torna più su
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(typeof MIGRATIONS[v], `manca la migrazione da v${v}`).toBe('function')
    }
  })

  it('uno stato della v1 arriva a oggi senza perdere niente', () => {
    const vecchio = {
      v: 1,
      characters: { a: { meta: { name: 'Kyra' } } },
      activeId: 'a',
      settings: { theme: 'light', lang: 'en', xpMode: 'milestone', edition: '2024' },
      diceLog: [{ total: 7 }],
    }
    const oggi = migrate(structuredClone(vecchio))
    expect(oggi.v).toBe(SCHEMA_VERSION)
    expect(oggi.characters).toEqual(vecchio.characters)
    expect(oggi.activeId).toBe('a')
    expect(oggi.diceLog).toEqual(vecchio.diceLog)
    // le scelte che aveva restano sue
    expect(oggi.settings.theme).toBe('light')
    expect(oggi.settings.edition).toBe('2024')
    // le nuove arrivano accese
    expect(oggi.settings.schermoSveglio).toBe(true)
    expect(oggi.settings.vibrazione).toBe(true)
  })

  it('un contatore di usi della v2 diventa una scheda con massimo e recupero', () => {
    // Un numero da solo non dice quanti usi restino: si legge come «tutti
    // spesi», che è la lettura prudente.
    const oggi = migrate({
      v: 2, activeId: null, diceLog: [],
      settings: { theme: 'dark', lang: 'it', xpMode: 'xp', edition: 'auto' },
      characters: { a: { meta: { name: 'Kyra' }, play: { uses: { rage: 2 } }, levels: [] } },
    })
    expect(oggi.characters['a'].play.uses['rage']).toEqual({ max: 2, spesi: 2, recupero: 'lungo' })
  })

  it('e se le aveva già scelte, non gliele si sovrascrive', () => {
    const oggi = migrate({
      v: 1, characters: {}, activeId: null, diceLog: [],
      settings: { theme: 'dark', lang: 'it', xpMode: 'xp', edition: 'auto', vibrazione: false },
    })
    expect(oggi.settings.vibrazione).toBe(false)
    expect(oggi.settings.schermoSveglio).toBe(true)
  })
})

describe('stato da una versione futura', () => {
  it('non viene letto: non sappiamo cosa contenga', () => {
    expect(migrate({ v: SCHEMA_VERSION + 1, characters: { a: 1 } })).toEqual(emptyState())
  })

  it('ma nemmeno buttato: finisce in un backup prima di ripartire', () => {
    const salvati = {}
    const store = {
      getItem: (k) => k === STORAGE_KEY ? JSON.stringify({ v: 99, characters: { a: 1 } }) : null,
      setItem: (k, v) => { salvati[k] = v },
      removeItem: () => {}, key: () => null, clear: () => {}, length: 0,
    }
    expect(load(store)).toEqual(emptyState())
    expect(JSON.parse(salvati[BACKUP_KEY]).characters).toEqual({ a: 1 })
  })
})
