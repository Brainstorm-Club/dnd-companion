/**
 * Il testo dei tratti razziali e dei privilegi di background, estratto dai due
 * PDF degli SRD da `build-rules.mjs`.
 *
 * Come in `rules.test.js` si leggono i **file generati** e non il generatore:
 * i PDF non stanno nel repo, i JSON sì, e il contratto che conta è quello del
 * dato. Il modo vero in cui questa estrazione può sbagliare non è lasciare un
 * buco — quello l'app lo sa già dire — ma **appaiare il testo giusto al tratto
 * sbagliato**: da lì i controlli puntuali qui sotto.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** @param {string} f */
const leggi = f => JSON.parse(readFileSync(`data/rules/${f}`, 'utf8'))
const pack = { '2014': leggi('2014.json'), '2024': leggi('2024.json') }

/**
 * Tutti i tratti razziali di un pacchetto, con la chiave
 * `razza/idTratto` o `razza/sottorazza/idTratto`.
 * @param {any} p
 * @returns {Array<[string, string|null]>}
 */
function tratti(p) {
  /** @type {Array<[string, string|null]>} */
  const out = []
  for (const [rid, r] of Object.entries(p.races)) {
    const razza = /** @type {any} */ (r)
    for (const t of razza.traits) out.push([`${rid}/${t.id}`, t.description])
    for (const [sid, s] of Object.entries(razza.subraces)) {
      for (const t of /** @type {any} */ (s).traits) out.push([`${rid}/${sid}/${t.id}`, t.description])
    }
  }
  return out
}

/** @param {any} p @returns {Array<[string, string|null]>} */
function privilegiBg(p) {
  /** @type {Array<[string, string|null]>} */
  const out = []
  for (const [bid, b] of Object.entries(p.backgrounds)) {
    for (const f of /** @type {any} */ (b).features) out.push([`${bid}/${f.id}`, f.description])
  }
  return out
}

/** @param {any} p @param {string} chiave @returns {string} */
function testo(p, chiave) {
  const v = tratti(p).find(([k]) => k === chiave)
  expect(v, `tratto ${chiave} inesistente`).toBeTruthy()
  const d = v?.[1]
  expect(d, `tratto ${chiave} senza testo`).toBeTypeOf('string')
  return String(d)
}

describe('copertura del testo dall\'SRD', () => {
  it('il 2014 copre almeno 34 dei 46 tratti razziali e il privilegio dell\'accolito', () => {
    const t = tratti(pack['2014'])
    expect(t).toHaveLength(46)
    expect(t.filter(([, d]) => d !== null).length).toBeGreaterThanOrEqual(34)
    expect(privilegiBg(pack['2014']).filter(([, d]) => d !== null).length).toBeGreaterThanOrEqual(1)
  })

  it('il 2024 copre almeno 47 dei 57 tratti e tutti e quattro i privilegi di background', () => {
    const t = tratti(pack['2024'])
    expect(t).toHaveLength(57)
    expect(t.filter(([, d]) => d !== null).length).toBeGreaterThanOrEqual(47)
    expect(privilegiBg(pack['2024']).filter(([, d]) => d !== null).length).toBe(4)
  })

  it('ciò che resta scoperto è esattamente ciò che l\'SRD non pubblica', () => {
    // L'SRD 5.1 stampa una sola sottorazza per razza, e il suo umano non ha un
    // tratto «Linguaggio extra»: il linguaggio in più è una riga di «Linguaggi».
    expect(tratti(pack['2014']).filter(([, d]) => d === null).map(([k]) => k)).toEqual([
      'dwarf/mountain-dwarf/dwarven-armor-training',
      'elf/dark-elf/drow-magic',
      'elf/dark-elf/drow-weapon-training',
      'elf/dark-elf/sunlight-sensitivity',
      'elf/dark-elf/superior-darkvision',
      'elf/wood-elf/elf-weapon-training',
      'elf/wood-elf/fleet-of-foot',
      'elf/wood-elf/mask-of-the-wild',
      'gnome/forest-gnome/natural-illusionist',
      'gnome/forest-gnome/speak-with-small-beasts',
      'halfling/stout-halfling/stout-resilience',
      'human/extra-language',
    ])
    // Nel 5.2.1 gli antenati draconici sono una tabella di soli tipi di danno,
    // che il nome del tratto («Antenato Draconico: Nero (Acido)») dice già.
    expect(tratti(pack['2024']).filter(([, d]) => d === null).map(([k]) => k))
      .toEqual(['black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white']
        .map(c => `dragonborn/${c}/dragonborn-${c}`))
    // Dei tredici background del 2014 l'SRD 5.1 pubblica solo l'accolito.
    expect(privilegiBg(pack['2014']).filter(([, d]) => d === null)).toHaveLength(12)
  })
})

describe('ogni testo sta sotto il tratto giusto', () => {
  it('2014: il soffio parla di soffio, la scurovisione di vedere al buio', () => {
    const p = pack['2014']
    expect(testo(p, 'dragonborn/breath-weapon')).toMatch(/soffio/i)
    expect(testo(p, 'dragonborn/breath-weapon')).toMatch(/2d6 danni/)
    expect(testo(p, 'dragonborn/damage-resistance')).toMatch(/resistenza ai danni/i)
    expect(testo(p, 'dragonborn/draconic-ancestry')).toMatch(/discendenza da un drago/i)
    // Sei razze hanno `darkvision` e l'SRD lo riscrive per ognuna: il testo
    // deve nominare la razza giusta, non una qualsiasi.
    expect(testo(p, 'dwarf/darkvision')).toMatch(/oscurità/i)
    expect(testo(p, 'dwarf/darkvision')).toMatch(/^Un nano/)
    expect(testo(p, 'elf/darkvision')).toMatch(/^Un elfo/)
    expect(testo(p, 'half-orc/darkvision')).toMatch(/sangue orchesco/i)
    expect(testo(p, 'dwarf/stonecunning')).toMatch(/struttura in pietra/i)
    expect(testo(p, 'elf/trance')).toMatch(/dormire/i)
    expect(testo(p, 'halfling/lucky')).toMatch(/ripetere il tiro/i)
    expect(testo(p, 'half-orc/relentless-endurance')).toMatch(/0 punti ferita/)
    expect(testo(p, 'tiefling/infernal-legacy')).toMatch(/taumaturgia/)
    expect(testo(p, 'elf/high-elf/cantrip')).toMatch(/trucchetto/i)
    expect(testo(p, 'gnome/rock-gnome/tinker')).toMatch(/congegno/i)
    const acolito = privilegiBg(p).find(([k]) => k === 'acolyte/shelter-of-the-faithful')?.[1]
    expect(acolito).toMatch(/tempio/i)
  })

  it('2024: la scurovisione dice la portata della sua specie', () => {
    const p = pack['2024']
    expect(testo(p, 'dragonborn/breath-weapon')).toMatch(/1d10 danni/)
    expect(testo(p, 'dragonborn/darkvision-60')).toMatch(/scurovisione fino a un raggio di 18 metri/)
    expect(testo(p, 'elf/darkvision-60')).toMatch(/18 metri/)
    expect(testo(p, 'dwarf/darkvision-120')).toMatch(/36 metri/)
    expect(testo(p, 'orc/darkvision-120')).toMatch(/36 metri/)
    expect(testo(p, 'dwarf/stonecunning')).toMatch(/percezione tellurica/i)
    expect(testo(p, 'orc/adrenaline-rush')).toMatch(/azione di Scatto/)
    expect(testo(p, 'human/versatile')).toMatch(/talento Origini/)
  })

  it('2024: ogni beneficio dei giganti porta il proprio danno', () => {
    const p = pack['2024']
    expect(testo(p, 'goliath/frosts-chill/goliath-frosts-chill')).toMatch(/1d6 danni da freddo/)
    expect(testo(p, 'goliath/fires-burn/goliath-fires-burn')).toMatch(/1d10 danni da fuoco/)
    expect(testo(p, 'goliath/storms-thunder/goliath-storms-thunder')).toMatch(/1d8 danni da tuono/)
    expect(testo(p, 'goliath/stones-endurance/goliath-stones-endurance')).toMatch(/1d12/)
    expect(testo(p, 'goliath/clouds-jaunt/goliath-clouds-jaunt')).toMatch(/teletrasport/i)
    expect(testo(p, 'goliath/hills-tumble/goliath-hills-tumble')).toMatch(/prona/)
  })

  it('2024: lignaggi e retaggi vengono dalla riga giusta della tabella', () => {
    const p = pack['2024']
    // Le tre colonne della tabella restano distinte e nell'ordine: se le
    // colonne fossero lette storte, il livello 3 del drow finirebbe altrove.
    expect(testo(p, 'elf/drow/elf-drow')).toMatch(/^Livello 1: .*36 metri.*luci danzanti/)
    expect(testo(p, 'elf/drow/elf-drow')).toMatch(/Livello 3: Luminescenza\. Livello 5: Oscurità\.$/)
    expect(testo(p, 'elf/high-elf/elf-high-elf')).toMatch(/prestidigitazione/)
    expect(testo(p, 'elf/high-elf/elf-high-elf')).toMatch(/Livello 5: Passo velato\.$/)
    expect(testo(p, 'elf/wood-elf/elf-wood-elf')).toMatch(/10,5 metri/)
    expect(testo(p, 'tiefling/abyssal/tiefling-abyssal')).toMatch(/danni da veleno/)
    expect(testo(p, 'tiefling/chthonic/tiefling-chthonic')).toMatch(/danni necrotici/)
    expect(testo(p, 'tiefling/infernal/tiefling-infernal')).toMatch(/danni da fuoco/)
  })

  it('2024: i privilegi di background sono i talenti che i background concedono', () => {
    const bg = Object.fromEntries(privilegiBg(pack['2024']))
    expect(bg['criminal/alert']).toMatch(/iniziativa/i)
    expect(bg['soldier/savage-attacker']).toMatch(/due volte per i danni/)
    expect(bg['acolyte/magic-initiate-cleric']).toMatch(/due trucchetti/i)
    expect(bg['sage/magic-initiate-wizard']).toMatch(/Incantesimo di 1º livello/)
  })

  it('due tratti diversi non condividono mai lo stesso testo', () => {
    // È il controllo che scopre il disallineamento all'ingrosso: se
    // l'estrazione perdesse un'intestazione, due tratti finirebbero con lo
    // stesso paragrafo. Lo stesso id in razze diverse può ripetersi — nel 2024
    // `darkvision-60` è la stessa frase per quattro specie.
    for (const ed of /** @type {const} */ (['2014', '2024'])) {
      /** @type {Map<string, Set<string>>} */
      const perTesto = new Map()
      for (const [k, d] of tratti(pack[ed])) {
        if (d === null) continue
        const id = k.split('/').pop() ?? ''
        if (!perTesto.has(d)) perTesto.set(d, new Set())
        perTesto.get(d)?.add(id)
      }
      const collisioni = [...perTesto.values()].filter(s => s.size > 1).map(s => [...s])
      expect(collisioni, `${ed}: tratti diversi con lo stesso testo`).toEqual([])
    }
  })
})

describe('igiene del testo estratto', () => {
  /** @returns {Array<[string, string]>} tutte le descrizioni non vuote delle due edizioni */
  const tutte = () => /** @type {const} */ (['2014', '2024']).flatMap(ed =>
    [...tratti(pack[ed]), ...privilegiBg(pack[ed])]
      .filter(/** @returns {v is [string, string]} */ v => v[1] !== null)
      .map(/** @returns {[string, string]} */ ([k, d]) => [`${ed}/${k}`, d]))

  it('nessun testo porta dentro l\'intestazione o il piè di pagina del PDF', () => {
    for (const [k, d] of tutte()) {
      expect(`${k}: ${/System[s]? Reference Document/i.test(d)}`).toBe(`${k}: false`)
      expect(`${k}: ${/Rivendita vietata|Not for resale|Permission granted/i.test(d)}`).toBe(`${k}: false`)
    }
  })

  it('nessun testo porta dentro un numero di pagina isolato', () => {
    for (const [k, d] of tutte()) {
      expect(`${k}: ${/[.!?…]\s\d{1,3}\s+[A-ZÀ-Ù]/.test(d)}`).toBe(`${k}: false`)
    }
  })

  it('nessun testo finisce a metà frase', () => {
    for (const [k, d] of tutte()) {
      expect(d.length, k).toBeGreaterThan(30)
      // Un blocco spezzato da una tabella o da un'intestazione mancata si
      // riconosce da qui: l'ultima riga di una colonna non chiude il periodo.
      expect(`${k}: ${d.slice(-1)}`).toMatch(/: [.:!?»")\]]$/)
    }
  })

  it('nessun testo comincia ripetendo il nome del tratto', () => {
    // Il nome sta già nell'intestazione della scheda: se ricomparisse qui
    // vorrebbe dire che l'estrazione non ha tolto il titolo del paragrafo.
    for (const ed of /** @type {const} */ (['2014', '2024'])) {
      for (const [rid, r] of Object.entries(pack[ed].races)) {
        const razza = /** @type {any} */ (r)
        /** @type {any[]} */
        const tutti = [...razza.traits, ...Object.values(razza.subraces).flatMap(
          /** @param {any} s */ s => s.traits)]
        for (const t of tutti) {
          if (!t.description) continue
          expect(`${ed}/${rid}/${t.id}: ${t.description.startsWith(t.name + '.')}`)
            .toBe(`${ed}/${rid}/${t.id}: false`)
        }
      }
    }
  })
})
