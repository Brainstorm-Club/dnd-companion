/**
 * I pacchetti delle varianti non spediscono testo di regole.
 *
 * Brancalonia e Apocalisse sono di Acheron Games: non sono SRD, non sono
 * CC-BY, e il permesso di ripubblicarne il testo non c'è. I pacchetti portano
 * quindi **nomi, id, numeri e parole chiave** — quanto basta a riconoscere un
 * personaggio e a fare i conti — e nient'altro.
 *
 * Questo file è la guardia di quel vincolo. Se un giorno il permesso arriva e
 * si rigenera con i testi, **questi test devono fallire**: pubblicare dev'essere
 * una decisione presa, non l'effetto collaterale di un comando rilanciato.
 *
 * Ci sono due reti, di proposito diverse:
 *
 * 1. i campi descrittivi noti, elencati a mano;
 * 2. un tetto sulla lunghezza di *qualunque* stringa, che è l'unica difesa
 *    contro la prosa che rientra sotto un nome di campo nuovo — cioè il modo in
 *    cui questo vincolo si romperà davvero, il giorno in cui il builder
 *    aggiunge un campo e nessuno se ne accorge qui.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

/** I nomi sotto cui il builder tiene la prosa. */
const CAMPI_DESCRITTIVI = [
  'description', 'descriptionEn', 'descrizione',
  'blurb', 'mechanicalEffect', 'benefit', 'benefits',
  'testo', 'text', 'effect', 'effetto', 'note', 'flavor',
  'speakers', 'summary', 'riassunto',
]

/**
 * Il tetto. Il nome più lungo che c'è oggi è «Incanalare Divinità: Recitare il
 * Calendario», 43 caratteri: 80 lascia respiro a un nome ancora più lungo e
 * taglia comunque qualunque frase di regole, che parte dai 120 in su.
 */
const TETTO = 80

/** Campi che possono superare il tetto perché non sono prosa di regole. */
const ESENTI = new Set(['attribuzione', 'licenza', 'generatedAt', 'sourceCommit', 'fonte'])

const PACCHETTI = ['brancalonia', 'apocalisse']

/**
 * Ogni stringa del documento, con la chiave sotto cui sta e il percorso.
 * @param {unknown} v
 * @param {string} chiave
 * @param {string} dove
 * @returns {Array<{chiave: string, dove: string, valore: string}>}
 */
function stringhe(v, chiave = '', dove = '') {
  if (typeof v === 'string') return [{ chiave, dove, valore: v }]
  if (Array.isArray(v)) return v.flatMap((x, i) => stringhe(x, chiave, `${dove}[${i}]`))
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => stringhe(x, k, dove ? `${dove}.${k}` : k))
  }
  return []
}

/**
 * Ogni valore che sta sotto uno dei campi descrittivi, quale che sia il tipo.
 * @param {unknown} v
 * @param {string} dove
 * @returns {Array<{dove: string, valore: unknown}>}
 */
function descrittivi(v, dove = '') {
  if (Array.isArray(v)) return v.flatMap((x, i) => descrittivi(x, `${dove}[${i}]`))
  if (!v || typeof v !== 'object') return []
  return Object.entries(v).flatMap(([k, x]) => {
    const qui = dove ? `${dove}.${k}` : k
    return CAMPI_DESCRITTIVI.includes(k)
      ? [{ dove: qui, valore: x }]
      : descrittivi(x, qui)
  })
}

/** Tutti i file JSON di un pacchetto di variante. @param {string} id */
function fileDi(id) {
  /** @type {Array<{nome: string, dato: unknown}>} */
  const out = []
  const regole = `data/rules/${id}.json`
  if (existsSync(regole)) out.push({ nome: regole, dato: JSON.parse(readFileSync(regole, 'utf8')) })
  const cartella = `data/spells/${id}`
  if (existsSync(cartella)) {
    for (const f of readdirSync(cartella).filter(f => f.endsWith('.json'))) {
      out.push({ nome: `${cartella}/${f}`, dato: JSON.parse(readFileSync(`${cartella}/${f}`, 'utf8')) })
    }
  }
  return out
}

describe.each(PACCHETTI)('il pacchetto %s', (id) => {
  const file = fileDi(id)

  it('esiste, e ha almeno le regole', () => {
    expect(file.length).toBeGreaterThan(0)
    expect(file.some(f => f.nome.startsWith('data/rules/'))).toBe(true)
  })

  it('non ha un solo campo descrittivo valorizzato', () => {
    /** @type {string[]} */
    const colpevoli = []
    for (const { nome, dato } of file) {
      for (const { dove, valore } of descrittivi(dato)) {
        // `null`, assente o stringa vuota vogliono dire la stessa cosa:
        // «non ho niente da dire». Qualunque altra cosa è testo spedito.
        if (valore !== null && valore !== '' && valore !== undefined) {
          colpevoli.push(`${nome} → ${dove} = ${JSON.stringify(valore).slice(0, 60)}`)
        }
      }
    }
    expect(colpevoli).toEqual([])
  })

  it('non ha nemmeno prosa sotto un nome di campo che non conosciamo', () => {
    /** @type {string[]} */
    const lunghe = []
    for (const { nome, dato } of file) {
      for (const { chiave, dove, valore } of stringhe(dato)) {
        if (ESENTI.has(chiave)) continue
        if (valore.length > TETTO) lunghe.push(`${nome} → ${dove} (${valore.length} caratteri)`)
      }
    }
    expect(lunghe).toEqual([])
  })

  it('dichiara da dove viene e su cosa poggia', () => {
    const regole = /** @type {any} */ (file[0]?.dato)
    expect(regole.variante).toBe(id)
    expect(regole.base).toBe('srd-2014')
    expect(regole.edizione).toBe('2014')
    // il commit del builder da cui è stato estratto: senza, un pacchetto
    // rigenerato non si distingue da uno vecchio
    expect(regole.sourceCommit).toMatch(/^[0-9a-f]{7,40}$/)
  })
})

describe('il registro', () => {
  const registro = JSON.parse(readFileSync('data/packs.json', 'utf8'))

  it.each(PACCHETTI)('%s dichiara di non essere materiale libero', (id) => {
    const pack = registro.packs.find((/** @type {any} */ p) => p.id === id)
    expect(pack).toBeDefined()
    expect(pack.licenza).not.toBe('CC-BY-4.0')
    expect(pack.attribuzione).toMatch(/Acheron Games/)
    expect(pack.attribuzione).toMatch(/non è materiale SRD/i)
  })
})
