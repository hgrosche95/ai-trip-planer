-- CreateTable
CREATE TABLE "ExternalApiCache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalApiCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ExternalApiCache_expiresAt_idx" ON "ExternalApiCache"("expiresAt");
