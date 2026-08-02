import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // One worker. Every spec here registers against the same Supabase instance,
  // and two concurrent sign-ups trip its auth rate limit — which surfaced as a
  // sign-up that simply never completed, in whichever spec happened to lose.
  // These tests share one backend; running them in parallel was never safe.
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
