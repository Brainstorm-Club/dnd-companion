import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Il percorso che conta: un JSON esportato davvero dal builder entra nell'app,
 * diventa una scheda, e dalla scheda si tira.
 *
 * Le fixture `reale-*` non sono scritte a mano: vengono dal builder in
 * esecuzione, generate col suo «🎲 Casuale» e lette da dove lui le salva.
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')
const BRANCALONIA = readFileSync('tests/fixtures/brancalonia-rifiuto.json', 'utf8')

/** Incolla un JSON nella libreria e preme il suo «importa». */
async function importa(page, json) {
  await page.goto('/#/libreria')
  const ta = page.locator('#principale textarea')
  await ta.fill(json)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
}

test('un personaggio vero del builder si importa e si apre', async ({ page }) => {
  await importa(page, CHIERICO)

  await expect(page.locator('#principale')).toContainText('Ulric')
  await expect(page.locator('#principale')).toContainText('D&D 2014')   // edizione dedotta, non chiesta
  await expect(page.locator('#principale')).toContainText('24 / 24')

  // «apri» è un link, non un pulsante: si cercano entrambi i ruoli
  await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
  await expect(page).toHaveURL(/#\/scheda\/[^/]+/)

  // i numeri sono quelli che il builder stesso calcola (vedi oracolo-derive.json)
  const scheda = page.locator('#principale')
  await expect(scheda).toContainText('16')     // CA
  await expect(scheda).toContainText('+2')     // competenza
  await expect(scheda).toContainText('3d8')    // dadi vita
})

test('dalla scheda si tira, e il tiro finisce nello storico', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
  await page.locator('#principale a, #principale button').filter({ hasText: /^prove$/i }).first().click()

  const riga = page.locator('#principale button.bsc-kv', { hasText: /percezione/i }).first()
  await expect(riga).toContainText('+5')       // Saggezza +3 più competenza +2
  await riga.click()

  await expect(page.locator('.bsc-toast')).toContainText(/percezione:\s*\d+/i)

  // il salvataggio è raggruppato di proposito: si aspetta che tocchi il disco
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('dndc') || '{}').diceLog?.length ?? 0,
  )).toBeGreaterThan(0)
  const voce = await page.evaluate(() => JSON.parse(localStorage.getItem('dndc')).diceLog[0])
  expect(voce.label).toBe('Percezione')
  expect(voce.source).toBe('1d20+5')
  expect(voce.total).toBeGreaterThanOrEqual(6)
  expect(voce.total).toBeLessThanOrEqual(25)

  // e lo storico è uno solo: un tiro dalla scheda e uno dal tastierino stanno insieme
  await page.goto('/#/dadi')
  await expect(page.locator('#principale')).toContainText('Percezione')
})

test('gli incantesimi si vedono in italiano, dal compendio SRD', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
  await page.locator('#principale a, #principale button').filter({ hasText: /^magia$/i }).first().click()

  const magia = page.locator('#principale')
  // il builder salva `1-cure-wounds`; il ponte lo aggancia a `cura-ferite`,
  // e l'indice del compendio dà il nome per esteso
  await expect(magia).toContainText('Cura ferite')
  await expect(magia).toContainText('Localizza oggetto')
  await expect(magia).not.toContainText('Cure Wounds')
})

test('Brancalonia viene rifiutata con una spiegazione, non con un errore', async ({ page }) => {
  const errori = []
  page.on('pageerror', e => errori.push(String(e)))

  await importa(page, BRANCALONIA)

  await expect(page.locator('body')).toContainText(/Brancalonia/)
  await expect(page.locator('body')).toContainText(/prossima versione/i)
  await expect(page.locator('#principale')).not.toContainText('Menego')   // niente import a metà
  expect(errori).toEqual([])
})

test('il personaggio sopravvive alla ricarica', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.reload()
  await expect(page.locator('#principale')).toContainText('Ulric')
})
