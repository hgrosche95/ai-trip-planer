import logging

from fastembed import TextEmbedding

from rag_service.schemas import InputType

logger = logging.getLogger(__name__)

# Modelle, die dem E5-Präfix-Schema folgen: Anfragen werden mit "query: ",
# Dokumente mit "passage: " vorangestellt eingebettet. Das Modell lernt beim
# Training dadurch zwei leicht unterschiedliche Repräsentationen für "wonach
# wird gesucht" und "was wird gefunden" - lässt man die Präfixe weg, verhält
# sich das Modell nicht falsch, aber die Retrieval-Qualität sinkt messbar,
# weil beide Textarten in denselben Vektorraum ohne diese Unterscheidung
# abgebildet werden. Das aktuell konfigurierte Standardmodell
# (paraphrase-multilingual-MiniLM-L12-v2) braucht das nicht, die Liste
# existiert, damit ein Wechsel auf ein E5-Modell (z.B. für höhere Qualität
# bei mehr Sprachen) korrekt gehandhabt wird, ohne Aufrufer anzupassen.
_E5_PREFIX_MODELS = {
    "intfloat/multilingual-e5-large",
    "intfloat/multilingual-e5-small",
    "intfloat/e5-small-v2",
    "intfloat/e5-base-v2",
    "intfloat/e5-large-v2",
}


def _apply_prefix(model_name: str, texts: list[str], input_type: InputType) -> list[str]:
    if model_name not in _E5_PREFIX_MODELS:
        return texts
    prefix = "query: " if input_type == InputType.QUERY else "passage: "
    return [f"{prefix}{text}" for text in texts]


class EmbeddingService:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        logger.info("Lade Embedding-Modell", extra={"model": model_name})
        self._model = TextEmbedding(model_name=model_name)
        # Einmalig einen Dummy-Text embedden, um die tatsächliche
        # Vektorlänge des geladenen Modells zu kennen, statt sie hart zu
        # kodieren und bei einem Modellwechsel stillschweigend falsch zu sein.
        # iter(...) statt next(...) direkt auf dem Rückgabewert: fastembeds
        # Overload-Signaturen für .embed() sind zu breit (Union über mehrere
        # dtype/Shape-Kombinationen), als dass mypy next() direkt darauf
        # auflösen könnte - iter() normalisiert das für die Typprüfung, ohne
        # das Laufzeitverhalten zu ändern.
        self.dimensions = len(next(iter(self._model.embed(["init"]))))
        # fastembed hat keine öffentliche API, um an Tokenizer/Max-Länge des
        # geladenen Modells zu kommen - .model.tokenizer ist ein interner
        # Pfad in die aktuelle fastembed-Version. Für die Ingestion (Schritt
        # 3.2) brauchen wir aber genau das, um Chunks token-genau statt nach
        # Zeichen zu schneiden. Bewusste, dokumentierte Kopplung an eine
        # interne Struktur statt Zeichen-basiertem Raten - daher nicht in den
        # öffentlichen Typstubs und hier bewusst mit type: ignore markiert.
        self.tokenizer = self._model.model.tokenizer  # type: ignore[attr-defined]
        self.max_sequence_length: int = self.tokenizer.truncation["max_length"]
        logger.info(
            "Embedding-Modell geladen",
            extra={
                "model": model_name,
                "dimensions": self.dimensions,
                "max_sequence_length": self.max_sequence_length,
            },
        )

    def embed(self, texts: list[str], input_type: InputType) -> list[list[float]]:
        prefixed = _apply_prefix(self.model_name, texts, input_type)
        return [vector.tolist() for vector in self._model.embed(prefixed)]
