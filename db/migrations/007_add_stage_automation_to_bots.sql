-- ============================================================================
-- Migration 007: add stage_automation jsonb to bots
-- ============================================================================
-- Generated: 2026-06-01
--
-- Stores the human (Nella) unlock decisions for the per-stage gradual
-- automation feature. Shape:
--
--   {
--     "<STAGE_NAME>": {
--       "enabled":     true,
--       "enabled_at":  "2026-06-02T14:00:00Z",
--       "enabled_by":  "nella@example.com"
--     },
--     ...
--   }
--
-- Absence of a stage key = TRAINING (default). The Worker (after step 5)
-- gates AUTO_SEND on stage_automation[stage].enabled === true in addition
-- to the existing per-message safety guards. Default '{}' preserves
-- current manual-review behavior: no stages unlocked, nothing auto-sends.
--
-- Eligibility (the data-driven "ready to graduate" flag) is computed live
-- in the dashboard (dashboard/src/lib/stageReadiness.js) from the reviews
-- table and is NEVER stored here. Only human unlocks are persisted.
--
-- Apply order: STAGING (hlpucysbaqerhwahfolg) first, then PRODUCTION
-- (rydkwsjwlgnivlwlvqku) only with explicit go from Anthony. Never the
-- other way around. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- DOWN (manual, only if absolutely needed):
--   ALTER TABLE public.bots DROP COLUMN IF EXISTS stage_automation;
-- ============================================================================

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS stage_automation jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.bots.stage_automation IS
  'Per-stage human unlock decisions for gradual auto-send. Map of conversation_stage to { enabled: bool, enabled_at: ISO, enabled_by: identifier }. Absence of a stage = TRAINING. Eligibility is computed live in the dashboard, not stored here.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, confirm:
--
-- 1. Column exists with the correct type, default, and NOT NULL:
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_name = 'bots' AND column_name = 'stage_automation';
--
--    Expected: one row, data_type = jsonb, is_nullable = NO,
--    column_default = '{}'::jsonb
--
-- 2. Existing rows defaulted to empty object:
--      SELECT id, name, stage_automation FROM public.bots ORDER BY id;
--    Expected: stage_automation = {} (empty json object) for every row.
--
-- 3. Comment is set:
--      SELECT col_description('public.bots'::regclass,
--        (SELECT attnum FROM pg_attribute
--         WHERE attrelid = 'public.bots'::regclass
--           AND attname = 'stage_automation'));
--    Expected: the COMMENT ON COLUMN text above.
-- ============================================================================
