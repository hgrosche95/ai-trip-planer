# Demo-Video für die Portfolio-Seite

Nimmt einen echten Lauf in der Live-App auf und erzeugt die Dateien für
`henrikgrosche.is-a.dev`: 1280×800, ca. 47,5 s, ohne Ton. Die Kapitel liegen
auf diesen Zeiten (`TARGET` in `assemble.py`, Länge 48 s):

| Kapitel   | Zeit   | Im Video |
|-----------|--------|----------|
| Eingabe   | 0:00   | Prompt tippen, senden |
| Agenten   | 0:09,5 | Agenten arbeiten (beschleunigt) |
| Antwort   | 0:20   | Entwurf mit Ticket-Tagen und Stadtkarte, Hover über die Tage |
| Ablauf    | 0:31   | „Wetter & Budget“, dann „Ablauf“ mit Zeitleiste |
| Speichern | 0:38,5 | „Plan speichern“, gespeicherte Reise mit Budget und Annahmen in der Kopfkarte |

## Voraussetzungen

- Netzwerk: `tiles.openfreemap.org` muss erreichbar sein (Kartenkacheln),
  dazu die Live-App und ihre API. In Claude Code on the web: in den
  Umgebungseinstellungen unter „Network access“ freigeben, dann eine **neue**
  Session starten. `record.cjs` bricht ab, wenn die Kacheln fehlen.
- `npm install` im Repo (Playwright kommt über `e2e/`).
- Ein Lauf verbraucht etwas LLM-Kontingent der Live-Demo.

## Aufnehmen

```bash
scripts/demo-video/setup.sh              # ffmpeg nach .bin/
node scripts/demo-video/record.cjs       # Frames nach out/raw/
python3 scripts/demo-video/assemble.py   # out/trip-planer.mp4, .webm, ai-trip-planer.webp
```

Optionen per Umgebungsvariable: `BASE` (andere URL der App), `PROMPT`
(anderer Reisewunsch), `CHROMIUM_PATH` (eigener Browser), `FFMPEG`.

Vor dem Hochladen die Kapitelzeiten prüfen; weichen sie ab, `TARGET` in
`assemble.py` anpassen. Das Poster ist der Moment kurz nach „Antwort“.
`record.cjs` bricht ab, wenn die Stadtkarte keine Vektorkacheln lädt (z. B.
ohne MapLibre-Worker, siehe #119), statt ein Video mit grauer Karte zu liefern.

## Trailer

Ein schnellerer Schnitt (ca. 60 s, stumm, 1280×800) mit Titelkarte,
Erklärtexten, Zooms auf Details und Schlusskarte mit Live-Link. Er nutzt die
Frames von `record.cjs` und eine zweite Aufnahme mit Zusatzszenen:

```bash
node scripts/demo-video/record.cjs          # erst das, liefert out/state.json + gespeicherte Reise
node scripts/demo-video/record-extras.cjs   # klassischer Modus mit Quellen, Reise im Chat bearbeiten
python3 scripts/demo-video/trailer.py       # out/trailer.mp4, .webm, .webp
```

- `record-extras.cjs` stellt im klassischen Modus eine Faktenfrage
  (`QUESTION`) und wartet auf die Quellen-Chips der RAG-Wissensbasis. Danach
  öffnet es die von `record.cjs` gespeicherte Reise (gleicher Gast über
  `out/state.json`), bearbeitet sie im Chat (`EDIT`) und speichert Fassung 2.
  Kostet zwei weitere LLM-Läufe. Ist die Reise schon so geändert, ein anderes
  `EDIT` wählen.
- `trailer.py` legt Schnitt, Zooms und Texte in `SHOTS` und `OVERLAYS` fest.
  Die Einstellungen hängen an den Marken der Aufnahmen (`mark(...)`), passen
  sich also an andere Laufzeiten an. Gerendert wird mit Pillow (Zoom per
  Float-Ausschnitt, ruckelfrei) und per Pipe an ffmpeg. Braucht `pip install pillow`.
- Kodiert wird aus einem verlustfreien Master per 2-Pass auf `TARGET_KB`
  (Standard 2400, die Portfolio-Grenze für MP4 liegt bei 2,5 MB). Am Ende
  druckt das Skript die Kapitelzeiten fürs Frontmatter der Portfolio-Seite.
- `overlays.cjs` rendert die Texte als HTML per Playwright zu transparenten
  PNGs, im Stil der Portfolio-Seite (Bricolage Grotesque, IBM Plex, Kupfer).
  Die Schriften kommen von Google Fonts.

## Prompt für eine neue Claude-Code-Session

> Nimm mit `scripts/demo-video` (siehe README) ein neues Demo-Video vom
> AI Trip Planner auf: `setup.sh`, `record.cjs`, `assemble.py`. Prüfe das
> Ergebnis anhand einiger Einzelbilder (Karte mit Kacheln sichtbar,
> Ticket-Tage, Kapitel an den richtigen Stellen) und schick mir MP4, WebM
> und das WebP-Poster.
