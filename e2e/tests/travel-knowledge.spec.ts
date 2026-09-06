import { test, expect } from '@playwright/test';

test('Wissensfrage zu einem Reiseziel zeigt eine Quellenanzeige', async ({ page }) => {
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

  await page
    .getByPlaceholder('Beschreib deine Reisewünsche...')
    .fill('Was kann man in Lissabon essen und trinken?');
  await page.getByRole('button', { name: 'Senden' }).click();

  const sourcesToggle = page.getByText(/^Quellen \(\d+\)$/);
  await expect(sourcesToggle).toBeVisible({ timeout: 100_000 });

  await sourcesToggle.click();
  // Mehrere Chunks desselben Dokuments können als getrennte Quellen
  // auftauchen (jeder Chunk ist eine eigene Textstelle) - .first() statt
  // eines strikten Einzeltreffers.
  await expect(page.getByText('Lissabon – Reiseziel-Überblick').first()).toBeVisible();
  await expect(page.getByText(/Relevanz/).first()).toBeVisible();
});
