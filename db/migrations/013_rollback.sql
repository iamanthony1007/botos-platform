-- ============================================================================
-- 013_rollback.sql
-- ============================================================================
-- Rollback for 013_add_reviews_channel.sql, following the paired-rollback
-- convention. Idempotent.
--
-- WARNING, PRODUCTION DATA LOSS. Production's reviews.channel predates this
-- migration and holds real values on every row (5951 'instagram' rows as of
-- 2026-08-16), and both the ManyChat path and the Worker write it on insert.
-- Running this on PRODUCTION destroys that data and breaks those inserts.
-- It exists for STAGING, where the column arriving via 013 is the only thing
-- that would be undone. Do not run it on production.
-- ============================================================================

ALTER TABLE public.reviews DROP COLUMN IF EXISTS channel;

NOTIFY pgrst, 'reload schema';
