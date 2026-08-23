import { defineConfig, devices } from '@playwright/test'

/**
 * Due viewport, sempre: telefono e tablet. Il layout del tablet non è una
 * variante cosmetica — è una griglia diversa — e va provato come tale.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [
    // I preset di Playwright per iPhone e iPad puntano a WebKit; qui si usa
    // Chromium con le stesse metriche e il tocco attivo, come da piano: serve
    // provare layout e gesti, non il motore di rendering di Apple, e una CI
    // che scarica un browser invece di tre resta veloce.
    { name: 'telefono', use: { ...devices['iPhone 14'], browserName: 'chromium', hasTouch: true, isMobile: false } },
    { name: 'tablet',   use: { ...devices['iPad (gen 7)'], browserName: 'chromium', hasTouch: true, isMobile: false } },
  ],
  webServer: { command: 'node scripts/serve.mjs', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
})
