import { describe, it, expect } from 'vitest'
import { XP_THRESHOLDS, levelForXp, xpProgress } from '../../src/domain/progress.js'

describe('punti esperienza', () => {
  it('ha venti soglie', () => {
    expect(XP_THRESHOLDS).toHaveLength(20)
    expect(XP_THRESHOLDS[0]).toBe(0)
    expect(XP_THRESHOLDS[19]).toBe(355000)
  })

  it('le soglie crescono sempre', () => {
    for (let i = 1; i < XP_THRESHOLDS.length; i++) {
      expect(XP_THRESHOLDS[i]).toBeGreaterThan(XP_THRESHOLDS[i - 1])
    }
  })

  it.each([[0, 1], [299, 1], [300, 2], [899, 2], [900, 3], [354999, 19], [355000, 20], [999999, 20]])(
    '%i PX → livello %i', (xp, atteso) => expect(levelForXp(xp)).toBe(atteso),
  )

  it('dice quanti PX mancano', () => {
    const p = xpProgress(500)
    expect(p.livello).toBe(2)
    expect(p.prossimo).toBe(900)
    expect(p.mancano).toBe(400)
    expect(p.frazione).toBeCloseTo((500 - 300) / (900 - 300))
  })

  it('al ventesimo non manca più niente', () => {
    const p = xpProgress(400000)
    expect(p.livello).toBe(20)
    expect(p.prossimo).toBeNull()
    expect(p.frazione).toBe(1)
  })
})
