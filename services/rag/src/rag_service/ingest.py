import argparse
import logging
from dataclasses import dataclass, field
from pathlib import Path

import frontmatter

from rag_service.chunking import chunk_text
from rag_service.config import Settings, get_settings
from rag_service.db import DocumentMetadata, DocumentRepository, compute_content_hash
from rag_service.embeddings import EmbeddingService
from rag_service.logging_config import configure_logging
from rag_service.schemas import InputType

logger = logging.getLogger(__name__)


@dataclass
class IngestSummary:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.created) + len(self.updated) + len(self.skipped)


def ingest_knowledge_base(
    knowledge_dir: Path,
    repo: DocumentRepository,
    embedder: EmbeddingService,
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
) -> IngestSummary:
    summary = IngestSummary()

    for path in sorted(knowledge_dir.glob("*.md")):
        # data/knowledge/README.md beschreibt nur das Frontmatter-Format für
        # Menschen, ist selbst kein Reiseziel-Dokument - hat auch kein
        # gültiges Frontmatter, würde also ohnehin nur mit "unbekannt"-Werten
        # eingelesen. Explizit ausschließen statt sich auf fehlendes
        # Frontmatter als impliziten Filter zu verlassen.
        if path.name.lower() == "readme.md":
            continue

        raw = path.read_bytes()
        content_hash = compute_content_hash(raw)
        source_path = path.name

        existing = repo.get_existing_content_hash(source_path)
        if existing is not None and existing[1] == content_hash:
            logger.info("Unverändert, übersprungen", extra={"file": source_path})
            summary.skipped.append(source_path)
            continue

        post = frontmatter.loads(raw.decode("utf-8"))
        chunks_text = chunk_text(
            post.content,
            embedder.tokenizer,
            max_tokens=chunk_max_tokens,
            overlap_tokens=chunk_overlap_tokens,
        )
        if not chunks_text:
            logger.warning("Keine Chunks erzeugt, übersprungen", extra={"file": source_path})
            continue

        vectors = embedder.embed(chunks_text, InputType.PASSAGE)

        document_id = repo.upsert_document(
            source_path=source_path,
            content_hash=content_hash,
            # frontmatter typisiert YAML-Werte als object (koennten beliebige
            # YAML-Skalare sein) - str(...) macht daraus die str/str | None,
            # die DocumentMetadata erwartet; in der Praxis sind es ohnehin
            # immer schon Strings aus dem Markdown-Frontmatter.
            metadata=DocumentMetadata(
                title=str(post.metadata.get("title", source_path)),
                source=str(post.metadata.get("source", "unbekannt")),
                url=str(url) if (url := post.metadata.get("url")) else None,
                license=str(post.metadata.get("license", "unbekannt")),
                language=str(post.metadata.get("language", "de")),
            ),
        )
        repo.replace_chunks(document_id, list(zip(chunks_text, vectors, strict=True)))

        if existing is not None:
            summary.updated.append(source_path)
            logger.info(
                "Geändert, neu eingebettet",
                extra={"file": source_path, "chunks": len(chunks_text)},
            )
        else:
            summary.created.append(source_path)
            logger.info(
                "Neu eingelesen",
                extra={"file": source_path, "chunks": len(chunks_text)},
            )

    return summary


def run(settings: Settings) -> IngestSummary:
    configure_logging(settings.log_level)
    embedder = EmbeddingService(settings.embedding_model)
    with DocumentRepository(settings.database_url) as repo:
        try:
            summary = ingest_knowledge_base(
                settings.knowledge_dir,
                repo,
                embedder,
                settings.chunk_max_tokens,
                settings.chunk_overlap_tokens,
            )
        except Exception:
            repo.rollback()
            raise
        repo.commit()
    logger.info(
        "Ingestion abgeschlossen",
        extra={
            "neu": len(summary.created),
            "aktualisiert": len(summary.updated),
            "uebersprungen": len(summary.skipped),
        },
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Liest data/knowledge ein und schreibt Chunks + Embeddings nach Postgres."
    )
    parser.add_argument(
        "--knowledge-dir",
        type=Path,
        default=None,
        help="Überschreibt den Standard-Pfad zu den Markdown-Dateien (Default: data/knowledge im Repo).",
    )
    args = parser.parse_args()

    settings = get_settings()
    if args.knowledge_dir is not None:
        settings = settings.model_copy(update={"knowledge_dir": args.knowledge_dir})

    run(settings)


if __name__ == "__main__":
    main()
