-- ============================================================================
-- Migration 008: append_followup_turn RPC (atomic auto follow-up write)
-- ============================================================================
-- Generated: 2026-06-10
--
-- Context:
--   The T+20h auto follow-up cron (sales-bot/src/index.js runFollowUpCron)
--   previously did two things after a successful Make Scenario 2 send:
--     1. NOTHING was written into conversations.messages, so the follow-up
--        never appeared in the dashboard thread or the bot's rehydrated memory.
--     2. A separate PATCH set followed_up=true, followup_count=1,
--        last_followup_source='auto'.
--
--   We need the sent follow-up recorded in conversations.messages AND the
--   follow-up flags set, in ONE atomic, race-safe write.
--
-- Why a NEW function instead of append_conversation_turn (migration 004):
--   append_conversation_turn HARDCODES followed_up=false and followup_count=0
--   on every call (it is the main per-turn write, where a fresh lead reply
--   resets those), and it overwrites status/lead_intent/conversation_stage/
--   profile_facts/running_summary with its parameters. Calling it from the
--   cron would (a) undo the very followed_up=true flag the cron needs (causing
--   a re-nudge loop) and (b) null out columns the cron does not carry. So the
--   cron gets its own purpose-built function that touches ONLY messages and
--   the three follow-up columns, and leaves everything else alone.
--
-- Behavior:
--   - SELECT ... FOR UPDATE row lock serializes concurrent writes for the same
--     (bot_id, customer_id), same as migration 004. This prevents the cron's
--     append from racing a simultaneous main-webhook write and losing a message.
--   - Dedup guard: if an identical (timestamp, role, content) message already
--     exists in the trailing 100, the message is NOT appended again and the
--     count is NOT incremented (defends against a retried RPC within a run).
--   - Sets followed_up=true, followup_count=followup_count+1 (only when a new
--     message was appended), last_followup_source=p_source, updated_at=now().
--   - If the conversation row does not exist, returns {ok:false} without
--     creating one. The cron only follows up rows it already selected, so the
--     row always exists; this is a safety net, not a create path.
--
-- This migration is idempotent (CREATE OR REPLACE FUNCTION). Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.append_followup_turn(
  p_bot_id       uuid,
  p_customer_id  text,
  p_new_message  jsonb,
  p_source       text DEFAULT 'auto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing        jsonb;
  v_count           integer;
  v_recent_window   jsonb;
  v_existing_msg    jsonb;
  v_is_dup          boolean := false;
  v_final           jsonb;
BEGIN
  -- ── Defensive type check ──────────────────────────────────────────────────
  IF jsonb_typeof(p_new_message) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_new_message must be a jsonb object, got %', jsonb_typeof(p_new_message);
  END IF;

  -- ── Acquire row lock (serializes concurrent writes for this lead) ─────────
  SELECT messages, followup_count
  INTO v_existing, v_count
  FROM public.conversations
  WHERE bot_id = p_bot_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Cron only follows up existing rows; never create one here.
    RETURN jsonb_build_object('ok', false, 'reason', 'row_not_found');
  END IF;

  IF v_existing IS NULL THEN
    v_existing := '[]'::jsonb;
  END IF;

  -- ── Dedup against the trailing 100 messages ───────────────────────────────
  IF jsonb_array_length(v_existing) > 100 THEN
    v_recent_window := jsonb_path_query_array(v_existing, '$[last - 99 to last]');
  ELSE
    v_recent_window := v_existing;
  END IF;

  FOR v_existing_msg IN SELECT * FROM jsonb_array_elements(v_recent_window)
  LOOP
    IF (v_existing_msg->>'timestamp') = (p_new_message->>'timestamp')
       AND (v_existing_msg->>'role') = (p_new_message->>'role')
       AND COALESCE(v_existing_msg->>'content', '') = COALESCE(p_new_message->>'content', '') THEN
      v_is_dup := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_is_dup THEN
    v_final := v_existing;
  ELSE
    v_final := v_existing || jsonb_build_array(p_new_message);
  END IF;

  -- ── Atomic write: message + the three follow-up columns, nothing else ─────
  UPDATE public.conversations
  SET messages             = v_final,
      followed_up          = true,
      followup_count       = COALESCE(v_count, 0) + CASE WHEN v_is_dup THEN 0 ELSE 1 END,
      last_followup_source = p_source,
      updated_at           = now()
  WHERE bot_id = p_bot_id
    AND customer_id = p_customer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'appended', NOT v_is_dup,
    'followup_count', COALESCE(v_count, 0) + CASE WHEN v_is_dup THEN 0 ELSE 1 END,
    'final_message_count', jsonb_array_length(v_final)
  );
END;
$$;

-- ============================================================================
-- Permissions
-- ============================================================================
-- The Worker authenticates as service_role via SUPABASE_SERVICE_KEY. Grant
-- EXECUTE so PostgREST exposes /rest/v1/rpc/append_followup_turn.
GRANT EXECUTE ON FUNCTION public.append_followup_turn(uuid, text, jsonb, text) TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Function exists:
--      SELECT proname, pronargs, prorettype::regtype
--      FROM pg_proc WHERE proname = 'append_followup_turn';
--    Expected: one row, pronargs=4, prorettype=jsonb
--
-- 2. Smoke test against a real (or seeded) conversation row. Replace the
--    customer_id with a seeded tester row that already exists:
--      SELECT public.append_followup_turn(
--        '00000000-0000-0000-0000-000000000002'::uuid,
--        'tester_followup_001',
--        '{"role":"assistant","content":"Haven''t heard back from you?","bot_messages":["Haven''t heard back from you?"],"timestamp":1700000000000,"followup":true,"followup_source":"auto","message_count":1}'::jsonb,
--        'auto'
--      );
--    Expected: {"ok":true,"appended":true,"followup_count":1,"final_message_count":N}
--
-- 3. Re-run the SAME call. Expected: {"ok":true,"appended":false,...} (dedup
--    held, count unchanged) and conversations.followed_up=true.
--
-- 4. Confirm flags on the row:
--      SELECT followed_up, followup_count, last_followup_source
--      FROM public.conversations
--      WHERE bot_id='00000000-0000-0000-0000-000000000002'
--        AND customer_id='tester_followup_001';
--    Expected: t, 1, auto
-- ============================================================================
