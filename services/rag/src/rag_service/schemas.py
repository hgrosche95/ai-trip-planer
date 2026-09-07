from enum import StrEnum

from pydantic import BaseModel, Field


class InputType(StrEnum):
    """Ob ein Text eine Suchanfrage oder ein zu indexierendes Dokument ist.

    Bei Präfix-Modellen wie der E5-Familie (intfloat/multilingual-e5-*)
    werden Anfrage- und Dokumenttexte unterschiedlich vorverarbeitet - siehe
    embeddings.py. Für das aktuell konfigurierte Modell hat dieses Feld
    keine Auswirkung, existiert aber, damit ein Modellwechsel später keine
    Breaking Change am API-Vertrag ist.
    """

    QUERY = "query"
    PASSAGE = "passage"


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, description="Zu embeddende Texte")
    input_type: InputType = Field(
        default=InputType.PASSAGE,
        description="query für Suchanfragen, passage für zu indexierende Dokumente",
    )


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int


class HealthResponse(BaseModel):
    status: str
    model: str


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    min_score: float = Field(
        default=0.0,
        description="Minimaler Ähnlichkeits-Score (siehe SearchResult.score). 0.0 = keine Filterung.",
    )


class SearchResult(BaseModel):
    content: str
    score: float = Field(
        description=(
            "Ohne Reranking: 1 - Cosine-Distanz (ungefähr 0..1, höher = ähnlicher). "
            "Mit Reranking: roher Cross-Encoder-Score (andere Skala, ebenfalls höher = besser)."
        )
    )
    document_title: str
    document_source: str
    document_url: str | None
    document_license: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    reranked: bool
