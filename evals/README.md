# Eval-Harness (`evals`)

Misst automatisch, ob RAG-Suche und Agent noch so gut funktionieren wie
erwartet – gegen ein festes Golden Dataset statt gegen das Bauchgefühl.

## Ausführen

Voraussetzung: Postgres + RAG-Service laufen (`docker compose up -d`) und
`apps/api` läuft lokal (`cd apps/api && npm run start:dev`).

```bash
cd evals
npm install
TRIP_PLANNER_USERNAME=dein-username TRIP_PLANNER_PASSWORD=dein-passwort npm run eval
```

Schreibt einen Markdown-Report nach `evals/reports/<Zeitstempel>.md` (nicht
eingecheckt, siehe `.gitignore`) und beendet sich mit Exit-Code 1, wenn eine
der Schwellen unterschritten wird – dieselbe Mechanik, die daraus in Phase 7
ein CI-Gate macht.

### Konfiguration (Env)

| Variable | Default | Zweck |
| --- | --- | --- |
| `RAG_SERVICE_URL` | `http://localhost:8001` | Basis-URL für die direkte Retrieval-Messung |
| `TRIP_PLANNER_API_URL` | `http://localhost:3000` | Basis-URL für die Tool-Call-Messung gegen den echten Agenten |
| `TRIP_PLANNER_USERNAME` / `TRIP_PLANNER_PASSWORD` | – (Pflicht) | Login für `POST /agent/chat`, wie in `apps/api/.env` |
| `EVAL_TOP_K` | `3` | k für Recall@k/MRR – Standardwert entspricht `RAG_SEARCH_TOP_K` in `apps/api` |
| `EVAL_MIN_RECALL` | `0.8` | Schwelle für Exit-Code |
| `EVAL_MIN_MRR` | `0.6` | Schwelle für Exit-Code |
| `EVAL_MIN_TOOL_ACCURACY` | `0.8` | Schwelle für Exit-Code |
| `EVAL_JUDGE_ENABLED` | `false` | LLM-as-Judge zuschalten (siehe unten) |
| `GROQ_API_KEY` / `GROQ_MODEL` | – | Nur nötig, wenn `EVAL_JUDGE_ENABLED=true` |

## Golden Dataset (`golden-dataset.json`)

8 handkuratierte Fragen gegen die vier vorhandenen Reiseziel-Dokumente in
`data/knowledge/`, plus ein Small-Talk-Fall ohne erwarteten Tool-Aufruf:

```json
{
  "id": "wien-essen",
  "question": "Was kann man in Wien traditionell essen?",
  "expected_document": "Wien – Reiseziel-Überblick",
  "expected_tool": "search_travel_knowledge"
}
```

`expected_document`/`expected_tool: null` markiert Fälle wie Small Talk, bei
denen weder eine Wissenssuche noch ein Retrieval-Treffer erwartet wird.

## Die Metriken

**Recall@k** – Anteil der Fragen, bei denen das erwartete Dokument
irgendwo unter den ersten k Treffern der RAG-Suche lag. Beantwortet nur
„gefunden, ja oder nein?“ – Platz 1 und Platz k zählen gleich.

**MRR (Mean Reciprocal Rank)** – Durchschnitt von `1 / Rang` des ersten
Treffers (0, wenn gar nicht gefunden). Beantwortet zusätzlich „wie weit
oben?“. Zwei Läufe können identisches Recall@k haben, aber sehr
unterschiedliches MRR: findet die Suche das richtige Dokument immer auf
Platz 1, ist MRR 1,0; findet sie es immer erst auf Platz k, ist MRR nur
`1/k` – bei gleichem Recall@k. Das ist hier nicht nur akademisch: `services/rag`
liefert per `RAG_SEARCH_TOP_K` nur wenige Chunks an den Agenten (kleines k
spart Tokens im 8.000-TPM-Budget von Groq). Ein niedriger MRR bei gutem
Recall@k heißt, der richtige Chunk würde eine weitere Verkleinerung von k
nicht überleben – ein Risiko, das Recall@k allein verschweigt.

**Tool-Genauigkeit** – Anteil der Fragen, bei denen der echte Agent
(`POST /agent/chat`) die erwartete Tool-Entscheidung getroffen hat. Zählt
auch „bewusst kein Tool aufgerufen“ (Small Talk) als korrekt, nicht nur
„richtiges Tool aufgerufen“.

**LLM-as-Judge (optional)** – Groq bewertet die finale Antwort des Agenten
auf einer 1–5-Skala danach, ob sie die Frage korrekt und erkennbar durch das
erwartete Dokument belegt beantwortet. Abschaltbar (Default: aus), weil jeder
Judge-Aufruf ein zusätzlicher, ratenlimitierter LLM-Aufruf ist und
subjektiver als die harten Retrieval-/Tool-Metriken.

## Zum Experimentieren

Chunk-Größe/-Overlap in `services/rag` ändern, Wissensbasis neu einlesen
(`rag-ingest`) und den Eval-Lauf wiederholen: Recall@k bleibt oft stabil,
während sich MRR deutlich verschiebt – genau der Effekt, den die Metrik
sichtbar machen soll, den ein reines Recall@k verschweigt.
