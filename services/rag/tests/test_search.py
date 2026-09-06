from dataclasses import dataclass

import numpy as np

from rag_service.db import ChunkCandidate
from rag_service.embeddings import EmbeddingService
from rag_service.schemas import InputType
from rag_service.search import perform_search


@dataclass
class FakeRepo:
    """Gibt bei jeder Suche dieselben, fest verdrahteten Kandidaten zurück -
    unabhängig vom Query-Vektor. Für die reine Orchestrierungs-Logik in
    perform_search (Filtern, Reranking, Limit) muss die Vektorsuche selbst
    nicht echt sein, nur ihr Rückgabeformat."""

    candidates: list[ChunkCandidate]

    def search_chunks(self, query_vector: list[float], limit: int) -> list[ChunkCandidate]:
        self.last_limit = limit
        return self.candidates[:limit]


class FakeEmbedder:
    def embed(self, texts: list[str], input_type: InputType) -> list[list[float]]:
        return [[0.0] for _ in texts]


class FakeReranker:
    def __init__(self, scores_by_content: dict[str, float]) -> None:
        self._scores = scores_by_content

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        return [self._scores[doc] for doc in documents]


def _candidate(content: str, distance: float) -> ChunkCandidate:
    return ChunkCandidate(
        content=content,
        distance=distance,
        document_title=f"Titel für {content}",
        document_source="Testquelle",
        document_url=None,
    )


def test_returns_top_k_ordered_by_similarity_without_reranker() -> None:
    repo = FakeRepo([_candidate("b", 0.5), _candidate("a", 0.1), _candidate("c", 0.9)])

    hits = perform_search(repo, FakeEmbedder(), "irgendeine Frage", top_k=2, min_score=0.0)

    assert [h.content for h in hits] == ["a", "b"]
    assert hits[0].score == 1 - 0.1


def test_min_score_filters_out_weak_matches() -> None:
    repo = FakeRepo([_candidate("gut", 0.1), _candidate("schwach", 0.9)])

    hits = perform_search(repo, FakeEmbedder(), "Frage", top_k=5, min_score=0.5)

    assert [h.content for h in hits] == ["gut"]


def test_reranker_overrides_the_vector_search_order() -> None:
    # Die Vektorsuche würde "b" vor "a" einordnen (kleinere Distanz), der
    # Reranker bewertet "a" aber als deutlich passender - das Endergebnis
    # muss der Reranker-Reihenfolge folgen, nicht der Vektor-Reihenfolge.
    repo = FakeRepo([_candidate("b", 0.1), _candidate("a", 0.5)])
    reranker = FakeReranker({"b": 0.2, "a": 9.0})

    hits = perform_search(repo, FakeEmbedder(), "Frage", top_k=2, min_score=0.0, reranker=reranker)

    assert [h.content for h in hits] == ["a", "b"]
    assert hits[0].score == 9.0


def test_reranker_triggers_overfetch_beyond_top_k() -> None:
    repo = FakeRepo([_candidate(str(i), 0.1) for i in range(20)])
    reranker = FakeReranker({str(i): float(i) for i in range(20)})

    perform_search(
        repo,
        FakeEmbedder(),
        "Frage",
        top_k=3,
        min_score=0.0,
        reranker=reranker,
        candidate_multiplier=4,
        max_candidates=50,
    )

    assert repo.last_limit == 12  # top_k * candidate_multiplier


def test_candidate_fetch_is_capped_at_max_candidates() -> None:
    repo = FakeRepo([_candidate(str(i), 0.1) for i in range(20)])
    reranker = FakeReranker({str(i): 0.0 for i in range(20)})

    perform_search(
        repo,
        FakeEmbedder(),
        "Frage",
        top_k=20,
        min_score=0.0,
        reranker=reranker,
        candidate_multiplier=4,
        max_candidates=15,
    )

    assert repo.last_limit == 15


class _RealEmbeddingFakeRepo:
    """Embedded eine kleine, feste Wissensbasis einmalig mit dem ECHTEN
    Modell und beantwortet search_chunks() mit echter Cosine-Distanz in
    Python (numpy) statt über Postgres - so lässt sich die tatsächliche
    Trefferqualität des Modells prüfen, ohne eine Datenbank zu brauchen."""

    def __init__(self, embedder: EmbeddingService, passages: dict[str, str]) -> None:
        self._embedder = embedder
        self._titles = list(passages.keys())
        self._contents = list(passages.values())
        vectors = embedder.embed(self._contents, InputType.PASSAGE)
        self._vectors = np.array(vectors)

    def search_chunks(self, query_vector: list[float], limit: int) -> list[ChunkCandidate]:
        query = np.array(query_vector)
        # Cosine-Distanz wie pgvectors <=>-Operator: 1 - Cosine-Similarity.
        similarities = self._vectors @ query / (
            np.linalg.norm(self._vectors, axis=1) * np.linalg.norm(query)
        )
        distances = 1 - similarities
        order = np.argsort(distances)[:limit]
        return [
            ChunkCandidate(
                content=self._contents[i],
                distance=float(distances[i]),
                document_title=self._titles[i],
                document_source="Testwissensbasis",
                document_url=None,
            )
            for i in order
        ]


def test_semantically_matching_chunk_ranks_first_with_real_embeddings() -> None:
    embedder = EmbeddingService("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    knowledge_base = {
        "Lissabon": "Pastéis de Nata sind das bekannteste süße Gebäck Lissabons, ein Blätterteig-Puddingtörtchen.",
        "Wien": "Die Wiener Kaffeehauskultur gehört zum UNESCO-Kulturerbe, ein Kaffeehausbesuch ist Pflicht.",
        "Rom": "Römische Pasta-Klassiker sind Carbonara, Cacio e Pepe und Amatriciana, immer ohne Sahne.",
    }
    repo = _RealEmbeddingFakeRepo(embedder, knowledge_base)

    hits = perform_search(
        repo, embedder, "Welches süße Gebäck ist typisch für Lissabon?", top_k=3, min_score=0.0
    )

    assert hits[0].document_title == "Lissabon"
