-- ============================================================================
-- Staging schema migration 002
-- ============================================================================
-- Generated: 2026-05-05
-- Issue discovered during 1.1.5b dashboard smoke test:
--   The staging dashboard hangs on the loading spinner because it queries
--   public.profiles for the logged-in user's profile row, and we never
--   created a profiles table. The dashboard retries the request in a loop
--   (visible 404s in DevTools network tab pointing at hlpucysbaqerhwahfolg
--   .supabase.co/rest/v1/profiles) and the rest of the UI is gated on that
--   fetch resolving.
--
-- Root cause (broader):
--   Original schema (db/schema.sql) replicated only the 5 tables the Worker
--   touches directly. The dashboard touches 8 additional tables. Those were
--   not exported from production until now.
--
-- Production tables list (13 total):
--   audit_log, bot_documents*, bots*, coach_flag_reasons,
--   conversation_examples, conversations*, invites, learnings*,
--   organizations, profiles, prompt_versions, reconciliation_queue,
--   reviews*
--   (* = already in db/schema.sql)
--
-- This migration adds the 8 missing tables and seeds:
--   - organizations row matching bots.organization_id
--   - profiles row for the staging test user (staging-test@botos-platform.local)
--
-- audit_log schema is taken verbatim from production DDL (provided by user).
-- Other 7 schemas are inferred from production CSV exports following the
-- same Option C policy as schema.sql:
--   - Strict NOT NULL on id, bot_id, and core required columns
--   - jsonb for fields where production stores JSON values
--   - text for customer_id (matches our conversations table; production
--     coach_flag_reasons.customer_id appears as integer in CSV but Worker
--     code writes String(customer_id) so text is consistent)
--   - No foreign keys (deferred for staging; would require strict ordering)
--   - No RLS policies (deferred; same gap as schema.sql)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
-- Standard Supabase pattern: profiles.id = auth.users.id (1:1).
-- The dashboard reads this on every login to get role / permissions /
-- assigned_bot_id.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid PRIMARY KEY,
  email            text NOT NULL,
  name             text,
  role             text DEFAULT 'setter',
  organization_id  uuid,
  assigned_bot_id  uuid,
  permissions      jsonb DEFAULT '[]'::jsonb,
  created_at       timestamptz DEFAULT now(),
  invited_by       uuid,
  disabled         boolean DEFAULT false
);

-- ----------------------------------------------------------------------------
-- invites
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  name             text,
  token            text NOT NULL,
  role             text DEFAULT 'setter',
  assigned_bot_id  uuid,
  permissions      jsonb DEFAULT '[]'::jsonb,
  invited_by       uuid,
  status           text DEFAULT 'pending',
  expires_at       timestamptz,
  accepted_at      timestamptz,
  created_at       timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- coach_flag_reasons
-- ----------------------------------------------------------------------------
-- Setter / coach manually flags a conversation with a category and optional
-- comment. Used by the inbox UI for triaging leads that need human
-- attention.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_flag_reasons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id              uuid NOT NULL,
  customer_id         text NOT NULL,
  event_type          text NOT NULL,
  category            text,
  comment             text,
  flagged_by_user_id  uuid,
  ai_confidence       float8,
  created_at          timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- prompt_versions
-- ----------------------------------------------------------------------------
-- Snapshot history of bots.system_prompt. Each time the prompt changes a new
-- row is inserted with an incrementing version_number. label is a
-- human-readable short string ("v5 · 4/12/2026").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL,
  prompt          text NOT NULL,
  note            text,
  created_at      timestamptz DEFAULT now(),
  version_number  int4 NOT NULL,
  label           text
);

-- ----------------------------------------------------------------------------
-- conversation_examples
-- ----------------------------------------------------------------------------
-- Imported real conversation transcripts used as training examples for the
-- bot. turns is a jsonb array of {date, text, role} objects.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_examples (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL,
  contact_name    text,
  contact_id      text,
  conversation_id text,
  outcome         text,
  total_messages  int4 DEFAULT 0,
  lead_messages   int4 DEFAULT 0,
  coach_messages  int4 DEFAULT 0,
  turns           jsonb DEFAULT '[]'::jsonb,
  has_zoom        boolean DEFAULT false,
  has_booking     boolean DEFAULT false,
  has_screening   boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- reconciliation_queue
-- ----------------------------------------------------------------------------
-- Queue for reconciling lead identities across data sources (e.g., GHL
-- import vs Instagram live messages). Surfaced in admin UI for manual
-- resolution.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_queue (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                 uuid NOT NULL,
  source_customer_id     text,
  source_username        text,
  source_profile_name    text,
  suggested_target_id    text,
  suggested_match_count  int4 DEFAULT 0,
  issue_type             text NOT NULL,
  status                 text DEFAULT 'pending',
  resolved_by            uuid,
  resolved_at            timestamptz,
  notes                  text,
  created_at             timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------------------
-- Schema taken verbatim from production DDL provided by user.
-- Includes original indexes since they were also provided.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   text NOT NULL,
  field_name  text NOT NULL,
  old_value   text NULL,
  new_value   text NULL,
  changed_by  text NOT NULL,
  change_type text NOT NULL,
  reason      text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON public.audit_log USING btree (table_name, record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by
  ON public.audit_log USING btree (changed_by, created_at DESC);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- 1. organizations row matching the staging bots.organization_id
INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Nella Platform (staging)')
ON CONFLICT (id) DO NOTHING;

-- 2. profiles row for the staging test user
--
-- The dashboard queries profiles?id=eq.{auth.users.id} on every login.
-- Without a matching row, the dashboard hangs on the loading spinner
-- (observed in 1.1.5b smoke test).
--
-- We grant the test user 'admin' role and full permissions so they can
-- exercise every dashboard feature in staging. This is intentionally
-- broader than the production 'setter' role you saw in profiles_rows.csv
-- because staging is a test environment and we want one user to be able
-- to test everything without manual permission edits.
--
-- Looking up the auth.users.id dynamically via subquery so this migration
-- is idempotent across user recreations.
INSERT INTO public.profiles (
  id,
  email,
  name,
  role,
  organization_id,
  assigned_bot_id,
  permissions,
  disabled
)
SELECT
  u.id,
  u.email,
  'Staging Test User',
  'admin',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '["inbox", "analytics", "settings", "training", "leads"]'::jsonb,
  false
FROM auth.users u
WHERE u.email = 'staging-test@botos-platform.local'
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, confirm all 13 tables exist:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected: audit_log, bot_documents, bots, coach_flag_reasons,
-- conversation_examples, conversations, invites, learnings,
-- organizations, profiles, prompt_versions, reconciliation_queue, reviews
--
-- Confirm the test user got a profile row:
--
--   SELECT id, email, name, role, organization_id, assigned_bot_id
--   FROM public.profiles
--   WHERE email = 'staging-test@botos-platform.local';
--
-- Expected: 1 row with role='admin' and the seeded organization_id and
-- assigned_bot_id.
-- ============================================================================
