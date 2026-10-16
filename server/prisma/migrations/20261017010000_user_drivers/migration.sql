-- Drivers a user follows ("My drivers", owner decision Oct 16 2026). Additive: a new table only.
CREATE TABLE "user_drivers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alerts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_drivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_drivers_user_id_key_key" ON "user_drivers"("user_id", "key");
CREATE INDEX "user_drivers_key_idx" ON "user_drivers"("key");

ALTER TABLE "user_drivers" ADD CONSTRAINT "user_drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
