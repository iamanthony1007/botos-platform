-- ============================================================================
-- demo_tenant_teardown.sql
-- ============================================================================
-- Paired teardown for demo_tenant_2026-08-19.sql. Run this once Meta approves,
-- alongside the reviewer-account removal already recorded at the top of
-- PROGRESS.md (delete the profiles row, then the auth user in the Supabase
-- Dashboard).
--
-- ORDER MATTERS. The reviewer profile is repointed BEFORE the bot is deleted, so
-- there is never a window where a live profile references a missing bot.
--
-- This deletes the demo tenant's own conversations and reviews. Those are the
-- reviewer's test DMs and carry no client data. It does NOT touch any other bot.
-- Every statement is scoped to the demo ids and re-running it is a no-op.
--
-- The connected_accounts row for whatever Instagram account the reviewer
-- connected is deleted here too. Deleting the row does NOT revoke the grant on
-- Meta's side: the reviewer (or Anthony) should remove the app from the
-- Instagram account's connected-apps list as well, which fires the deauthorize
-- callback.
-- ============================================================================

begin;

-- 1) Unpoint the reviewer account first (leave the profile itself in place;
--    deleting it is a separate documented step with the auth user).
update public.profiles
set assigned_bot_id = null,
    organization_id = null
where assigned_bot_id = '00000000-0000-0000-0000-0000000000d1';

-- 2) The reviewer's test data.
delete from public.reviews       where bot_id = '00000000-0000-0000-0000-0000000000d1';
delete from public.conversations where bot_id = '00000000-0000-0000-0000-0000000000d1';
delete from public.learnings     where bot_id = '00000000-0000-0000-0000-0000000000d1';
delete from public.bot_documents where bot_id = '00000000-0000-0000-0000-0000000000d1';

-- 3) The Instagram connection the reviewer made.
delete from public.connected_accounts where bot_id = '00000000-0000-0000-0000-0000000000d1';

-- 4) The tenant itself.
delete from public.bots          where id = '00000000-0000-0000-0000-0000000000d1';
delete from public.organizations where id = '00000000-0000-0000-0000-0000000000d0';

commit;

-- Verification: all of these should return 0.
--   select
--     (select count(*) from public.bots               where id      = '00000000-0000-0000-0000-0000000000d1'),
--     (select count(*) from public.organizations      where id      = '00000000-0000-0000-0000-0000000000d0'),
--     (select count(*) from public.conversations      where bot_id  = '00000000-0000-0000-0000-0000000000d1'),
--     (select count(*) from public.reviews            where bot_id  = '00000000-0000-0000-0000-0000000000d1'),
--     (select count(*) from public.connected_accounts where bot_id  = '00000000-0000-0000-0000-0000000000d1');
--
-- KV note: the Worker keys conversation memory as memory:<bot_id>:<customer_id>
-- and dedup as ig_seen:<mid>. Neither is removed by SQL. Sweep them by PREFIX
-- LISTING (the delete-loop-then-list lesson from 2026-08-18), not by guessing
-- key names.
