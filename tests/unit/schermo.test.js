/**
 * Lo schermo acceso e la vibrazione: due comodità che non devono mai
 * diventare un problema.
 *
 * Sono migliorie progressive, e la prova che lo siano davvero è che con le API
 * assenti — che è il caso di Safari per la vibrazione, e di parecchi browser
 * per il wake lock — non succeda **niente**: nessuna eccezione, nessun ramo
 * che si comporta diverso, nessun messaggio.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tieniAcceso, acceso, vibra, seguiVisibilita, _reset } from '../../src/schermo.js'

/** Un finto documento con lo stato di visibilità pilotabile. */
function fintoDocumento(stato = 'visible') {
  /** @type {Record<string, Function[]>} */
  const ascolti = {}
  return {
    visibilityState: stato,
    addEventListener: (/** @type {string} */ e, /** @type {Function} */ f) => {
      (ascolti[e] ??= []).push(f)
    },
    removeEventListener: (/** @type {string} */ e, /** @type {Function} */ f) => {
      ascolti[e] = (ascolti[e] ?? []).filter(x => x !== f)
    },
    /** @param {string} nuovo */
    vai(nuovo) {
      this.visibilityState = nuovo
      for (const f of ascolti['visibilitychange'] ?? []) f()
    },
  }
}

/** Un finto wake lock che tiene il conto di richieste e rilasci. */
function fintoWakeLock({ fallisce = false } = {}) {
  const conto = { richieste: 0, rilasci: 0 }
  /** @type {any} */
  let ultima = null
  return {
    conto,
    rilasciaDalSistema() { ultima?.emetti() },
    api: {
      async request() {
        conto.richieste++
        if (fallisce) throw new Error('batteria bassa')
        /** @type {Function[]} */
        const su = []
        ultima = {
          release: async () => { conto.rilasci++ },
          addEventListener: (/** @type {string} */ _e, /** @type {Function} */ f) => su.push(f),
          emetti: () => su.forEach(f => f()),
        }
        return ultima
      },
    },
  }
}

beforeEach(() => {
  _reset()
  vi.unstubAllGlobals()
})

describe('lo schermo che resta acceso', () => {
  it('lo chiede quando lo si accende, e lo rilascia quando lo si spegne', async () => {
    const wl = fintoWakeLock()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', fintoDocumento())

    await tieniAcceso(true)
    expect(wl.conto.richieste).toBe(1)
    expect(acceso()).toBe(true)

    await tieniAcceso(false)
    expect(wl.conto.rilasci).toBe(1)
    expect(acceso()).toBe(false)
  })

  it('non ne chiede due: uno basta, e il secondo non si rilascerebbe mai', async () => {
    const wl = fintoWakeLock()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', fintoDocumento())

    await tieniAcceso(true)
    await tieniAcceso(true)
    expect(wl.conto.richieste).toBe(1)
  })

  it('senza l\'API non succede niente, e soprattutto non lancia', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', fintoDocumento())
    await expect(tieniAcceso(true)).resolves.toBeUndefined()
    expect(acceso()).toBe(false)
  })

  it('se il sistema dice di no — batteria bassa — si tace', async () => {
    const wl = fintoWakeLock({ fallisce: true })
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', fintoDocumento())

    await expect(tieniAcceso(true)).resolves.toBeUndefined()
    expect(acceso()).toBe(false)   // l'utente ha chiesto una comodità, non una funzione
  })

  it('non lo chiede se la pagina non è in primo piano', async () => {
    const wl = fintoWakeLock()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', fintoDocumento('hidden'))

    await tieniAcceso(true)
    expect(wl.conto.richieste).toBe(0)
  })

  it('lo riprende tornando in primo piano', async () => {
    // È il caso che conta: il browser lo rilascia da sé a ogni notifica che ti
    // porta altrove. Senza questo, la promessa dura fino alla prima interruzione.
    const wl = fintoWakeLock()
    const doc = fintoDocumento()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', doc)

    seguiVisibilita()
    await tieniAcceso(true)
    expect(wl.conto.richieste).toBe(1)

    doc.vai('hidden')
    expect(acceso()).toBe(false)

    doc.vai('visible')
    await Promise.resolve()
    await Promise.resolve()
    expect(wl.conto.richieste).toBe(2)
  })

  it('ma non lo riprende se nel frattempo l\'utente l\'ha spento', async () => {
    const wl = fintoWakeLock()
    const doc = fintoDocumento()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', doc)

    seguiVisibilita()
    await tieniAcceso(true)
    await tieniAcceso(false)

    doc.vai('hidden')
    doc.vai('visible')
    await Promise.resolve()
    expect(wl.conto.richieste).toBe(1)
  })

  it('se il sistema lo revoca, non ci si illude di averlo ancora', async () => {
    const wl = fintoWakeLock()
    vi.stubGlobal('navigator', { wakeLock: wl.api })
    vi.stubGlobal('document', fintoDocumento())

    await tieniAcceso(true)
    expect(acceso()).toBe(true)
    wl.rilasciaDalSistema()
    expect(acceso()).toBe(false)
  })
})

describe('la vibrazione', () => {
  it('vibra solo se l\'utente la vuole', () => {
    const chiamate = []
    vi.stubGlobal('navigator', { vibrate: (/** @type {number[]} */ p) => chiamate.push(p) })

    vibra('tiro', false)
    expect(chiamate).toEqual([])

    vibra('tiro', true)
    expect(chiamate).toHaveLength(1)
  })

  it('il critico e il fallimento si riconoscono a occhi chiusi', () => {
    // È l'unico motivo per cui esistono tre schemi invece di uno: un tiro
    // fatto senza guardare deve poter dire com'è andato senza guardare.
    const chiamate = []
    vi.stubGlobal('navigator', { vibrate: (/** @type {number[]} */ p) => chiamate.push(p) })

    vibra('tiro', true)
    vibra('critico', true)
    vibra('fallimento', true)
    const [tiro, critico, fallimento] = chiamate
    expect(new Set([tiro.length, critico.length, fallimento.length]).size).toBe(3)
    // e nessuna dura tanto da farsi sentire da tutto il tavolo
    for (const s of chiamate) expect(s.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0)).toBeLessThan(200)
  })

  it('su un browser che non vibra non succede niente', () => {
    vi.stubGlobal('navigator', {})
    expect(() => vibra('critico', true)).not.toThrow()
  })

  it('e se l\'API c\'è ma rifiuta, nemmeno', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('no') } })
    expect(() => vibra('tiro', true)).not.toThrow()
  })
})
