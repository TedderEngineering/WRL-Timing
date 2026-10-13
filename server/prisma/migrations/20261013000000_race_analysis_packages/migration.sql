-- RaceTrace 2.0 (G5): Race Analysis Packages. One versioned, validated
-- analysis document per race; the gzipped JSON itself lives in Supabase
-- Storage (race-files/packages/<raceId>/v<version>.json.gz), not here.
-- Additive only: two new enums, one new table, two new columns on races
-- (one nullable, one with a constant default, so no table rewrite). No
-- existing data is changed, and chart_data / annotation_data stay as they are.

-- CreateEnum
CREATE TYPE "RacePackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResultsStatus" AS ENUM ('OFFICIAL', 'PROVISIONAL');

-- AlterTable
ALTER TABLE "races" ADD COLUMN     "current_package_id" TEXT,
ADD COLUMN     "packages_disabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "race_analysis_packages" (
    "id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "rulebook_version" TEXT,
    "status" "RacePackageStatus" NOT NULL DEFAULT 'DRAFT',
    "storage_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "validator_report" JSONB NOT NULL,
    "data_quality_grade" TEXT,
    "results_status" "ResultsStatus",
    "created_by_id" TEXT,
    "published_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "race_analysis_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "race_analysis_packages_race_id_status_idx" ON "race_analysis_packages"("race_id", "status");

-- CreateIndex
CREATE INDEX "race_analysis_packages_created_by_id_idx" ON "race_analysis_packages"("created_by_id");

-- CreateIndex
CREATE INDEX "race_analysis_packages_published_by_id_idx" ON "race_analysis_packages"("published_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "race_analysis_packages_race_id_version_key" ON "race_analysis_packages"("race_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "races_current_package_id_key" ON "races"("current_package_id");

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_current_package_id_fkey" FOREIGN KEY ("current_package_id") REFERENCES "race_analysis_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_analysis_packages" ADD CONSTRAINT "race_analysis_packages_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_analysis_packages" ADD CONSTRAINT "race_analysis_packages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_analysis_packages" ADD CONSTRAINT "race_analysis_packages_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The API reaches this table through its own server connection; nothing
-- reaches it through Supabase's public API.
ALTER TABLE "race_analysis_packages" ENABLE ROW LEVEL SECURITY;
