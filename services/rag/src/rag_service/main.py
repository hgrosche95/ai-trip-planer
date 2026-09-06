import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from rag_service.config import get_settings
from rag_service.embeddings import EmbeddingService
from rag_service.logging_config import configure_logging
from rag_service.schemas import EmbedRequest, EmbedResponse, HealthResponse

logger = logging.getLogger(__name__)

_state: dict[str, EmbeddingService] = {}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    # Einmal beim Start laden statt pro Request: das ONNX-Modell zu laden
    # dauert spürbar (Modelldatei lesen + Runtime initialisieren), ein
    # Reload pro Anfrage würde /embed für jeden Aufruf unnötig verlangsamen.
    _state["embedding_service"] = EmbeddingService(settings.embedding_model)
    yield
    _state.clear()


app = FastAPI(title="RAG Service", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    service = _state["embedding_service"]
    return HealthResponse(status="ok", model=service.model_name)


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    service = _state["embedding_service"]
    vectors = service.embed(request.texts, request.input_type)
    return EmbedResponse(
        embeddings=vectors,
        model=service.model_name,
        dimensions=service.dimensions,
    )
