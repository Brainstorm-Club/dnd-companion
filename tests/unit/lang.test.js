import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const it_ = JSON.parse(readFileSync('lang/it.json', 'utf8'))
const en = JSON.parse(readFileSync('lang/en.json', 'utf8'))

describe('traduzioni', () => {
  it('italiano e inglese hanno le stesse chiavi', () => {
    const soloIt = Object.keys(it_).filter(k => !(k in en))
    const soloEn = Object.keys(en).filter(k => !(k in it_))
    expect({ soloIt, soloEn }).toEqual({ soloIt: [], soloEn: [] })
  })

  it('nessun valore vuoto', () => {
    for (const [k, v] of Object.entries({ ...it_, ...en })) expect(v, k).not.toBe('')
  })

  it('i segnaposto {…} coincidono fra le due lingue', () => {
    const seg = (/** @type {string} */ s) => (s.match(/\{[a-z]+\}/gi) ?? []).sort()
    for (const k of Object.keys(it_)) expect(seg(en[k]), k).toEqual(seg(it_[k]))
  })
})
