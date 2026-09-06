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
  // Bewusst nicht auf einen konkreten Dokumenttitel (z.B. "Lissabon")
  // geprüft: welche Quelle das Modell exakt zitiert, hängt davon ab, wie
  // es die Suchanfrage an search_travel_knowledge formuliert - das kann
  // sich zwischen Groq (lokal) und Anthropic (CI) unterscheiden. Getestet
  // wird die Funktion (Quellenanzeige mit echtem Inhalt erscheint), nicht
  // die exakte Trefferwahl der Suche.
  await expect(page.getByRole('listitem').first()).toBeVisible();
  await expect(page.getByText(/Relevanz/).first()).toBeVisible();
});
