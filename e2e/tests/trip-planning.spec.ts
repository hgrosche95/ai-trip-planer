import { test, expect } from '@playwright/test';

test('Chat-Nachricht führt zu gespeichertem und angezeigtem Reiseplan', async ({ page }) => {
  const username = process.env.E2E_AUTH_USERNAME;
  const password = process.env.E2E_AUTH_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'E2E_AUTH_USERNAME/E2E_AUTH_PASSWORD nicht gesetzt - müssen zum lokalen AUTH_USERNAME/AUTH_PASSWORD_HASH in apps/api/.env passen.',
    );
  }

  await page.goto('/login');
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Passwort').fill(password);
  await page.getByRole('button', { name: 'Einloggen' }).click();
  await page.waitForURL('/');

  const message =
    'Plane für mich eine 3-tägige Reise nach Wien ab 1. September, Gesamtbudget 500 Euro für alles. ' +
    'Interessen: Musik und Kaffeehäuser. Entscheide selbst über Aktivitäten und Essen und speichere den ' +
    'fertigen Plan sofort, ohne nochmal nachzufragen.';

  await page.getByPlaceholder('Beschreib deine Reisewünsche...').fill(message);
  await page.getByRole('button', { name: 'Senden' }).click();

  await expect(page.getByText(/gespeichert/i)).toBeVisible({ timeout: 100_000 });

  await page.goto('/trips');
  const firstTrip = page.getByRole('link', { name: /Wien/i }).first();
  await expect(firstTrip).toBeVisible();
  await firstTrip.click();

  await expect(page.getByRole('heading', { name: 'Tag 1' })).toBeVisible();
});
