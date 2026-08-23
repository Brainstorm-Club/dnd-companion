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
    await page.locator('#principale .dc-pg__testa').first().click()
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
    await page.locator('#principale .dc-pg__testa').first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^magia$/i }).first().click()
  })

  test('ogni incantesimo mostra il suo livello, e i trucchetti lo dicono', async ({ page }) => {
    const cura = page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' }).first()
    await expect(cura).toContainText('1°')
    await expect(cura.locator('button').filter({ hasText: /usa/i })).toHaveCount(1)

    // «Guida» è un trucchetto: niente slot da spendere, niente «usa». Il nome
    // resta toccabile — apre la descrizione — quindi si conta quello giusto.
    const guida = page.locator('#principale .bsc-kv').filter({ hasText: 'Guida' }).first()
    await expect(guida).toContainText('trucchetto')
    await expect(guida.locator('button').filter({ hasText: /^usa$/i })).toHaveCount(0)
    await expect(guida.locator('.dc-kv__link')).toHaveCount(1)
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

})

test.describe('privilegi', () => {
  test('il personaggio ha una sezione sua, e i privilegi si aprono sul testo', async ({ page }) => {
    await importa(page)
    await page.locator('#principale .dc-pg__testa').first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^privilegi$/i }).first().click()

    // Il chierico è un export di schema 1: non porta l'origine dei privilegi,
    // quindi restano un gruppo solo. Il raggruppamento per origine è coperto
    // dai test di unità, sulla fixture di schema 2.
    const sezione = page.locator('#principale')
    await expect(sezione).toContainText('Privilegi e tratti')
    await expect(sezione).toContainText('Dominio divino')

    // e ogni privilegio si apre sul testo del pacchetto regole
    const voce = page.locator('#principale details.dc-priv').first()
    await expect(voce).toBeVisible()
    await voce.locator('summary').click()
    await expect(voce.locator('p')).not.toBeEmpty()
  })

  test('il compendio mostra i privilegi di ogni classe, non solo i propri', async ({ page }) => {
    await importa(page)
    await page.goto('/#/privilegi')

    // parte dalla classe del personaggio aperto, segnata con una stella
    await expect(page.locator('#principale button[data-classe="cleric"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#principale')).toContainText('★')

    // e si può guardare quella di qualcun altro
    await page.locator('#principale button[data-classe="barbarian"]').click()
    await expect(page.locator('#principale')).toContainText('Ira')
    await expect(page.locator('#principale button[data-classe="barbarian"]')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('il cassetto di consultazione', () => {
  test('si consulta senza perdere il posto', async ({ page }) => {
    await importa(page)
    await page.locator('#principale .dc-pg__testa').first().click()

    // dallo zaino, come nell'esempio
    await page.locator('#principale a, #principale button').filter({ hasText: /^zaino$/i }).first().click()
    const dove = page.url()

    // si apre il cassetto e si va sui privilegi
    await page.locator('.dc-tray__maniglia').click()
    await page.locator('.dc-tray__schede [data-scheda="privilegi"]').click()
    await expect(page.locator('.dc-tray__pane[data-pane="compendio"]')).toContainText(/privilegi di classe/i)

    // chiuso il cassetto si è ancora nello zaino, non altrove
    await page.locator('.dc-tray__chiudi').click()
    expect(page.url()).toBe(dove)
  })

  test('un incantesimo del personaggio si legge sopra la sua scheda', async ({ page }) => {
    await importa(page)
    await page.locator('#principale .dc-pg__testa').first().click()
    await page.locator('#principale a, #principale button').filter({ hasText: /^magia$/i }).first().click()
    const dove = page.url()

    await page.locator('#principale .bsc-kv').filter({ hasText: 'Cura ferite' })
      .first().locator('.dc-kv__link').click()

    const pane = page.locator('.dc-tray__pane[data-pane="compendio"]')
    await expect(pane).toContainText(/cura ferite/i)
    await expect(pane).toContainText(/tempo di lancio/i)

    // e l'edizione è la sua, non quella di un altro personaggio aperto prima
    await expect(pane).toContainText('D&D 2014')

    await page.locator('.dc-tray__chiudi').click()
    expect(page.url()).toBe(dove)
    await expect(page.locator('#principale')).toContainText('CD incantesimi')
  })

  test('le tre schede ci sono tutte, e i dadi restano dov\'erano', async ({ page }) => {
    await page.goto('/#/libreria')
    await page.locator('.dc-tray__maniglia').click()
    const schede = page.locator('.dc-tray__schede .bsc-tab')
    await expect(schede).toHaveCount(3)
    await expect(schede.first()).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.dc-tray .bsc-die').first()).toBeVisible()
  })
})

test.describe('come si legge un tiro', () => {
  /** Tira finché non esce il naturale chiesto. Il d20 prima o poi lo dà. */
  async function tiraFinoA(page, naturale) {
    for (let i = 0; i < 120; i++) {
      await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()
      if (await page.locator(`#principale [data-naturale="${naturale}"]`).count()) return true
      await page.waitForTimeout(30)
    }
    return false
  }

  test('col 20 naturale il totale si vede lo stesso, e la regola non urla', async ({ page }) => {
    // con un personaggio c'è un bonus vero: senza, 20 + 0 fa 20 e il test non
    // distinguerebbe «totale calcolato» da «mostra solo il dado»
    await importa(page)
    await page.goto('/#/prove')
    // una CD, così c'è anche l'esito da confrontare
    for (const c of ['1', '2']) await page.locator('#principale button', { hasText: new RegExp(`^${c}$`) }).first().click()
    expect(await tiraFinoA(page, '20')).toBe(true)

    const esito = page.locator('#principale [data-totale]').first()
    // il totale è calcolato: naturale più bonus, non «20 naturale» e basta
    const totale = Number(await esito.getAttribute('data-totale'))
    expect(totale).toBeGreaterThan(20)
    await expect(page.locator('#principale [data-esito]')).toBeVisible()

    // il dado mostra il numero, non il numero dentro il proprio commento
    const dado = page.locator('#principale .dc-dado').first()
    const visibile = await dado.evaluate(el =>
      [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim())
    expect(visibile).toBe('20')

    // la nota resta per chi non vede il colore, ma non occupa la tessera
    const nota = dado.locator('.dc-solo-lettori')
    await expect(nota).toHaveCount(1)
    const r = await nota.boundingBox()
    expect(r.width).toBeLessThan(3)
  })

  test('lo storico dice perché si è tirato, prima di dire quanto', async ({ page }) => {
    await importa(page)
    await page.goto('/#/prove')
    await page.locator('#principale button').filter({ hasText: /^tira$/i }).click()
    await page.locator('.dc-tray__maniglia').click()

    const riga = page.locator('.dc-tray .dc-tiro').first()
    await expect(riga.locator('.dc-tiro__motivo')).toContainText(/prova/i)
    await expect(riga.locator('.dc-tiro__totale')).toHaveText(/^\d+$/)
    await expect(riga.locator('.dc-tiro__formula')).toContainText(/\(1d20/)

    // il motivo viene prima: è la domanda che ci si fa scorrendo lo storico
    const ordine = await riga.evaluate(el => [...el.children].map(c => c.className.split(' ')[0]))
    expect(ordine[0]).toBe('dc-tiro__motivo')
  })
})
