-- Setup Sheet: team car setups (target vs actual), session notes and change
-- history. Additive only: new enums, new setup_* tables, and one new nullable
-- column on refresh_tokens. No existing data is changed.

-- AlterTable
-- Marks a refresh token as exchanged, so a concurrent refresh within a short
-- grace window is not mistaken for token theft (see services/auth.ts).
ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "SetupRole" AS ENUM ('OWNER', 'ENGINEER', 'VIEWER');

-- CreateEnum
CREATE TYPE "SetupSessionKind" AS ENUM ('TEST', 'PRACTICE', 'QUALIFYING', 'RACE', 'OTHER');

-- CreateEnum
CREATE TYPE "SetupSheetKind" AS ENUM ('TARGET', 'ACTUAL');

-- CreateEnum
CREATE TYPE "SetupNoteCategory" AS ENUM ('DRIVER', 'ENGINEER', 'CHANGE', 'GENERAL');

-- CreateTable
CREATE TABLE "setup_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_team_members" (
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "SetupRole" NOT NULL DEFAULT 'ENGINEER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "setup_invites" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "SetupRole" NOT NULL DEFAULT 'ENGINEER',
    "invited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_cars" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "car_class" TEXT,
    "reference" JSONB NOT NULL DEFAULT '{}',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_events" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_sessions" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "car_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SetupSessionKind" NOT NULL DEFAULT 'PRACTICE',
    "seq" INTEGER NOT NULL DEFAULT 0,
    "session_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_sheets" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" "SetupSheetKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_sheet_revisions" (
    "id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "notes_changed" BOOLEAN NOT NULL DEFAULT false,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_sheet_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_session_notes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "author_id" TEXT,
    "category" "SetupNoteCategory" NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "setup_teams_created_by_id_idx" ON "setup_teams"("created_by_id");

-- CreateIndex
CREATE INDEX "setup_team_members_user_id_idx" ON "setup_team_members"("user_id");

-- CreateIndex
CREATE INDEX "setup_invites_email_idx" ON "setup_invites"("email");

-- CreateIndex
CREATE INDEX "setup_invites_invited_by_id_idx" ON "setup_invites"("invited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "setup_invites_team_id_email_key" ON "setup_invites"("team_id", "email");

-- CreateIndex
CREATE INDEX "setup_cars_team_id_idx" ON "setup_cars"("team_id");

-- CreateIndex
CREATE INDEX "setup_events_team_id_start_date_idx" ON "setup_events"("team_id", "start_date" DESC);

-- CreateIndex
CREATE INDEX "setup_sessions_event_id_seq_idx" ON "setup_sessions"("event_id", "seq");

-- CreateIndex
CREATE INDEX "setup_sessions_car_id_idx" ON "setup_sessions"("car_id");

-- CreateIndex
CREATE INDEX "setup_sessions_team_id_idx" ON "setup_sessions"("team_id");

-- CreateIndex
CREATE INDEX "setup_sheets_updated_by_id_idx" ON "setup_sheets"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "setup_sheets_session_id_kind_key" ON "setup_sheets"("session_id", "kind");

-- CreateIndex
CREATE INDEX "setup_sheet_revisions_sheet_id_changed_at_idx" ON "setup_sheet_revisions"("sheet_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "setup_sheet_revisions_changed_by_id_idx" ON "setup_sheet_revisions"("changed_by_id");

-- CreateIndex
CREATE INDEX "setup_session_notes_session_id_created_at_idx" ON "setup_session_notes"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "setup_session_notes_author_id_idx" ON "setup_session_notes"("author_id");

-- AddForeignKey
ALTER TABLE "setup_teams" ADD CONSTRAINT "setup_teams_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_team_members" ADD CONSTRAINT "setup_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "setup_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_team_members" ADD CONSTRAINT "setup_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_invites" ADD CONSTRAINT "setup_invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "setup_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_invites" ADD CONSTRAINT "setup_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_cars" ADD CONSTRAINT "setup_cars_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "setup_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_events" ADD CONSTRAINT "setup_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "setup_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sessions" ADD CONSTRAINT "setup_sessions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "setup_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sessions" ADD CONSTRAINT "setup_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "setup_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sessions" ADD CONSTRAINT "setup_sessions_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "setup_cars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sheets" ADD CONSTRAINT "setup_sheets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "setup_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sheets" ADD CONSTRAINT "setup_sheets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sheet_revisions" ADD CONSTRAINT "setup_sheet_revisions_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "setup_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_sheet_revisions" ADD CONSTRAINT "setup_sheet_revisions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_session_notes" ADD CONSTRAINT "setup_session_notes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "setup_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setup_session_notes" ADD CONSTRAINT "setup_session_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security: server-only tables. The Express API connects as the
-- database owner and bypasses RLS; with no policies defined, direct PostgREST
-- access through the anon / authenticated roles is denied.
ALTER TABLE public.setup_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_sheet_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_session_notes ENABLE ROW LEVEL SECURITY;
