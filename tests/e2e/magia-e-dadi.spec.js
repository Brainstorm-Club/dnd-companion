import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Due cose che si vedono solo provandole: i dadi che girano prima di fermarsi,
 * e il compendio che si apre sugli incantesimi del personaggio invece che su
 * tutti e trecento.
 */

const CHIERICO = readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8')

async function importa(page) {
  await page.goto('/#/libreria')
  await page.locator('#principale textarea').fill(CHIERICO)
  await page.locator('#principale button', { hasText: /importa/i }).first().click()
  await expect(page.locator('#principale')).toContainText('Ulric')
}

test.describe('i dadi girano, poi si fermano', () => {
  test('durante il tiro si scuotono, alla fine mostrano i valori veri', async ({ page }) => {
    await page.goto('/#/dadi')
    await page.locator('#principale input[type=text]').fill('4d6dl1')
    await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()

    // subito: girano
    await expect(page.locator('#principale .dc-dado--gira').first()).toBeVisible()

    // alla fine: nessuno gira più, e i numeri sono quelli registrati
    await expect(page.locator('#principale .dc-dado--gira')).toHaveCount(0, { timeout: 4000 })
    const facce = await page.locator('#principale .dc-dado').allTextContents()
    const valori = await page.locator('#principale .dc-dado').evaluateAll(
      els => els.map(e => Number(e.getAttribute('data-valore'))))
    expect(facce).toHaveLength(4)
    // il testo mostrato coincide con il valore vero del dado
    facce.forEach((testo, i) => expect(testo).toContain(String(valori[i])))
    // e un dado su quattro è scartato, perché la notazione lo dice
    expect(await page.locator('#principale .dc-dado[data-scartato="si"]').count()).toBe(1)
  })

  test('anche le prove mostrano i dadi, e con vantaggio sono due', async ({ page }) => {
    await importa(page)
    await page.goto('/#/prove')
    await page.locator('#principale button').filter({ hasText: /^vantaggio$/i }).click()
    await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()
    await expect(page.locator('#principale .dc-dado')).toHaveCount(2, { timeout: 4000 })
    // uno dei due è scartato: il vantaggio tiene il più alto
    await expect(page.locator('#principale .dc-dado[data-scartato="si"]')).toHaveCount(1)
  })
})

test.describe('chi chiede meno movimento', () => {
  test('vede subito il numero, senza che nessun dado giri', async ({ page }) => {
    // `test.use({ reducedMotion })` non arriva a `matchMedia` in questo
    // Chromium: verificato, riporta `false`. `emulateMedia` sì, ed è la
    // preferenza che il codice legge davvero.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/dadi')
    await page.locator('#principale input[type=text]').fill('2d20')
    await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()
    // nessuna fase di rotazione, e i valori sono già quelli definitivi
    await expect(page.locator('#principale .dc-dado')).toHaveCount(2)
    expect(await page.locator('#principale .dc-dado--gira').count()).toBe(0)
    const valori = await page.locator('#principale .dc-dado').evaluateAll(
      els => els.map(e => ({ testo: e.textContent, vero: e.getAttribute('data-valore') })))
    for (const v of valori) expect(v.testo).toContain(v.vero)
  })
})

test.describe('il compendio si apre sui tuoi incantesimi', () => {
  test('di default mostra i suoi nove, e «tutti» apre il compendio intero', async ({ page }) => {
    await importa(page)
    await page.goto('/#/incantesimi')

    const righe = page.locator('#principale .dc-elenco > *')
    await expect(page.locator('#principale')).toContainText('Cura ferite')
    const suoi = await righe.count()
    expect(suoi).toBeGreaterThan(0)
    expect(suoi).toBeLessThan(30)   // i suoi, non trecento

    await page.locator('#principale button').filter({ hasText: /^tutti$/i }).click()
    await expect.poll(() => righe.count()).toBeGreaterThan(200)

    await page.locator('#principale button').filter({ hasText: /^i miei$/i }).click()
    await expect.poll(() => righe.count()).toBe(suoi)
  })

  test('senza personaggi l\'interruttore non compare, e il compendio è intero', async ({ page }) => {
    await page.goto('/#/incantesimi')
    await expect(page.locator('#principale')).toContainText('Cerca un incantesimo')
    await expect(page.locator('#principale button').filter({ hasText: /^i miei$/i })).toHaveCount(0)
    await expect.poll(() => page.locator('#principale .dc-elenco > *').count()).toBeGreaterThan(200)
  })
})

test.describe('lo zaino si riempie giocando', () => {
  test('si aggiungono oggetti e si cambiano le monete, e restano dopo la ricarica', async ({ page }) => {
    await importa(page)
    await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^zaino$/i }).first().click()

    // l'equipaggiamento iniziale c'è, e viene dallo snapshot
    await expect(page.locator('#principale')).toContainText('Equipaggiamento iniziale')
    await expect(page.locator('#principale')).toContainText('holy symbol')

    const campo = page.locator('#principale .dc-aggiungi input')
    await campo.fill('tre torce')
    await campo.press('Enter')
    await expect(page.locator('#principale')).toContainText('tre torce')

    // il fuoco resta nel campo: si segna il bottino una riga dopo l'altra
    await expect(campo).toBeFocused()
    await campo.fill('un teschio di goblin')
    await campo.press('Enter')
    await expect(page.locator('#principale')).toContainText('un teschio di goblin')

    // le monete si muovono. Si punta all'etichetta accessibile, che è precisa:
    // «GP» da solo compare anche in righe che non sono quella delle monete.
    const riga = page.locator('#principale .dc-monete .bsc-kv').filter({ hasText: 'GP' }).first()
    await page.getByLabel('GP +1').click()
    await expect(riga).toContainText('39')

    // e tutto sopravvive alla ricarica
    await page.reload()
    await page.locator('#principale a, #principale button').filter({ hasText: /^zaino$/i }).first().click()
    await expect(page.locator('#principale')).toContainText('tre torce')
    await expect(page.locator('#principale .dc-monete')).toContainText('39')

    // togliere leva quello giusto
    const daTogliere = page.locator('#principale .bsc-kv').filter({ hasText: 'tre torce' }).first()
    await daTogliere.locator('button').click()
    await expect(page.locator('#principale')).not.toContainText('tre torce')
    await expect(page.locator('#principale')).toContainText('un teschio di goblin')
  })
})

test.describe('gli incantesimi si usano dalla scheda', () => {
  test.beforeEach(async ({ page }) => {
    await importa(page)
    await page.locator('#principale a, #principale button').filter({ hasText: /^apri$/i }).first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^magia$/i }).first().click()
  })

  test('ogni incantesimo mostra il suo livello, e i trucchetti lo dicono', async ({ page }) => {
    const cura = page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' }).first()
    await expect(cura).toContainText('1°')
    await expect(cura.locator('button').filter({ hasText: /usa/i })).toHaveCount(1)

    // «Guida» è un trucchetto: niente slot da spendere, niente bottone
    const guida = page.locator('#principale .bsc-kv').filter({ hasText: 'Guida' }).first()
    await expect(guida).toContainText('trucchetto')
    await expect(guida.locator('button')).toHaveCount(0)
  })

  test('«usa» spende uno slot del livello giusto, e resta speso', async ({ page }) => {
    const slot1 = page.locator('#principale .bsc-kv').filter({ hasText: /Slot 1/ }).first()
    const prima = (await slot1.locator('.bsc-kv__value').textContent()) ?? ''

    await page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' })
      .first().locator('button').filter({ hasText: /usa/i }).click()

    await expect(page.locator('.bsc-toast')).toContainText(/slot di 1/i)
    await expect(slot1.locator('.bsc-kv__value')).not.toHaveText(prima)

    // resta speso dopo la ricarica: è stato di gioco, non un'animazione
    await page.reload()
    await page.locator('#principale a, #principale button').filter({ hasText: /^magia$/i }).first().click()
    await expect(page.locator('#principale .bsc-kv').filter({ hasText: /Slot 1/ }).first()
      .locator('.bsc-kv__value')).not.toHaveText(prima)
  })

  test('finiti gli slot di quel livello lo dice, e non ne prende uno più alto', async ({ page }) => {
    const usa = page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' })
      .first().locator('button').filter({ hasText: /usa/i })

    // il chierico di 3° ha quattro slot di 1°: dopo quattro non ne restano
    for (let i = 0; i < 5; i++) { await usa.click(); await page.waitForTimeout(150) }

    await expect(page.locator('.bsc-toast')).toContainText(/niente slot di 1/i)
    // gli slot di 2° sono ancora tutti lì: l'app non se n'è preso uno da sé
    const slot2 = page.locator('#principale .bsc-kv').filter({ hasText: /Slot 2/ }).first()
    await expect(slot2.locator('.bsc-kv__value')).toHaveText(/^(\d+)\/\1$/)
  })

  test('il nome apre la scheda dell\'incantesimo nel compendio', async ({ page }) => {
    await page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' })
      .first().locator('a').click()
    await expect(page).toHaveURL(/#\/incantesimi\//)
    await expect(page.locator('#principale')).toContainText('Cura ferite')
  })
})
