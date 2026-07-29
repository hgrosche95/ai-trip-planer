import { test, expect } from '@playwright/test';

test('Chat-Nachricht führt zu gespeichertem und angezeigtem Reiseplan', async ({ page }) => {
  await page.goto('/');

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
