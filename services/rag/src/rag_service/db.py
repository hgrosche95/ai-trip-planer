import hashlib
from dataclasses import dataclass

import psycopg
from pgvector.psycopg import register_vector


def compute_content_hash(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


@dataclass
class DocumentMetadata:
    title: str
    source: str
    url: str | None
    license: str
    language: str


class DocumentRepository:
    """Schreibzugriff auf Document/DocumentChunk. Bewusst rohes SQL statt
    eines ORMs: es ist derselbe Postgres-Server wie apps/api (Prisma bleibt
    dort die Quelle der Wahrheit fürs Schema), dieser Service muss nur genau
    zwei Tabellen befüllen können - dafür lohnt keine zweite ORM-Abhängigkeit
    in einer anderen Sprache."""

    def __init__(self, database_url: str) -> None:
        self._conn = psycopg.connect(database_url, autocommit=False)
        register_vector(self._conn)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "DocumentRepository":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def get_existing_content_hash(self, source_path: str) -> tuple[str, str] | None:
        """Liefert (document_id, content_hash) für einen bekannten
        sourcePath, oder None, wenn die Datei noch nie eingelesen wurde."""
        with self._conn.cursor() as cur:
            cur.execute(
                'SELECT id, "contentHash" FROM "Document" WHERE "sourcePath" = %s',
                (source_path,),
            )
            row = cur.fetchone()
            return (row[0], row[1]) if row else None

    def upsert_document(
        self,
        source_path: str,
        content_hash: str,
        metadata: DocumentMetadata,
    ) -> str:
        """Legt ein Document an oder aktualisiert es (per sourcePath erkannt)
        und gibt die id zurück. cuid()-artige id wird hier bewusst nicht neu
        erzeugt, sondern von Postgres per gen_random_uuid() vergeben, falls
        neu - Format weicht dadurch von Prisma-cuids ab, was für diese
        Fremdschlüssel-Beziehung unerheblich ist, da nichts im NestJS-Backend
        aktuell auf Document.id von außen zugreift."""
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "Document"
                    (id, title, source, url, license, language, "sourcePath", "contentHash", "updatedAt")
                VALUES
                    (gen_random_uuid()::text, %(title)s, %(source)s, %(url)s, %(license)s,
                     %(language)s, %(source_path)s, %(content_hash)s, now())
                ON CONFLICT ("sourcePath") DO UPDATE SET
                    title = EXCLUDED.title,
                    source = EXCLUDED.source,
                    url = EXCLUDED.url,
                    license = EXCLUDED.license,
                    language = EXCLUDED.language,
                    "contentHash" = EXCLUDED."contentHash",
                    "updatedAt" = now()
                RETURNING id
                """,
                {
                    "title": metadata.title,
                    "source": metadata.source,
                    "url": metadata.url,
                    "license": metadata.license,
                    "language": metadata.language,
                    "source_path": source_path,
                    "content_hash": content_hash,
                },
            )
            (document_id,) = cur.fetchone()
            return document_id

    def replace_chunks(self, document_id: str, chunks: list[tuple[str, list[float]]]) -> None:
        """Ersetzt alle Chunks eines Dokuments. Löschen + neu Einfügen statt
        Diffen: bei einer Änderung ist idR der komplette Text neu gechunkt
        (andere Grenzen durch Overlap-Logik), ein Chunk-Diff auf Zeilenebene
        würde keine Kosten sparen, nur Komplexität hinzufügen."""
        with self._conn.cursor() as cur:
            cur.execute('DELETE FROM "DocumentChunk" WHERE "documentId" = %s', (document_id,))
            for index, (content, embedding) in enumerate(chunks):
                cur.execute(
                    """
                    INSERT INTO "DocumentChunk"
                        (id, content, "chunkIndex", embedding, "documentId")
                    VALUES
                        (gen_random_uuid()::text, %s, %s, %s, %s)
                    """,
                    (content, index, embedding, document_id),
                )

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()
