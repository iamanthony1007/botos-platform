-- ============================================================================
-- Staging schema migration 004
-- ============================================================================
-- Generated: 2026-05-07
-- Issue discovered during May 6 production debug:
--   Two webhooks for the same (bot_id, customer_id) arriving within ~1-10
--   seconds of each other would race in the Worker. Both invocations would
--   read memory.messages independently, push their own user message, call
--   Claude, and then upsert conversations.messages with their own version of
--   the array. The second upsert overwrote the first because the existing
--   supabaseUpsert pattern uses Prefer: resolution=merge-duplicates which is
--   a full-row replacement, NOT a JSONB array merge.
--
--   Result: silent message loss in conversations.messages whenever a lead
--   sent two messages in quick succession. Both review rows survived (because
--   reviews uses INSERT with unique IDs), but the conversations.messages
--   array reflected only the second invocation's view of history.
--
--   Confirmed examples:
--     - customer_id 2121147450: 1 message in array, 2 review rows existed
--     - customer_id 442049182:  7 messages in array, 16 review rows existed
--
-- Fix:
--   Add a Postgres function append_conversation_turn() that performs the
--   write atomically using SELECT ... FOR UPDATE row locking. Two concurrent
--   calls for the same (bot_id, customer_id) are serialized at the database
--   level. Each call APPENDS its new turn's messages to whatever is already
--   there, instead of replacing the array.
--
--   The function dedupes by (timestamp, role, content) so a retried webhook
--   carrying the same payload cannot double-append, while genuinely different
--   messages that happen to share a millisecond are still preserved.
--   (Initial version dedup'd on (timestamp, role) only, but that dropped
--    legitimate concurrent messages whose Date.now() collided. Caught during
--    staging test with 3 parallel webhooks.)
--
--   The function preserves existing values for lead_source,
--   lead_source_updated_at, username, and profile_name when the corresponding
--   parameter is NULL. This matches the current Worker behavior of using
--   conditional spreads to avoid clobbering these fields.
--
-- Worker callsite that depends on this function:
--   sales-bot/src/index.js (the main /webhook turn write).
--   Other supabaseUpsert sites continue using the upsert helper for now (they
--   are delivery-failure recovery and metadata-only paths with much smaller
--   loss surface; will be migrated in a follow-up).
--
-- This migration is idempotent (uses CREATE OR REPLACE FUNCTION).
-- Safe to run multiple times.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.append_conversation_turn(
  p_bot_id                  uuid,
  p_customer_id             text,
  p_channel                 text,
  p_new_messages            jsonb,
  p_status                  text,
  p_lead_intent             text,
  p_contact_type            text,
  p_primary_goal            text,
  p_conversation_stage      text,
  p_profile_facts           jsonb,
  p_running_summary         text,
  p_re_engaged              boolean,
  p_pre_followup_stage      text,
  p_lead_source             text DEFAULT NULL,
  p_lead_source_updated_at  timestamptz DEFAULT NULL,
  p_username                text DEFAULT NULL,
  p_profile_name            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_messages   jsonb;
  v_deduped_new         jsonb;
  v_final_messages      jsonb;
  v_was_inserted        boolean;
  v_skipped_count       integer := 0;
  v_new_msg             jsonb;
  v_existing_msg        jsonb;
  v_is_dup              boolean;
  v_recent_window       jsonb;
BEGIN
  -- ── Defensive type check ──────────────────────────────────────────────────
  IF jsonb_typeof(p_new_messages) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_new_messages must be a jsonb array, got %', jsonb_typeof(p_new_messages);
  END IF;

  -- ── Acquire row lock (serializes concurrent calls for same lead) ──────────
  -- If the row exists, FOR UPDATE blocks any other concurrent call to this
  -- function for the same (bot_id, customer_id) until we COMMIT.
  -- If the row does not exist, the SELECT returns no rows and we INSERT
  -- below. The unique constraint on (bot_id, customer_id) guarantees that
  -- two concurrent INSERTs cannot both succeed; one will conflict and
  -- fall through to the UPDATE branch via ON CONFLICT.
  SELECT messages
  INTO v_existing_messages
  FROM public.conversations
  WHERE bot_id = p_bot_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF v_existing_messages IS NULL THEN
    v_existing_messages := '[]'::jsonb;
  END IF;

  -- ── Dedupe new messages against the last 100 of existing ──────────────────
  -- A retried webhook would always be very recent, so scanning the full
  -- array is wasteful on long conversations. We compare new messages
  -- against the trailing window only.
  IF jsonb_array_length(v_existing_messages) > 100 THEN
    v_recent_window := jsonb_path_query_array(
      v_existing_messages,
      '$[last - 99 to last]'
    );
  ELSE
    v_recent_window := v_existing_messages;
  END IF;

  v_deduped_new := '[]'::jsonb;

  -- Dedup key: (timestamp, role, content). All three must match for a
  -- message to be considered a duplicate. This catches retried webhooks
  -- (identical payload) without dropping legitimately-different messages
  -- that happened to land in the same millisecond.
  FOR v_new_msg IN SELECT * FROM jsonb_array_elements(p_new_messages)
  LOOP
    v_is_dup := false;
    FOR v_existing_msg IN SELECT * FROM jsonb_array_elements(v_recent_window)
    LOOP
      IF (v_existing_msg->>'timestamp') = (v_new_msg->>'timestamp')
         AND (v_existing_msg->>'role') = (v_new_msg->>'role')
         AND COALESCE(v_existing_msg->>'content', '') = COALESCE(v_new_msg->>'content', '') THEN
        v_is_dup := true;
        EXIT;
      END IF;
    END LOOP;

    IF v_is_dup THEN
      v_skipped_count := v_skipped_count + 1;
    ELSE
      v_deduped_new := v_deduped_new || jsonb_build_array(v_new_msg);
    END IF;
  END LOOP;

  -- ── Build the final messages array ────────────────────────────────────────
  v_final_messages := v_existing_messages || v_deduped_new;

  -- ── Upsert the row ────────────────────────────────────────────────────────
  -- INSERT path: row did not exist. All fields use the parameter values.
  --              Nullable preserved fields are NULL on first write because
  --              there is nothing to preserve.
  -- UPDATE path: row existed. All fields are overwritten with parameters
  --              EXCEPT lead_source, lead_source_updated_at, username,
  --              profile_name which use COALESCE to preserve existing
  --              values when the parameter is NULL.
  -- followed_up=false and followup_count=0 are hardcoded to match the
  -- existing Worker behavior on every turn.
  INSERT INTO public.conversations (
    bot_id, customer_id, channel,
    status, lead_intent, contact_type,
    primary_goal, conversation_stage,
    messages, profile_facts, running_summary,
    followed_up, followup_count, re_engaged, pre_followup_stage,
    lead_source, lead_source_updated_at,
    username, profile_name,
    updated_at
  ) VALUES (
    p_bot_id, p_customer_id, p_channel,
    p_status, p_lead_intent, p_contact_type,
    p_primary_goal, p_conversation_stage,
    v_final_messages, p_profile_facts, p_running_summary,
    false, 0, p_re_engaged, p_pre_followup_stage,
    p_lead_source, p_lead_source_updated_at,
    p_username, p_profile_name,
    now()
  )
  ON CONFLICT (bot_id, customer_id) DO UPDATE SET
    channel              = EXCLUDED.channel,
    status               = EXCLUDED.status,
    lead_intent          = EXCLUDED.lead_intent,
    contact_type         = EXCLUDED.contact_type,
    primary_goal         = EXCLUDED.primary_goal,
    conversation_stage   = EXCLUDED.conversation_stage,
    messages             = v_final_messages,
    profile_facts        = EXCLUDED.profile_facts,
    running_summary      = EXCLUDED.running_summary,
    followed_up          = false,
    followup_count       = 0,
    re_engaged           = EXCLUDED.re_engaged,
    pre_followup_stage   = EXCLUDED.pre_followup_stage,
    lead_source          = COALESCE(EXCLUDED.lead_source, public.conversations.lead_source),
    lead_source_updated_at = COALESCE(EXCLUDED.lead_source_updated_at, public.conversations.lead_source_updated_at),
    username             = COALESCE(EXCLUDED.username, public.conversations.username),
    profile_name         = COALESCE(EXCLUDED.profile_name, public.conversations.profile_name),
    updated_at           = now();

  GET DIAGNOSTICS v_was_inserted = ROW_COUNT;

  -- ── Return diagnostic info for caller logging ─────────────────────────────
  RETURN jsonb_build_object(
    'final_message_count', jsonb_array_length(v_final_messages),
    'appended_count', jsonb_array_length(v_deduped_new),
    'skipped_duplicates', v_skipped_count,
    'merged_at', now()
  );
END;
$$;

-- ============================================================================
-- Permissions
-- ============================================================================
-- The Worker uses SUPABASE_SERVICE_KEY which authenticates as service_role.
-- Grant EXECUTE on the function to service_role explicitly so PostgREST
-- exposes it via /rest/v1/rpc/append_conversation_turn.
GRANT EXECUTE ON FUNCTION public.append_conversation_turn(
  uuid, text, text, jsonb, text, text, text, text, text, jsonb, text,
  boolean, text, text, timestamptz, text, text
) TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, confirm the function exists and is callable:
--
-- 1. Function exists:
--      SELECT proname, pronargs, prorettype::regtype
--      FROM pg_proc
--      WHERE proname = 'append_conversation_turn';
--
--    Expected: one row, pronargs=17, prorettype=jsonb
--
-- 2. Smoke test on a throwaway bot_id and customer_id:
--      SELECT public.append_conversation_turn(
--        '00000000-0000-0000-0000-000000000099'::uuid,  -- fake bot
--        'rpc_smoke_test_001',                           -- fake customer
--        'tester',
--        '[{"role":"user","content":"smoke","timestamp":1700000000000}]'::jsonb,
--        'active', 'LOW', 'prospect',
--        null, 'HOOK / ENTRY',
--        '{}'::jsonb, '',
--        false, null,
--        null, null,
--        null, null
--      );
--
--    Expected return:
--      {"final_message_count": 1, "appended_count": 1, "skipped_duplicates": 0, "merged_at": "..."}
--
-- 3. Call the same RPC again with same args. Should dedup:
--      Expected return:
--      {"final_message_count": 1, "appended_count": 0, "skipped_duplicates": 1, "merged_at": "..."}
--
-- 4. Cleanup the smoke test row:
--      DELETE FROM public.conversations
--      WHERE bot_id = '00000000-0000-0000-0000-000000000099'
--        AND customer_id = 'rpc_smoke_test_001';
-- ============================================================================
