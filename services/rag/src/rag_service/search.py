from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from rag_service.schemas import InputType


class ChunkCandidateLike(Protocol):
    content: str
    distance: float
    document_title: str
    document_source: str
    document_url: str | None
    document_license: str


class ChunkRepository(Protocol):
    # Sequence statt list: list ist für mypy invariant, eine Implementierung,
    # die list[ChunkCandidate] zurückgibt (siehe db.py), würde list[ChunkCandidateLike]
    # trotz strukturell passendem ChunkCandidate nicht erfüllen. Sequence ist
    # covariant und passt genau zum tatsächlichen (nur lesenden) Gebrauch hier.
    def search_chunks(
        self, query_vector: list[float], limit: int
    ) -> Sequence[ChunkCandidateLike]: ...


class Embedder(Protocol):
    def embed(self, texts: list[str], input_type: InputType) -> list[list[float]]: ...


class DocumentReranker(Protocol):
    def rerank(self, query: str, documents: list[str]) -> list[float]: ...


@dataclass
class SearchHit:
    content: str
    # Ohne Reranking: 1 - Cosine-Distanz (0..~1, höher = ähnlicher). Mit
    # Reranking: der rohe Cross-Encoder-Score (unbeschränkter Wertebereich,
    # modellabhängig) - beide Male gilt "höher = besser", aber die Skala ist
    # eine andere. Für Aufrufer, die reranken lassen, ist die Rangfolge das
    # eigentlich Wichtige, nicht der absolute Score-Wert.
    score: float
    document_title: str
    document_source: str
    document_url: str | None
    document_license: str


def perform_search(
    repo: ChunkRepository,
    embedder: Embedder,
    query: str,
    top_k: int,
    min_score: float,
    reranker: DocumentReranker | None = None,
    candidate_multiplier: int = 4,
    max_candidates: int = 50,
) -> list[SearchHit]:
    """Embedded die Frage, holt per Vektorsuche eine Kandidatenmenge und
    filtert/sortiert sie.

    Ohne Reranker: Top-k direkt per Cosine-Distanz, min_score filtert vorher.
    Mit Reranker: erst eine größere Kandidatenmenge (candidate_multiplier *
    top_k, gedeckelt) per schneller Vektorsuche holen, dann der langsamere,
    aber genauere Cross-Encoder sortiert nur diese engere Auswahl neu -
    zweistufig, weil ein Cross-Encoder-Durchlauf über den kompletten
    Chunk-Bestand für jede Anfrage nicht praktikabel wäre.
    """
    query_vector = embedder.embed([query], InputType.QUERY)[0]

    fetch_limit = min(top_k * candidate_multiplier, max_candidates) if reranker else top_k
    candidates = repo.search_chunks(query_vector, fetch_limit)

    hits = [
        SearchHit(
            content=c.content,
            score=1 - c.distance,
            document_title=c.document_title,
            document_source=c.document_source,
            document_url=c.document_url,
            document_license=c.document_license,
        )
        for c in candidates
    ]
    # Explizit sortieren statt uns darauf zu verlassen, dass das Repo schon
    # sortiert liefert: die echte Postgres-Implementierung tut das zwar
    # (ORDER BY distance ASC), aber perform_search soll auch mit einem Repo
    # korrekt sein, das diese Garantie nicht gibt.
    hits = sorted((hit for hit in hits if hit.score >= min_score), key=lambda h: h.score, reverse=True)

    if reranker is not None and hits:
        rerank_scores = reranker.rerank(query, [hit.content for hit in hits])
        reranked = sorted(
            zip(hits, rerank_scores, strict=True), key=lambda pair: pair[1], reverse=True
        )
        hits = [
            SearchHit(
                content=hit.content,
                score=score,
                document_title=hit.document_title,
                document_source=hit.document_source,
                document_url=hit.document_url,
                document_license=hit.document_license,
            )
            for hit, score in reranked
        ]

    return hits[:top_k]
