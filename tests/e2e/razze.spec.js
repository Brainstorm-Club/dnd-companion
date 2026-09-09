import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Il compendio delle razze: la domanda che lo ha fatto nascere è «cosa fa di
 * preciso il Soffio del Drago?», e la risposta deve stare a due tocchi anche
 * per chi dragonide non è.
 *
 * I tre casi che contano sono: a libreria vuota (nessuno ha ancora importato
 * niente), col proprio personaggio aperto (si parte dalla sua razza), e con un
 * personaggio di una variante (deve trovare le razze del *suo* pacchetto, non
 * le nove dell'SRD).
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')
const BRANCALONIA = readFileSync('tests/fixtures/brancalonia-rifiuto.json', 'utf8')

/** @param {import('@playwright/test').Page} page @param {string} json */
async function importa(page, json, chi) {
  await page.goto('/#/libreria')
  await page.locator('#principale textarea').fill(json)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
  await expect(page.locator('#principale')).toContainText(chi)
}

test('si consulta anche a libreria vuota', async ({ page }) => {
  await page.goto('/#/razze')
  await expect(page.locator('#principale .dc-vista[data-vista="razze"]')).toBeVisible()
  // senza nessun personaggio si parte dall'SRD 2024
  await expect(page.locator('#principale')).toContainText('SRD 5.2.1')
  await expect(page.locator('#principale button[data-razza="dragonborn"]')).toBeVisible()
})

test('la razza si sceglie, i tratti si aprono sul testo', async ({ page }) => {
  await page.goto('/#/razze')
  await page.locator('#principale button[data-razza="dragonborn"]').click()
  await expect(page.locator('#principale button[data-razza="dragonborn"]')).toHaveAttribute('aria-pressed', 'true')

  const voce = page.locator('#principale details.dc-priv').first()
  await voce.locator('summary').click()
  // Il testo dei tratti di razza oggi non c'è in nessun pacchetto: la vista non
  // si apre su un vuoto, dice perché. Quando l'estrazione arriverà, qui ci sarà
  // la descrizione — e il controllo continua a valere.
  await expect(voce.locator('p')).not.toBeEmpty()
})

test('la sottorazza si filtra, e solo dove ce ne sono', async ({ page }) => {
  await page.goto('/#/razze')

  // Il dragonide del 2024 ha dieci antenati draconici
  await page.locator('#principale button[data-razza="dragonborn"]').click()

  // Il filtro sta chiuso: dieci chip sotto i nove delle razze coprivano lo
  // schermo intero, e chi apre il compendio per leggere un tratto deve
  // vederne almeno uno senza scorrere.
  const filtro = page.locator('#principale details.dc-sotto')
  await expect(filtro).toBeVisible()
  await expect(page.locator('#principale button[data-sottorazza]').first()).toBeHidden()
  await expect(page.locator('#principale details.dc-priv').first()).toBeVisible()

  // ma il sommario dice a che punto sei, e si apre con un tocco
  await expect(filtro.locator('summary')).toContainText(/tutte/i)
  await filtro.locator('summary').click()
  await page.locator('#principale button[data-sottorazza="red"]').click()
  const testi = await page.locator('#principale details.dc-priv .bsc-badge').allTextContents()
  expect(testi.every(t => /rosso/i.test(t))).toBe(true)

  // scelto un antenato, il sommario lo dice anche da chiuso
  await expect(page.locator('#principale details.dc-sotto summary')).toContainText(/rosso/i)

  // il nano no: un filtro col solo «Tutte» sarebbe un controllo che non controlla
  await page.locator('#principale button[data-razza="dwarf"]').click()
  await expect(page.locator('#principale details.dc-sotto')).toHaveCount(0)
})

test('col personaggio aperto parte dalla sua razza, segnata', async ({ page }) => {
  await importa(page, CHIERICO, 'Ulric')
  await page.goto('/#/razze')
  await expect(page.locator('#principale')).toContainText('★')
  await expect(page.locator('#principale .bsc-chip--on')).toHaveCount(1)
})

test('un personaggio di variante trova le razze del suo pacchetto', async ({ page }) => {
  await importa(page, BRANCALONIA, 'Menego')
  await page.goto('/#/razze')

  // le sue…
  await expect(page.locator('#principale button[data-razza="malebranche"]')).toHaveAttribute('aria-pressed', 'true')
  // …e quelle del pacchetto su cui il suo poggia
  await expect(page.locator('#principale button[data-razza="dwarf"]')).toBeVisible()

  // e il testo c'è: viene dal manuale di Brancalonia, non dall'SRD.
  // (Questo test nasceva asserendo il contrario — che il testo mancasse — ed
  // era vero fino a quando i testi dei manuali non sono stati estratti.)
  const voce = page.locator('#principale details.dc-priv').first()
  await voce.locator('summary').click()
  await expect(voce.locator('p')).not.toContainText(/non è materiale SRD/i)
  expect((await voce.locator('p').textContent() ?? '').length).toBeGreaterThan(60)
})

test('la quinta voce di menù porta alle razze', async ({ page }) => {
  await page.goto('/')
  await page.locator('#tabbar a').last().click()
  await expect(page).toHaveURL(/#\/razze$/)
  await expect(page.locator('#principale .dc-vista[data-vista="razze"]')).toBeVisible()
})

test('e il cassetto le ospita senza far perdere il posto', async ({ page }) => {
  await importa(page, CHIERICO, 'Ulric')
  await page.locator('#principale .dc-pg__testa').first().click()
  await page.locator('#principale a, #principale button').filter({ hasText: /^zaino$/i }).first().click()
  const dove = page.url()

  await page.locator('.dc-tray__maniglia').click()
  await page.locator('.dc-tray__schede [data-scheda="razze"]').click()
  await expect(page.locator('.dc-tray__pane[data-pane="compendio"] [data-vista="razze"]')).toBeVisible()

  await page.locator('.dc-tray__chiudi').click()
  expect(page.url()).toBe(dove)
})
