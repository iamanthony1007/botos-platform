-- ============================================================================
-- BotOS staging schema (sub-step 1.1.5a)
-- ============================================================================
-- Generated: 2026-05-05
-- Source: production CSV exports of bots, conversations, reviews, learnings,
-- bot_documents tables, cross-referenced against sales-bot/src/index.js on the
-- staging branch (commit bf6bdae).
--
-- Target: Mu AI Staging Env Supabase project (ref hlpucysbaqerhwahfolg)
--
-- Run this in:
--   Supabase Dashboard -> SQL Editor -> paste -> Run
--
-- ----------------------------------------------------------------------------
-- KNOWN GAPS vs production schema (DO NOT use this schema in production)
-- ----------------------------------------------------------------------------
-- 1. Row Level Security (RLS) is DISABLED on all tables (via the ALTER
--    statements at the end of this file). Supabase enables RLS by default
--    on tables created in the public schema; without policies in place this
--    causes every dashboard query to silently return zero rows. We disable
--    RLS for staging because it is a single-user development sandbox.
--    Production has RLS on with real policies (NOT captured in this repo
--    yet). DO NOT use this schema in production.
-- 2. Foreign keys are NOT created. Production likely has organizations(id)
--    referenced by bots.organization_id, and possibly bots(id) referenced by
--    other tables' bot_id columns. We did not export the organizations table
--    so the FK chain cannot be reconstructed safely.
-- 3. Indexes beyond primary keys are NOT created. Worker queries filter on
--    bot_id, customer_id, username, history_source. For a smoke test with
--    one bot row this does not matter. Add indexes if staging gets used at
--    higher data volumes.
-- 4. Triggers (e.g. auto-updating updated_at on row update) are NOT created.
--    Worker writes updated_at explicitly so this is fine for the documented
--    code paths, but dashboard updates would need manual updated_at writes
--    or a trigger.
-- 5. Functions (Postgres functions / RPC procedures) are NOT included.
--    None were found referenced from the Worker code we read. Dashboard may
--    use some.
-- 6. NOT NULL constraints are minimal (only id and bot_id are NOT NULL on
--    most tables) per the agreed Option C ("hybrid: strict on critical
--    columns, loose elsewhere"). This is intentional. A row that fails to
--    populate optional fields will insert successfully so smoke tests can
--    proceed; a row that fails to populate id or bot_id will fail loudly,
--    which is the desired behavior.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bots
-- ----------------------------------------------------------------------------
-- The Worker reads exactly one row by id = BOT_ID hardcoded constant.
-- We will seed that single row at the bottom of this file.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  organization_id      uuid,
  system_prompt        text,
  model                text,
  status               text DEFAULT 'active',
  auto_send_enabled    boolean DEFAULT false,
  webhook_url          text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  intent_definitions   jsonb,
  lead_type            text,
  buyer_type           text,
  communication_style  text,
  campaign_goal        text,
  target_avatar        text,
  ai_behavior_settings jsonb,
  welcome_context      text
);

-- ----------------------------------------------------------------------------
-- conversations
-- ----------------------------------------------------------------------------
-- One row per (bot_id, customer_id) lead. Worker reads this on every webhook
-- call and writes back updated memory. messages and profile_facts are jsonb.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                 uuid NOT NULL,
  customer_id            text NOT NULL,
  channel                text,
  status                 text DEFAULT 'active',
  lead_readiness         text,
  primary_goal           text,
  conversation_stage     text,
  messages               jsonb DEFAULT '[]'::jsonb,
  profile_facts          jsonb DEFAULT '{}'::jsonb,
  running_summary        text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  username               text,
  profile_name           text,
  lead_intent            text,
  conversation_id        text,
  ghl_contact_id         text,
  total_messages         int4 DEFAULT 0,
  first_message_date     timestamptz,
  last_message_date      timestamptz,
  history_source         text DEFAULT 'live',
  followed_up            boolean DEFAULT false,
  followup_count         int4 DEFAULT 0,
  re_engaged             boolean DEFAULT false,
  pre_followup_stage     text,
  deleted_at             timestamptz,
  merged_into            uuid,
  contact_type           text DEFAULT 'prospect',
  lead_source            text,
  lead_source_updated_at timestamptz,
  for_coach              boolean DEFAULT false,
  -- Worker upserts conversations on (bot_id, customer_id). This UNIQUE
  -- constraint is required by Postgres ON CONFLICT semantics and matches the
  -- business invariant: one conversation record per (bot, lead) pair.
  CONSTRAINT conversations_bot_id_customer_id_key UNIQUE (bot_id, customer_id)
);

-- ----------------------------------------------------------------------------
-- reviews
-- ----------------------------------------------------------------------------
-- Inbox approval queue. Worker creates these via ctx.waitUntil (per project
-- memory: this is the documented race-condition area). Status values seen in
-- prod: discarded; code also writes 'pending' and 'approved'.
--
-- NOTE: id here is text, not uuid, because production uses prefixed timestamp
-- IDs like "review_1774011336781_nnulffi1z". This is what the Worker emits.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reviews (
  id                  text PRIMARY KEY,
  bot_id              uuid NOT NULL,
  customer_id         text NOT NULL,
  action_type         text NOT NULL,
  conversation_stage  text,
  confidence          float8,
  bot_reply           text,
  internal_notes      text,
  last_messages       jsonb DEFAULT '[]'::jsonb,
  status              text DEFAULT 'pending',
  final_reply         text,
  resolved_at         timestamptz,
  created_at          timestamptz DEFAULT now(),
  username            text,
  bot_messages        jsonb DEFAULT '[]'::jsonb,
  typing_delays       jsonb DEFAULT '[]'::jsonb,
  final_messages      jsonb DEFAULT '[]'::jsonb,
  escalation_reason   text,
  emotional_state     text,
  lead_intent         text,
  profile_name        text
);

-- ----------------------------------------------------------------------------
-- learnings
-- ----------------------------------------------------------------------------
-- Captured when a setter edits a bot reply via the inbox. Stores both the
-- original generated reply and the corrected version for future training.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learnings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id              uuid NOT NULL,
  customer_id         text NOT NULL,
  review_id           text,
  conversation_stage  text,
  situation_context   text,
  original_reply      text,
  corrected_reply     text,
  reason              text,
  tags                jsonb DEFAULT '[]'::jsonb,
  source              text,
  created_at          timestamptz DEFAULT now(),
  corrected_messages  jsonb DEFAULT '[]'::jsonb
);

-- ----------------------------------------------------------------------------
-- bot_documents
-- ----------------------------------------------------------------------------
-- Training documents attached to a bot. Worker /extract-document endpoint
-- writes here. Dashboard reads.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id       uuid NOT NULL,
  name         text NOT NULL,
  content      text,
  file_type    text,
  status       text DEFAULT 'active',
  usage_count  int4 DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  file_path    text,
  file_size    int8
);

-- ============================================================================
-- SEED DATA
-- ============================================================================
-- The Worker hardcodes BOT_ID = '00000000-0000-0000-0000-000000000002' and
-- queries the bots table for that exact id. Without this row the Worker will
-- fall back to default bot settings (per src/index.js line ~639), which works
-- but does not match production behavior. We seed it from production values.
--
-- intent_definitions and ai_behavior_settings: copied from the production
-- CSV. These are configuration JSON, not customer data, so safe to replicate.
--
-- system_prompt: NOT copied from production. The production system_prompt is
-- a 10243-character "Coach Shaun" persona for the live golf coaching business.
-- For staging we use a short generic placeholder so:
--   1. We don't bake live business prompts into a less-secure environment
--   2. Staging tests don't accidentally produce production-quality replies
--      that could be misused
-- The prompt can be replaced by hand if you want to test prompt-specific
-- behavior. For 1.1.5b's smoke test, the placeholder is sufficient.
-- ============================================================================
INSERT INTO public.bots (
  id,
  name,
  organization_id,
  system_prompt,
  model,
  status,
  auto_send_enabled,
  webhook_url,
  intent_definitions,
  lead_type,
  buyer_type,
  communication_style,
  campaign_goal,
  ai_behavior_settings,
  welcome_context
) VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Bombers Blueprint (staging)',
  '00000000-0000-0000-0000-000000000001',
  'You are a test bot in a staging environment. Reply briefly and helpfully.',
  'claude-sonnet-4-6',
  'active',
  false,
  'https://sales-bot-staging.nellakuate.workers.dev/webhook',
  '{"stages": {"GOAL": {"LOW": {"examples": ["just want to get better"], "definition": "Vague or unclear goal"}, "MEDIUM": {"examples": ["want to break 80"], "definition": "Specific goal stated"}, "HIGH": {"examples": ["compete in club championship"], "definition": "Clear measurable goal with timeline"}}}}'::jsonb,
  'Warm',
  'Emotional',
  'Hybrid',
  'General',
  '{"aiRole": "Setter / Assistant", "offerName": "", "offerSummary": "", "primaryObjective": "Book Call"}'::jsonb,
  'Staging environment seed row. This is a test bot in Mu AI Staging Env. Do not use for live customer interactions.'
);

-- ============================================================================
-- ADDITIONAL TABLES (added in migration 002)
-- ============================================================================
-- These 8 tables are queried by the dashboard but not by the Worker. Without
-- them the dashboard hangs on a profiles 404 loop after login (discovered in
-- 1.1.5b smoke test).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL,
  prompt          text NOT NULL,
  note            text,
  created_at      timestamptz DEFAULT now(),
  version_number  int4 NOT NULL,
  label           text
);

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

-- Seed the organization that bots.organization_id references.
INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Nella Platform (staging)')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- DISABLE ROW LEVEL SECURITY (added in migration 003)
-- ============================================================================
-- Supabase enables RLS by default on every table in the public schema.
-- Without policies, this means PostgREST returns 0 rows for every query
-- made by anyone other than the postgres superuser, causing the dashboard
-- to fail to load.
--
-- For staging (single-user dev sandbox), we disable RLS entirely. For
-- production, RLS should remain on with real policies. See migration 003
-- header for full discussion.
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
-- After running this file, run these checks in SQL Editor:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--   -- Expected (13 tables): audit_log, bot_documents, bots,
--   -- coach_flag_reasons, conversation_examples, conversations, invites,
--   -- learnings, organizations, profiles, prompt_versions,
--   -- reconciliation_queue, reviews
--
--   SELECT id, name, status FROM public.bots;
--   -- Expected: one row with id 00000000-0000-0000-0000-000000000002
--
--   SELECT id, name FROM public.organizations;
--   -- Expected: one row with id 00000000-0000-0000-0000-000000000001
--
-- Profile seeding for the staging test user lives in migration 002 because
-- it depends on auth.users having the user already created.
-- ============================================================================
