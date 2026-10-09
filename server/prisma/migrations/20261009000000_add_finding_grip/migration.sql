-- Finding Grip: tire pressure and damper tools.
-- Additive only: new enums and grip_* tables. No existing table is altered.

-- CreateEnum
CREATE TYPE "GripPlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "GripUnits" AS ENUM ('STANDARD', 'METRIC');

-- CreateEnum
CREATE TYPE "GripWeather" AS ENUM ('DRY', 'WET');

-- CreateTable
CREATE TABLE "grip_accounts" (
    "user_id" TEXT NOT NULL,
    "units" "GripUnits" NOT NULL DEFAULT 'STANDARD',
    "plan" "GripPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripe_subscription_id" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "calc_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grip_accounts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "grip_tracks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "country" TEXT,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grip_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grip_reference_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "session_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weather" "GripWeather" NOT NULL DEFAULT 'DRY',
    "track_temp" DOUBLE PRECISION NOT NULL,
    "ambient_temp" DOUBLE PRECISION NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "cold_lf" DOUBLE PRECISION NOT NULL,
    "cold_rf" DOUBLE PRECISION NOT NULL,
    "cold_lr" DOUBLE PRECISION NOT NULL,
    "cold_rr" DOUBLE PRECISION NOT NULL,
    "hot_lf" DOUBLE PRECISION,
    "hot_rf" DOUBLE PRECISION,
    "hot_lr" DOUBLE PRECISION,
    "hot_rr" DOUBLE PRECISION,
    "wheel_lf" DOUBLE PRECISION NOT NULL,
    "wheel_rf" DOUBLE PRECISION NOT NULL,
    "wheel_lr" DOUBLE PRECISION NOT NULL,
    "wheel_rr" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grip_reference_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grip_calculations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reference_session_id" TEXT,
    "reference_name" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "session_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weather" "GripWeather" NOT NULL,
    "track_temp" DOUBLE PRECISION NOT NULL,
    "ambient_temp" DOUBLE PRECISION NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "wheel_lf" DOUBLE PRECISION NOT NULL,
    "wheel_rf" DOUBLE PRECISION NOT NULL,
    "wheel_lr" DOUBLE PRECISION NOT NULL,
    "wheel_rr" DOUBLE PRECISION NOT NULL,
    "target_lf" DOUBLE PRECISION NOT NULL,
    "target_rf" DOUBLE PRECISION NOT NULL,
    "target_lr" DOUBLE PRECISION NOT NULL,
    "target_rr" DOUBLE PRECISION NOT NULL,
    "result_lf" DOUBLE PRECISION NOT NULL,
    "result_rf" DOUBLE PRECISION NOT NULL,
    "result_lr" DOUBLE PRECISION NOT NULL,
    "result_rr" DOUBLE PRECISION NOT NULL,
    "ref_cold_lf" DOUBLE PRECISION NOT NULL,
    "ref_cold_rf" DOUBLE PRECISION NOT NULL,
    "ref_cold_lr" DOUBLE PRECISION NOT NULL,
    "ref_cold_rr" DOUBLE PRECISION NOT NULL,
    "converted_to_ref" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grip_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grip_damper_scenarios" (
    "scenario_number" INTEGER NOT NULL,
    "adjustment_type" TEXT NOT NULL,
    "turn_direction" TEXT NOT NULL,
    "over_under" TEXT NOT NULL,
    "corner_segment" TEXT NOT NULL,
    "corner_speed" TEXT NOT NULL,
    "option_1" TEXT NOT NULL,
    "option_2" TEXT,
    "option_3" TEXT,

    CONSTRAINT "grip_damper_scenarios_pkey" PRIMARY KEY ("scenario_number")
);

-- CreateIndex
CREATE UNIQUE INDEX "grip_accounts_stripe_subscription_id_key" ON "grip_accounts"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "grip_tracks_name_key" ON "grip_tracks"("name");

-- CreateIndex
CREATE INDEX "grip_reference_sessions_user_id_session_date_idx" ON "grip_reference_sessions"("user_id", "session_date" DESC);

-- CreateIndex
CREATE INDEX "grip_calculations_user_id_created_at_idx" ON "grip_calculations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "grip_damper_scenarios_inputs_key" ON "grip_damper_scenarios"("adjustment_type", "turn_direction", "over_under", "corner_segment", "corner_speed");

-- AddForeignKey
ALTER TABLE "grip_accounts" ADD CONSTRAINT "grip_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grip_reference_sessions" ADD CONSTRAINT "grip_reference_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grip_reference_sessions" ADD CONSTRAINT "grip_reference_sessions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "grip_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grip_calculations" ADD CONSTRAINT "grip_calculations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grip_calculations" ADD CONSTRAINT "grip_calculations_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "grip_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grip_calculations" ADD CONSTRAINT "grip_calculations_reference_session_id_fkey" FOREIGN KEY ("reference_session_id") REFERENCES "grip_reference_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security: server-only tables. The Express API connects as the
-- database owner and bypasses RLS; with no policies defined, direct PostgREST
-- access through the anon / authenticated roles is denied. This matters most
-- for grip_damper_scenarios, which holds proprietary tuning data.
ALTER TABLE public.grip_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grip_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grip_reference_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grip_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grip_damper_scenarios ENABLE ROW LEVEL SECURITY;

-- Starter track list. Admins can add, rename and deactivate tracks afterwards.
INSERT INTO "grip_tracks" ("id", "name", "short_name", "country") VALUES
  ('grip_trk_bmp',  'Barber Motorsports Park',              'BMP',  'USA'),
  ('grip_trk_cmp',  'Carolina Motorsports Park',            'CMP',  'USA'),
  ('grip_trk_clt',  'Charlotte Motor Speedway Roval',       'CLT',  'USA'),
  ('grip_trk_cota', 'Circuit of the Americas',              'COTA', 'USA'),
  ('grip_trk_day',  'Daytona International Speedway',       'DAY',  'USA'),
  ('grip_trk_ims',  'Indianapolis Motor Speedway',          'IMS',  'USA'),
  ('grip_trk_lrp',  'Lime Rock Park',                       'LRP',  'USA'),
  ('grip_trk_mo',   'Mid-Ohio Sports Car Course',           'MO',   'USA'),
  ('grip_trk_ncm',  'NCM Motorsports Park',                 'NCM',  'USA'),
  ('grip_trk_ra',   'Road America',                         'RA',   'USA'),
  ('grip_trk_atl',  'Road Atlanta',                         'ATL',  'USA'),
  ('grip_trk_rrr',  'Roebling Road Raceway',                'RRR',  'USA'),
  ('grip_trk_seb',  'Sebring International Raceway',        'SEB',  'USA'),
  ('grip_trk_son',  'Sonoma Raceway',                       'SON',  'USA'),
  ('grip_trk_vir',  'Virginia International Raceway',       'VIR',  'USA'),
  ('grip_trk_wgi',  'Watkins Glen International',           'WGI',  'USA'),
  ('grip_trk_ls',   'WeatherTech Raceway Laguna Seca',      'LS',   'USA'),
  ('grip_trk_oth',  'Other track',                          'OTH',  NULL)
ON CONFLICT DO NOTHING;
