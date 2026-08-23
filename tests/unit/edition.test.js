import { describe, it, expect } from 'vitest'
import { EDITIONS, isEdition, resolveEdition, otherEdition } from '../../src/domain/edition.js'

describe('edizione', () => {
  it('conosce due edizioni e nient\'altro', () => {
    expect(EDITIONS).toEqual(['2014', '2024'])
    expect(isEdition('2014')).toBe(true)
    expect(isEdition('5.5')).toBe(false)
    expect(isEdition(undefined)).toBe(false)
  })

  it('senza scelte usa quella del personaggio', () => {
    expect(resolveEdition({ personaggio: '2014' })).toBe('2014')
  })

  it('la preferenza globale scavalca il personaggio', () => {
    expect(resolveEdition({ personaggio: '2014', preferenza: '2024' })).toBe('2024')
  })

  it('lo scavalco puntuale scavalca tutto', () => {
    expect(resolveEdition({ personaggio: '2014', preferenza: '2024', scavalco: '2014' })).toBe('2014')
  })

  it('«auto» non è un\'edizione: si torna al personaggio', () => {
    expect(resolveEdition({ personaggio: '2024', preferenza: 'auto' })).toBe('2024')
  })

  it('ignora valori sporchi da localStorage', () => {
    // @ts-expect-error verifica difensiva
    expect(resolveEdition({ personaggio: '2014', preferenza: 'onednd' })).toBe('2014')
  })

  it('sa qual è l\'altra', () => {
    expect(otherEdition('2014')).toBe('2024')
    expect(otherEdition('2024')).toBe('2014')
  })
})
