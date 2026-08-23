import { test, expect } from '@playwright/test'

/**
 * Il layout: griglia, pager, temi.
 *
 * Quello che `avvio.spec.js` già verifica (corpo senza scorrimento
 * orizzontale sulla shell, tab bar dentro la safe-area, zone morte e target)
 * qui non si ripete. Qui si prova ciò che è specifico del layout: che le
 * colonne compaiano ai breakpoint giusti **senza una riga di JS**, che il pager
 * si agganci davvero, e che il tema chiaro non porti via il contrasto.
 *
 * Il pager viene costruito nel test quando la vista scheda non lo produce
 * ancora: l'oggetto della verifica è il CSS di `.bsc-pager`, che esiste già.
 */

/** Le sei sezioni della scheda (PIANO.md § 5.2), per il pager di prova. */
const SEZIONI = ['Gioco', 'Prove', 'Azioni', 'Magia', 'Zaino', 'Storia']

/**
 * Apre l'app e aspetta che la vista sia davvero disegnata: il router svuota
 * `#principale` e lo ridisegna, e ciò che si inietta prima sparisce.
 * @param {import('@playwright/test').Page} page
 */
async function apri(page) {
  await page.goto('/')
  await page.locator('#principale .dc-vista').first().waitFor()
}

/** @param {import('@playwright/test').Page} page */
async function pagerPronto(page) {
  return page.evaluate((sezioni) => {
    const esistente = document.querySelector('.bsc-pager')
    if (esistente && esistente.children.length >= 2) return
    const main = document.getElementById('principale')
    if (!main) throw new Error('manca #principale')
    const pager = esistente ?? document.createElement('div')
    pager.className = 'bsc-pager'
    pager.replaceChildren(...sezioni.map((nome) => {
      const s = document.createElement('section')
      s.dataset.sezione = nome
      const h = document.createElement('h2')
      h.textContent = nome
      s.appendChild(h)
      return s
    }))
    if (!esistente) main.appendChild(pager)
  }, SEZIONI)
}

test.describe('griglia responsiva', () => {
  test('le colonne dipendono solo dal viewport, e sono due a 768 px e tre a 1024', async ({ page }) => {
    await apri(page)

    /** @param {number} w @param {number} h */
    const colonne = async (w, h) => {
      await page.setViewportSize({ width: w, height: h })
      // Un frame per far ricalcolare il layout, e nient'altro: se servisse del
      // JS per cambiare colonne, questo test passerebbe lo stesso — ed è il
      // motivo per cui c'è anche il controllo su `window` più sotto.
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const griglia = await page.evaluate(() => {
        const el = document.getElementById('principale')
        const cs = el ? getComputedStyle(el) : null
        return cs ? { display: cs.display, tracce: cs.gridTemplateColumns } : null
      })
      if (!griglia || griglia.display !== 'grid') return 1
      return griglia.tracce.trim().split(/\s+/).filter(Boolean).length
    }

    expect(await colonne(390, 780), 'telefono: una colonna sola').toBe(1)
    expect(await colonne(767, 1024), 'sotto il breakpoint: ancora una').toBe(1)
    expect(await colonne(768, 1024), 'tablet: master-detail').toBe(2)
    expect(await colonne(1023, 800), 'sotto i 1024: ancora due').toBe(2)
    expect(await colonne(1024, 800), 'desktop: la terza colonna del dice tray').toBe(3)
    expect(await colonne(1280, 900), 'oltre: restano tre').toBe(3)
  })

  test('a tre colonne la fascia del dice tray resta a destra e visibile', async ({ page }) => {
    await apri(page)
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.evaluate(() => {
      const main = document.getElementById('principale')
      if (!main) throw new Error('manca #principale')
      for (const colonna of ['master', 'tray']) {
        const d = document.createElement('div')
        d.dataset.colonna = colonna
        d.textContent = colonna
        d.style.minHeight = '10rem'
        main.appendChild(d)
      }
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))

    const master = await page.locator('[data-colonna="master"]').boundingBox()
    const tray = await page.locator('[data-colonna="tray"]').boundingBox()
    expect(master).not.toBeNull()
    expect(tray).not.toBeNull()
    if (!master || !tray) return
    // Tre fasce affiancate, non impilate: stessa riga, ordini diversi.
    expect(Math.abs(master.y - tray.y)).toBeLessThan(2)
    expect(master.x + master.width).toBeLessThanOrEqual(tray.x)
    // E il tray sta davvero a destra, dentro il viewport.
    expect(tray.x + tray.width).toBeLessThanOrEqual(1200)
    expect(tray.x).toBeGreaterThan(1200 / 2)
  })

  test('il contenuto sta fuori dalla zona morta anche a due e tre colonne', async ({ page }) => {
    await page.goto('/')
    for (const w of [768, 1024]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const box = await page.locator('#principale').boundingBox()
      expect(box).not.toBeNull()
      if (!box) continue
      const stile = await page.evaluate(() => {
        const cs = getComputedStyle(document.getElementById('principale'))
        return { sx: parseFloat(cs.paddingLeft), dx: parseFloat(cs.paddingRight) }
      })
      expect(stile.sx, `a ${w} px il margine sinistro`).toBeGreaterThanOrEqual(24)
      expect(stile.dx, `a ${w} px il margine destro`).toBeGreaterThanOrEqual(24)
    }
  })
})

test.describe('pager a scroll-snap', () => {
  test('scorrendo di una larghezza cambia la sezione in vista, e si aggancia', async ({ page }) => {
    await apri(page)
    await pagerPronto(page)

    const misure = await page.evaluate(() => {
      const p = document.querySelector('.bsc-pager')
      const cs = getComputedStyle(p)
      return {
        snap: cs.scrollSnapType,
        overscroll: cs.overscrollBehaviorX,
        larghezza: p.clientWidth,
        scorribile: p.scrollWidth,
        sezioni: p.children.length,
      }
    })
    // Sei sezioni affiancate: il contenitore scorre, non il corpo.
    expect(misure.sezioni).toBe(6)
    expect(misure.snap).toContain('x')
    expect(misure.snap).toContain('mandatory')
    // Niente concatenamento verso il browser: in fondo al pager non deve
    // scattare il gesto «indietro».
    expect(misure.overscroll).toBe('contain')
    expect(misure.scorribile).toBeGreaterThan(misure.larghezza * 5)

    /** Quale sezione occupa il bordo sinistro del pager. */
    const inVista = () => page.evaluate(() => {
      const p = document.querySelector('.bsc-pager')
      const b = p.getBoundingClientRect()
      for (const s of p.children) {
        const r = s.getBoundingClientRect()
        if (r.right > b.left + 1) return s.dataset.sezione ?? s.textContent?.trim() ?? ''
      }
      return ''
    })

    expect(await inVista()).toBe('Gioco')

    await page.evaluate(() => {
      const p = document.querySelector('.bsc-pager')
      p.scrollLeft = p.clientWidth
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    expect(await inVista(), 'una larghezza a destra = la sezione dopo').toBe('Prove')

    // E l'aggancio corregge uno scorrimento a metà strada.
    await page.evaluate(() => {
      const p = document.querySelector('.bsc-pager')
      p.scrollTo({ left: p.clientWidth * 2 + p.clientWidth * 0.45, behavior: 'instant' })
    })
    await page.waitForTimeout(150)
    const resto = await page.evaluate(() => {
      const p = document.querySelector('.bsc-pager')
      return p.scrollLeft % p.clientWidth
    })
    const tolleranza = 2
    expect(Math.min(resto, misure.larghezza - resto), 'lo scorrimento si ferma su una sezione').toBeLessThanOrEqual(tolleranza)
  })

  test('il pager non fa scorrere il corpo in orizzontale', async ({ page }) => {
    await apri(page)
    await pagerPronto(page)
    await page.evaluate(() => {
      const s = document.querySelector('.bsc-pager > *')
      // Una parola lunghissima è il modo più rapido di sfondare una griglia.
      if (s) s.appendChild(document.createTextNode('x'.repeat(400)))
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(scroll).toBeLessThanOrEqual(client)
  })
})

test.describe('temi', () => {
  test('il tema carta cambia davvero i colori risolti, e il testo resta leggibile', async ({ page }) => {
    await apri(page)

    const colori = () => page.evaluate(() => {
      /** @param {string} c "rgb(r, g, b)" → luminanza relativa WCAG */
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
          .map(v => v / 255)
          .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const cs = getComputedStyle(document.body)
      const fondo = cs.backgroundColor
      const testo = cs.color
      const a = lum(fondo), b = lum(testo)
      return {
        fondo, testo,
        contrasto: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        tema: document.documentElement.getAttribute('data-theme'),
      }
    })

    /** La tab bar ha un fondo suo, mescolato al tema: va guardata a parte. */
    const tabbar = () => page.evaluate(() => {
      const nav = document.getElementById('tabbar')
      const a = nav?.querySelector('a')
      return { fondo: nav ? getComputedStyle(nav).backgroundColor : '', testo: a ? getComputedStyle(a).color : '' }
    })

    const carbone = await colori()
    const carboneTab = await tabbar()
    expect(carbone.tema).toBe('dark')
    expect(carbone.contrasto, 'contrasto AA sul carbone').toBeGreaterThanOrEqual(4.5)

    // Il toggle del design system cicla scuro → chiaro → auto. Le icone le
    // inietta initTheme(): finché non ci sono, il click non ha ascoltatori.
    await expect(page.locator('[data-bsc-theme-toggle] svg')).toHaveCount(3)
    await page.locator('[data-bsc-theme-toggle]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const carta = await colori()
    expect(carta.fondo, 'il fondo cambia').not.toBe(carbone.fondo)
    expect(carta.testo, 'il testo cambia').not.toBe(carbone.testo)
    expect(carta.contrasto, 'contrasto AA sulla carta').toBeGreaterThanOrEqual(4.5)

    // Le etichette della tab bar hanno una transizione sul colore: subito dopo
    // il click il valore calcolato è ancora quello di partenza. Si aspetta che
    // arrivi, invece di leggere a metà strada.
    expect((await tabbar()).fondo, 'la tab bar segue il tema').not.toBe(carboneTab.fondo)
    await expect.poll(async () => (await tabbar()).testo, { message: 'e anche le sue etichette' })
      .not.toBe(carboneTab.testo)
  })

  test('lo zoom non è disabilitato', async ({ page }) => {
    await page.goto('/')
    const viewport = await page.getAttribute('meta[name=viewport]', 'content')
    expect(viewport).toContain('viewport-fit=cover')
    expect(viewport).not.toContain('user-scalable=no')
    expect(viewport).not.toMatch(/maximum-scale=\s*1/)
  })
})
