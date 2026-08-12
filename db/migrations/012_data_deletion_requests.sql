-- ============================================================================
-- 012_data_deletion_requests.sql
-- ============================================================================
-- Meta compliance: a persistent log of data-deletion requests received via the
-- Instagram data-deletion callback (POST /meta/data-deletion). Meta requires a
-- status URL that stays resolvable AFTER the deletion completes, so each request
-- is assigned a persistent confirmation code that the status endpoint
-- (GET /meta/data-deletion/status?code=...) looks the request up by.
--
-- status values (enforced by data_deletion_status_chk):
--   'received'  request logged, background anonymisation running
--   'completed' anonymisation finished (see rows_affected, completed_at)
--   'failed'    anonymisation errored (see error_detail)
--
-- OUT-OF-SEQUENCE NOTE
-- Migration 011 (tenant RLS policies) is NOT yet applied to production, so 012 is
-- being applied ahead of 011. That is safe and order-independent: 012 CREATES a
-- brand-new, self-contained table and touches nothing else, while 011 only ALTERS
-- policies on 13 pre-existing tables. Neither depends on the other, in either
-- direction, so it does not matter which lands first.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code  text NOT NULL UNIQUE,
  platform           text NOT NULL,
  external_user_id   text NOT NULL,
  bot_id             uuid NULL,
  status             text NOT NULL DEFAULT 'received',
  rows_affected      integer NOT NULL DEFAULT 0,
  error_detail       text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz NULL,
  -- Same fixed-option convention as waitlist_status_chk in 010.
  constraint data_deletion_status_chk check (
    status in ('received', 'completed', 'failed')
  )
);

-- Lookups by (platform, external_user_id) when we need every request for a user.
-- NOTE: no explicit index on confirmation_code. The `confirmation_code text
-- NOT NULL UNIQUE` column constraint above already creates a btree index on it,
-- which the status endpoint's equality lookup uses; a second index would just be
-- a redundant write on every insert.
CREATE INDEX IF NOT EXISTS data_deletion_requests_user_idx
  ON public.data_deletion_requests (platform, external_user_id);

-- ----------------------------------------------------------------------------
-- Row Level Security: ENABLED with NO policy, plus an explicit REVOKE. This
-- follows 010_waitlist_applications (the stronger pattern), not 009. We enable
-- RLS EXPLICITLY because a table created via raw SQL does NOT inherit the
-- Supabase table-editor's "RLS on by default" behavior; left alone it would be
-- RLS-off and potentially readable by the anon role.
--
-- The Worker authenticates with SUPABASE_SERVICE_KEY (service role, has
-- BYPASSRLS) and reads and writes this table normally. Nothing else has any
-- reason to touch it: the dashboard never reads this request log. So there is
-- deliberately NO permissive policy for anon OR authenticated, and closed-by-
-- default is the correct posture (it also avoids adding another USING (true)
-- surface ahead of the Phase 1 RLS migration).
--
-- Belt and braces: we also REVOKE ALL from anon and authenticated at the
-- table-grant level. RLS-with-no-policy already denies, but the REVOKE means
-- that even if a permissive policy is added by mistake later, the role has no
-- table-level grant to fall back on. This is the difference the anon probe
-- showed on 2026-08-12: waitlist_applications (010, revoked) returns 401
-- permission denied, whereas connected_accounts (009, RLS-deny but grant intact)
-- returns 200 with zero rows. 012 takes the 010 posture. service_role is
-- intentionally NOT revoked, so the Worker is unaffected.
-- ----------------------------------------------------------------------------
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

revoke all on public.data_deletion_requests from anon;
revoke all on public.data_deletion_requests from authenticated;
