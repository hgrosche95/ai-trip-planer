from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# services/rag/src/rag_service/config.py -> 4x parents = Repo-Root
_REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RAG_", env_file=".env")

    # Einziges mehrsprachiges Modell in fastembeds Registry mit 384
    # Dimensionen (siehe TextEmbedding.list_supported_models()) - passend zur
    # vector(384)-Spalte aus der Postgres-Migration in apps/api. Ein Wechsel
    # auf ein anderes Dimensionsmaß erfordert eine neue Migration plus
    # Neu-Embedding des kompletten Datenbestands.
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    log_level: str = "INFO"

    # Dieselbe Postgres-Instanz wie apps/api, deshalb bewusst ohne RAG_-Präfix
    # eingelesen (validation_alias) - ein Name für dieselbe Sache, keine
    # zweite Kopie desselben Secrets unter anderem Namen pflegen. Nur die
    # Ingestion-CLI (ingest.py) braucht eine Datenbankverbindung - /health
    # und /embed nicht -, deshalb ein Default statt eines Pflichtfelds:
    # sonst würde schon der App-Start für die reinen Embedding-Endpunkte
    # unnötig eine DB verlangen.
    database_url: str = Field(
        default="postgresql://trip_planner:trip_planner@localhost:5432/trip_planner",
        validation_alias="DATABASE_URL",
    )

    knowledge_dir: Path = _REPO_ROOT / "data" / "knowledge"

    # 100 Tokens: das Modell schneidet ohnehin bei 128 Tokens hart ab
    # (tokenizer.truncation["max_length"], live geprüft) - alles darüber
    # würde beim Embedden stillschweigend abgeschnitten. 100 statt 128 lässt
    # Puffer, weil deutsche Komposita ("Reiseplanungsempfehlung") in mehr
    # Subword-Tokens zerfallen als vergleichbare englische Wörter.
    chunk_max_tokens: int = 100
    # ~20% Overlap: genug, damit ein Gedanke an der Chunk-Grenze nicht ohne
    # Kontext im nächsten Chunk landet, ohne die meisten Chunks doppelt zu
    # speichern (Overlap zu groß = viel redundanter Text pro zusätzlichem
    # Embedding-Aufruf).
    chunk_overlap_tokens: int = 20

    search_default_top_k: int = 5
    # Bei aktivem Reranking werden mehr Kandidaten per Vektorsuche geholt als
    # am Ende zurückgegeben werden (schneller Bi-Encoder filtert grob vor,
    # der langsamere Cross-Encoder sortiert nur die engere Auswahl neu) -
    # Faktor 4, gedeckelt auf 50, damit ein hoher top_k den Cross-Encoder
    # nicht mit zu vielen Kandidaten auf einmal belastet.
    rerank_candidate_multiplier: int = 4
    rerank_max_candidates: int = 50

    # Standardmäßig AUS: das einzige mehrsprachige Reranking-Modell in
    # fastembeds Registry (jinaai/jina-reranker-v2-base-multilingual) steht
    # unter CC-BY-NC-4.0 (nicht-kommerziell) - für dieses Lern-/Portfolio-
    # projekt unproblematisch, aber keine Lizenz, die man stillschweigend
    # aktiv haben sollte. Bewusstes Opt-in per Env.
    rerank_enabled: bool = False
    rerank_model: str = "jinaai/jina-reranker-v2-base-multilingual"


@lru_cache
def get_settings() -> Settings:
    return Settings()
