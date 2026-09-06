from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RAG_")

    # Einziges mehrsprachiges Modell in fastembeds Registry mit 384
    # Dimensionen (siehe TextEmbedding.list_supported_models()) - passend zur
    # vector(384)-Spalte aus der Postgres-Migration in apps/api. Ein Wechsel
    # auf ein anderes Dimensionsmaß erfordert eine neue Migration plus
    # Neu-Embedding des kompletten Datenbestands.
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
