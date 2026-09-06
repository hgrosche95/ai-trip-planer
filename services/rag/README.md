# RAG-Service

FastAPI-Service für lokale Embeddings, Ingestion und (ab Schritt 3.3)
semantische Suche über die Wissensbasis in `data/knowledge/`. Läuft
komplett lokal über [fastembed](https://github.com/qdrant/fastembed) (ONNX,
CPU) - kein API-Key, keine laufenden Kosten.

## Setup & Start

Voraussetzung: [uv](https://docs.astral.sh/uv/).

```bash
cd services/rag
uv sync
uv run uvicorn rag_service.main:app --reload --port 8001
```

Swagger-UI unter `http://localhost:8001/docs`.

## Konfiguration

Siehe `.env.example`. Alle Variablen haben den Präfix `RAG_`:

| Variable | Default | Zweck |
| --- | --- | --- |
| `RAG_EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Muss ein Modell mit 384 Dimensionen sein (passend zur `vector(384)`-Spalte in `apps/api/prisma/schema.prisma`) |
| `RAG_LOG_LEVEL` | `INFO` | Log-Level (strukturiertes JSON-Logging nach stdout) |
| `DATABASE_URL` | lokale Postgres aus `docker-compose.yml` | Dieselbe Datenbank wie `apps/api` - bewusst ohne `RAG_`-Präfix. Nur für die Ingestion-CLI relevant, `/health`/`/embed` brauchen keine DB |
| `RAG_CHUNK_MAX_TOKENS` | `100` | Maximale Chunk-Größe in Tokens (Modell schneidet bei 128 hart ab, siehe unten) |
| `RAG_CHUNK_OVERLAP_TOKENS` | `20` | Überlappung zwischen aufeinanderfolgenden Chunks in Tokens |

## Wissensbasis einlesen (Ingestion)

```bash
uv run rag-ingest
```

Liest alle `.md`-Dateien aus `data/knowledge/` (außer `README.md`), teilt sie
in überlappende Chunks, erzeugt Embeddings und schreibt beides nach Postgres
(`Document`/`DocumentChunk`, siehe `apps/api/prisma/schema.prisma`).

**Idempotent:** Jede Datei wird über einen sha256-Hash ihres Inhalts erkannt.
Ein zweiter Lauf ohne Änderungen schreibt nichts neu (`"übersprungen"` im
Log). Ändert sich eine Datei, wird nur diese neu gechunkt und eingebettet -
alle anderen bleiben unangetastet.

**Chunk-Größe (100 Tokens, 20 Overlap):** Das Modell schneidet bei 128
Tokens hart ab (`tokenizer.truncation["max_length"]`, live geprüft) - alles
darüber würde beim Embedden unbemerkt verloren gehen. 100 statt 128 lässt
Puffer, weil deutsche Komposita in mehr Subword-Tokens zerfallen als
vergleichbare englische Wörter. Chunks werden an Absatzgrenzen gebildet
(nicht mitten im Satz), 20 Tokens Overlap verhindern, dass ein Gedanke genau
auf einer Chunk-Grenze ohne Kontext landet.

## Warum dieses Modell

`TextEmbedding.list_supported_models()` liefert genau ein mehrsprachiges
Modell mit 384 Dimensionen:
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (~50 Sprachen,
kein Query-/Passage-Präfix nötig). `intfloat/multilingual-e5-small` (das
E5-Modelle mit Präfix-Konvention "query: "/"passage: ") gibt es in fastembeds
Registry nicht - nur die 1024-dimensionale `-large`-Variante, die nicht zur
bestehenden `vector(384)`-Spalte passen würde. `embeddings.py` kapselt die
Präfix-Logik trotzdem (`_apply_prefix`), damit ein späterer Wechsel auf ein
E5-Modell (bei Bedarf für höhere Retrieval-Qualität, dann mit neuer Migration
für die geänderte Dimension) keine Aufrufer anpassen müsste.

## Tests

```bash
uv run pytest
```
