import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

/**
 * Inquadrare il QR.
 *
 * Due cose si provano qui, e sono di natura diversa. La prima è che ogni modo
 * di fallire abbia la **sua** frase: un permesso negato e un telefono senza
 * telecamera non si risolvono allo stesso modo, e dirli con la stessa frase
 * significa non dirli. La seconda è che la telecamera **si spenga**, comunque
 * si esca — una spia che resta accesa è il difetto peggiore di questa vista, e
 * l'unico che non si vede guardando lo schermo. Per questo le tracce del flusso
 * si guardano da dentro la pagina: `ended` o `live` è l'unica prova.
 *
 * La telecamera è quella finta di Chromium: `--use-fake-device-for-media-stream`
 * per il flusso, `--use-fake-ui-for-media-stream` perché senza, l'headless
 * shell rifiuta con `NotSupportedError` invece di chiedere. `getUserMedia` è
 * quella vera, il flusso è vero. Dove invece serve *negare* qualcosa, la si
 * sostituisce: è l'unico modo di provare cinque errori distinti.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
})

/** Il link che il builder ha stampato dentro il QR di Kyra (gnoma ranger 6, 2024). */
const QR_DI_KYRA = readFileSync('tests/fixtures/qr/kyra.testo.txt', 'utf8').trim()

/** La stessa Kyra, ma come griglia di moduli: serve a disegnarne uno vero. */
const GRIGLIA_DI_KYRA = readFileSync('tests/fixtures/qr/kyra.matrice.txt', 'utf8')
  .trim().split('\n')

/** Fa fallire `getUserMedia` col nome d'errore che darebbe il browser. */
async function telecameraChe(page, nomeErrore) {
  await page.addInitScript((nome) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const e = new Error(nome)
          e.name = nome
          throw e
        },
      },
    })
  }, nomeErrore)
}

/** Il rilevatore del sistema operativo, e cosa ci trova dentro. */
async function ilCodiceContiene(page, valore) {
  await page.addInitScript((v) => {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code'] }
      async detect() { return [{ rawValue: v }] }
    }
  }, valore)
}

/** Nessun rilevatore di sistema: si passa dal lettore nostro. */
async function senzaRilevatoreDiSistema(page) {
  await page.addInitScript(() => { delete window.BarcodeDetector })
}

/** Tiene d'occhio le tracce del flusso, per sapere poi se sono state fermate. */
async function spiaLeTracce(page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices
    const vero = md.getUserMedia.bind(md)
    window.__tracce = []
    md.getUserMedia = async (v) => {
      const s = await vero(v)
      window.__tracce.push(...s.getTracks())
      return s
    }
  })
}

const statoLocator = (page) => page.locator('.dc-qr__stato')
const riprovaLocator = (page) => page.locator('#principale button', { hasText: /^riprova$/i })

/** Aspetta che la telecamera sia davvero accesa. */
async function accesa(page) {
  await expect(statoLocator(page)).toContainText(/telecamera accesa/i, { timeout: 15_000 })
}

/** @returns {Promise<string[]>} lo stato delle tracce viste finora */
const statoTracce = (page) => page.evaluate(() => (window.__tracce ?? []).map(t => t.readyState))

test.describe('i modi di non poter inquadrare', () => {
  test('il permesso negato dice anche dove si ridà', async ({ page }) => {
    await telecameraChe(page, 'NotAllowedError')
    await page.goto('/#/inquadra')

    const stato = statoLocator(page)
    await expect(stato).toContainText(/permesso/i)
    await expect(stato).toContainText(/impostazioni del browser/i)
    // riprovare qui può cambiare qualcosa: il bottone c'è
    await expect(riprovaLocator(page)).toBeVisible()
  })

  test('senza telecamera si indicano le altre vie d\'ingresso', async ({ page }) => {
    await telecameraChe(page, 'NotFoundError')
    await page.goto('/#/inquadra')

    const stato = statoLocator(page)
    await expect(stato).toContainText(/non trovo nessuna telecamera/i)
    await expect(stato).toContainText(/link di condivisione/i)
    // e qui riprovare non può cambiare niente: il bottone non c'è
    await expect(riprovaLocator(page)).toBeHidden()
  })

  test('la telecamera occupata da un\'altra app lo dice', async ({ page }) => {
    await telecameraChe(page, 'NotReadableError')
    await page.goto('/#/inquadra')
    await expect(statoLocator(page)).toContainText(/già in uso/i)
    await expect(riprovaLocator(page)).toBeVisible()
  })

  test('fuori da una connessione sicura si nomina https, non un errore', async ({ page }) => {
    // Senza contesto sicuro `getUserMedia` non esiste proprio: non è un
    // permesso negato, e il rimedio è l'indirizzo da cui si è aperta l'app.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    })
    await page.goto('/#/inquadra')

    await expect(statoLocator(page)).toContainText(/https/)
    await expect(riprovaLocator(page)).toBeHidden()
  })
})

test.describe('quello che si inquadra', () => {
  test('il QR del builder diventa un personaggio in libreria', async ({ page }) => {
    await ilCodiceContiene(page, QR_DI_KYRA)
    await page.goto('/#/inquadra')

    await expect(page).toHaveURL(/#\/libreria$/, { timeout: 15_000 })
    await expect(page.locator('#principale')).toContainText('Kyra')
    // l'esito arriva dalla libreria, come per le altre tre vie d'ingresso
    await expect(page.locator('#principale [role="status"]')).toContainText(/Kyra/)
    await expect(page.locator('.bsc-toast')).toContainText(/Kyra/)

    // e il personaggio è quello vero, non un guscio col nome giusto
    await page.locator('#principale .dc-pg__testa').first().click()
    await expect(page).toHaveURL(/#\/scheda\/[^/]+/)
  })

  test('un QR qualunque non è un personaggio, e lo si dice', async ({ page }) => {
    const errori = []
    page.on('pageerror', e => errori.push(String(e)))

    await ilCodiceContiene(page, 'https://esempio.test/una-pagina-qualunque')
    await page.goto('/#/inquadra')

    const stato = statoLocator(page)
    await expect(stato).toContainText(/non è un personaggio/i, { timeout: 15_000 })
    await expect(page).toHaveURL(/#\/inquadra$/)
    await expect(riprovaLocator(page)).toBeVisible()
    expect(errori).toEqual([])
    // letto vuol dire letto: la telecamera si spegne prima dell'import, non dopo
    await expect.poll(() => statoTracce(page)).not.toContain('live')
  })

  test('se non si legge niente, dopo un po\' lo dice invece di girare in silenzio', async ({ page }) => {
    await spiaLeTracce(page)
    await senzaRilevatoreDiSistema(page)
    await page.goto('/#/inquadra')
    await accesa(page)

    // il suggerimento arriva da sé, senza che nessuno tocchi niente
    await expect(statoLocator(page)).toContainText(/avvicina il telefono/i, { timeout: 25_000 })
    // e nel frattempo la telecamera è ancora accesa: non si è arresa da sola
    expect(await statoTracce(page)).toContain('live')
  })
})

/**
 * La strada senza `BarcodeDetector` — Safari, cioè metà dei telefoni: il
 * fotogramma passa dal canvas al lettore nostro.
 *
 * La prima cosa che fa è chiedere al lettore di leggere la griglia di Kyra
 * disegnata su un canvas: è il contratto fra questa vista e `domain/qr`, e se
 * si rompe conviene saperlo qui, con un messaggio che dice quale metà è caduta,
 * invece che quindici secondi dopo con «non riesco a leggere il codice».
 */
test('il lettore nostro legge il QR dalla telecamera, senza rilevatore di sistema', async ({ page }) => {
  await senzaRilevatoreDiSistema(page)
  await page.addInitScript((griglia) => {
    /** Disegna la griglia su un canvas, con la sua zona di quiete. */
    const disegna = (scala) => {
      const bordo = 4
      const n = griglia.length
      const c = document.createElement('canvas')
      c.width = c.height = (n + bordo * 2) * scala
      const g = c.getContext('2d')
      g.fillStyle = 'white'
      g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = 'black'
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (griglia[y][x] === '#') g.fillRect((x + bordo) * scala, (y + bordo) * scala, scala, scala)
        }
      }
      return c
    }
    window.__disegnaQr = disegna

    // Una telecamera che inquadra il foglio: un canvas che si ridisegna, così
    // il flusso produce fotogrammi veri e il video arriva a `readyState` 2.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const c = disegna(3)
          const flusso = c.captureStream(10)
          const g = c.getContext('2d')
          const ridisegna = () => {
            g.drawImage(c, 0, 0)
            if (flusso.getTracks().some(t => t.readyState === 'live')) requestAnimationFrame(ridisegna)
          }
          requestAnimationFrame(ridisegna)
          window.__tracce = (window.__tracce ?? []).concat(flusso.getTracks())
          return flusso
        },
      },
    })
  }, GRIGLIA_DI_KYRA)

  await page.goto('/#/libreria')
  const decodifica = await page.evaluate(async () => {
    const { leggiQr } = await import('/src/domain/qr/index.js')
    const c = window.__disegnaQr(3)
    const g = c.getContext('2d')
    const img = g.getImageData(0, 0, c.width, c.height)
    return leggiQr(img.data, c.width, c.height)
  })
  expect(decodifica, 'domain/qr non decodifica la griglia di Kyra').toContain('/share/')

  await page.goto('/#/inquadra')
  await expect(page).toHaveURL(/#\/libreria$/, { timeout: 20_000 })
  await expect(page.locator('#principale')).toContainText('Kyra')
  await expect.poll(() => statoTracce(page)).not.toContain('live')
})

test.describe('la telecamera si spegne', () => {
  test('chiudendo', async ({ page }) => {
    await spiaLeTracce(page)
    await senzaRilevatoreDiSistema(page)
    await page.goto('/#/inquadra')
    await accesa(page)
    expect(await statoTracce(page)).toContain('live')

    await page.locator('#principale button', { hasText: /^chiudi$/i }).click()

    await expect(page).toHaveURL(/#\/libreria$/)
    await expect.poll(() => statoTracce(page)).toEqual(['ended'])
  })

  test('col tasto Esc', async ({ page }) => {
    await spiaLeTracce(page)
    await senzaRilevatoreDiSistema(page)
    await page.goto('/#/inquadra')
    await accesa(page)

    await page.keyboard.press('Escape')

    await expect(page).toHaveURL(/#\/libreria$/)
    await expect.poll(() => statoTracce(page)).toEqual(['ended'])
  })

  test('cambiando rotta senza ricaricare la pagina', async ({ page }) => {
    await spiaLeTracce(page)
    await senzaRilevatoreDiSistema(page)
    await page.goto('/#/inquadra')
    await accesa(page)

    await page.locator('#tabbar a', { hasText: /dadi/i }).click()

    await expect(page).toHaveURL(/#\/dadi$/)
    await expect.poll(() => statoTracce(page)).toEqual(['ended'])
  })

  test('quando la pagina passa in secondo piano', async ({ page }) => {
    await spiaLeTracce(page)
    await senzaRilevatoreDiSistema(page)
    await page.goto('/#/inquadra')
    await accesa(page)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await expect.poll(() => statoTracce(page)).toEqual(['ended'])
    // e si riprende con un tocco, non alle spalle di chi è andato altrove
    await expect(statoLocator(page)).toContainText(/secondo piano/i)
    await expect(page.locator('#principale button', { hasText: /^riprendi$/i })).toBeVisible()
  })
})

test('si arriva dalla libreria, e ciò che c\'è si può usare', async ({ page }) => {
  await telecameraChe(page, 'NotFoundError')   // la telecamera qui non serve
  await page.goto('/#/libreria')

  await page.locator('#principale a', { hasText: /inquadra il qr/i }).click()
  await expect(page).toHaveURL(/#\/inquadra$/)
  // prima che i bottoni si contino, la vista deve aver finito di decidere
  // quali esistono: «riprova» compare o sparisce a seconda dell'errore.
  await expect(statoLocator(page)).toContainText(/non trovo nessuna telecamera/i)

  for (const b of await page.locator('#principale button:visible, #principale a:visible').all()) {
    const box = await b.boundingBox()
    const che = await b.textContent()
    expect(box.height, che).toBeGreaterThanOrEqual(44)
    expect(box.width, che).toBeGreaterThanOrEqual(44)
  }

  // il video non è informazione per chi non vede; l'esito sì, e va annunciato
  await expect(page.locator('.dc-qr__video')).toHaveAttribute('aria-hidden', 'true')
  await expect(statoLocator(page)).toHaveAttribute('aria-live', 'polite')

  // e si esce da tastiera, senza toccare niente
  await page.keyboard.press('Tab')
  await expect(page.locator('#principale button', { hasText: /^chiudi$/i })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/libreria$/)
})

/**
 * La rotta nuova passa lo stesso controllo delle altre. Sta qui e non nel giro
 * di `accessibilita.spec.js` perché con la telecamera vera il video è nero e
 * axe non ha niente da dire su un `<video aria-hidden>`: quello che conta è che
 * il resto della pagina — titolo, istruzioni, regione annunciata, bottoni —
 * regga anche quando la vista è in errore, che è come la vedrà chi ci capita
 * senza telecamera.
 */
test('non ha violazioni WCAG che una macchina sappia vedere', async ({ page }) => {
  await telecameraChe(page, 'NotFoundError')
  await page.goto('/#/inquadra')
  await expect(statoLocator(page)).toContainText(/non trovo nessuna telecamera/i)

  const esito = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.bsc-wordmark')   // logotipo: la 1.4.3 lo esenta (vedi accessibilita.spec.js)
    .analyze()
  expect(esito.violations.map(v => ({ regola: v.id, dove: v.nodes.map(n => n.target.join(' ')) }))).toEqual([])
})
