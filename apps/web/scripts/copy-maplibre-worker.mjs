// Kopiert den Web-Worker von MapLibre (ab v6 eine eigene Datei) nach
// public/maplibre/. MapLibre sucht ihn sonst neben seinem eigenen Modul
// (import.meta.url), nach dem Bundling also im Chunk-Ordner, wo er fehlt:
// "Worker failed to load", die Karte bleibt ohne Kacheln.
// Der Worker importiert maplibre-gl-shared.mjs relativ, deshalb beide.
// Läuft vor dev und build (predev/prebuild), so passt die Kopie immer zur
// installierten Version.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(target, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(dist, file), join(target, file));
}
