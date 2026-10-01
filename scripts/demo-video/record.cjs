// Demo-Video für die Portfolio-Seite: nimmt einen echten Lauf in der Live-App
// per CDP-Screencast auf (JPEG-Frames mit Zeitstempel plus Kapitelmarken).
// assemble.py macht daraus MP4/WebM/WebP. Anleitung: README.md.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'https://witty-pond-0504bdc0f.7.azurestaticapps.net';
const OUT = path.join(__dirname, 'out', 'raw');
const PROMPT = process.env.PROMPT || '3 Tage Lissabon im Oktober, Budget 800 €';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  // Hinter einem Egress-Proxy (Cloud-Umgebung) über diesen ins Netz
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  // Cloud-Umgebung: vorinstalliertes Chromium, falls die Playwright-Version
  // des Repos ein anderes erwartet
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, proxy, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'de-DE', ignoreHTTPSErrors: !!proxy });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const marks = [];
  const t0 = Date.now();
  const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log('mark', name, marks.at(-1).t); };
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: (Date.now() - t0) / 1000 });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  // Sanfte Mausbewegung, damit Hover sichtbar und natürlich wirkt
  let mouse = { x: 640, y: 400 };
  const glide = async (x, y, steps = 25) => { await page.mouse.move(x, y, { steps }); mouse = { x, y }; };
  const glideTo = async (locator) => { const b = await locator.boundingBox(); await glide(b.x + b.width / 2, b.y + b.height / 2); };

  // Neuer Kontext = leerer sessionStorage, also ein frischer Chat
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.getByRole('textbox', { name: 'Nachricht' }).waitFor();
  // Globus (WebGL) und Kartenkacheln müssen da sein, sonst taugt das Video nicht
  await page.locator('canvas').first().waitFor({ timeout: 60_000 });
  const tiles = await page.request.get('https://tiles.openfreemap.org/styles/positron').catch(() => null);
  if (!tiles?.ok()) throw new Error('tiles.openfreemap.org nicht erreichbar: Karte bliebe leer. Netzwerk freigeben (README).');
  await page.waitForTimeout(4000);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  mark('Eingabe');
  await page.waitForTimeout(1500);
  const box = page.getByRole('textbox', { name: 'Nachricht' });
  await glideTo(box);
  await box.click();
  await box.pressSequentially(PROMPT, { delay: 55 });
  if ((await box.inputValue()) !== PROMPT) throw new Error('Eingabe kam nicht im Feld an');
  await page.waitForTimeout(600);
  await glideTo(page.getByRole('button', { name: 'Senden' }));
  await page.getByRole('button', { name: 'Senden' }).click();
  mark('Agenten');
  await glide(900, 300, 40);
  // Warten, bis der Entwurf da ist (echter Lauf: bis zu 3 min)
  await page.getByRole('heading', { name: 'Entwurf' }).waitFor({ timeout: 240_000 });
  mark('Antwort');
  await page.waitForTimeout(2500);
  const days = page.locator('section[aria-label^="Tag "]');
  const n = await days.count();
  for (let i = 0; i < Math.min(n, 3); i++) {
    await glideTo(days.nth(i));
    await page.waitForTimeout(1400);
  }
  await glide(1000, 150, 30);
  await page.waitForTimeout(800);
  await glideTo(page.getByRole('tab', { name: 'Wetter & Budget' }));
  await page.getByRole('tab', { name: 'Wetter & Budget' }).click();
  await page.waitForTimeout(3000);
  mark('Ablauf');
  await glideTo(page.getByRole('tab', { name: 'Ablauf' }));
  await page.getByRole('tab', { name: 'Ablauf' }).click();
  await page.waitForTimeout(800);
  // Zeitleiste der Agenten aufklappen
  const summary = page.locator('[role=tabpanel] details > summary').first();
  if (await summary.count()) { await glideTo(summary); await summary.click(); }
  await page.waitForTimeout(4000);
  await glideTo(page.getByRole('tab', { name: 'Plan', exact: true }));
  await page.getByRole('tab', { name: 'Plan', exact: true }).click();
  await page.waitForTimeout(1200);
  mark('Speichern');
  await glideTo(page.getByRole('button', { name: 'Plan speichern' }));
  await page.getByRole('button', { name: 'Plan speichern' }).click();
  await page.getByRole('link', { name: 'In Meine Reisen ansehen' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await glideTo(page.getByRole('link', { name: 'In Meine Reisen ansehen' }));
  await page.getByRole('link', { name: 'In Meine Reisen ansehen' }).click();
  await page.getByRole('heading', { name: 'Tag 1' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await glide(640, 700, 40);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2500);
  mark('Ende');
  await cdp.send('Page.stopScreencast');
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ frames, marks }, null, 1));
  console.log('frames', frames.length, 'dauer', frames.at(-1)?.t);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
