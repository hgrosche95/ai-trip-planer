# syntax=docker/dockerfile:1
#
# Build-Kontext ist das Repo-Root (siehe docker-compose.yml), analog zu
# apps/api/Dockerfile - Pfade unten sind deshalb relativ zum Repo-Root.

# ---- deps: nur Abhängigkeiten installieren. Dieser Layer bleibt gecacht,
# solange pyproject.toml/uv.lock unverändert sind, unabhängig davon, wie oft
# sich der Quellcode ändert ----
FROM python:3.12-slim AS deps
RUN pip install --no-cache-dir uv==0.12.5
WORKDIR /app/services/rag
COPY services/rag/pyproject.toml services/rag/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# ---- model: Embedding-Modell einmalig ins Image laden. Ohne diesen Schritt
# würde der ERSTE Request nach JEDEM Container-Start (nicht nur beim
# allerersten Mal - Container sind flüchtig) das ONNX-Modell erst von
# HuggingFace herunterladen müssen, bevor er beantwortet werden kann. Das
# wäre bei jedem Neustart/Scale-Up ein spürbarer, unvorhersehbarer
# Cold-Start statt eines schnellen, immer gleich langsamen Boots. ----
FROM deps AS model
ENV FASTEMBED_CACHE_PATH=/app/services/rag/.fastembed_cache
# --no-sync: der Quellcode (src/rag_service) ist in diesem Stage noch nicht
# kopiert, `uv run` würde sonst versuchen, das Projekt zu bauen, um es zu
# syncen - für den reinen Modell-Download ist nur fastembed nötig, das
# schon im deps-Layer installiert ist.
RUN uv run --no-sync python -c "\
from fastembed import TextEmbedding; \
TextEmbedding(model_name='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# ---- build: Quellcode dazu, das Projekt selbst installieren (schnell, da
# die Abhängigkeiten schon im gecachten deps-Layer stehen) ----
FROM model AS build
COPY services/rag/src ./src
RUN uv sync --frozen --no-dev

# ---- runtime: schlankes, von deps/model/build unabhängiges Basis-Image,
# non-root User. onnxruntime (fastembeds Inferenz-Engine) braucht libgomp1
# für Multi-Threading - in python:3.12-slim nicht enthalten. ----
FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system raguser && useradd --system --gid raguser raguser

WORKDIR /app/services/rag
ENV FASTEMBED_CACHE_PATH=/app/services/rag/.fastembed_cache \
    PATH="/app/services/rag/.venv/bin:${PATH}"

COPY --from=build --chown=raguser:raguser /app/services/rag /app/services/rag

USER raguser
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health', timeout=3)" || exit 1

CMD ["uvicorn", "rag_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
