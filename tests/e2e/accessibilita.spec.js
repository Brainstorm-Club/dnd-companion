import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

/**
 * Il controllo di accessibilità che il piano (§ 9) chiedeva dalla fase 0 e che
 * nessuno aveva mai eseguito.
 *
 * axe non dice «è accessibile»: dice che non ci sono le violazioni che una
 * macchina sa riconoscere. È il pavimento, non il soffitto — ma un pavimento
 * che finora non c'era.
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')

async function conPersonaggio(page) {
  await page.goto('/#/libreria')
  await page.locator('#principale textarea').fill(CHIERICO)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
  await expect(page.locator('#principale')).toContainText('Ulric')
  return page.evaluate(() => JSON.parse(localStorage.getItem('dndc')).activeId)
}

/** @param {import('@playwright/test').Page} page */
async function violazioni(page) {
  const esito = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Il marchio del club è un logotipo, e la 1.4.3 esenta esplicitamente
    // «testo che fa parte di un logo o di un nome di marca». axe non può
    // saperlo e lo segnala come contrasto insufficiente: si esclude quello, non
    // la regola — ogni altro testo resta sotto controllo.
    .exclude('.bsc-wordmark')
    .analyze()
  return esito.violations.map(v => ({
    regola: v.id,
    impatto: v.impact,
    dove: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
  }))
}

/**
 * Aspetta che la vista ci sia davvero.
 *
 * «`#principale` non è vuoto» non basta: mentre la vista si carica lì dentro
 * c'è il segnaposto «Caricamento…», che vuoto non è. Sotto carico axe partiva
 * su quello, o peggio a metà dello scambio, e il test cadeva a giorni alterni
 * senza che fosse cambiato niente.
 * @param {import('@playwright/test').Page} page
 */
async function pronta(page) {
  await expect(page.locator('#principale .dc-vista')).toBeVisible()
  // figlio diretto: il segnaposto del router sta lì, mentre `.dc-avvio` dentro
  // una vista è un'altra cosa — è il modo in cui certe schermate dicono «qui
  // non c'è ancora niente», e resta anche a vista disegnata.
  await expect(page.locator('#principale > .dc-avvio')).toHaveCount(0)
}

test.describe('accessibilità', () => {
  for (const [nome, rotta] of [
    ['libreria', '#/libreria'],
    ['dadi', '#/dadi'],
    ['prove', '#/prove'],
    ['compendio', '#/incantesimi'],
    ['impostazioni', '#/impostazioni'],
  ]) {
    test(`${nome} non ha violazioni WCAG che una macchina sappia vedere`, async ({ page }) => {
      await page.goto(`/${rotta}`)
      await pronta(page)
      expect(await violazioni(page)).toEqual([])
    })
  }

  test('la scheda di un personaggio vero, sezione per sezione', async ({ page }) => {
    const id = await conPersonaggio(page)
    for (const sezione of ['gioco', 'prove', 'azioni', 'magia', 'zaino', 'storia']) {
      await page.goto(`/#/scheda/${id}/${sezione}`)
      await pronta(page)
      expect(await violazioni(page), `sezione ${sezione}`).toEqual([])
    }
  })

  test('anche in tema carta, dove cambia il contrasto', async ({ page }) => {
    await page.goto('/#/impostazioni')
    await page.locator('#principale button[data-valore="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await violazioni(page)).toEqual([])
  })
})
