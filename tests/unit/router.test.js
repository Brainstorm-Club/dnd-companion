import { describe, it, expect } from 'vitest'
import { match } from '../../src/router.js'

describe('router a hash', () => {
  it.each([
    ['', 'libreria'], ['#/', 'libreria'], ['#/libreria', 'libreria'],
    ['#/dadi', 'dadi'], ['#/prove', 'prove'], ['#/impostazioni', 'impostazioni'],
    ['#/rotta-che-non-esiste', 'libreria'],
  ])('«%s» → %s', (hash, nome) => expect(match(hash).nome).toBe(nome))

  it('estrae id e sezione della scheda', () => {
    expect(match('#/scheda/abc-123/magia')).toEqual({ nome: 'scheda', params: { id: 'abc-123', sezione: 'magia' } })
    expect(match('#/scheda/abc-123')).toEqual({ nome: 'scheda', params: { id: 'abc-123' } })
  })

  it('decodifica i parametri', () => {
    expect(match('#/px/id%20con%20spazi').params.id).toBe('id con spazi')
  })
})
