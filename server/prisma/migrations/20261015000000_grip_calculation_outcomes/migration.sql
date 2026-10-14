-- Finding Grip: record how a calculated run came in (measured hot pressures).
-- Additive only: the code already live ignores these columns.
ALTER TABLE "grip_calculations"
  ADD COLUMN "actual_hot_lf" DOUBLE PRECISION,
  ADD COLUMN "actual_hot_rf" DOUBLE PRECISION,
  ADD COLUMN "actual_hot_lr" DOUBLE PRECISION,
  ADD COLUMN "actual_hot_rr" DOUBLE PRECISION,
  ADD COLUMN "outcome_at" TIMESTAMP(3),
  ADD COLUMN "outcome_skipped" BOOLEAN NOT NULL DEFAULT false;
