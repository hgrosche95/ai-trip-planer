// Rendert die Texteinblendungen des Trailers als transparente PNGs
// (1280x800) per Playwright. Aufruf durch trailer.py:
//   node overlays.cjs <specs.json> <ausgabeordner>
// Stil wie die Portfolio-Seite: dunkle Fläche, Bricolage Grotesque für
// Überschriften, IBM Plex für Text, Kupfer als Akzent.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [specFile, outDir] = process.argv.slice(2);
const specs = JSON.parse(fs.readFileSync(specFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const css = `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 800px; background: transparent; overflow: hidden; }
  body { font-family: 'IBM Plex Sans', system-ui, sans-serif; color: #e4e9ee; -webkit-font-smoothing: antialiased; }
  .eyebrow { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 14px; font-weight: 500;
    letter-spacing: .16em; text-transform: uppercase; color: #e08a4f; }
  h1, h2 { font-family: 'Bricolage Grotesque', 'IBM Plex Sans', sans-serif; font-weight: 700; letter-spacing: -.02em; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .chip { font-family: 'IBM Plex Mono', monospace; font-size: 15px; padding: 7px 14px; border-radius: 999px;
    border: 1px solid #3b4855; background: rgba(27,37,47,.85); color: #c9d2da; }
  .chip b { color: #e08a4f; font-weight: 500; }

  /* Bauchbinde unten links, darunter ein weicher Verlauf für die Lesbarkeit */
  .shade { position: absolute; inset: auto 0 0 0; height: 340px;
    background: linear-gradient(to top, rgba(10,14,18,.78), rgba(10,14,18,0)); }
  .caption { position: absolute; left: 56px; bottom: 52px; max-width: 640px; padding: 20px 26px 22px 28px;
    border-radius: 14px; background: rgba(15,21,27,.9); border: 1px solid #2c3946;
    box-shadow: 0 18px 50px -12px rgba(0,0,0,.6); }
  .caption::before { content: ''; position: absolute; left: 0; top: 18px; bottom: 18px; width: 4px;
    border-radius: 0 4px 4px 0; background: #e08a4f; }
  .caption h2 { font-size: 36px; line-height: 1.08; margin-top: 8px; }
  .caption p { font-size: 18px; line-height: 1.45; color: #b6c1cb; margin-top: 10px; text-wrap: pretty; }
  .caption.right { left: auto; right: 56px; }
  .caption.top { bottom: auto; top: 48px; }

  /* Titel- und Schlusskarte: fast deckend, das Bild dahinter schimmert durch */
  .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; gap: 18px;
    background: radial-gradient(ellipse at 50% 45%, rgba(15,21,27,.72), rgba(10,14,18,.96) 70%); }
  .card h1 { font-size: 104px; line-height: 1; }
  .card h1 span { color: #e08a4f; }
  .card .lead { font-size: 24px; color: #b6c1cb; max-width: 820px; line-height: 1.4; text-wrap: balance; }
  .card .url { font-family: 'IBM Plex Mono', monospace; font-size: 24px; color: #e4e9ee; padding: 14px 24px;
    border: 1.5px solid #e08a4f; border-radius: 12px; background: rgba(42,30,22,.7); }
  .card .small { font-family: 'IBM Plex Mono', monospace; font-size: 14px; color: #8f9ba7; letter-spacing: .04em; }
  .rule { width: 72px; height: 3px; background: #e08a4f; border-radius: 2px; }
`;

function body(s) {
  if (s.kind === 'title') {
    return `<div class="card">
      <div class="eyebrow">${esc(s.eyebrow)}</div>
      <h1>${s.titleHtml}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(s.text)}</p>
      <div class="chips" style="margin-top:10px">${(s.chips || []).map((c) => `<span class="chip">${c}</span>`).join('')}</div>
    </div>`;
  }
  if (s.kind === 'end') {
    return `<div class="card">
      <div class="eyebrow">${esc(s.eyebrow)}</div>
      <h1>${s.titleHtml}</h1>
      <p class="lead">${esc(s.text)}</p>
      <div class="url">${esc(s.url)}</div>
      <p class="small">${esc(s.small)}</p>
    </div>`;
  }
  const pos = [s.align === 'right' ? 'right' : '', s.valign === 'top' ? 'top' : ''].join(' ');
  return `${s.valign === 'top' ? '' : '<div class="shade"></div>'}
    <div class="caption ${pos}">
      <div class="eyebrow">${esc(s.eyebrow)}</div>
      <h2>${esc(s.title)}</h2>
      ${s.text ? `<p>${esc(s.text)}</p>` : ''}
    </div>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const fonts = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=block';
  for (const s of specs) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>${css}</style></head><body>${body(s)}</body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, `${s.name}.png`), omitBackground: true });
    console.log('overlay', s.name);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
