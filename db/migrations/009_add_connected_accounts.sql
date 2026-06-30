-- ============================================================================
-- 009_add_connected_accounts.sql
-- ============================================================================
-- Maps an external messaging account (WhatsApp phone number, Instagram account,
-- etc.) to a bot, and stores the per-account access token (encrypted at rest)
-- used to send replies. Replaces the single hardcoded BOT_ID for inbound
-- routing: an inbound webhook carries the account that received the message;
-- we look up which bot owns it and the token to reply with.
--
-- Channel-agnostic: `platform` distinguishes whatsapp / instagram / messenger,
-- and `platform_metadata` holds channel-specific identifiers (e.g. WhatsApp
-- WABA id) without needing per-channel columns.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                  uuid NOT NULL,
  platform                text NOT NULL,                 -- 'whatsapp' | 'instagram' | 'messenger' | ...
  external_account_id     text NOT NULL,                 -- WhatsApp phone-number id / IG account id
  account_username        text,                          -- display handle / phone label (optional)
  access_token_encrypted  text,                          -- encrypted token (IV packed in); null until connected
  token_expires_at        timestamptz,                   -- null = non-expiring (e.g. system user token)
  platform_metadata       jsonb DEFAULT '{}'::jsonb,     -- channel-specific: WABA id, display number, etc.
  deauthorized            boolean DEFAULT false,
  deauthorized_at         timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  CONSTRAINT connected_accounts_platform_account_key UNIQUE (platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_bot_id
  ON public.connected_accounts (bot_id);

-- ----------------------------------------------------------------------------
-- Row Level Security: ENABLED with NO policy. This table holds access tokens,
-- so it must be locked to the Worker only. The Worker authenticates with
-- SUPABASE_SERVICE_KEY (service role, has BYPASSRLS) and so reads/writes
-- normally. The dashboard uses the public anon key, which is subject to RLS;
-- with RLS on and no permissive policy it receives zero rows. We enable RLS
-- EXPLICITLY because a table created via raw SQL does NOT inherit the Supabase
-- table-editor's "RLS on by default" behavior; left alone it would be RLS-off
-- and potentially readable by the anon role.
-- ----------------------------------------------------------------------------
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
