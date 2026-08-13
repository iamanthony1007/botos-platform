-- ============================================================================
-- 012_rollback.sql
-- ============================================================================
-- Rollback for 012_data_deletion_requests.sql, following the repo's paired-
-- rollback convention (see 011_rollback.sql). Dropping the table drops its index
-- (and the confirmation_code unique-constraint index) with it. Idempotent: safe
-- to run more than once.
--
-- Note: this destroys the deletion-request audit log. Only run it if 012 needs
-- to be reverted before any real deletion requests have been logged, or after
-- their retention obligation has lapsed.
-- ============================================================================

DROP TABLE IF EXISTS public.data_deletion_requests;
