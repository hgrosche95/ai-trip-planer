-- AlterTable
ALTER TABLE "Itinerary" ADD COLUMN     "lodging" TEXT,
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "travelers" INTEGER;

-- AlterTable
ALTER TABLE "TripDraft" ADD COLUMN     "itineraryId" TEXT,
ADD COLUMN     "seeded" BOOLEAN NOT NULL DEFAULT false;
