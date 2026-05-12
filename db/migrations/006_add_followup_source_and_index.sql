-- ============================================================================
-- Migration 006: auto follow-up support
-- ============================================================================
-- Generated: 2026-05-12
-- Issue: Priority 3 introduces a Cloudflare Worker cron trigger that sends
--   an automated single-word follow-up ("James?", "Anna?", etc.) at T+20h
--   after a lead's last user message. The cron needs:
--
--   1. An efficient way to query candidate leads each hour. The conversations
--      table has ~thousands of rows over the lifetime of the bot; without an
--      index the hourly query would be a full table scan.
--
--   2. A way to distinguish auto follow-ups (sent by the cron) from manual
--      follow-ups (sent by a setter clicking the "Mark as followed up" button
--      in the dashboard). Without this distinction the dashboard cannot show
--      setters which follow-ups were automated vs human, and the audit trail
--      conflates the two.
--
-- This migration adds both. It does NOT modify the existing followed_up
-- boolean or followup_count integer (already present on conversations).
-- The cron will set followed_up=true, followup_count=followup_count+1,
-- last_followup_source='auto'. The dashboard manual button will later be
-- updated to set last_followup_source='manual'.
--
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column: last_followup_source
-- ---------------------------------------------------------------------------
-- Nullable. Existing rows stay NULL forever (we do not backfill historical
-- manual follow-ups; setters who care can read followup_count and trust
-- the convention that pre-2026-05-12 follow-ups were manual). Going forward
-- every follow-up write sets this column.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_followup_source text NULL;

COMMENT ON COLUMN public.conversations.last_followup_source IS
  'Source of the most recent follow-up. Values: ''auto'' (Worker cron at T+20h), ''manual'' (setter clicked Mark as followed up). NULL means no follow-up has been recorded with the new source-tracking column, either because the conversation has never been followed up, or because the follow-up predates 2026-05-12.';

-- ---------------------------------------------------------------------------
-- 2. Partial index: speed up the hourly cron query
-- ---------------------------------------------------------------------------
-- The cron query filters on:
--   bot_id = '00000000-0000-0000-0000-000000000002'
--   followed_up = false
--   for_coach = false
--   conversation_stage <> 'BOOKED'
--   updated_at BETWEEN NOW() - 21h AND NOW() - 20h
--
-- A partial index that excludes rows we will never look at (followed-up,
-- for-coach, or BOOKED) keeps the index small and the scan fast. We index
-- on (bot_id, updated_at) because both are filter columns and updated_at
-- is the range component.
CREATE INDEX IF NOT EXISTS idx_conversations_followup_eligibility
  ON public.conversations (bot_id, updated_at)
  WHERE followed_up = false
    AND for_coach = false
    AND conversation_stage <> 'BOOKED';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Confirm column exists:
--      SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--      WHERE table_name = 'conversations'
--        AND column_name = 'last_followup_source';
--
--    Expected: one row, data_type=text, is_nullable=YES
--
-- 2. Confirm index exists:
--      SELECT indexname, indexdef
--      FROM pg_indexes
--      WHERE tablename = 'conversations'
--        AND indexname = 'idx_conversations_followup_eligibility';
--
--    Expected: one row.
--
-- 3. Confirm all existing rows have NULL for the new column:
--      SELECT COUNT(*) AS rows_total,
--             COUNT(last_followup_source) AS rows_with_value
--      FROM public.conversations;
--
--    Expected: rows_with_value = 0 immediately after migration. rows_total
--    matches the current table size.
-- ============================================================================