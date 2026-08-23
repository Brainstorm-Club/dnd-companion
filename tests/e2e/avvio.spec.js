import { test, expect } from '@playwright/test'

/**
 * Il minimo che deve reggere fin dalla fase 0: la shell si carica, il tema è
 * quello giusto, la navigazione risponde, e — la verifica che vale di più —
 * nessun controllo finisce nelle zone che il sistema operativo si è prenotato.
 */

test('la shell si carica e naviga', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Character Companion/)
  await expect(page.locator('#tabbar a')).toHaveCount(4)

  const tab = page.locator('#tabbar a', { hasText: 'Dadi' })
  await tab.click()
  // La rotta è cambiata e la tab risulta selezionata: si verifica lo stato, non
  // una stringa nel testo — che dipendeva dal segnaposto della fase 0.
  await expect(page).toHaveURL(/#\/dadi$/)
  await expect(tab).toHaveAttribute('aria-current', /.*/)
  // e la vista dadi ha davvero i suoi dadi
  await expect(page.locator('.bsc-die').first()).toBeVisible()
})

test('parte in tema carbone', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('nessuna console rossa all\'avvio', async ({ page }) => {
  const errori = []
  page.on('console', m => { if (m.type() === 'error') errori.push(m.text()) })
  page.on('pageerror', e => errori.push(String(e)))
  await page.goto('/')
  await page.waitForTimeout(300)
  expect(errori).toEqual([])
})

test('nessun controllo nelle zone di sistema, nessun target sotto i 44 px', async ({ page }) => {
  await page.goto('/')
  const larghezza = page.viewportSize().width
  const problemi = await page.evaluate((w) => {
    const MORTA = 24, MIN = 44
    const out = []
    for (const el of document.querySelectorAll('#principale button, #principale a, #principale input, #principale select')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.left < MORTA || r.right > w - MORTA) out.push(`${el.tagName} tocca il bordo`)
      if (r.height < MIN || r.width < MIN) out.push(`${el.tagName} è ${Math.round(r.width)}×${Math.round(r.height)}`)
    }
    return out
  }, larghezza)
  expect(problemi).toEqual([])
})

test('il corpo non scorre in orizzontale', async ({ page }) => {
  await page.goto('/')
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
})

test('la tab bar sta in basso, dentro la safe-area, con le voci intere', async ({ page }) => {
  await page.goto('/')
  const voci = page.locator('#tabbar a')
  // Quattro destinazioni dell'app: schede, dadi, magia, privilegi. Le
  // impostazioni sono salite nell'app bar, perché non sono un posto dove si va
  // durante una sessione.
  await expect(voci).toHaveCount(4)
  const box = await page.locator('#tabbar').boundingBox()
  const vp = page.viewportSize()
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1)
  for (let i = 0; i < 4; i++) {
    const b = await voci.nth(i).boundingBox()
    expect(b.width, `voce ${i} larga ${b.width}`).toBeGreaterThan(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1)
  }
  // E che ci stiano dentro *per intero*: un'etichetta tagliata a metà passava
  // il controllo dei riquadri e restava illeggibile.
  const tagliate = await page.evaluate(() =>
    [...document.querySelectorAll('#tabbar a')]
      .filter(a => a.scrollWidth > a.clientWidth + 1)
      .map(a => a.textContent))
  expect(tagliate).toEqual([])
})

test('i due menu si distinguono a colpo d\'occhio', async ({ page }) => {
  // Il menu dell'app e quello del personaggio prima erano due file di parole
  // quasi identiche: guardandoli non si capiva quale fosse quale.
  await page.goto('/#/impostazioni')
  await expect(page.locator('#tabbar')).toBeVisible()
  await expect(page.locator('.bsc-tabs[data-sezioni]')).toHaveCount(0)

  // le impostazioni si raggiungono dall'app bar, non dalla barra da pollice
  await page.goto('/')
  await expect(page.locator('#barra [data-azione="impostazioni"]')).toBeVisible()
  await expect(page.locator('#tabbar')).not.toContainText(/opzioni|settings/i)
})
