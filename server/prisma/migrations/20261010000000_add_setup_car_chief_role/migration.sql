-- Setup Sheet: add the Car Chief team role (same rights as Engineer).
-- Additive only; the running server ignores the new value until it is updated.
ALTER TYPE "SetupRole" ADD VALUE 'CAR_CHIEF' BEFORE 'VIEWER';
