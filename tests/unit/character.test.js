/**
 * I contratti del lotto B, lato scheda: i numeri che `derive()` mette sotto gli
 * occhi al tavolo, e la regola che li rende affidabili — lo snapshot non si
 * tocca.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromJson } from '../../src/domain/importer.js'
import {
  derive, features, modifier, proficiencyBonus, formatModifier, diceModifier, ABILITIES,
} from '../../src/domain/character.js'

const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

/** @param {string} nome @returns {import('../../src/storage.js').CharacterEntry} */
function importa(nome) {
  const r = fromJson(readFileSync(`tests/fixtures/${nome}.json`, 'utf8'), registro, 'file')
  if (!r.ok) throw new Error(`la fixture ${nome} non si importa: ${r.message}`)
  return r.entry
}

describe('lotto B — numeri della scheda', () => {
  it('modificatore, bonus di competenza e formattazione', () => {
    expect(modifier(8)).toBe(-1)
    expect(modifier(10)).toBe(0)
    expect(modifier(18)).toBe(4)
    expect([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 4, 5, 6, 6])
    // fuori scala non deve dare numeri assurdi
    expect(proficiencyBonus(0)).toBe(2)
    expect(proficiencyBonus(99)).toBe(6)
    expect(formatModifier(3)).toBe('+3')
    expect(formatModifier(-1)).toBe('−1')          // meno tipografico: lo legge una persona
    expect(diceModifier(-1)).toBe('-1')            // meno ASCII: lo legge il parser dei dadi
    expect(diceModifier(0)).toBe('')
  })

  it('calcola punteggi pieni, modificatori, tiri salvezza, CA, iniziativa e CD incantesimi', () => {
    const d = derive(importa('dnd2024-mago-5'), null)

    // punteggi = base + bonus razziali (Int 17+1, Cos 14+1)
    expect(d.punteggi).toEqual({ str: 8, dex: 14, con: 15, int: 18, wis: 12, cha: 10 })
    expect(d.modificatori).toEqual({ str: -1, dex: 2, con: 2, int: 4, wis: 1, cha: 0 })
    expect(d.competenza).toBe(3)

    // competenza nei tiri salvezza solo dove la dà la classe (Int e Sag)
    expect(d.tiriSalvezza.int).toBe(4 + 3)
    expect(d.tiriSalvezza.wis).toBe(1 + 3)
    expect(d.tiriSalvezza.dex).toBe(2)
    expect(d.tiriSalvezza.str).toBe(-1)

    expect(d.ca).toBe(12)             // niente armatura, niente scudo: 10 + Des
    expect(d.iniziativa).toBe(2)
    expect(d.pfMax).toBe(32)
    expect(d.cdIncantesimi).toBe(8 + 3 + 4)
    expect(d.attaccoIncantesimi).toBe(3 + 4)
  })

  it('senza magia, CD e attacco magico sono nulli invece che zero', () => {
    const d = derive(importa('dnd5e-guerriero-3'), null)
    expect(d.cdIncantesimi).toBeNull()
    expect(d.attaccoIncantesimi).toBeNull()
  })

  it('l\'armatura pesante ignora la Destrezza, la media la limita, la leggera no', () => {
    // Cotta di maglia (pesante, CA 16): la Destrezza +1 non conta
    expect(derive(importa('dnd5e-guerriero-3'), null).ca).toBe(16)
    // stesso caso ma col nome inglese che il builder salva davvero
    expect(derive(importa('reale-dnd2024-guerriero-3'), null).ca).toBe(16)
    // Mezza armatura (media, CA 15) + Des +1, sotto il limite di 2
    expect(derive(importa('reale-dnd5e-chierico-3'), null).ca).toBe(16)
  })

  it('senza armatura ma con lo scudo: Difesa Senza Armatura più due', () => {
    // Il caso che fa sbagliare la CA: `armor: ""` e `shield: true` è normale.
    // Barbaro: 10 + Des (+1) + Cos (+1) + scudo (2) = 14
    const d = derive(importa('reale-dnd5e-barbaro-10'), null)
    expect(d.punteggi.con).toBe(13)
    expect(d.modificatori.dex).toBe(1)
    expect(d.ca).toBe(14)
    expect(d.competenza).toBe(4)
  })

  it('la maestria raddoppia la competenza, la competenza semplice no', () => {
    const entry = importa('dnd2024-mago-5')
    const conMaestria = {
      ...entry,
      snapshot: { ...entry.snapshot, skillExpertise: ['arcana'] },
    }
    const base = derive(entry, null)
    const doppia = derive(conMaestria, null)

    const arcanoBase = base.abilita.find(a => a.id === 'arcana')
    const arcanoDoppio = doppia.abilita.find(a => a.id === 'arcana')
    // Arcano è governato da Intelligenza (+4), competenza 3
    expect(arcanoBase).toMatchObject({ competenza: true, maestria: false, bonus: 4 + 3 })
    expect(arcanoDoppio).toMatchObject({ competenza: true, maestria: true, bonus: 4 + 3 * 2 })

    // e chi non è competente prende solo il modificatore
    expect(base.abilita.find(a => a.id === 'stealth')?.bonus).toBe(2)
    expect(base.abilita.find(a => a.id === 'stealth')?.competenza).toBe(false)
  })

  it('le diciotto abilità ci sono tutte, con nome italiano e caratteristica valida', () => {
    const d = derive(importa('dnd5e-guerriero-3'), null)
    expect(d.abilita).toHaveLength(18)
    for (const a of d.abilita) {
      expect(ABILITIES).toContain(a.caratteristica)
      expect(a.nome).toMatch(/^[A-ZÀ-Ù]/)
      expect(a.nome).not.toBe(a.id)
    }
    expect(d.abilita.find(a => a.id === 'athletics')?.nome).toBe('Atletica')
  })

  it('i PF massimi vengono dallo snapshot, e solo in sua assenza dal dado vita', () => {
    expect(derive(importa('reale-dnd5e-barbaro-10'), null).pfMax).toBe(85)

    const senzaPf = importa('dnd5e-guerriero-3')
    const rifatto = { ...senzaPf, snapshot: { ...senzaPf.snapshot, maxHp: 0 } }
    // d10, Cos 15+2=17 (+3), livello 3 → 13 + 2 × 9 = 31
    expect(derive(rifatto, null).pfMax).toBe(31)
  })

  it('non modifica mai lo snapshot: derive() legge e basta', () => {
    const entry = importa('reale-dnd5e-chierico-3')
    const prima = JSON.stringify(entry.snapshot)
    const play = JSON.stringify(entry.play)

    derive(entry, null)
    derive(entry, { classes: { cleric: { savingThrows: ['str'] } } })
    features(entry, null)

    expect(JSON.stringify(entry.snapshot)).toBe(prima)
    expect(JSON.stringify(entry.play)).toBe(play)
    expect(Object.isFrozen(entry.snapshot)).toBe(true)
  })

  it('regge uno snapshot ostile e un pacchetto regole assente', () => {
    /** @type {any} */
    const rotto = {
      snapshot: { level: 'tre', abilityScores: null, skillProficiencies: 'no', armor: 42, shield: 'sì' },
      meta: {}, play: {}, levels: [],
    }
    for (const rules of [null, undefined, 'niente', { classes: 'no' }, { abilita: [] }]) {
      const d = derive(rotto, rules)
      expect(d.competenza).toBe(2)
      expect(d.ca).toBe(10)
      expect(d.abilita).toHaveLength(18)
      for (const v of Object.values(d.punteggi)) expect(v).toBe(10)
    }
  })

  it('se lo snapshot non porta i tiri salvezza li chiede al pacchetto regole', () => {
    const entry = importa('reale-dnd5e-chierico-3')
    const senza = { ...entry, snapshot: { ...entry.snapshot, savingThrowProficiencies: [] } }
    const competenza = derive(senza, null).competenza

    expect(derive(senza, null).tiriSalvezza.wis).toBe(derive(senza, null).modificatori.wis)
    const conPacchetto = derive(senza, { classes: { cleric: { savingThrows: ['wis', 'cha'] } } })
    expect(conPacchetto.tiriSalvezza.wis).toBe(conPacchetto.modificatori.wis + competenza)
  })
})

describe('lotto B — contro il builder, che è l\'implementazione di riferimento', () => {
  const oracolo = JSON.parse(readFileSync('tests/fixtures/oracolo-derive.json', 'utf8'))
  const casi = Object.keys(oracolo).filter(k => !k.startsWith('_'))

  it('ci sono oracoli da confrontare', () => {
    expect(casi.length).toBeGreaterThan(0)
  })

  for (const nome of casi) {
    it(`combacia col riepilogo del builder: ${nome}`, () => {
      const atteso = oracolo[nome]
      const entry = importa(nome)
      const d = derive(entry, null)

      expect(d.punteggi).toEqual(atteso.punteggi)
      expect(d.modificatori).toEqual(atteso.modificatori)
      expect(d.tiriSalvezza).toEqual(atteso.tiriSalvezza)
      expect(d.ca).toBe(atteso.ca)
      expect(d.iniziativa).toBe(atteso.iniziativa)
      expect(d.pfMax).toBe(atteso.pfMax)
      expect(d.competenza).toBe(atteso.competenza)
      expect(`${entry.snapshot['level']}d${entry.snapshot['hitDie']}`).toBe(atteso.dadoVita)

      for (const [id, bonus] of Object.entries(atteso.abilita)) {
        expect(d.abilita.find(a => a.id === id)?.bonus, id).toBe(bonus)
      }
    })
  }

  it('un modificatore negativo resta negativo anche dove c\'è competenza', () => {
    // Intelligenza 7 → −2: Arcano competente torna a 0, non a +2. Un
    // `Math.max(0, …)` di troppo lo romperebbe senza che nessuno se ne accorga.
    const d = derive(importa('reale-dnd2024-guerriero-3'), null)
    expect(d.modificatori.int).toBe(-2)
    expect(d.abilita.find(a => a.id === 'arcana')?.bonus).toBe(-2)
    expect(d.abilita.find(a => a.id === 'history')).toMatchObject({ competenza: true, bonus: 0 })
  })
})

describe('lotto B — privilegi stampabili', () => {
  it('deduplica i doppioni contandoli', () => {
    // Il barbaro di 10° porta due volte «Ability Score Improvement» e due
    // volte «Primal Path feature»: la lista grezza non si può stampare.
    const entry = importa('reale-dnd5e-barbaro-10')
    const f = features(entry, null)
    const ids = f.map(v => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(f.find(v => v.id === 'Ability Score Improvement')?.volte).toBe(2)
    expect(f.find(v => v.id === 'Primal Path feature')?.volte).toBe(2)
    expect(f.find(v => v.id === 'Rage')?.volte).toBe(1)
  })

  it('rende leggibili gli id kebab, e dichiara di averlo fatto per ripiego', () => {
    const f = features(importa('reale-dnd5e-chierico-3'), null)
    const antenati = f.find(v => v.id === 'draconic-ancestry')
    expect(antenati?.nome).toBe('Draconic Ancestry')
    expect(antenati?.risolto).toBe(false)
    // un nome già leggibile resta com'è
    expect(f.find(v => v.id === 'Channel Divinity')?.nome).toBe('Channel Divinity')
  })

  it('col pacchetto regole vero i privilegi di classe e sottoclasse diventano italiani', () => {
    const rules = JSON.parse(readFileSync('data/rules/2014.json', 'utf8'))
    const f = features(importa('reale-dnd5e-barbaro-10'), rules)
    expect(f.find(v => v.id === 'Rage')).toMatchObject({ nome: 'Ira', risolto: true })
    expect(f.find(v => v.id === 'Unarmored Defense')?.nome).toBe('Difesa senza armatura')
    // «Frenesia» sta nella sottoclasse, non fra i privilegi di classe
    expect(f.find(v => v.id === 'Frenzy')).toMatchObject({ nome: 'Frenesia', risolto: true })
    // i tratti razziali il pacchetto non li ha: restano ripieghi, e lo dicono
    expect(f.find(v => v.id === 'extra-language')).toMatchObject({ nome: 'Extra Language', risolto: false })
  })

  it('quando il pacchetto regole conosce il privilegio, vince il suo nome', () => {
    const rules = { classes: { cleric: { features: [{ id: 'draconic-ancestry', nome: 'Ascendenza Draconica' }] } } }
    const f = features(importa('reale-dnd5e-chierico-3'), rules)
    const antenati = f.find(v => v.id === 'draconic-ancestry')
    expect(antenati?.nome).toBe('Ascendenza Draconica')
    expect(antenati?.risolto).toBe(true)
  })
})
