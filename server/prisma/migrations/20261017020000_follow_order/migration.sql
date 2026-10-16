-- The order of the followed cars' and drivers' tabs (drag to reorder, Oct 16 2026). Additive.
ALTER TABLE "user_cars" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_drivers" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
