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

/**
 * Incolla un JSON nella libreria e preme il suo «importa».
 *
 * Con dei personaggi già dentro il pannello d'import è chiuso — è la libreria
 * che deve mostrare i personaggi, non il modulo — quindi prima si apre.
 */
async function importa(page, json) {
  await page.goto('/#/libreria')
  // Prima che la vista esista non c'è niente da aprire: senza questa attesa il
  // controllo sul pannello legge zero, salta il clic, e poi `fill` aspetta per
  // sempre una textarea che nel frattempo è comparsa dentro un `<details>`
  // chiuso.
  await expect(page.locator('#principale [data-vista="libreria"]')).toBeVisible()
  const pannello = page.locator('#principale details.dc-import')
  if (await pannello.count()) await pannello.first().locator('summary').click()
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

test('Brancalonia entra, e la scheda si apre', async ({ page }) => {
  const errori = []
  page.on('pageerror', e => errori.push(String(e)))

  await importa(page, BRANCALONIA)

  await expect(page.locator('#principale')).toContainText('Menego')
  await page.locator('.dc-pg__testa').first().click()
  await expect(page.locator('#barra-pg')).toContainText('Menego')
  expect(errori).toEqual([])
})

test('col compendio aperto su Brancalonia si attribuiscono tutt\'e due le fonti', async ({ page }) => {
  // L'elenco mescola incantesimi SRD e incantesimi di Acheron Games: mostrare
  // solo l'attribuzione CC-BY vorrebbe dire dichiarare libero ciò che non lo è.
  await importa(page, BRANCALONIA)
  await page.locator('.dc-pg__testa').first().click()
  await page.goto('/#/incantesimi')

  const fonti = page.locator('#principale details summary')
  await expect(fonti).toHaveCount(2)
  await expect(fonti.first()).toContainText('CC-BY-4.0')
  await expect(fonti.last()).toContainText('Brancalonia')
  await expect(fonti.last()).not.toContainText('CC-BY-4.0')

  // e un incantesimo della variante c'è, senza il suo testo
  await page.locator('#principale input[type=search]').fill('Dito del Fato')
  await expect(page.locator('#principale')).toContainText('Dito del Fato')
})

test('una variante senza pacchetto viene rifiutata con una spiegazione, non con un errore', async ({ page }) => {
  const errori = []
  page.on('pageerror', e => errori.push(String(e)))

  const inventato = JSON.parse(BRANCALONIA)
  inventato.variant = 'gioco-che-non-esiste'
  await importa(page, JSON.stringify(inventato))

  await expect(page.locator('body')).toContainText(/gioco-che-non-esiste/)
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

/**
 * Ri-importare lo stesso personaggio non fa un doppione: aggiorna quello che
 * c'è e si tiene la partita. È il gesto di ogni sessione — si sale di livello
 * nel builder e si riporta qui — e finora costava o due schede uguali o i
 * punti ferita azzerati.
 */
test('lo stesso personaggio ri-importato aggiorna la scheda e tiene la partita', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.locator('.dc-pg__testa').first().click()

  const misura = () => page.locator('#principale [data-sezione="gioco"] .bsc-meter').first()
  const prima = await misura().getAttribute('aria-valuenow')

  // e intanto nel builder il personaggio è salito di livello
  const salito = JSON.parse(CHIERICO)
  salito.level = 4
  salito.maxHp = Number(salito.maxHp) + 7
  await importa(page, JSON.stringify(salito))

  // una scheda sola, non due
  await expect(page.locator('.dc-pg')).toHaveCount(1)
  await expect(page.locator('#principale')).toContainText(/livello 4/i)

  // e l'app dice cosa è cambiato, invece di farlo di nascosto
  await expect(page.locator('#principale')).toContainText(/aggiornato/i)
  await expect(page.locator('#principale')).toContainText(/livello.*3.*4/i)

  // i punti ferita correnti sono quelli di prima: salire di livello non cura
  await page.locator('.dc-pg__testa').first().click()
  await expect(misura()).toHaveAttribute('aria-valuenow', String(prima))
  // il massimo invece è cresciuto, perché è la scheda a essere cambiata
  const maxDopo = Number(await misura().getAttribute('aria-valuemax'))
  expect(maxDopo).toBeGreaterThan(Number(prima))
})

test('due personaggi diversi restano due, anche importati di fila', async ({ page }) => {
  await importa(page, CHIERICO)
  await importa(page, readFileSync('tests/fixtures/reale-dnd2024-guerriero-3.json', 'utf8'))
  await expect(page.locator('.dc-pg')).toHaveCount(2)
})

/**
 * Gli usi dei privilegi e le note di sessione: i due campi che stavano nello
 * stato da sempre e che nessuna schermata mostrava.
 */
test.describe('quello che si segna al tavolo', () => {
  /** @param {import('@playwright/test').Page} page */
  async function apriScheda(page) {
    await importa(page, readFileSync('tests/fixtures/reale-dnd2024-guerriero-3.json', 'utf8'))
    await page.locator('.dc-pg__testa').first().click()
    await expect(page.locator('#principale [data-sezione="privilegi"]')).toBeAttached()
  }

  test('un privilegio si conta, si spende e torna col riposo giusto', async ({ page }) => {
    await apriScheda(page)
    const sezione = page.locator('#principale [data-sezione="privilegi"]')

    // il conteggio non c'è finché non lo si chiede: quasi nessun privilegio si conta
    await expect(sezione.locator('.bsc-pips')).toHaveCount(0)
    await sezione.getByRole('button', { name: /conta gli usi/i }).first().click()

    // due usi, che tornano col riposo breve
    const foglio = page.locator('.bsc-sheet')
    await foglio.getByRole('button', { name: /\+1$/ }).click()
    await foglio.getByRole('button', { name: /riposo breve/i }).click()
    await foglio.getByRole('button', { name: /conferma/i }).click()

    const pallini = sezione.locator('.dc-usi .bsc-pips').first()
    await expect(pallini.getByRole('button')).toHaveCount(2)

    // se ne spende uno
    await pallini.getByRole('button').first().click()
    await expect(pallini.locator('.is-used')).toHaveCount(1)

    // e un riposo breve lo restituisce
    await page.goto(page.url().replace(/\/[^/]+$/, '/gioco'))
    await page.locator('#principale button', { hasText: /riposo breve/i }).first().click()
    const conferma = page.locator('.bsc-sheet button', { hasText: /riposo breve|conferma/i }).last()
    if (await conferma.count()) await conferma.click()
    await page.goto(page.url().replace(/\/[^/]+$/, '/privilegi'))
    await expect(page.locator('#principale [data-sezione="privilegi"] .dc-usi .is-used')).toHaveCount(0)
  })

  test('le note di sessione si salvano mentre si scrive, e restano', async ({ page }) => {
    await apriScheda(page)
    await page.goto(page.url().replace(/\/[^/]+$/, '/storia'))

    const note = page.locator('#dc-note')
    await note.fill('L’oste si chiama Beppe, gli dobbiamo 4 mo')
    // niente pulsante «salva»: al tavolo si annota di fretta e si torna al gioco
    await page.reload()
    await expect(page.locator('#dc-note')).toHaveValue(/Beppe/)
  })
})

/**
 * Le regole di casa: un tavolo che gioca Brancalonia col proprio grimorio non
 * gioca un'altra variante, gioca la stessa con qualcosa in più. Il builder non
 * lo sa e non può saperlo — esporta `variant: "brancalonia"` e basta — quindi
 * la scelta si fa qui, scheda per scheda.
 */
test.describe('le regole del tavolo', () => {
  test('si scelgono dalla scheda, e cambiano il compendio', async ({ page }) => {
    await importa(page, BRANCALONIA)
    await page.locator('.dc-pg__testa').first().click()

    const riga = page.locator('#principale [data-sezione="gioco"] .bsc-kv', { hasText: /regole del tavolo/i })
    await expect(riga).toContainText('Brancalonia')
    await riga.click()

    // due scelte: il pacchetto suo e il grimorio che ci si appoggia sopra
    const foglio = page.locator('.bsc-sheet')
    await expect(foglio.locator('[data-pacchetto]')).toHaveCount(2)
    await foglio.locator('[data-pacchetto="brancalonia-brainstorm"]').click()

    await expect(page.locator('#principale [data-sezione="gioco"] .bsc-kv', { hasText: /regole del tavolo/i }))
      .toContainText('Grimorio')

    // il compendio ora parla la lingua del grimorio, non quella del builder…
    await page.goto('/#/incantesimi')
    await page.locator('#principale input[type=search]').fill('Dito')
    await expect(page.locator('#principale')).toContainText('Dito della Sorte')
    // …e non tutt'e due: appaiati per id, non sdoppiati
    await expect(page.locator('#principale')).not.toContainText('Dito del Fato')

    // e ogni fonte in pagina porta la sua attribuzione: SRD, Acheron, il tavolo
    const fonti = page.locator('#principale details summary')
    await expect(fonti).toHaveCount(3)
    await expect(fonti.last()).toContainText(/Grimorio/)
  })

  test('a chi gioca D&D non si offre una scelta che non ha', async ({ page }) => {
    await importa(page, CHIERICO)
    await page.locator('.dc-pg__testa').first().click()
    await expect(page.locator('#principale [data-sezione="gioco"] .bsc-kv', { hasText: /regole del tavolo/i }))
      .toHaveCount(0)
  })

  test('un incantesimo del Regno si apre col testo della campagna', async ({ page }) => {
    await importa(page, BRANCALONIA)
    await page.locator('.dc-pg__testa').first().click()
    await page.locator('#principale [data-sezione="gioco"] .bsc-kv', { hasText: /regole del tavolo/i }).click()
    await page.locator('.bsc-sheet [data-pacchetto="brancalonia-brainstorm"]').click()

    await page.goto('/#/incantesimi')
    await page.locator('#principale input[type=search]').fill('Dito della')
    await page.locator('#principale a', { hasText: 'Dito della Sorte' }).click()
    // il difetto che ha fatto nascere questo test: la scheda cadeva su
    // «Qualcosa non ha funzionato» perché alle voci mancavano due campi
    await expect(page.locator('#principale')).not.toContainText('Qualcosa non ha funzionato')
    await expect(page.locator('#principale')).toContainText(/parole di buona sorte/i)
  })
})

test('una scheda illeggibile non si porta dietro le altre', async ({ page }) => {
  // `derive()` legge lo snapshot senza guardie, ed è giusto: è il cuore dei
  // conti. Ma una voce corrotta faceva cadere l'intera libreria, e chi aveva
  // tre personaggi ne perdeva la vista di tre per colpa di uno.
  await importa(page, CHIERICO)
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dndc') ?? '{}')
    s.characters['rotta'] = { meta: {}, play: {}, levels: [] }
    localStorage.setItem('dndc', JSON.stringify(s))
  })
  await page.reload()

  await expect(page.locator('#principale')).toContainText('Ulric')
  await expect(page.locator('.dc-pg--rotta')).toHaveCount(1)
  await expect(page.locator('#principale')).not.toContainText(/qualcosa non ha funzionato/i)
})

test('duplicare dà una scheda nuova, non una copia della partita', async ({ page }) => {
  await importa(page, CHIERICO)
  await page.locator('.dc-pg__testa').first().click()
  // si gioca un po': una ferita e una nota
  await page.locator('#principale [data-sezione="gioco"] .bsc-stepper__btn').first().click()
  await page.goto(page.url().replace(/\/[^/]+$/, '/storia'))
  await page.locator('#dc-note').fill('la partita di ieri sera')

  await page.goto('/#/libreria')
  await page.locator('.dc-pg', { hasText: 'Ulric' }).getByRole('button', { name: /duplica/i }).click()
  await expect(page.locator('.dc-pg')).toHaveCount(2)

  // Il salvataggio è raggruppato (`setTimeout(0)`): si aspetta che sia sceso
  // su disco invece di leggere subito e sperare.
  await expect.poll(async () => page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('dndc') ?? '{}').characters ?? {}).length)).toBe(2)

  const stato = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dndc') ?? '{}')
    return Object.values(s.characters).map((/** @type {any} */ c) => ({
      nome: c.meta.name, note: c.play.notes, snapId: c.snapshot.id ?? null,
    }))
  })
  const copia = stato.find(c => /copia/.test(c.nome))
  const suo = stato.find(c => !/copia/.test(c.nome))

  // la copia non si porta dietro la partita…
  expect(copia.note).toBe('')
  expect(suo.note).toBe('la partita di ieri sera')
  // …e non è indistinguibile dall'originale per chi ri-importa
  expect(copia.snapId).toBeNull()
  expect(suo.snapId).toBeTruthy()
})

/**
 * Il bonus magico di un'arma sta accanto al nome sul riepilogo del builder e su
 * tutte e tre le schede PDF; qui non c'era. Al tavolo la stessa spada si
 * leggeva «Spada Lunga» sullo schermo e «Spada Lunga +1» sul foglio, e con due
 * armi dello stesso tipo non c'era modo di sapere quale si stesse tirando.
 */
test('un\'arma magica porta il suo +N accanto al nome', async ({ page }) => {
  const scheda = JSON.parse(readFileSync('tests/fixtures/reale-dnd5e-chierico-3.json', 'utf8'))
  // Attacco e danno il builder li scrive già col bonus dentro: qui si aggiunge
  // solo il campo che dice *perché* quei numeri sono quelli.
  scheda.weapons[0].magicBonus = 2
  const nome = scheda.weapons[0].name
  await importa(page, JSON.stringify(scheda))

  await page.locator('.dc-pg__testa').first().click()
  await page.locator('[data-sezioni] a', { hasText: /azioni/i }).click()

  const azioni = page.locator('[data-sezione="azioni"]')
  await expect(azioni.locator('.bsc-kv__label').first()).toHaveText(`${nome} +2`)
  // e le armi comuni restano nude: nessun «+0» appiccicato a tutto
  await expect(azioni.getByText('+0', { exact: false })).toHaveCount(0)
})
