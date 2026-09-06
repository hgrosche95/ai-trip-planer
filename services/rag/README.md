# RAG-Service

FastAPI-Service für lokale Embeddings, Ingestion und semantische Suche über
die Wissensbasis in `data/knowledge/`. Läuft komplett lokal über
[fastembed](https://github.com/qdrant/fastembed) (ONNX, CPU) - kein
API-Key, keine laufenden Kosten.

## Setup & Start

Voraussetzung: [uv](https://docs.astral.sh/uv/).

```bash
cd services/rag
uv sync
uv run uvicorn rag_service.main:app --reload --port 8001
```

Swagger-UI unter `http://localhost:8001/docs`.

## Mit Docker (empfohlen für "einfach mal alles starten")

```bash
docker compose up -d       # im Repo-Root - baut das Image beim ersten Mal
docker compose run --rm rag rag-ingest   # Wissensbasis einlesen
```

Das Dockerfile ist mehrstufig (`deps` → `model` → `build` → `runtime`):
Abhängigkeiten und das Embedding-Modell werden in eigenen, gecachten Layern
installiert bzw. heruntergeladen, das Laufzeit-Image läuft als non-root User
und enthält das Modell bereits fertig geladen (kein Download beim ersten
Request - siehe "Warum das Modell vorladen" unten). `docker compose` startet
zusätzlich `postgres` mit; `apps/api`/`apps/web` laufen weiterhin nativ
(siehe [Architektur](../../README.md#architektur-lokal) in der Haupt-README).

**Warum das Modell ins Image vorladen statt beim ersten Request laden?**
Container sind flüchtig - ohne Vorladen würde nicht nur der allererste
Start, sondern **jeder** Neustart (Redeploy, Crash-Restart, Skalierung)
erneut einen Download von HuggingFace auslösen, bevor der Service
antwortet. Das macht die Boot-Zeit unvorhersehbar und hängt von einer
Netzwerkverbindung ab, die es beim Start eigentlich nicht bräuchte -
vorgeladen ist der Boot dagegen immer gleich schnell (~1-2 Sekunden) und
funktioniert auch offline.

OpenAPI-Schema exportieren (bei laufendem Service):
```bash
curl -s http://localhost:8001/openapi.json | python -m json.tool > ../../docs/rag-service-openapi.json
```

## Konfiguration

Siehe `.env.example`. Alle Variablen haben den Präfix `RAG_`:

| Variable | Default | Zweck |
| --- | --- | --- |
| `RAG_EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Muss ein Modell mit 384 Dimensionen sein (passend zur `vector(384)`-Spalte in `apps/api/prisma/schema.prisma`) |
| `RAG_LOG_LEVEL` | `INFO` | Log-Level (strukturiertes JSON-Logging nach stdout) |
| `DATABASE_URL` | lokale Postgres aus `docker-compose.yml` | Dieselbe Datenbank wie `apps/api` - bewusst ohne `RAG_`-Präfix. Nur für die Ingestion-CLI relevant, `/health`/`/embed` brauchen keine DB |
| `RAG_CHUNK_MAX_TOKENS` | `100` | Maximale Chunk-Größe in Tokens (Modell schneidet bei 128 hart ab, siehe unten) |
| `RAG_CHUNK_OVERLAP_TOKENS` | `20` | Überlappung zwischen aufeinanderfolgenden Chunks in Tokens |
| `RAG_RERANK_ENABLED` | `false` | Cross-Encoder-Reranking für `/search` an/aus (Lizenzgrund, siehe unten) |
| `RAG_RERANK_MODEL` | `jinaai/jina-reranker-v2-base-multilingual` | Nur relevant, wenn Reranking aktiv ist |

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

## Suche (`POST /search`)

```json
{ "query": "Was kann man in Wien essen?", "top_k": 5, "min_score": 0.0 }
```

Embedded die Frage, holt per pgvector-Cosine-Distanz die ähnlichsten Chunks
und gibt Text, Score, Dokumenttitel und Quelle zurück. `score` bedeutet je
nach Modus etwas anderes: ohne Reranking `1 - Cosine-Distanz` (ungefähr
0 bis 1, höher = ähnlicher), mit Reranking der rohe Cross-Encoder-Score
(andere Skala, ebenfalls höher = besser) - die Antwort trägt ein `reranked`-
Flag, damit Aufrufer wissen, welche Skala gerade gilt.

**Bi-Encoder vs. Cross-Encoder:** Unser Embedding-Modell (ein Bi-Encoder)
bildet Frage und Chunk *unabhängig voneinander* in denselben Vektorraum ab -
einmal pro Text, das macht Vektorsuche über tausende Chunks überhaupt
praktikabel, ist aber ungenauer. Ein Cross-Encoder bewertet Frage und Chunk
*gemeinsam* in einem Modelldurchlauf - genauer, aber ein eigener Durchlauf
pro Kandidat, also nicht für die ganze Datenbank pro Anfrage machbar.
Deshalb der zweistufige Ablauf bei aktivem Reranking: der Bi-Encoder holt
eine breite Vorauswahl (`top_k * RAG_RERANK_CANDIDATE_MULTIPLIER`, gedeckelt
auf `RAG_RERANK_MAX_CANDIDATES`), der Cross-Encoder sortiert nur diese
engere Auswahl neu.

**Reranking ist standardmäßig deaktiviert:** Das einzige mehrsprachige
Cross-Encoder-Modell in fastembeds Registry
(`jinaai/jina-reranker-v2-base-multilingual`) steht unter
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.de)
(nicht-kommerziell). Für dieses Lern-/Portfolio-Projekt unproblematisch,
aber keine Lizenz, die stillschweigend aktiv sein sollte - deshalb bewusstes
Opt-in per `RAG_RERANK_ENABLED=true`.

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
