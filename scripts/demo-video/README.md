# Demo-Video für die Portfolio-Seite

Nimmt einen echten Lauf in der Live-App auf und erzeugt die Dateien für
`henrikgrosche.is-a.dev`: 1280×800, ca. 47,5 s, ohne Ton. Die Kapitel liegen
auf denselben Zeiten wie im bisherigen Video:

| Kapitel   | Zeit | Im Video |
|-----------|------|----------|
| Eingabe   | 0:00 | Prompt tippen, senden |
| Agenten   | 0:10 | Agenten arbeiten (beschleunigt) |
| Antwort   | 0:21 | Entwurf mit Ticket-Tagen und Stadtkarte, Hover über die Tage |
| Ablauf    | 0:34 | „Wetter & Budget“, dann „Ablauf“ mit Zeitleiste |
| Speichern | 0:42 | „Plan speichern“, gespeicherte Reise |

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

## Prompt für eine neue Claude-Code-Session

> Nimm mit `scripts/demo-video` (siehe README) ein neues Demo-Video vom
> AI Trip Planner auf: `setup.sh`, `record.cjs`, `assemble.py`. Prüfe das
> Ergebnis anhand einiger Einzelbilder (Karte mit Kacheln sichtbar,
> Ticket-Tage, Kapitel an den richtigen Stellen) und schick mir MP4, WebM
> und das WebP-Poster.
