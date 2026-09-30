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
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL('/');

  await page
    .getByRole('textbox', { name: 'Nachricht' })
    .fill('Was kann man in Lissabon essen und trinken?');
  await page.getByRole('button', { name: 'Senden' }).click();

  const sources = page.getByRole('list', { name: /^Quellen \(\d+\)$/ });
  await expect(sources).toBeVisible({ timeout: 100_000 });

  // Bewusst nicht auf einen konkreten Dokumenttitel (z.B. "Lissabon")
  // geprüft: welche Quelle das Modell exakt zitiert, hängt davon ab, wie
  // es die Suchanfrage an search_travel_knowledge formuliert - das kann
  // sich zwischen Providern und von Lauf zu Lauf unterscheiden. Getestet
  // wird die Funktion (Quellenanzeige mit echtem Inhalt erscheint), nicht
  // die exakte Trefferwahl der Suche.
  await expect(sources.getByRole('listitem').first()).toBeVisible();
  await expect(sources.getByText(/\d+%/).first()).toBeVisible();
});
