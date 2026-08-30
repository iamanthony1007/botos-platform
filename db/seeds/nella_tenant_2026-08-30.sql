-- ============================================================================
-- nella_tenant_2026-08-30.sql
-- ============================================================================
-- Creates the "Nella's bot" tenant (organization + bot) on PRODUCTION for
-- Part B of the multi-tenant phase: Nella's own business tenant, the one her
-- Instagram connects to. Ruled by Anthony 2026-08-30: a NEW org and bot named
-- "Nella's bot", superseding the earlier D3 wording that pointed at SuperYOU.
-- Her tenant-staff account (Nellaledonne6803@proton.me, role admin) is created
-- separately by scripts/mt-partb-account.mjs; this file is data only.
--
-- Data, not schema, so deliberately NOT a migration (the demo-tenant pattern).
-- INSERT-ONLY: no statement in this file touches a row it did not create. The
-- preflight paste proves the target ids and name are unclaimed first.
--
-- SERVED ONE PASTE AT A TIME in the production SQL editor, breadcrumb
-- Mu AI PRODUCTION project rydkwsjwlgnivlwlvqku, expected output beside each
-- paste, stop on any mismatch. No begin/commit: the editor-atomicity ruling
-- from 011 applies, every paste is idempotent and re-runnable.
--
-- PROMPT PROVENANCE. system_prompt is copied AT INSERT TIME from the demo bot
-- row (...00d1), which carries the verified genericised scaffold, md5
-- 65e10a8a71edfd638a3ce8c67b14a08b, LF-only, zero client identity (0 brand
-- leaks verified 2026-08-19). Copying the live row rather than re-pasting the
-- text guarantees byte-identity and reuses the existing provenance chain.
-- PLACEHOLDER, STATED PLAINLY: the scaffold's persona line still names the
-- demo coaching business. auto_send_enabled=false and stage_automation='{}'
-- mean nothing sends regardless, and NO REAL LEADS should flow until Nella's
-- actual business content replaces the prompt via the Prompt Editor. That is
-- product setup, tracked in the connect choreography, not this seed.
--
-- IDS follow the demo vanity convention: org ...00e0, bot ...00e1.
-- ============================================================================


-- ============================================================================
-- PASTE 1: read-only preflight
-- ============================================================================
-- Proves (a) the scaffold source row is intact, (b) the target ids and the
-- org name are unclaimed, so the inserts below create rather than collide.

select
  (select md5(system_prompt) from public.bots
    where id = '00000000-0000-0000-0000-0000000000d1')          as demo_prompt_md5,
  (select count(*) from public.organizations
    where id = '00000000-0000-0000-0000-0000000000e0')          as org_id_taken,
  (select count(*) from public.bots
    where id = '00000000-0000-0000-0000-0000000000e1')          as bot_id_taken,
  (select count(*) from public.organizations
    where name = 'Nella''s bot')                                as org_name_taken;

-- EXPECTED, exactly one row:
--   demo_prompt_md5 = 65e10a8a71edfd638a3ce8c67b14a08b
--   org_id_taken = 0, bot_id_taken = 0, org_name_taken = 0
-- Any other md5 means the demo prompt drifted: STOP, do not seed from it.
-- Any nonzero count on a re-run after a successful seed is expected (1) and
-- the pastes below remain safe: they are upserts keyed on these exact ids.


-- ============================================================================
-- PASTE 2: the organization
-- ============================================================================

insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-0000000000e0', 'Nella''s bot')
on conflict (id) do update set name = excluded.name;

select id, name, created_at from public.organizations
where id = '00000000-0000-0000-0000-0000000000e0';

-- EXPECTED: one row, name = Nella's bot.


-- ============================================================================
-- PASTE 3: the bot
-- ============================================================================
-- Mirrors the demo bot's safe posture exactly: auto_send_enabled = false and
-- stage_automation = '{}' are REQUIRED (everything takes the setter-review
-- path), intent_definitions / welcome_context / webhook_url stay NULL for the
-- same reasons recorded in the demo seed (Worker generic fallbacks, no
-- ManyChat anywhere near this tenant). No client URLs, no keyword regexes.

insert into public.bots (
  id, name, organization_id, system_prompt, model, status,
  auto_send_enabled, stage_automation,
  lead_type, buyer_type, communication_style, campaign_goal,
  target_avatar, ai_behavior_settings,
  intent_definitions, welcome_context, webhook_url
)
select
  '00000000-0000-0000-0000-0000000000e1',
  'Nella''s bot',
  '00000000-0000-0000-0000-0000000000e0',
  d.system_prompt,
  'claude-sonnet-4-6',
  'active',
  false,
  '{}'::jsonb,
  'Warm',
  'Emotional',
  'Hybrid',
  'General',
  '',
  '{"aiRole": "Setter / Assistant", "offerName": "", "offerSummary": "", "disqualifiers": "", "leadCommStyle": "Mixed (default)", "topPainPoints": "", "desiredOutcomes": "", "primaryObjective": "Book Call", "qualificationCriteria": ""}'::jsonb,
  null,
  null,
  null
from public.bots d
where d.id = '00000000-0000-0000-0000-0000000000d1'
on conflict (id) do update set
  name                 = excluded.name,
  organization_id      = excluded.organization_id,
  system_prompt        = excluded.system_prompt,
  model                = excluded.model,
  status               = excluded.status,
  auto_send_enabled    = excluded.auto_send_enabled,
  stage_automation     = excluded.stage_automation,
  lead_type            = excluded.lead_type,
  buyer_type           = excluded.buyer_type,
  communication_style  = excluded.communication_style,
  campaign_goal        = excluded.campaign_goal,
  target_avatar        = excluded.target_avatar,
  ai_behavior_settings = excluded.ai_behavior_settings,
  intent_definitions   = excluded.intent_definitions,
  welcome_context      = excluded.welcome_context,
  webhook_url          = excluded.webhook_url,
  updated_at           = now();

select b.id, b.name, o.name as org_name,
       b.auto_send_enabled, b.stage_automation,
       md5(b.system_prompt) as prompt_md5,
       (b.intent_definitions is null and b.welcome_context is null
        and b.webhook_url is null) as nulls_correct,
       (select count(*) from public.conversations c where c.bot_id = b.id) as convos,
       (select count(*) from public.reviews r where r.bot_id = b.id) as reviews
from public.bots b
join public.organizations o on o.id = b.organization_id
where b.id = '00000000-0000-0000-0000-0000000000e1';

-- EXPECTED, exactly one row:
--   name = Nella's bot, org_name = Nella's bot
--   auto_send_enabled = false, stage_automation = {}
--   prompt_md5 = 65e10a8a71edfd638a3ce8c67b14a08b
--   nulls_correct = true, convos = 0, reviews = 0
