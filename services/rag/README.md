# RAG-Service

FastAPI-Service für lokale Embeddings und (ab Schritt 3.2/3.3) Ingestion und
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
