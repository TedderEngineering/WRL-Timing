-- My cars (engagement plan B): the cars a user follows. Additive only.
CREATE TABLE "user_cars" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "team_name" TEXT,
    "car_class" TEXT,
    "season" INTEGER,
    "setup_car_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_cars_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_cars_user_id_idx" ON "user_cars"("user_id");
CREATE INDEX "user_cars_series_number_idx" ON "user_cars"("series", "number");

ALTER TABLE "user_cars" ADD CONSTRAINT "user_cars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_cars" ADD CONSTRAINT "user_cars_setup_car_id_fkey" FOREIGN KEY ("setup_car_id") REFERENCES "setup_cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
