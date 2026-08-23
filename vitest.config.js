import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Solo i test di unità: gli end-to-end li governa Playwright, e se Vitest
    // li raccoglie esplodono con un messaggio poco chiaro.
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
})
