/**
 * A rete spenta, un tavolo che gioca con le sue regole deve avere le sue regole.
 *
 * Il precache lungo elencava i pacchetti a mano e ragionava per edizioni: di
 * Brancalonia e del grimorio metteva in cache il solo indice. Offline l'app
 * mostrava i nomi degli incantesimi e, al posto del testo, la frase sulla
 * licenza — cioè dava la colpa al permesso di pubblicare per un file che non
 * era stato scaricato. Adesso i pacchetti li legge dal registro, catena
 * compresa.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const BRANCALONIA = readFileSync('tests/fixtures/brancalonia-rifiuto.json', 'utf8')

test('col grimorio, a rete spenta, il testo c\'è', async ({ page, context }) => {
  await page.goto('/?sw=1')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

  await page.goto('/?sw=1#/libreria')
  const pannello = page.locator('#principale details.dc-import')
  if (await pannello.count()) await pannello.first().locator('summary').click()
  await page.locator('#principale textarea').fill(BRANCALONIA)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
  await page.locator('.dc-pg__testa').first().click()
  await page.locator('#principale [data-sezione="gioco"] .bsc-kv', { hasText: /regole del tavolo/i }).click()
  await page.locator('.bsc-sheet [data-pacchetto="brancalonia-brainstorm"]').click()

  // il precache lungo parte dal messaggio della pagina: gli si dà tempo
  await page.waitForTimeout(4000)
  await context.setOffline(true)
  await page.reload()
  await page.goto('/?sw=1#/incantesimi')
  await page.locator('#principale input[type=search]').fill('Dito della')
  await page.locator('#principale a', { hasText: 'Dito della Sorte' }).click()

  await expect(page.locator('#principale')).toContainText(/parole di buona sorte/i)
  // la frase «non è materiale SRD» compare anche nell'attribuzione in fondo,
  // dove è giusta: quella da non vedere è la resa del testo mancante
  await expect(page.locator('#principale')).not.toContainText(/Testo non disponibile/i)
  // e il nome è quello del grimorio, non quello del pacchetto sotto
  await expect(page.locator('#principale')).not.toContainText('Dito del Fato')
  await context.setOffline(false)
})
