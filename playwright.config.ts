import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (npm run e2e builds it first) with a throwaway profile.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
})
