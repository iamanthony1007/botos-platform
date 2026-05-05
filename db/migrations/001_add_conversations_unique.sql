-- ============================================================================
-- Staging schema migration 001
-- ============================================================================
-- Generated: 2026-05-05
-- Issue discovered during 1.1.5b smoke test:
--   Worker upserts conversations rows with on_conflict=bot_id,customer_id, but
--   our initial schema (db/schema.sql) did not declare a unique constraint on
--   that column pair. Postgres returned error 42P10 ("there is no unique or
--   exclusion constraint matching the ON CONFLICT specification") and the
--   ctx.waitUntil swallowed the error silently. Result: reviews row was
--   created, but conversations row was not.
--
-- Fix:
--   Add UNIQUE constraint on (bot_id, customer_id). This matches the
--   business invariant the Worker code already assumes: one conversation
--   record per (bot, lead) pair.
--
-- Worker callsites that depend on this constraint:
--   sales-bot/src/index.js lines 1136, 1261, 1322, 1501
--   (all four use on_conflict=bot_id,customer_id)
--
-- This migration is idempotent (uses IF NOT EXISTS pattern via DO block).
-- Safe to run multiple times.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_bot_id_customer_id_key'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_bot_id_customer_id_key
      UNIQUE (bot_id, customer_id);
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, confirm the constraint exists:
--
--   SELECT conname, contype FROM pg_constraint
--   WHERE conrelid = 'public.conversations'::regclass
--   ORDER BY conname;
--
-- Expected to include:
--   conversations_bot_id_customer_id_key | u
--   conversations_pkey                   | p
-- ============================================================================
