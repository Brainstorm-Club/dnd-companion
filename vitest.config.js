import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Solo i test di unità: gli end-to-end li governa Playwright, e se Vitest
    // li raccoglie esplodono con un messaggio poco chiaro.
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',

    // La soglia del piano (§ 9) sul dominio, dove vive la logica. Le viste non
    // entrano: `environment: 'node'` non ha un DOM, e coprirle qui vorrebbe
    // dire aggiungere jsdom per misurare ciò che gli end-to-end già provano
    // davvero, nel browser.
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.js'],
      // Le soglie stanno **appena sotto** il valore raggiunto, non dieci punti
      // sotto: una soglia più bassa del reale non ferma nessuna regressione —
      // si possono cancellare due file di test interi e restare verdi, e lo si
      // è verificato. Si alzano quando la copertura sale, non si abbassano
      // quando scende.
      thresholds: { statements: 93, branches: 83.5, functions: 93.5, lines: 96 },
      reporter: ['text-summary'],
    },
  },
})
