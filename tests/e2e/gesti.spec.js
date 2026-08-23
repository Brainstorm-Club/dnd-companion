import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * I gesti, e le zone in cui non si può giocare (PIANO § 5.2.1).
 *
 * Quello che si prova qui è che **nessuna funzione dipende da un gesto**: il
 * vassoio dei dadi si apre trascinando la maniglia *e* toccandola, si chiude
 * con Esc, e da 1024 px non si apre affatto perché è già lì. Lo swipe fra le
 * sezioni non compare: non è codice nostro, è `scroll-snap`, e lo verifica
 * `layout.spec.js`.
 *
 * Il vassoio viene montato dal test finché `main.js` non lo monta da sé — la
 * riga è una sola e appartiene a un altro lotto. Quando ci sarà, questo
 * montaggio non farà niente: l'oggetto della verifica è il componente, che
 * esiste già.
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')

/** Il margine che il sistema operativo si è già prenotato sui due lati. */
const MORTA = 24

/**
 * Apre l'app e aspetta che la vista sia davvero disegnata: il router svuota
 * `#principale` e lo ridisegna.
 * @param {import('@playwright/test').Page} page
 */
async function apri(page, rotta = '/') {
  await page.goto(rotta)
  await page.locator('#principale .dc-vista').first().waitFor()
}

/**
 * Monta il vassoio se non c'è già. Usa gli stessi moduli della pagina — stesso
 * URL, stessa istanza — quindi legge lo storico vero, non una copia.
 * @param {import('@playwright/test').Page} page
 */
async function vassoio(page) {
  await page.addScriptTag({
    type: 'module',
    content: `
      import { mount } from '/src/components/dice-tray.js'
      import { getState } from '/src/store.js'
      import { t } from '/src/i18n.js'
      if (!document.querySelector('.dc-tray')) mount(document.body, { state: getState(), t })
    `,
  })
  await page.locator('.dc-tray').waitFor()
}

/** @param {import('@playwright/test').Page} page */
function aperto(page) {
  return page.getAttribute('.dc-tray', 'data-aperto')
}

test.describe('il vassoio dei dadi', () => {
  test('si apre trascinando la maniglia, e si chiude con Esc', async ({ page }) => {
    await apri(page, '/#/dadi')
    await vassoio(page)

    const presa = page.locator('.dc-tray__maniglia')
    const box = await presa.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    // La maniglia sta sopra la tab bar, lontana dalla barra di casa: fra la sua
    // base e il fondo dello schermo ci sono ben più dei 32 px chiesti dal piano.
    const vp = page.viewportSize()
    expect(vp).not.toBeNull()
    if (!vp) return
    expect(vp.height - (box.y + box.height), 'la presa non tocca la zona della barra home').toBeGreaterThanOrEqual(32)

    expect(await aperto(page)).toBe('no')

    const x = box.x + box.width / 2
    await page.mouse.move(x, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, box.y - 320, { steps: 12 })
    await page.mouse.up()

    expect(await aperto(page), 'trascinare su apre').toBe('si')
    expect(await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.querySelector('.dc-tray'))
      return el.style.getPropertyValue('--dc-apertura').trim()
    })).toBe('1')
    await expect(presa).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.dc-tray .bsc-die').first()).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await aperto(page), 'Esc chiude').toBe('no')
    await expect(page.locator('.dc-tray .bsc-die').first()).toBeHidden()
  })

  test('si apre anche solo toccandola, e da lì si tira', async ({ page }) => {
    await apri(page, '/#/libreria')
    await vassoio(page)

    // Nessun trascinamento: un tocco secco. È l'equivalente tappabile che WCAG
    // 2.5.7 pretende, e non un ripiego — è il modo normale di aprirlo.
    await page.locator('.dc-tray__maniglia').click()
    expect(await aperto(page)).toBe('si')

    const d20 = page.locator('.dc-tray .bsc-die[data-facce="20"]')
    await expect(d20).toBeVisible()
    await d20.click()

    // Il tiro finisce nell'unico storico, quello di `state.diceLog`: il vassoio
    // non ne tiene uno suo.
    await expect(page.locator('.dc-tray .dc-elenco li').first()).toContainText('1d20')
    await expect(page.locator('.bsc-toast')).toContainText(/\d/)
    await expect.poll(() => page.evaluate(
      () => JSON.parse(localStorage.getItem('dndc') || '{}').diceLog?.length ?? 0,
    )).toBe(1)

    // e lo stesso tiro si ritrova nella vista dadi: lo storico è uno solo
    await page.goto('/#/dadi')
    await expect(page.locator('#principale .dc-elenco li').first()).toContainText('1d20')
  })

  test('il tocco chiude quello che il tocco ha aperto', async ({ page }) => {
    await apri(page, '/#/dadi')
    await vassoio(page)
    const presa = page.locator('.dc-tray__maniglia')
    await presa.click()
    expect(await aperto(page)).toBe('si')
    await presa.click()
    expect(await aperto(page)).toBe('no')
    await expect(presa).toHaveAttribute('aria-expanded', 'false')
  })

  test('da chiuso non ruba i tocchi alla tab bar che gli sta sotto', async ({ page }) => {
    // Il riquadro del pannello chiuso passa sopra la barra da pollice: è spinto
    // giù, ma resta un riquadro. Se se ne prendesse i tocchi, la navigazione
    // smetterebbe di funzionare e nessun altro test se ne accorgerebbe.
    await apri(page, '/#/dadi')
    await vassoio(page)
    await page.locator('#tabbar a').last().click()
    await expect(page).toHaveURL(/#\/impostazioni$/)
  })

  test('a 1024 px non si apre: è già la terza colonna', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 })
    await apri(page, '/#/dadi')
    await vassoio(page)

    // Mai toccato, mai aperto — e comunque in vista.
    expect(await aperto(page)).toBe('no')
    await expect(page.locator('.dc-tray .bsc-die').first()).toBeVisible()
    // La maniglia non c'è: un comando che non fa niente è peggio di nessun comando.
    await expect(page.locator('.dc-tray__maniglia')).toBeHidden()

    const tray = await page.locator('.dc-tray').boundingBox()
    expect(tray).not.toBeNull()
    if (!tray) return
    expect(tray.x, 'sta nella fascia di destra').toBeGreaterThan(600)
    expect(tray.x + tray.width).toBeLessThanOrEqual(1200)

    // E il contenuto si ferma prima: la terza colonna è del vassoio, non ci
    // finisce sotto.
    const vista = await page.locator('#principale > *').first().boundingBox()
    expect(vista).not.toBeNull()
    if (!vista) return
    expect(vista.x + vista.width).toBeLessThanOrEqual(tray.x + 1)
  })
})

test.describe('le zone che il sistema si è prenotato', () => {
  /**
   * Ogni elemento interattivo **a schermo**, non solo quelli in `#principale`:
   * il vassoio e la tab bar vivono fuori di lì.
   *
   * Ciò che un contenitore di scorrimento ritaglia non è a schermo, e va
   * ignorato: le pagine del pager che non stai guardando stanno dentro il
   * pager, e i loro pulsanti sfiorano i bordi senza che nessuno possa
   * toccarli. Segnalarli sarebbe un falso allarme che costringe a spostare
   * cose che stanno benissimo dove sono.
   * @param {import('@playwright/test').Page} page
   */
  const violazioni = (page) => page.evaluate((MORTA) => {
    const TOL = 0.5
    const w = document.documentElement.clientWidth
    /** @param {Element} el @param {DOMRect} r */
    const ritagliato = (el, r) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p === document.body || p === document.documentElement) continue
        const cs = getComputedStyle(p)
        if (!/auto|scroll|hidden|clip/.test(`${cs.overflowX} ${cs.overflowY}`)) continue
        const pr = p.getBoundingClientRect()
        if (r.right <= pr.left + TOL || r.left >= pr.right - TOL) return true
        if (r.bottom <= pr.top + TOL || r.top >= pr.bottom - TOL) return true
      }
      return false
    }
    /** @type {string[]} */
    const out = []
    for (const el of document.querySelectorAll('button, a, input, select, summary, [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue
      // fuori dallo schermo di suo: lo «salta al contenuto» sta a −4 rem
      if (r.right <= 0 || r.left >= w || r.bottom <= 0) continue
      if (ritagliato(el, r)) continue
      const nome = `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`
      if (r.left < MORTA - TOL) out.push(`${nome} — ${Math.round(r.left)} px dal bordo sinistro`)
      if (r.right > w - MORTA + TOL) out.push(`${nome} — ${Math.round(w - r.right)} px dal bordo destro`)
    }
    return out
  }, MORTA)

  test('col vassoio aperto, niente entra nei 24 px dai bordi verticali', async ({ page }) => {
    await apri(page, '/#/dadi')
    await vassoio(page)
    expect(await violazioni(page), 'a vassoio chiuso').toEqual([])
    await page.locator('.dc-tray__maniglia').click()
    await expect(page.locator('.dc-tray .bsc-die').first()).toBeVisible()
    expect(await violazioni(page), 'a vassoio aperto').toEqual([])
  })

  test('anche sulla scheda, dove il pager tiene fuori schermo cinque sezioni su sei', async ({ page }) => {
    await page.goto('/#/libreria')
    await page.locator('#principale textarea').fill(CHIERICO)
    await page.locator('#principale button', { hasText: /importa/i }).first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
    await expect(page).toHaveURL(/#\/scheda\/[^/]+/)
    await vassoio(page)

    expect(await violazioni(page)).toEqual([])

    // e anche dopo essersi spostati di una sezione: il pager scorre, la zona
    // morta resta
    await page.locator('#principale a, #principale button').filter({ hasText: /^prove$/i }).first().click()
    await expect(page.locator('#principale button.bsc-kv').first()).toBeVisible()
    expect(await violazioni(page)).toEqual([])
  })
})
