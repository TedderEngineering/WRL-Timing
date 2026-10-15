-- Race-ready emails (engagement plan D). Additive only: off by default, plus a log so each
-- user gets at most one email per race.
ALTER TABLE "user_preferences" ADD COLUMN "race_alerts" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "race_alert_sends" (
    "user_id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "car_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "race_alert_sends_pkey" PRIMARY KEY ("user_id","race_id")
);

CREATE INDEX "race_alert_sends_race_id_idx" ON "race_alert_sends"("race_id");

ALTER TABLE "race_alert_sends" ADD CONSTRAINT "race_alert_sends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "race_alert_sends" ADD CONSTRAINT "race_alert_sends_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;
