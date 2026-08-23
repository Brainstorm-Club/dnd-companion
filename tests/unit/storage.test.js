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
    // la fase 0 non ne ha ancora: il test descrive il contratto per chi ne aggiungerà
    expect(Object.keys(MIGRATIONS)).toEqual([])
    expect(migrate(emptyState()).v).toBe(SCHEMA_VERSION)
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
