-- CreateTable
CREATE TABLE "TripDraft" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "brief" JSONB NOT NULL,
    "draft" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "budget" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TripDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripDraft_updatedAt_idx" ON "TripDraft"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripDraft_userId_sessionId_key" ON "TripDraft"("userId", "sessionId");

-- AddForeignKey
ALTER TABLE "TripDraft" ADD CONSTRAINT "TripDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
