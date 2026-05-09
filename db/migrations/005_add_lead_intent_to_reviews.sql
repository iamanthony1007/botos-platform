-- ============================================================================
-- Migration 005: add lead_intent column to reviews
-- ============================================================================
-- Closes a schema gap where the Worker writes `lead_intent` to the `reviews`
-- table on three code paths (SEND_TO_INBOX_REVIEW batching UPDATE,
-- AUTO_SEND batching UPDATE, Claude API overloaded fallback INSERT) but the
-- column was never added to the table. PostgREST returns PGRST204 and the
-- entire UPDATE/INSERT is rejected. Errors are silent because the writes are
-- wrapped in ctx.waitUntil. Result: batched-turn inbox records show stale
-- first-turn data on production.
--
-- Definition matches conversations.lead_intent for consistency.
-- Worker writes literal strings: LOW | MEDIUM | HIGH | UNKNOWN.
--
-- Idempotent: safe to run multiple times.
-- Apply order: STAGING (hlpucysbaqerhwahfolg) first, PRODUCTION
-- (rydkwsjwlgnivlwlvqku) second. Never the other way around.
--
-- DOWN (manual, only if needed):
--   ALTER TABLE public.reviews DROP COLUMN IF EXISTS lead_intent;
-- ============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS lead_intent text;