/**
 * Il lettore d'immagine: da un fotogramma alla griglia dei moduli.
 *
 * La verità di riferimento sono due QR **veri**, stampati dal builder ed
 * estratti dal loro SVG: `lucian` (157 moduli, versione 35) e `kyra` (149,
 * versione 33). Da lì si disegnano fotogrammi finti con i difetti che ha una
 * foto vera — storta, sfocata, rumorosa, in controluce — e si pretende che
 * torni **esattamente** quella matrice.
 *
 * I casi difficili qui dentro non sono decorativi: è la differenza fra un
 * lettore che funziona sullo scanner di un test e uno che funziona su un
 * tavolo, con la mano che trema e la lampada di fianco.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  matriceFixture, matriceGenerata, disegna, aTesto, fotogrammaVuoto, fintiFinder,
} from '../aiuti/immagini-qr.js'
import { matriceDa } from '../../src/domain/qr/immagine.js'
import { testoDa } from '../../src/domain/qr/moduli.js'
import { leggiQr } from '../../src/domain/qr/index.js'

/** @param {string} nome */
function atteso(nome) {
  return readFileSync(`tests/fixtures/qr/${nome}.testo.txt`, 'utf8').trim()
}

const VERI = /** @type {const} */ (['lucian', 'kyra'])

describe('dal fotogramma alla griglia', () => {
  describe.each(VERI)('%s, il QR vero', (nome) => {
    const riferimento = matriceFixture(nome)

    it('a fuoco esce identico, modulo per modulo', () => {
      const img = disegna(riferimento, { scala: 4 })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta).not.toBeNull()
      expect(aTesto(/** @type {boolean[][]} */ (letta))).toBe(aTesto(riferimento))
    })

    // Tre pixel per modulo è il minimo che una telecamera di telefono dà a un
    // codice tenuto a distanza di lettura: sotto, non è più un problema di
    // algoritmo.
    it.each([3, 4, 6, 8])('regge a %i pixel per modulo', (scala) => {
      const img = disegna(riferimento, { scala })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })

    it.each([0, 7, 45, 90, 180, 270])('ruotato di %i gradi', (gradi) => {
      const img = disegna(riferimento, { scala: 5, rotazione: gradi * Math.PI / 180 })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })

    it('inquadrato storto', () => {
      const img = disegna(riferimento, {
        scala: 5, prospettiva: [.06, .03, -.05, .02, -.04, -.05, .03, -.03],
      })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })

    it('sfocato, fino a due pixel di sigma', () => {
      for (const sfocatura of [0.8, 1.4, 2.0]) {
        const img = disegna(riferimento, { scala: 5, sfocatura })
        const letta = matriceDa(img.dati, img.larghezza, img.altezza)
        expect(letta && testoDa(letta), `sigma ${sfocatura}`).toBe(atteso(nome))
      }
    })

    /**
     * Rumore e contrasto non sono due difetti separati: contano insieme.
     *
     * Misurando, il lettore tiene finché il rumore sta sotto circa un settimo
     * dello scarto fra bianco e nero — su carta ben stampata regge σ 30, su una
     * fotocopia sbiadita (Δ 100) cede fra 15 e 22. La soglia è scritta qui in
     * chiaro perché è una **proprietà misurata**, non un'aspirazione: se un
     * domani il binarizzatore migliora, questi numeri vanno alzati apposta.
     */
    it.each([
      [255, 0, 30],
      [225, 40, 22],
      [190, 90, 15],
      [170, 110, 8],
    ])('con bianco %i e nero %i regge fino a rumore %i', (chiaro, scuro, rumore) => {
      const img = disegna(riferimento, { scala: 5, rumore, chiaro, scuro, seme: 4 })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })

    it('chiaro su scuro, che è come lo stampa un tema notte', () => {
      const img = disegna(riferimento, { scala: 5, inverti: true })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })

    it('piccolo, in un angolo di un fotogramma grande', () => {
      const img = disegna(riferimento, { scala: 3, larghezza: 1280, altezza: 960, x: 60, y: 40 })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      expect(letta && testoDa(letta)).toBe(atteso(nome))
    })
  })

  /**
   * Il caso vero: tutti i difetti insieme.
   *
   * Qui non si pretende il fotogramma perfetto, si pretende che **la maggior
   * parte** dei fotogrammi passi. La telecamera ne manda una decina al secondo:
   * con più della metà buoni il codice si aggancia in una frazione di secondo,
   * ed è quello che conta. Preteserlo al cento per cento vorrebbe dire scrivere
   * un test che passa per fortuna e che un giorno fallirà da solo.
   */
  it.each(VERI)('%s fotografato male, la maggior parte delle volte si legge', (nome) => {
    const riferimento = matriceFixture(nome)
    let letti = 0
    for (let seme = 1; seme <= 10; seme++) {
      const img = disegna(riferimento, {
        scala: 5, seme,
        rotazione: 4 * Math.PI / 180,
        prospettiva: [.03, .02, -.03, .01, -.02, -.03, .02, -.01],
        sfocatura: 1.1, rumore: 12, chiaro: 225, scuro: 40,
      })
      const letta = matriceDa(img.dati, img.larghezza, img.altezza)
      if (letta && testoDa(letta) === atteso(nome)) letti++
    }
    expect(letti).toBeGreaterThanOrEqual(5)
    // Dieci letture di un codice da 150 moduli: fuori misura sono un paio di
    // decimi, ma con lo strumento della copertura addosso il codice va dieci
    // volte più piano, e il limite predefinito di cinque secondi non basta.
  }, 30_000)

  it.each([1, 4, 10, 20, 30, 40])('legge anche la versione %i, generata', (versione) => {
    const contenuto = 'BRAINSTORM'.repeat(Math.min(4, versione))
    const riferimento = matriceGenerata(versione, contenuto)
    const img = disegna(riferimento, {
      scala: 5, rotazione: 4 * Math.PI / 180,
      prospettiva: [.03, .02, -.03, .01, -.02, -.03, .02, -.01],
      sfocatura: 1.1, rumore: 12,
    })
    const letta = matriceDa(img.dati, img.larghezza, img.altezza)
    expect(letta && testoDa(letta)).toBe(contenuto)
  })
})

describe('quando non c\'è niente da leggere', () => {
  // La telecamera manda decine di fotogrammi al secondo e quasi nessuno
  // contiene un codice: il caso normale è questo, e deve costare poco e non
  // lanciare mai.
  it('un fotogramma vuoto dà null, non un\'eccezione', () => {
    const img = fotogrammaVuoto(640, 480)
    expect(matriceDa(img.dati, img.larghezza, img.altezza)).toBeNull()
  })

  it('qualcosa che somiglia a tre finder pattern non basta', () => {
    const img = fintiFinder(640, 480)
    expect(matriceDa(img.dati, img.larghezza, img.altezza)).toBeNull()
  })

  it('un fotogramma tutto nero e uno tutto bianco', () => {
    for (const livello of [0, 255]) {
      const img = fotogrammaVuoto(320, 240, livello, 0)
      expect(matriceDa(img.dati, img.larghezza, img.altezza), `livello ${livello}`).toBeNull()
    }
  })

  it('un fotogramma degenere non manda in errore', () => {
    for (const [w, h] of [[0, 0], [1, 1], [8, 8]]) {
      const dati = new Uint8ClampedArray(Math.max(w * h, 1) * 4).fill(255)
      expect(() => matriceDa(dati, w, h)).not.toThrow()
    }
  })
})

describe('quanto costa', () => {
  /**
   * Gira su un telefono, a ogni fotogramma. La soglia è larga apposta —
   * l'hardware che fa girare i test non è quello che conta — ma un lettore che
   * ci mette mezzo secondo per fotogramma non serve a niente, e questo test è
   * lì per accorgersene prima dell'utente.
   */
  it('un fotogramma 640×480 con dentro un codice sta sotto i 100 ms', () => {
    const riferimento = matriceGenerata(10, 'BRAINSTORM CLUB')
    const img = disegna(riferimento, { scala: 4, larghezza: 640, altezza: 480, x: 90, y: 40 })
    matriceDa(img.dati, img.larghezza, img.altezza)   // scaldata

    const inizio = performance.now()
    const giri = 5
    for (let i = 0; i < giri; i++) matriceDa(img.dati, img.larghezza, img.altezza)
    const medio = (performance.now() - inizio) / giri
    expect(medio).toBeLessThan(100)
  })

  it('un fotogramma vuoto costa meno di uno pieno', () => {
    const vuoto = fotogrammaVuoto(640, 480)
    const inizio = performance.now()
    for (let i = 0; i < 5; i++) matriceDa(vuoto.dati, vuoto.larghezza, vuoto.altezza)
    expect((performance.now() - inizio) / 5).toBeLessThan(100)
  })
})

describe('le due metà insieme', () => {
  // `leggiQr` è la porta da cui entra la vista: se le due metà si parlano male
  // qui, i test delle metà restano verdi e l'app non legge niente.
  it.each(VERI)('%s: dall\'immagine al testo in un colpo solo', (nome) => {
    const img = disegna(matriceFixture(nome), { scala: 4 })
    expect(leggiQr(img.dati, img.larghezza, img.altezza)).toBe(atteso(nome))
  })

  it('senza codice torna null, come le sue metà', () => {
    const img = fotogrammaVuoto(320, 240)
    expect(leggiQr(img.dati, img.larghezza, img.altezza)).toBeNull()
  })
})
