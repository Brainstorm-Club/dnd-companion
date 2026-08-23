import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { errataDi } from '../../src/domain/errata.js'

const REGOLE_2024 = JSON.parse(readFileSync('data/rules/2024.json', 'utf8'))
const REGOLE_2014 = JSON.parse(readFileSync('data/rules/2014.json', 'utf8'))

/** @param {any} pacchetto @param {string} id */
function condizione(pacchetto, id) {
  return pacchetto.conditions.find((/** @type {any} */ c) => c.id === id)
}

describe('errata della fonte', () => {
  it('segnala il refuso di «Incapacitato» nell’SRD 5.2.1', () => {
    const c = condizione(REGOLE_2024, 'incapacitated')
    expect(errataDi('5.2.1', 'condizione', c.id, c.description)).toBe('errata.incapacitato')
  })

  it('il refuso c’è davvero: il testo spedito parla di «paralizzato»', () => {
    // Se un giorno questo test cade è una buona notizia — vuol dire che la
    // fonte è stata corretta — ma allora va tolta anche la voce in `errata.js`.
    const c = condizione(REGOLE_2024, 'incapacitated')
    expect(c.description).toContain('ha la condizione "paralizzato"')
    expect(REGOLE_2024.srd).toBe('5.2.1')
  })

  it('tace se il testo è stato corretto', () => {
    const giusto = 'Quando il tuo personaggio ha la condizione "incapacitato", subisce i seguenti effetti.'
    expect(errataDi('5.2.1', 'condizione', 'incapacitated', giusto)).toBe(null)
  })

  it('tace sulle altre condizioni, sugli altri tipi e sull’altro SRD', () => {
    const c = condizione(REGOLE_2024, 'incapacitated')
    expect(errataDi('5.2.1', 'condizione', 'paralyzed', c.description)).toBe(null)
    expect(errataDi('5.2.1', 'incantesimo', 'incapacitated', c.description)).toBe(null)
    expect(errataDi('5.1', 'condizione', 'incapacitated', c.description)).toBe(null)
  })

  it('l’SRD 5.1 non ha lo stesso refuso', () => {
    const c = condizione(REGOLE_2014, 'incapacitated')
    expect(errataDi(REGOLE_2014.srd, 'condizione', c.id, c.description ?? '')).toBe(null)
  })
})
