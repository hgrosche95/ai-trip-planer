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

  // Möglichst wenig Lücken für Rückfragen lassen: explizites Enddatum,
  // Abflugort, Personenzahl. Live-Untersuchung zeigte, dass fehlende Details
  // (z.B. nur "ab 1. September" ohne Enddatum) den Agenten trotz "entscheide
  // selbst" zu einer Rückfrage verleiten - für einen echten Nutzer richtiges
  // Verhalten, aber der häufigste Grund, warum dieser Test sonst random
  // timeout. Interessanterweise macht ein einzelner zusätzlicher Fakt (z.B.
  // nur der Abflugort) es manchmal sogar schlimmer, weil der Agent dann
  // anfängt, reale Flugkosten gegenzurechnen und nach der Budgetaufteilung
  // fragt - deshalb hier alle drei üblichen Lücken auf einmal geschlossen.
  const message =
    'Plane für mich eine 3-tägige Reise nach Wien vom 1. bis 4. September, Abflug ab München, ' +
    'für 1 Person, Gesamtbudget 500 Euro für alles. Interessen: Musik und Kaffeehäuser. Entscheide ' +
    'selbst über Aktivitäten, Essen und die Budgetaufteilung und speichere den fertigen Plan sofort, ' +
    'ohne nochmal nachzufragen.';

  await page.getByPlaceholder('Beschreib deine Reisewünsche...').fill(message);
  await page.getByRole('button', { name: 'Senden' }).click();

  // Auch mit einer vollständig spezifizierten Erstnachricht bleibt eine
  // Restwahrscheinlichkeit für eine Rückfrage (live gemessen: ca. jeder
  // zweite Lauf brauchte diesen zweiten Turn, dann aber zuverlässig
  // erfolgreich). Ein Einzelschritt-Test, der stur auf die erste Antwort
  // wartet, würde daran zeitweise scheitern - ein echter Nutzer würde auf
  // eine Rückfrage schlicht antworten. Das bildet dieser Fallback nach,
  // statt eine perfekte Erstantwort per Prompt-Wortwahl erzwingen zu wollen.
  const saved = page.getByText(/gespeichert/i);
  try {
    await expect(saved).toBeVisible({ timeout: 45_000 });
  } catch {
    await page
      .getByPlaceholder('Beschreib deine Reisewünsche...')
      .fill(
        'Nutze für alle offenen Details plausible Annahmen (1 Reisender, Abflug München, Budget frei ' +
          'auf Flug/Hotel/Aktivitäten aufteilen) und speichere den Plan jetzt ohne weitere Rückfragen.',
      );
    await page.getByRole('button', { name: 'Senden' }).click();
    await expect(saved).toBeVisible({ timeout: 60_000 });
  }

  await page.goto('/trips');
  const firstTrip = page.getByRole('link', { name: /Wien/i }).first();
  await expect(firstTrip).toBeVisible();
  await firstTrip.click();

  await expect(page.getByRole('heading', { name: 'Tag 1' })).toBeVisible();
});
