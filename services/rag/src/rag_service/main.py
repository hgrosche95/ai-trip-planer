import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI

from rag_service.config import get_settings
from rag_service.db import DocumentRepository
from rag_service.embeddings import EmbeddingService
from rag_service.logging_config import configure_logging
from rag_service.reranking import Reranker
from rag_service.schemas import (
    EmbedRequest,
    EmbedResponse,
    HealthResponse,
    SearchRequest,
    SearchResponse,
    SearchResult,
)
from rag_service.search import perform_search

logger = logging.getLogger(__name__)

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    # Einmal beim Start laden statt pro Request: das ONNX-Modell zu laden
    # dauert spürbar (Modelldatei lesen + Runtime initialisieren), ein
    # Reload pro Anfrage würde /embed für jeden Aufruf unnötig verlangsamen.
    _state["embedding_service"] = EmbeddingService(settings.embedding_model)
    _state["settings"] = settings

    # Reranker nur laden, wenn per Env aktiviert (Default aus, siehe
    # config.py - Lizenzgrund) - sonst würde jeder Start des Service
    # ungefragt ein zusätzliches ~1GB-Modell herunterladen.
    if settings.rerank_enabled:
        _state["reranker"] = Reranker(settings.rerank_model)

    # Bewusst KEINE Datenbankverbindung hier im Lifespan: /health und /embed
    # brauchen keine DB. Würde die DB-Verbindung hier beim Start erzwungen,
    # würde ein nicht erreichbares Postgres den kompletten Service inklusive
    # embedding-only-Endpunkten lahmlegen - dieselbe Klasse von Fehler wie
    # der Produktions-Bug aus Phase 1 (ein nicht benötigter Anbieter hat
    # beim Start alles blockiert). /search öffnet ihre eigene Verbindung.
    yield
    _state.clear()


app = FastAPI(title="RAG Service", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    service: EmbeddingService = _state["embedding_service"]
    return HealthResponse(status="ok", model=service.model_name)


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    service: EmbeddingService = _state["embedding_service"]
    vectors = service.embed(request.texts, request.input_type)
    return EmbedResponse(
        embeddings=vectors,
        model=service.model_name,
        dimensions=service.dimensions,
    )


@app.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    settings = _state["settings"]
    embedder: EmbeddingService = _state["embedding_service"]
    reranker: Reranker | None = _state.get("reranker")

    with DocumentRepository(settings.database_url) as repo:
        hits = perform_search(
            repo,
            embedder,
            request.query,
            top_k=request.top_k,
            min_score=request.min_score,
            reranker=reranker,
            candidate_multiplier=settings.rerank_candidate_multiplier,
            max_candidates=settings.rerank_max_candidates,
        )

    return SearchResponse(
        results=[
            SearchResult(
                content=hit.content,
                score=hit.score,
                document_title=hit.document_title,
                document_source=hit.document_source,
                document_url=hit.document_url,
            )
            for hit in hits
        ],
        reranked=reranker is not None,
    )
