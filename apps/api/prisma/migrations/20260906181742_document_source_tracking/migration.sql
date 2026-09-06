-- AlterTable
-- sourcePath/contentHash ermöglichen der Python-Ingestion-Pipeline
-- (services/rag), Dateien aus data/knowledge über mehrere Läufe hinweg
-- wiederzuerkennen und unveränderte Inhalte zu überspringen (Idempotenz).
-- updatedAt ohne Default, da die Document-Tabelle zum Zeitpunkt dieser
-- Migration leer ist (kein Backfill nötig).
ALTER TABLE "Document" ADD COLUMN     "contentHash" TEXT NOT NULL,
ADD COLUMN     "sourcePath" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourcePath_key" ON "Document"("sourcePath");
