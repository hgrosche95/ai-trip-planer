// Zusatzszenen für den Trailer (trailer.py): eine Faktenfrage im klassischen
// Modus mit Quellen aus der RAG-Wissensbasis und das Bearbeiten der Reise, die
// record.cjs gespeichert hat. Braucht deshalb dessen out/state.json und
// out/raw/frames.json (tripUrl). Frames nach out/extras/. Anleitung: README.md.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'https://witty-pond-0504bdc0f.7.azurestaticapps.net';
const OUT = path.join(__dirname, 'out', 'extras');
const STATE = path.join(__dirname, 'out', 'state.json');
const QUESTION = process.env.QUESTION || 'Wie komme ich in Lissabon am besten die Hügel hoch?';
const EDIT = process.env.EDIT || 'Mach Tag 2 zu einem Ausflug nach Sintra';
const { tripUrl } = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'raw', 'frames.json'), 'utf8'));
if (!tripUrl || !fs.existsSync(STATE)) throw new Error('Erst record.cjs laufen lassen (gespeicherte Reise fehlt)');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const frames = [];
const marks = [];

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, proxy, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  // Gleicher Gast wie in record.cjs, damit die gespeicherte Reise sichtbar ist
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'de-DE', ignoreHTTPSErrors: !!proxy, storageState: STATE });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();
  const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log('mark', name, marks.at(-1).t); };
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: (Date.now() - t0) / 1000 });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const glide = (x, y, steps = 25) => page.mouse.move(x, y, { steps });
  const glideTo = async (locator) => { const b = await locator.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); };
  const send = async (text) => {
    const box = page.getByRole('textbox', { name: 'Nachricht' });
    await glideTo(box);
    await box.click();
    await box.pressSequentially(text, { delay: 45 });
    await page.waitForTimeout(400);
    await glideTo(page.getByRole('button', { name: 'Senden' }));
    await page.getByRole('button', { name: 'Senden' }).click();
  };
  const startScreencast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });

  // 1) Klassischer Modus: Faktenfrage, Antwort mit Quellen-Chips
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.getByRole('textbox', { name: 'Nachricht' }).waitFor();
  await page.locator('canvas').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await startScreencast();
  mark('Klassisch');
  const modeSummary = page.locator('summary', { hasText: 'Modus:' });
  await glideTo(modeSummary);
  await modeSummary.click();
  await page.waitForTimeout(700);
  const classic = page.getByRole('radio', { name: /Klassisch/ });
  await glideTo(classic);
  await classic.click();
  await page.waitForTimeout(900);
  await send(QUESTION);
  const sources = page.locator('ul[aria-label^="Quellen"]');
  await sources.first().waitFor({ timeout: 120_000 });
  mark('Quellen');
  await page.waitForTimeout(800);
  await glideTo(sources.first());
  await page.waitForTimeout(3500);
  // Zurück auf Multi-Agent, sonst bleibt der Modus in localStorage hängen
  await page.evaluate(() => localStorage.setItem('trip-planner.agent-mode', 'multi'));

  // 2) Gespeicherte Reise im Chat bearbeiten, Fassung 2 speichern
  mark('Reise');
  await page.goto(tripUrl, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Tag 1', exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const edit = page.getByRole('button', { name: 'Im Chat bearbeiten' }).first();
  await glideTo(edit);
  await edit.click();
  // Bei noch laufendem Chat fragt der Knopf nach
  const yes = page.getByRole('button', { name: /^Ja/ });
  if (await yes.isVisible().catch(() => false)) await yes.click();
  await page.getByRole('heading', { name: 'Entwurf', exact: true }).waitFor({ timeout: 30_000 });
  mark('Bearbeiten');
  await page.waitForTimeout(2000);
  await send(EDIT);
  mark('Überarbeiten');
  await glide(900, 300, 40);
  await page.getByRole('button', { name: 'Fassung 2', exact: true }).waitFor({ timeout: 240_000 });
  mark('Fassung 2');
  await page.waitForTimeout(2500);
  const days = page.locator('section[aria-label^="Tag "]');
  for (let i = 0; i < Math.min(await days.count(), 2); i++) {
    await glideTo(days.nth(i));
    await page.waitForTimeout(1300);
  }
  const save = page.getByRole('button', { name: 'Änderungen speichern' }).first();
  await glideTo(save);
  await save.click();
  // Überholte Fassungen tragen ihr "Gespeichert" versteckt mit
  await page.getByText('Gespeichert', { exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  mark('Gespeichert');
  await page.waitForTimeout(2500);
  mark('Ende');
  await cdp.send('Page.stopScreencast');
  console.log('frames', frames.length, 'dauer', frames.at(-1)?.t);
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; })
  // Auch nach einem Fehler: Die Frames bis dahin bleiben verwertbar
  .finally(() => fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ frames, marks }, null, 1)));
