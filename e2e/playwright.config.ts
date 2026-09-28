import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // War 120_000 - die Chat-Antwort allein darf schon bis zu 100s dauern (mehrere
  // Tool-Calls), der neue Login-Schritt vor dem Chat hat das knappe Restbudget
  // gesprengt (Timeout mitten im finalen .click(), obwohl das Element sichtbar war).
  // 240s statt 150s: mit Groq ruft der Agent die Tools nacheinander auf (bis
  // zu 8 Runden), der Reiseplan-Test braucht mit Rückfrage-Fallback daher
  // zwei lange Chat-Antworten à bis zu 90s.
  timeout: 240_000,
  // In CI nacheinander statt parallel: beide Tests rufen das LLM auf, und das
  // kostenlose Groq-Tier hat ein Token-pro-Minute-Limit - parallel laufende
  // Agenten-Chats landen sonst in 429-Wartezeiten und reißen die Timeouts.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3001',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: '../apps/api',
      url: 'http://localhost:3000/health',
      // API-Logs (LLM-Aufrufe, Rate-Limit-Warnungen) im Testlauf sichtbar
      // machen - ohne 'pipe' landet nur stderr im CI-Log.
      stdout: 'pipe',
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
