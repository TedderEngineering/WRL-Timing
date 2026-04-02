-- Enable RLS on qualifying_sessions (added after the original RLS migration)
ALTER TABLE public.qualifying_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
--
-- Architecture:
--   - Express API connects as `postgres` (owner) -> bypasses RLS entirely
--   - Supabase Storage uses `service_role` key  -> bypasses RLS entirely
--   - These policies govern `anon` and `authenticated` roles only, providing
--     defense-in-depth against direct PostgREST / Supabase client access.
--
-- Tables fall into two categories:
--   1. PUBLIC READ  — published race/event data readable by anyone
--   2. SERVER-ONLY  — no policies; RLS denies all non-owner access
-- ============================================================================

-- ─── Public read: events ────────────────────────────────────────────────────

CREATE POLICY "Published events are publicly readable"
  ON public.events FOR SELECT
  USING (status = 'PUBLISHED');

-- ─── Public read: races ─────────────────────────────────────────────────────

CREATE POLICY "Published races are publicly readable"
  ON public.races FOR SELECT
  USING (status = 'PUBLISHED');

-- ─── Public read: qualifying_sessions ───────────────────────────────────────

CREATE POLICY "Published qualifying sessions are publicly readable"
  ON public.qualifying_sessions FOR SELECT
  USING (status = 'PUBLISHED');

-- ─── Public read: race_entries (via published race) ─────────────────────────

CREATE POLICY "Entries for published races are publicly readable"
  ON public.race_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_entries.race_id
        AND races.status = 'PUBLISHED'
    )
  );

-- ─── Public read: race_laps (via published race) ────────────────────────────

CREATE POLICY "Laps for published races are publicly readable"
  ON public.race_laps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_laps.race_id
        AND races.status = 'PUBLISHED'
    )
  );

-- ─── Public read: pit_stop_analysis (via published race) ────────────────────

CREATE POLICY "Pit stop analysis for published races is publicly readable"
  ON public.pit_stop_analysis FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = pit_stop_analysis.race_id
        AND races.status = 'PUBLISHED'
    )
  );

-- ─── Public read: track_pit_configs (reference data) ────────────────────────

CREATE POLICY "Track pit configs are publicly readable"
  ON public.track_pit_configs FOR SELECT
  USING (true);

-- ─── Server-only tables: no policies ────────────────────────────────────────
-- RLS is enabled with no permissive policies, so anon/authenticated roles
-- are denied all access. The Express API (postgres owner) bypasses RLS.
--
--   users
--   refresh_tokens
--   password_reset_tokens
--   email_verification_tokens
--   subscriptions
--   user_preferences
--   user_favorites
--   user_race_views
--   audit_log
