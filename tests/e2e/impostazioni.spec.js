import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')

async function importa(page) {
  await page.goto('/#/libreria')
  await page.locator('#principale textarea').fill(CHIERICO)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
  await expect(page.locator('#principale')).toContainText('Ulric')
}

test.describe('impostazioni', () => {
  test('il tema si sceglie fra tre stati e sopravvive alla ricarica', async ({ page }) => {
    await page.goto('/#/impostazioni')
    await page.locator('#principale button[data-valore="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.locator('#principale button[data-valore="dark"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('la lingua si cambia, e non c\'era altro posto per farlo', async ({ page }) => {
    await page.goto('/#/impostazioni')
    await page.locator('#principale button[data-valore="en"]').click()
    await expect(page.locator('#principale')).toContainText('Settings')
    await expect(page.locator('#tabbar')).toContainText('Sheets')
    await page.locator('#principale button[data-valore="it"]').click()
    await expect(page.locator('#principale')).toContainText('Impostazioni')
  })

  test('i traguardi spengono i punti esperienza', async ({ page }) => {
    await importa(page)
    await page.goto('/#/impostazioni')
    await page.locator('#principale button[data-valore="milestone"]').click()

    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('dndc')).activeId)
    await page.goto(`/#/px/${id}`)
    await expect(page.locator('#principale')).not.toContainText('Mancano')
  })

  test('le attribuzioni CC-BY sono raggiungibili: è una condizione della licenza', async ({ page }) => {
    await page.goto('/#/impostazioni')
    const crediti = page.locator('[data-crediti]')
    await expect(crediti.locator('[data-attribuzione="2014"]')).toContainText('SRD 5.1')
    await expect(crediti.locator('[data-attribuzione="2024"]')).toContainText('SRD 5.2.1')
    await expect(crediti).toContainText('Creative Commons')
  })

  test('si salva una copia e si cancella tutto, con conferma', async ({ page }) => {
    await importa(page)
    await page.goto('/#/impostazioni')

    // la copia esce come file
    const scarica = page.waitForEvent('download')
    await page.locator('#principale button', { hasText: /salva una copia/i }).click()
    const file = await scarica
    expect(file.suggestedFilename()).toMatch(/character-companion-\d{4}-\d{2}-\d{2}\.json/)

    // cancellare chiede conferma, e se si dice no non cancella
    page.once('dialog', d => d.dismiss())
    await page.locator('#principale button[data-azione="azzera"]').click()
    await page.goto('/#/libreria')
    await expect(page.locator('#principale')).toContainText('Ulric')

    // se si dice sì, cancella
    await page.goto('/#/impostazioni')
    page.once('dialog', d => d.accept())
    await page.locator('#principale button[data-azione="azzera"]').click()
    await page.goto('/#/libreria')
    await expect(page.locator('#principale')).not.toContainText('Ulric')
  })
})

test('i crediti portano al club e al builder, in una scheda nuova', async ({ page }) => {
  await page.goto('/#/impostazioni')
  const club = page.locator('#principale a[href="https://www.brainstormclub.it/"]')
  await expect(club).toBeVisible()
  await expect(club).toHaveAttribute('target', '_blank')
  // senza `noopener` la pagina aperta può manomettere quella che l'ha aperta
  await expect(club).toHaveAttribute('rel', /noopener/)

  const builder = page.locator('#principale a[href*="dnd-character-builder"]')
  await expect(builder).toBeVisible()
})
