import logging

from fastembed.rerank.cross_encoder import TextCrossEncoder

logger = logging.getLogger(__name__)


class Reranker:
    """Dünner Wrapper um fastembeds Cross-Encoder-Reranking.

    Bewusst getrennt von EmbeddingService: ein Cross-Encoder bewertet
    Frage+Dokument gemeinsam in einem Modelldurchlauf (genauer, aber pro
    Kandidat ein eigener Durchlauf - teuer), während ein Bi-Encoder (unser
    Embedding-Modell) Frage und Dokument unabhängig voneinander in denselben
    Vektorraum abbildet (weniger genau, dafür einmal pro Text statt einmal
    pro Frage-Dokument-Paar - das ist es, was Vektorsuche über tausende
    Chunks überhaupt praktikabel macht). Deshalb der zweistufige Ablauf in
    search.py: Bi-Encoder holt eine breite Vorauswahl, Cross-Encoder sortiert
    nur die engere Auswahl neu.
    """

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        logger.info("Lade Reranking-Modell", extra={"model": model_name})
        self._model = TextCrossEncoder(model_name=model_name)
        logger.info("Reranking-Modell geladen", extra={"model": model_name})

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        return list(self._model.rerank(query, documents))
