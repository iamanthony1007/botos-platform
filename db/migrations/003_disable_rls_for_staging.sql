-- ============================================================================
-- Staging schema migration 003
-- ============================================================================
-- Generated: 2026-05-05
-- Issue discovered during 1.1.5b dashboard smoke test (after migration 002):
--   The dashboard could not render even after the profiles row was created.
--   PostgREST returned PGRST116 ("The result contains 0 rows") for every
--   query the dashboard made, despite the rows existing when queried via
--   the SQL editor as the postgres superuser. Root cause: Supabase enables
--   Row Level Security (RLS) by default on every table created in the
--   public schema. Our schema.sql created tables without explicit RLS
--   handling, so all 13 ended up with RLS=true and policy_count=0, which
--   is the "deny everything for non-superusers" state.
--
--   Verification before fix (run in SQL editor as superuser):
--     SELECT tablename, rowsecurity, (SELECT count(*) FROM pg_policies p
--       WHERE p.tablename = t.tablename) AS policies
--     FROM pg_tables t WHERE schemaname = 'public';
--     -> all 13 tables: rowsecurity=true, policies=0
--
-- Fix:
--   Disable RLS on all 13 public tables for staging. This is intentional
--   for staging only.
--
--   This is NOT what production should do. Production has RLS on with real
--   policies (which we have not yet captured into source-controlled SQL).
--   Replicating production's policies into staging is out of scope for
--   Phase 1.1; tracked as a future task.
--
--   For staging, used as a single-user development sandbox, RLS-off is
--   acceptable because there are no other users to protect rows from.
--
-- Idempotent: ALTER TABLE ... DISABLE ROW LEVEL SECURITY is a no-op when
-- RLS is already off. Safe to re-run.
-- ============================================================================

ALTER TABLE public.audit_log              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_documents          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bots                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_flag_reasons     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_examples  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.learnings              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_queue   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Confirm RLS is now off on all 13 public tables:
--
--   SELECT tablename, rowsecurity AS rls_enabled
--   FROM pg_tables WHERE schemaname = 'public'
--   ORDER BY tablename;
--
-- Expected: all rows show rls_enabled = false.
-- ============================================================================
