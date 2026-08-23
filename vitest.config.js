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
      thresholds: { statements: 90, branches: 78, functions: 90, lines: 90 },
      reporter: ['text-summary'],
    },
  },
})
