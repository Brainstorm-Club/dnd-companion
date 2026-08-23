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

  // Aprire un personaggio è toccare la testa della sua scheda: il nome, la
  // classe e il livello sono tutti dentro il collegamento.
  await page.locator('#principale .dc-pg__testa').first().click()
  await expect(page).toHaveURL(/#\/scheda\/[^/]+/)

  // i numeri sono quelli che il builder stesso calcola (vedi oracolo-derive.json)
  const scheda = page.locator('#principale')
  await expect(scheda).toContainText('16')     // CA
  await expect(scheda).toContainText('+2')     // competenza
  await expect(scheda).toContainText('3d8')    // dadi vita
})

test('dalla scheda si tira, e il tiro finisce nello storico', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.locator('#principale .dc-pg__testa').first().click()
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
  await page.locator('#principale .dc-pg__testa').first().click()
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

/**
 * La barra dice sempre di chi è la scheda aperta.
 *
 * Con tre personaggi importati, «character companion» in alto non serve a
 * nessuno: serve sapere chi si sta giocando. Il marchio si stringe in «cc» e
 * cede il posto al nome.
 */
test.describe('il nome in barra', () => {
  test('compare aprendo una scheda e sparisce tornando alla libreria', async ({ page }) => {
    await importa(page, CHIERICO)
    await page.locator('.dc-pg__testa').first().click()

    const nome = page.locator('#barra-pg')
    await expect(nome).toBeVisible()
    const atteso = JSON.parse(CHIERICO).name
    await expect(nome).toHaveText(atteso)

    // il marchio si è stretto, ma solo alla vista
    await expect(page.locator('.dc-marchio__coda').first()).toBeHidden()
    await expect(page.locator('.bsc-wordmark')).toHaveAttribute('aria-label', 'Character Companion')
    // e il nome non deve allargare la barra oltre lo schermo
    const largo = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(largo).toBe(true)

    // e porta a casa: dai punti esperienza si torna alla scheda toccandolo
    await page.goto(`/#/px/${await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('dndc') ?? '{}').characters ?? {})[0])}`)
    await expect(nome).toBeVisible()
    await nome.click()
    await expect(page).toHaveURL(/#\/scheda\/[^/]+\/gioco$/)

    await page.locator('.bsc-wordmark').click()
    await expect(nome).toBeHidden()
    await expect(page.locator('.dc-marchio__coda').first()).toBeVisible()
  })
})

/**
 * L'SRD 5.2.1 italiano ufficiale apre «Incapacitato» dicendo «paralizzato».
 * Il testo resta com'è — è la fonte, si riporta tale e quale — ma l'errore
 * si dichiara: al tavolo quella riga fa prendere la decisione sbagliata.
 */
test('la voce sbagliata dell’SRD porta la sua nota', async ({ page }) => {
  await importa(page, readFileSync('tests/fixtures/reale-dnd2024-guerriero-3.json', 'utf8'))
  await page.locator('.dc-pg__testa').first().click()
  await page.locator('.dc-condizioni button').last().click()

  const voce = page.locator('[data-condizione="incapacitated"]')
  await voce.scrollIntoViewIfNeeded()
  await expect(voce.locator('.bsc-prose')).toContainText('paralizzato')
  await expect(voce.locator('.dc-errata')).toContainText('incapacitato')

  // e nessun'altra condizione si porta dietro una nota che non le spetta
  await expect(page.locator('.dc-errata')).toHaveCount(1)
})
