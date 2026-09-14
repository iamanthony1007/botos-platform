-- ============================================================================
-- real_estate_demo_naming_2026-09-14.sql
-- ============================================================================
-- Names each synthetic Real Estate Demo conversation after its persona, so
-- the demo inbox shows readable lead names instead of raw synthetic IGSIDs.
--
-- Run AFTER scripts/demo-drive-real-estate.mjs has posted the conversations.
-- Idempotent, scoped to the demo bot only, keys on the driver's fixed
-- sender ids (they never collide with real IGSIDs: the 990914... range is
-- this run's synthetic namespace). All names are fictional demo personas.
-- ============================================================================

begin;

update public.conversations set username = 'jordan.explores',   profile_name = 'Jordan M.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100101';

update public.conversations set username = 'maya.buysnextyear', profile_name = 'Maya R.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100202';

update public.conversations set username = 'chris.firstrental', profile_name = 'Chris D.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100303';

update public.conversations set username = 'taylor.almostready', profile_name = 'Taylor B.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100404';

update public.conversations set username = 'sam.threemonths',   profile_name = 'Sam K.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100505';

update public.conversations set username = 'dana.somedaysoon',  profile_name = 'Dana W.'
  where bot_id = '00000000-0000-0000-0000-0000000000e1' and customer_id = '990914100606';

commit;

-- Verification: six named conversations on the demo bot, intents visible.
--   select customer_id, username, profile_name, lead_intent, conversation_stage
--   from public.conversations
--   where bot_id = '00000000-0000-0000-0000-0000000000e1'
--   order by customer_id;
-- Expect 6 rows, every username and profile_name populated. Expected intents
-- per Nella's pack: 990914100101 LOW, 990914100202 MEDIUM, 990914100303 HIGH,
-- 990914100404 HIGH, 990914100505 HIGH-leaning after turn 2, 990914100606 LOW
-- after turn 2. Divergence is a finding about the prompt, not about this file:
-- her Expected Classification Test is the acceptance gate.
