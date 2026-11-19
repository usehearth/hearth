// User-journey tests: the browser build (Vite dev server) against a fake Hearth server (test/fake-server), one fake
// server per test. `npx playwright test` runs them; `npx playwright test --ui` to watch. Known failures are marked
// `test.fail()` with a one-line reason, so the suite stays green while they are tracked (a fixed one turns red: then
// remove its mark).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5191);

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
