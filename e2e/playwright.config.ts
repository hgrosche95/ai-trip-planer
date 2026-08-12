import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // War 120_000 - die Chat-Antwort allein darf schon bis zu 100s dauern (mehrere
  // Tool-Calls), der neue Login-Schritt vor dem Chat hat das knappe Restbudget
  // gesprengt (Timeout mitten im finalen .click(), obwohl das Element sichtbar war).
  timeout: 150_000,
  use: {
    baseURL: 'http://localhost:3001',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: '../apps/api',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      cwd: '../apps/web',
      url: 'http://localhost:3001',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
