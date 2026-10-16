-- A second race email when official results change a car's finish or pit cycles (owner decision,
-- Oct 15 2026). Additive only: four nullable columns on the send log.
ALTER TABLE "race_alert_sends" ADD COLUMN "results_status" TEXT;
ALTER TABLE "race_alert_sends" ADD COLUMN "facts" JSONB;
ALTER TABLE "race_alert_sends" ADD COLUMN "official_checked_at" TIMESTAMP(3);
ALTER TABLE "race_alert_sends" ADD COLUMN "official_sent_at" TIMESTAMP(3);
