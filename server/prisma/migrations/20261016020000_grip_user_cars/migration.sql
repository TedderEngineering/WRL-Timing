-- Finding Grip: link reference sessions and calculations to the shared My cars list.
-- Nullable; removing a car clears the link and keeps the records.
ALTER TABLE "grip_reference_sessions" ADD COLUMN "user_car_id" TEXT;
ALTER TABLE "grip_calculations" ADD COLUMN "user_car_id" TEXT;

CREATE INDEX "grip_reference_sessions_user_car_id_idx" ON "grip_reference_sessions"("user_car_id");
CREATE INDEX "grip_calculations_user_car_id_idx" ON "grip_calculations"("user_car_id");

ALTER TABLE "grip_reference_sessions" ADD CONSTRAINT "grip_reference_sessions_user_car_id_fkey" FOREIGN KEY ("user_car_id") REFERENCES "user_cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grip_calculations" ADD CONSTRAINT "grip_calculations_user_car_id_fkey" FOREIGN KEY ("user_car_id") REFERENCES "user_cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
