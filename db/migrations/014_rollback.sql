-- ============================================================================
-- 014_rollback.sql
-- ============================================================================
-- Rollback for 014_revoke_waitlist_authenticated.sql, following the paired-
-- rollback convention. Idempotent.
--
-- Restores the table grant that 010 gave `authenticated` implicitly (Supabase
-- grants the standard roles on tables in the public schema; 010 revoked anon
-- but left authenticated intact, and 014 revoked authenticated). The two 010
-- policies were never dropped, so restoring the grant restores exactly the
-- pre-014 behavior: authenticated can SELECT and UPDATE every row.
--
-- WARNING, READ BEFORE RUNNING. Running this re-opens every waitlist applicant's
-- name, email, revenue figures and Instagram handle to EVERY authenticated user,
-- which currently includes the Meta App Review account
-- (meta-review@getmu.co, auth id 98b266d7-1753-48b8-9811-c51553691f8a). Do not
-- run it on production while that account exists. If waitlist access needs to
-- come back for Nella before 011 lands, the correct move is a narrower grant
-- plus a role-scoped policy, not this file.
--
-- DELETE is deliberately not granted: 010 states applications are business
-- records and are rejected rather than deleted, and 014 did not change that.
-- INSERT is deliberately not granted: inserts come from the Pages Function on
-- the service key.
-- ============================================================================

grant select, update on public.waitlist_applications to authenticated;

NOTIFY pgrst, 'reload schema';
