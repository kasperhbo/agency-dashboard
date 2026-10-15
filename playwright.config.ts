import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', storageState: { cookies: [], origins: ['http://127.0.0.1:5173', 'http://127.0.0.1:4319'].map(origin => ({ origin, localStorage: [{ name: 'agency.mode', value: 'demo' }] })) } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }],
});
