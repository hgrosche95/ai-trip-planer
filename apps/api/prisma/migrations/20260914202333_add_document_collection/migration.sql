-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "collection" TEXT NOT NULL DEFAULT 'travel';

-- CreateIndex
CREATE INDEX "Document_collection_idx" ON "Document"("collection");
