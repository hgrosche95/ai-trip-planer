-- AlterTable
ALTER TABLE "Itinerary" ADD COLUMN     "assumptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "budgetReport" JSONB;
