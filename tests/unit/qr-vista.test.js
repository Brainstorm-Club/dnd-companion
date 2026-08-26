import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { chiaveErrore } from '../../src/views/scan.js'

/**
 * La vista della telecamera si prova davvero negli end-to-end, dove c'è un
 * browser. Qui resta la parte che non ha bisogno di uno: la traduzione fra il
 * nome dell'errore che dà `getUserMedia` e la frase che leggerà chi guarda.
 *
 * Vale la pena provarla da sola perché è l'unico punto in cui un `default:`
 * distratto trasformerebbe cinque situazioni diverse — e cinque rimedi diversi
 * — in un unico «qualcosa non ha funzionato».
 */

const it_ = JSON.parse(readFileSync('lang/it.json', 'utf8'))
const en = JSON.parse(readFileSync('lang/en.json', 'utf8'))

/** @param {string} nome */
const errore = (nome) => Object.assign(new Error(nome), { name: nome })

describe('inquadra il QR — i modi di non avere la telecamera', () => {
  it.each([
    ['NotAllowedError', 'qr.permessoNegato'],
    ['PermissionDeniedError', 'qr.permessoNegato'],
    ['SecurityError', 'qr.permessoNegato'],
    ['NotFoundError', 'qr.nessunaTelecamera'],
    ['DevicesNotFoundError', 'qr.nessunaTelecamera'],
    ['OverconstrainedError', 'qr.nessunaTelecamera'],
    ['NotReadableError', 'qr.telecameraOccupata'],
    ['TrackStartError', 'qr.telecameraOccupata'],
    ['AbortError', 'qr.telecameraOccupata'],
  ])('%s → %s', (nome, chiave) => {
    expect(chiaveErrore(errore(nome))).toBe(chiave)
  })

  it('quello che non conosciamo ha comunque una frase sua', () => {
    expect(chiaveErrore(errore('QualcosaDiNuovoError'))).toBe('qr.errore')
    expect(chiaveErrore(null)).toBe('qr.errore')
    expect(chiaveErrore(undefined)).toBe('qr.errore')
    expect(chiaveErrore('non è nemmeno un errore')).toBe('qr.errore')
  })

  it('ogni frase esiste in entrambe le lingue', () => {
    const chiavi = [
      'qr.permessoNegato', 'qr.nessunaTelecamera', 'qr.telecameraOccupata',
      'qr.contestoInsicuro', 'qr.errore', 'qr.nonUnPersonaggio',
      'qr.nienteDaLeggere', 'qr.senzaRegistro',
    ]
    for (const k of chiavi) {
      expect(it_[k], k).toBeTruthy()
      expect(en[k], k).toBeTruthy()
    }
  })

  it('il permesso negato dice dove si ridà', () => {
    // Un messaggio che dice solo «negato» lascia l'utente senza la mossa
    // successiva, che è l'unica cosa che gli serve sapere.
    expect(it_['qr.permessoNegato']).toMatch(/impostazioni/i)
    expect(en['qr.permessoNegato']).toMatch(/settings/i)
  })

  it('il contesto insicuro nomina https, non «errore»', () => {
    expect(it_['qr.contestoInsicuro']).toMatch(/https/)
    expect(en['qr.contestoInsicuro']).toMatch(/https/)
  })

  it('senza telecamera si indicano le altre vie d\'ingresso', () => {
    for (const d of [it_, en]) {
      expect(d['qr.nessunaTelecamera']).toMatch(/file/i)
      expect(d['qr.nessunaTelecamera']).toMatch(/link/i)
    }
  })
})
