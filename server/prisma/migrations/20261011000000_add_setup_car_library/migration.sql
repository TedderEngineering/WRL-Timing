-- Setup Sheet: the car library (one spec per car model, shared by every team),
-- an optional model on each team car, and a third sheet kind for technical
-- inspection. Additive only: no existing data is changed.

-- AlterEnum
ALTER TYPE "SetupSheetKind" ADD VALUE 'TECH';

-- CreateEnum
CREATE TYPE "SetupModelStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "setup_cars" ADD COLUMN "model_id" TEXT;

-- CreateTable
CREATE TABLE "setup_car_models" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "series" TEXT,
    "status" "SetupModelStatus" NOT NULL DEFAULT 'DRAFT',
    "spec" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_car_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "setup_car_models_slug_key" ON "setup_car_models"("slug");

-- CreateIndex
CREATE INDEX "setup_cars_model_id_idx" ON "setup_cars"("model_id");

-- AddForeignKey
ALTER TABLE "setup_cars" ADD CONSTRAINT "setup_cars_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "setup_car_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The API reaches this table through its own server connection; nothing
-- reaches it through Supabase's public API.
ALTER TABLE "setup_car_models" ENABLE ROW LEVEL SECURITY;
