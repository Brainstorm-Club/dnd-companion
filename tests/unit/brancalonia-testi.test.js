/**
 * I testi di Brancalonia: quanti ce ne sono, e che siano quelli giusti.
 *
 * Il testo lo estrae `scripts/build-varianti.mjs` dai tre manuali di Acheron
 * Games — che non stanno nel repo — impaginati su due colonne, con i nomi, le
 * schede e i corpi in blocchi separati. Il modo vero in cui quell'estrazione
 * fallisce non è restare senza testo: è **attribuire a una voce il testo di
 * quella accanto**, che nessuno si accorge di avere finché non gli fa perdere
 * una sessione.
 *
 * Da cui le tre reti qui sotto:
 *
 * 1. **la copertura**, fissata al numero raggiunto: una rigenerazione che perde
 *    pezzi si vede subito invece di passare inosservata;
 * 2. **i controlli puntuali**, scelti apposta sulle voci che nel manuale stanno
 *    appaiate e che uno scambio confonderebbe — le due sottorazze di arcimboldo
 *    con lo stesso nome di tratto, i due incantesimi stampati sulla stessa
 *    pagina a due colonne, i due background con lo stesso privilegio;
 * 3. **l'igiene**, che nel testo non ci sia niente del PDF: la filigrana con il
 *    numero d'ordine di chi ha comprato il manuale, le intestazioni correnti, i
 *    numeri di pagina, le frasi tagliate a metà.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const regole = JSON.parse(readFileSync('data/rules/brancalonia.json', 'utf8'))
const blocchi = readdirSync('data/spells/brancalonia')
  .filter(f => /^l\d\.json$/.test(f))
  .map(f => JSON.parse(readFileSync(`data/spells/brancalonia/${f}`, 'utf8')))
const incantesimi = blocchi.flat()

/** @param {string} classe @param {string} sottoclasse @param {string} nome */
function privilegio(classe, sottoclasse, nome) {
  const c = regole.classes[classe]
  const dove = sottoclasse ? c.subclasses[sottoclasse] : c
  return dove.features.find((/** @type {any} */ f) => f.name === nome)
}

/** @param {string} razza @param {string|null} sottorazza @param {string} nome */
function tratto(razza, sottorazza, nome) {
  const r = regole.races[razza]
  const dove = sottorazza ? r.subraces[sottorazza] : r
  return dove.traits.find((/** @type {any} */ t) => t.name === nome)
}

/** @param {string} nome */
const incantesimo = nome => incantesimi.find((/** @type {any} */ s) => s.nome === nome)

/** Ogni descrizione del pacchetto, con il percorso da cui viene. */
function tutte() {
  /** @type {Array<{dove: string, testo: string}>} */
  const out = []
  for (const [ci, c] of Object.entries(regole.classes)) {
    for (const f of /** @type {any} */ (c).features ?? []) out.push({ dove: `${ci}/${f.id}`, testo: f.description })
    for (const [si, s] of Object.entries(/** @type {any} */ (c).subclasses ?? {})) {
      for (const f of /** @type {any} */ (s).features) out.push({ dove: `${ci}/${si}/${f.id}`, testo: f.description })
    }
  }
  for (const [ri, r] of Object.entries(regole.races)) {
    for (const t of /** @type {any} */ (r).traits) out.push({ dove: `${ri}/${t.id}`, testo: t.description })
    for (const [si, s] of Object.entries(/** @type {any} */ (r).subraces ?? {})) {
      for (const t of /** @type {any} */ (s).traits) out.push({ dove: `${ri}/${si}/${t.id}`, testo: t.description })
    }
  }
  for (const [bi, b] of Object.entries(regole.backgrounds)) {
    for (const f of /** @type {any} */ (b).features) out.push({ dove: `background/${bi}`, testo: f.description })
  }
  for (const [ti, t] of Object.entries(regole.talenti)) out.push({ dove: `talento/${ti}`, testo: /** @type {any} */ (t).description })
  for (const s of incantesimi) out.push({ dove: `incantesimo/${s.id}`, testo: s.testo })
  return out.filter(x => x.testo !== null && x.testo !== undefined)
}

describe('la copertura dei testi di Brancalonia', () => {
  /**
   * I numeri raggiunti dall'estrazione, non quelli sperati. Se una
   * rigenerazione ne fa salire uno, si alza qui: se ne fa scendere uno, c'è da
   * capire perché prima di alzare bandiera bianca. Quello che manca lo elenca
   * il rapporto di `node scripts/build-varianti.mjs`.
   */
  const ATTESI = {
    privilegiDiClasse: 6,
    privilegiDiSottoclasse: 59,
    tratti: 60,
    privilegiDiBackground: 18,
    talenti: 15,
    incantesimi: 14,
  }

  /** @param {readonly any[]} v @param {string} campo */
  const conTesto = (v, campo) => v.filter(x => x[campo]).length

  it('i privilegi di classe e di sottoclasse', () => {
    const classi = Object.values(regole.classes)
    const diClasse = classi.flatMap((/** @type {any} */ c) => c.features ?? [])
    const diSottoclasse = classi.flatMap((/** @type {any} */ c) =>
      Object.values(c.subclasses ?? {}).flatMap((/** @type {any} */ s) => s.features))
    expect(conTesto(diClasse, 'description')).toBe(ATTESI.privilegiDiClasse)
    expect(conTesto(diSottoclasse, 'description')).toBe(ATTESI.privilegiDiSottoclasse)
    // e il totale non deve calare di nascosto
    expect(diClasse.length + diSottoclasse.length).toBe(75)
  })

  it('i tratti di razza e di sottorazza', () => {
    const tratti = Object.values(regole.races).flatMap((/** @type {any} */ r) => [
      ...r.traits,
      ...Object.values(r.subraces ?? {}).flatMap((/** @type {any} */ s) => s.traits),
    ])
    expect(conTesto(tratti, 'description')).toBe(ATTESI.tratti)
    expect(tratti.length).toBe(63)
  })

  it('i background e i talenti', () => {
    const bg = Object.values(regole.backgrounds).flatMap((/** @type {any} */ b) => b.features)
    expect(conTesto(bg, 'description')).toBe(ATTESI.privilegiDiBackground)
    expect(conTesto(Object.values(regole.talenti), 'description')).toBe(ATTESI.talenti)
  })

  it('i quattordici incantesimi propri, tutti con il testo', () => {
    expect(incantesimi.length).toBe(ATTESI.incantesimi)
    expect(conTesto(incantesimi, 'testo')).toBe(ATTESI.incantesimi)
  })
})

describe('a ogni voce il testo suo', () => {
  it('le tre sottorazze di arcimboldo non si scambiano i trucchetti', () => {
    // Sul manuale i tre tratti si chiamano tutti «Influsso fandonico» e stanno
    // a tre pagine di distanza: se l'estrazione li cercasse per nome invece che
    // dentro la sezione della sottorazza, li prenderebbe tutti uguali.
    expect(tratto('arcimboldo', 'orcharder', 'Influsso Fandonico (Ortolano)').description)
      .toMatch(/artificio druidico e fiotto acido/)
    expect(tratto('arcimboldo', 'scrapper', 'Influsso Fandonico (Ferrivecchi)').description)
      .toMatch(/resistenza e riparare/)
    expect(tratto('arcimboldo', 'ragpicker', 'Influsso Fandonico (Robivecchi)').description)
      .toMatch(/amicizia e guida/)
  })

  it('e nemmeno il tipo di danno da cui sono protette', () => {
    expect(tratto('arcimboldo', 'orcharder', 'Resistenza Strutturale (Perforanti)').description)
      .toMatch(/danni perforanti/)
    expect(tratto('arcimboldo', 'scrapper', 'Resistenza Strutturale (Taglienti)').description)
      .toMatch(/danni taglienti/)
  })

  it('le fogge della marionetta tengono ciascuna il proprio tratto', () => {
    expect(tratto('marionette', 'pinocchio', 'Credulone').description).toMatch(/Intuizione/)
    expect(tratto('marionette', 'pupo', 'Armatura Innestata').description).toMatch(/scudo/)
    expect(tratto('marionette', null, 'Magico ma Sempre Legno').description).toMatch(/vulnerabilità ai danni da fuoco/)
  })

  it('i due Collegi bardici non si scambiano i privilegi', () => {
    // Arlecchino e Guappo hanno due privilegi con lo stesso nome, su due pagine
    // diverse del Macaronicon e del Manuale di Ambientazione.
    expect(privilegio('bard', 'harlequin', 'Competenze Bonus').description)
      .toMatch(/Collegio del Carnevale/)
    expect(privilegio('bard', 'harlequin', 'Batocchio').description)
      .toMatch(/ispirazione bardica/i)
    expect(privilegio('bard', 'guappo', 'Canzone Sottintesa').description)
      .toMatch(/spaventarlo/)
  })

  it('i due background della Forca hanno lo stesso privilegio ma non lo stesso testo', () => {
    const adepto = regole.backgrounds['fork-adept'].features[0].description
    const rinnegato = regole.backgrounds['fork-renegade'].features[0].description
    // Il privilegio si chiama «Talento della Forca» in tutti e due: il testo no.
    expect(adepto).toMatch(/^L'Adepto della Forca/)
    expect(rinnegato).toMatch(/^Il Rinnegato della Forca/)
    expect(adepto).not.toBe(rinnegato)
  })

  it('i due incantesimi stampati sulla stessa pagina restano distinti', () => {
    // Bollo di Qualità ed Emanazione Angelica stanno affiancati sulla stessa
    // pagina del Macaronicon, e `pdftotext` ne mette in fila prima i due nomi,
    // poi le due schede, poi i due testi: il nome non dice quale testo sia suo.
    expect(incantesimo('Bollo di Qualità').testo).toMatch(/perde la qualità scadente/)
    expect(incantesimo('Emanazione Angelica').testo).toMatch(/ali di luce/)
    // e lo stesso vale per Esorcismo e Bonificare, due pagine più in là
    expect(incantesimo('Esorcismo').testo).toMatch(/Padre Terno/)
    expect(incantesimo('Bonificare').testo).toMatch(/raggio massimo di 18 metri/)
  })

  it('un privilegio dice il livello a cui si prende', () => {
    // Non tutti lo dicono — i Cammini e i Domini sono presentazioni, non
    // regole — ma quando lo dicono dev'essere il proprio.
    const sospetti = []
    for (const [ci, c] of Object.entries(regole.classes)) {
      for (const [si, s] of Object.entries(/** @type {any} */ (c).subclasses ?? {})) {
        for (const f of /** @type {any} */ (s).features) {
          if (!f.description) continue
          const livelli = [...f.description.matchAll(/(\d)° livello/g)].map(m => Number(m[1]))
          if (livelli.length && !livelli.includes(f.level)) sospetti.push(`${ci}/${si}/${f.id} (L${f.level}, dice ${livelli})`)
        }
      }
    }
    // Tre privilegi parlano solo del livello di un altro privilegio che citano:
    // è il manuale a essere fatto così, non l'estrazione ad aver sbagliato.
    expect(sospetti.length).toBeLessThanOrEqual(3)
  })
})

describe('nel testo non c\'è niente del PDF', () => {
  /**
   * Le righe che il PDF fa colare dentro le descrizioni. La filigrana è la più
   * grave: porta il nome e il numero d'ordine di chi ha comprato il manuale, e
   * spedirla vorrebbe dire pubblicare un dato personale.
   */
  const MOBILIA = [
    { nome: 'filigrana della copia', re: /\(Order\s*#\d+\)|Francesco Fullone/ },
    { nome: 'intestazione corrente', re: /Canaglie di Brancalonia|Classi di Brancalonia|Razze di Brancalonia|Nuove Sottoclassi|Nuove Canaglie|Canaglie alla Guerra|Talenti Brancaloni|Nuovo Equipaggiamento|Nuovi Incantesimi|Nuovo Ordine Feudale/ },
    { nome: 'numero di pagina', re: /(^|\s)[-–]\s?\d{1,3}\s?[-–](\s|$)/ },
    { nome: 'citazione a effetto', re: /[-–]\s[A-ZÀ-Ù][^-–]{3,60}\s?[-–]$/ },
  ]

  it.each(MOBILIA)('nessuna descrizione porta $nome', ({ re }) => {
    const sporche = tutte().filter(x => re.test(x.testo)).map(x => x.dove)
    expect(sporche).toEqual([])
  })

  it('nessuna descrizione è tagliata a metà frase', () => {
    const monche = tutte()
      .filter(x => !/[.!?…»")]$/.test(x.testo))
      .map(x => `${x.dove} → …${x.testo.slice(-40)}`)
    expect(monche).toEqual([])
  })

  it('nessuna descrizione comincia a metà frase', () => {
    // Un testo che apre in minuscola è il segno che una colonna è stata letta
    // storta e il capoverso è cominciato da lì.
    const monche = tutte()
      .filter(x => !/^[A-ZÀ-Ù«"•]/.test(x.testo))
      .map(x => `${x.dove} → ${x.testo.slice(0, 40)}…`)
    expect(monche).toEqual([])
  })

  it('nessuna descrizione è un moncone di due parole', () => {
    // Il tratto più corto che il manuale abbia davvero è «Un arcimboldo è un
    // costrutto.», 28 caratteri: sotto i venti non c'è una regola, c'è un
    // pezzo di riga rimasto attaccato.
    const corte = tutte().filter(x => x.testo.length < 20).map(x => `${x.dove} → ${x.testo}`)
    expect(corte).toEqual([])
  })
})
