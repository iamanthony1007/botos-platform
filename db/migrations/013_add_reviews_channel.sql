-- ============================================================================
-- 013_add_reviews_channel.sql
-- ============================================================================
-- Adds reviews.channel, closing a schema drift found live on 2026-08-16.
--
-- HOW THE DRIFT HAPPENED. Production's reviews table has had a channel column
-- for months (5951 rows, all 'instagram' from the ManyChat path; the Worker's
-- WhatsApp and Stage 4 instagram_api paths write it explicitly). But NO migration
-- ever added it and it is absent from db/schema.sql, so it was added to
-- production out of band. Staging, rebuilt from the migration chain, therefore
-- has no channel column, and the first code path that writes reviews on staging
-- (the Stage 4 pipeline test) failed all 3 insert retries with PGRST204
-- "Could not find the 'channel' column of 'reviews' in the schema cache" while
-- the conversation write succeeded (rpc_ok=true review_ok=false).
--
-- This migration makes the column part of the canonical chain. It mirrors the
-- production column EXACTLY as PostgREST reports it (text, nullable,
-- DEFAULT 'instagram') and is a no-op on production thanks to IF NOT EXISTS.
-- The default is production's actual default; do not "improve" it, matching
-- matters more than taste here.
-- ============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS channel text DEFAULT 'instagram';

NOTIFY pgrst, 'reload schema';
