-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO', 'TEAM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "suspended_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "onboarding_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "races" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "track" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "status" "RaceStatus" NOT NULL DEFAULT 'DRAFT',
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "max_lap" INTEGER,
    "total_cars" INTEGER,
    "created_by" TEXT NOT NULL,
    "s3_data_key" TEXT,
    "s3_ann_key" TEXT,
    "chart_data" JSONB,
    "annotation_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "races_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_entries" (
    "id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "car_number" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "driver_names" TEXT NOT NULL,
    "car_class" TEXT NOT NULL,
    "car_color" TEXT,
    "finish_pos" INTEGER,
    "finish_pos_class" INTEGER,
    "laps_completed" INTEGER,

    CONSTRAINT "race_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_laps" (
    "id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "car_number" TEXT NOT NULL,
    "lap_number" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "class_position" INTEGER,
    "lap_time_formatted" TEXT,
    "lap_time_sec" DOUBLE PRECISION,
    "lap_time_ms" INTEGER,
    "cumulative_time_ms" BIGINT,
    "gap_to_leader_ms" INTEGER,
    "interval_ms" INTEGER,
    "flag" TEXT,
    "speed" DOUBLE PRECISION,
    "pit_stop" BOOLEAN NOT NULL DEFAULT false,
    "in_lap" BOOLEAN NOT NULL DEFAULT false,
    "out_lap" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "race_laps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "user_id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("user_id","race_id")
);

-- CreateTable
CREATE TABLE "user_race_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "race_id" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_race_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "default_chart_settings" JSONB,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_token_hash_idx" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "races_status_idx" ON "races"("status");

-- CreateIndex
CREATE INDEX "races_series_season_idx" ON "races"("series", "season");

-- CreateIndex
CREATE INDEX "races_date_idx" ON "races"("date" DESC);

-- CreateIndex
CREATE INDEX "race_entries_race_id_idx" ON "race_entries"("race_id");

-- CreateIndex
CREATE UNIQUE INDEX "race_entries_race_id_car_number_key" ON "race_entries"("race_id", "car_number");

-- CreateIndex
CREATE INDEX "race_laps_race_id_lap_number_position_idx" ON "race_laps"("race_id", "lap_number", "position");

-- CreateIndex
CREATE INDEX "race_laps_race_id_car_number_idx" ON "race_laps"("race_id", "car_number");

-- CreateIndex
CREATE INDEX "user_race_views_user_id_viewed_at_idx" ON "user_race_views"("user_id", "viewed_at" DESC);

-- CreateIndex
CREATE INDEX "user_race_views_race_id_idx" ON "user_race_views"("race_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_admin_user_id_idx" ON "audit_log"("admin_user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_entries" ADD CONSTRAINT "race_entries_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_laps" ADD CONSTRAINT "race_laps_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_race_views" ADD CONSTRAINT "user_race_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_race_views" ADD CONSTRAINT "user_race_views_race_id_fkey" FOREIGN KEY ("race_id") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
