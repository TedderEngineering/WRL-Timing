-- CreateTable
CREATE TABLE "qualifying_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "session_name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "track" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "status" "RaceStatus" NOT NULL DEFAULT 'DRAFT',
    "chart_data" JSONB,
    "created_by" TEXT NOT NULL,
    "event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualifying_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qualifying_sessions_status_idx" ON "qualifying_sessions"("status");

-- CreateIndex
CREATE INDEX "qualifying_sessions_series_season_idx" ON "qualifying_sessions"("series", "season");

-- CreateIndex
CREATE INDEX "qualifying_sessions_date_idx" ON "qualifying_sessions"("date" DESC);

-- CreateIndex
CREATE INDEX "qualifying_sessions_event_id_idx" ON "qualifying_sessions"("event_id");

-- AddForeignKey
ALTER TABLE "qualifying_sessions" ADD CONSTRAINT "qualifying_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualifying_sessions" ADD CONSTRAINT "qualifying_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
