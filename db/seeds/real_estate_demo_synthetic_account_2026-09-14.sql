-- ============================================================================
-- real_estate_demo_synthetic_account_2026-09-14.sql
-- ============================================================================
-- SIMULATE BRANCH of the revised 2026-09-14 demo ruling (both branches
-- supported): binds a SYNTHETIC Instagram business id to the Real Estate Demo
-- bot so the demo driver runs with no OAuth connect. The Worker resolves bots
-- by string equality on (platform, external_account_id); nothing on the
-- inbound path reads the token. Verified in sales-bot/src/index.js at commit
-- 76c8988:
--   1. routeInstagramEvent -> resolveConnectedAccount -> processWhatsAppReply:
--      no Graph API call anywhere, profileName is null for instagram_api.
--   2. refreshInstagramTokens requires token_expires_at NOT NULL, so this row
--      (null expiry) is never a refresh candidate. Zero cron churn.
--   3. The follow-up cron is hardcoded to Shaun's BOT_ID and
--      channel in (instagram, manychat). Demo rows are instagram_api under
--      bot ...00e1. Double-excluded.
--
-- RUN AFTER the tenant seed (real_estate_demo_tenant_2026-09-14.sql), in the
-- PRODUCTION SQL editor. Idempotent: a re-paste forces the row back to the
-- expected state.
--
-- DRIVER ENV for this branch (replaces "read external_account_id after the
-- connect"):
--   $env:DEMO_IG_ACCOUNT_ID = "990914100000"
--
-- RULE FOR THE LIVE BRANCH: if Nella wants the live on-camera moment, DELETE
-- this row FIRST, then do the real OAuth connect. getInstagramSendCreds
-- selects by bot_id with limit 1 and no ordering; a second tokenless row on
-- the same bot can hand the send path this row and break real sends.
--
--   delete from public.connected_accounts
--   where id = '00000000-0000-0000-0000-0000000000e2';
--
-- CLEANUP after the demo: the same delete, alongside the demo org teardown.
-- ============================================================================

insert into public.connected_accounts (
  id, bot_id, platform, external_account_id, account_username,
  access_token_encrypted, token_expires_at, platform_metadata,
  deauthorized, deauthorized_at
) values (
  '00000000-0000-0000-0000-0000000000e2',
  '00000000-0000-0000-0000-0000000000e1',  -- Real Estate Demo bot
  'instagram_api',
  '990914100000',  -- synthetic business id; driver senders are 990914100101..990914100606
  'realestatedemo.synthetic',
  null,            -- no token; the inbound path never reads it
  null,            -- null expiry keeps the refresh cron away
  '{"synthetic": true, "purpose": "real_estate_demo_2026-09-14"}'::jsonb,
  false,
  null
)
on conflict (platform, external_account_id) do update set
  bot_id            = excluded.bot_id,
  account_username  = excluded.account_username,
  platform_metadata = excluded.platform_metadata,
  deauthorized      = false,
  deauthorized_at   = null,
  updated_at        = now();

-- ----------------------------------------------------------------------------
-- VERIFICATION. Expected: exactly one row.
--   id                   00000000-0000-0000-0000-0000000000e2
--   bot_id               00000000-0000-0000-0000-0000000000e1
--   external_account_id  990914100000
--   account_username     realestatedemo.synthetic
--   deauthorized         false
--   token_nulled         true
-- If bot_id shows anything other than ...00e1, stop: the id is claimed.
-- ----------------------------------------------------------------------------
select id, bot_id, external_account_id, account_username, deauthorized,
       (access_token_encrypted is null) as token_nulled
from public.connected_accounts
where platform = 'instagram_api';
