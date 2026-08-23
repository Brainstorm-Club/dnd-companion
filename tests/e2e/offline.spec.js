import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * «Funziona senza rete» è la promessa che regge tutto il progetto: al tavolo,
 * in cantina, in un capanno senza campo. Finora era stata provata a mano una
 * volta sola.
 *
 * Il service worker su localhost non si registra (lo decide `main.js`, per non
 * far inseguire modifiche che ci sono già): qui lo si chiede apposta con `?sw=1`.
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')

test.describe('senza rete', () => {
  test('la scheda, i dadi e il compendio reggono a rete spenta', async ({ page, context }) => {
    // 1. prima visita, con la rete: il service worker si installa e riempie la cache
    await page.goto('/?sw=1#/libreria')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    await page.locator('#principale textarea').fill(CHIERICO)
    await page.locator('#principale button', { hasText: /importa/i }).first().click()
    await expect(page.locator('#principale')).toContainText('Ulric')

    // si apre il compendio una volta, così i blocchi di testo entrano in cache
    await page.goto('/?sw=1#/incantesimi')
    await expect(page.locator('#principale')).toContainText('Cura ferite')
    await page.waitForTimeout(1500)

    // 2. si stacca la spina
    await context.setOffline(true)
    await page.reload()

    // 3. e l'app c'è ancora, col suo personaggio
    await expect(page.locator('#principale')).toContainText('Cura ferite')
    await page.goto('/?sw=1#/libreria')
    await expect(page.locator('#principale')).toContainText('Ulric')

    // la scheda si apre e i numeri ci sono
    await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
    await expect(page.locator('#principale')).toContainText('16')   // CA

    // e si tira lo stesso: i dadi non hanno mai avuto bisogno della rete
    await page.goto('/?sw=1#/dadi')
    await page.locator('#principale input[type=text]').fill('1d20+5')
    await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()
    await expect.poll(() => page.evaluate(
      () => JSON.parse(localStorage.getItem('dndc') || '{}').diceLog?.length ?? 0,
    )).toBeGreaterThan(0)

    await context.setOffline(false)
  })
})
