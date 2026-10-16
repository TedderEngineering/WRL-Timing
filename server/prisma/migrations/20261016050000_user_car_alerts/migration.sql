-- The per-car switch for race emails (shared "Alerts and preferences" contract, Oct 14 2026).
-- Additive: on for every car, so nothing changes until someone switches a car off.
ALTER TABLE "user_cars" ADD COLUMN "alerts" BOOLEAN NOT NULL DEFAULT true;
