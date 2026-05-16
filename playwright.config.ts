import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for NexMedicon HMS
 * 
 * SETUP:
 * 1. npm install -D @playwright/test
 * 2. npx playwright install
 * 3. Make sure your app is running: npm run dev
 * 4. Run tests: npx playwright test
 * 5. See report: npx playwright show-report
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,          // run tests sequentially (they share state)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                    // one worker to avoid conflicts
  reporter: 'html',
  timeout: 30000,                // 30 seconds per test

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start your dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,   // don't restart if already running
    timeout: 120000,
  },
})
