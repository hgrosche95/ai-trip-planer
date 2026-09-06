from enum import Enum

from pydantic import BaseModel, Field


class InputType(str, Enum):
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
