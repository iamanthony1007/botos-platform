2026-07-04: Stage 3d-ii (WhatsApp turn persistence) merged and verified.

persistWhatsAppTurn persists each WhatsApp turn under the resolved bot: KV memory
(memory:${botId}:${waId}), append_conversation_turn RPC (p_channel 'whatsapp',
user turn only on the review path), and a pending reviews row (channel 'whatsapp')
with Slack notification. wamid dedup via wa_seen KV (7-day TTL) prevents Meta
redelivery double-writes. Reused helpers (supabaseRpc, supabaseInsertWithRetry,
sendToSlack, sanitizeBotMessage, calcTypingDelay, resolveNextAction). Golf keyword
classifier intentionally NOT ported; Calendly link promotes BOOKED.

Migration 010 (applied prod): reviews.channel text default 'instagram'. Prevents
WhatsApp reviews being misrouted as Instagram when Stage 4 sending routes approvals.

VERIFIED without Claude credits via a temporary synthetic self-test route (since
removed): finalAction SEND_TO_INBOX_REVIEW, rpc_ok true, review_ok true; SQL
confirmed one conversations row (channel whatsapp, msg_count 1 = user turn only,
assistant draft held in memory until approval) and one pending reviews row
(channel whatsapp). Synthetic selftest-3dii rows + KV deleted post-verification.

WHATSAPP_VERIFY_TOKEN was rotated this session (all three copies aligned: Worker
secret, Meta Configuration field, saved note).

Next: Stage 4 (send path) via Graph API POST /{phone_number_id}/messages using the
per-account decrypted token, routing approved WhatsApp reviews by channel, strictly
separate from sendToMakeScenario2. Blocked only on the Anthropic API top-up for the
single real end-to-end run. Also pending: operator bot-switcher, prod RLS confirm
before SuperYOU external setters get logins.

2026-07-01: SuperYOU onboarded as second tenant + Stage 3d-i (WhatsApp reply generation, log-only) live.

TENANT (Phase B, all direct prod DB changes with no git trail, recorded here):
- New org "SuperYOU" id c854fd89-7e7e-4b32-aaf8-f5daa1dfb082 (separate from Nella
  Platform ...0001; one org per client so the dashboard admin resolver's .single()
  stays valid).
- New bot "SuperYOU - Laura Phillips" id 45b776e3-ee4f-461d-a526-4249d18757b3,
  model claude-sonnet-4-6 (NOTE: bots.model column default is 'gpt-4o', wrong for
  this platform, always set the Claude model explicitly), auto_send_enabled false,
  campaign_goal Book Call, ai_behavior_settings holding SuperYOU offer/qualifiers,
  intent_definitions = generic default (not Coach Shaun's golf taxonomy).
- system_prompt set (3614 bytes): Laura Phillips, Singapore weight-loss coaching,
  sort-not-sell, book the Calendly discovery call, no price pitching in chat.
- connected_accounts test-number row (Phone Number ID 1190161784184058) repointed
  from bot ...0002 to SuperYOU bot 45b776e3. Test number now routes to SuperYOU.

STAGE 3d-i (GENERATE + LOG ONLY, no writes, no send):
- New helper processWhatsAppReply mirrors the /webhook reply core under the
  resolved bot id, with bot-namespaced memory key memory:${botId}:${waId} and
  bot-scoped retrieval (Phase A params). Runs in ctx.waitUntil for a fast 200.
- Prod version 52fc004b-c4f3-47aa-a2d6-11f313702652.
- VERIFIED on real Meta traffic up to the Claude call: received, signature-verified,
  routed to SuperYOU bot, prompt parsed (phase-f __PRELUDE__), retrieval ran. Failed
  ONLY at callClaude with "credit balance too low" (Anthropic API account out of
  credits). Billing, not code. Live DRAFT test pending Nella topping up the account.

OPERATIONAL FLAG: the Anthropic API account balance (ANTHROPIC_API_KEY on the
Worker) is a single point of failure for ALL bots (SuperYOU AND Coach Shaun).
Recommend auto-reload / low-balance alert in console.anthropic.com.

Next: (1) provision Anthony's SuperYOU dashboard admin login so the prompt is
editable in the Prompt Editor; (2) Stage 3d-ii (persist the turn under the resolved
bot + create the inbox draft), buildable now, live-verifiable once credits land;
(3) confirm prod RLS is ON before SuperYOU's own setters get logins; (4) Stage 4
send path after 3d-ii + credits.

2026-07-01: Phase A done. Reply-core functions parameterized by botId.

Five shared functions now take botId (default BOT_ID), swapping internal
hardcoded BOT_ID for the param: getBotSettings, fetchRelevantLearningsSemantic,
fetchRelevantDocumentsSemantic, fetchRelevantLearningsLegacy,
fetchActiveDocumentsLegacy. Behavior-preserving (no call site changed, default
applies, live /webhook unchanged). Enables the WhatsApp path to run under a
resolved bot id. Prod Worker version 47235707-f2e4-46e8-9fda-e317fcbaef88.

Isolation audit outcome (this session, read-only): dashboard already multi-tenant
(scopes by bot_id via getAssignedBot); SQL retrieval bot-scoped (match_learnings
and match_documents both filter bot_id = target_bot_id, confirmed in prod);
Worker reply core WAS single-tenant (hardcoded BOT_ID), now fixed by Phase A.
Still to address before a SECOND client goes live: (1) memory KV key must be
namespaced by bot (memory:${bot_id}:${customer_id}) since current
memory:${customer_id} collides across tenants; (2) follow-up cron is
single-bot + single-channel (IG/Make only), so a second bot gets no follow-ups
(fine for inbound-only WhatsApp; revisit only if WhatsApp re-engagement wanted,
which needs paid templates); (3) confirm PROD RLS is ON before a second client's
setters get dashboard logins (dashboard isolation is currently app-layer only).
Note: fetchActiveDocumentsLegacy has NO active caller (dead code, candidate for
future removal).

Next: Phase B. Create SuperYOU (Laura Phillips, Singapore weight-loss coaching,
Jumpstart offer 3x=$399 / 5x=$599, Calendly discovery-call) as their own
organization + bot row, then repoint the connected_accounts test-number row from
...0002 to the new SuperYOU bot. Then Phase C (3d) builds the WhatsApp reply
orchestration against SuperYOU's bot with the memory key namespaced by bot.

## 2026-07-01: Stage 3c done. Meta/WhatsApp inbound parse + route live and proven.

POST /meta/webhook parses the verified payload, skips value.statuses events,
reads metadata.phone_number_id / contacts[].wa_id / messages[].text.body,
resolves bot via connected_accounts (platform=whatsapp), logs routing. Non-text
logged-and-skipped. try/catch guarantees 200 on any signed event. New helper
resolveConnectedAccount (service-role lookup, skips deauthorized). No storage,
no reply yet. Prod Worker version b97bd8e0-3817-4ff5-a69c-86ff79fad872.

Verified end to end on REAL Meta traffic: a WhatsApp reply to the test number
(Phone Number ID 1190161784184058, WABA 1010810851319371) was received,
signature-verified, parsed, and routed to bot 00000000-0000-0000-0000-000000000002
in wrangler tail.

Setup learnings this session:
- Webhook delivery to an external callback requires the app to be subscribed to
  the WABA via POST /{WABA_ID}/subscribed_apps. The Meta dashboard's built-in
  viewer ("WA DevX Webhook Events 1P App") shows payloads even when your app is
  NOT subscribed, which masks the problem. Subscribing field=messages at the app
  level is NOT the same as the WABA subscription. Fold the WABA subscribe into
  the production-number cutover checklist.
- connected_accounts test row maps test Phone Number ID 1190161784184058 ->
  bot ...0002 (temporary, repoint to the real WhatsApp client bot at 3d).

Next: Stage 3d. Feed the resolved bot + inbound text into the reply core
(memory load, retrieval, callClaude, resolveNextAction, race-safe
append_conversation_turn with the resolved bot_id) and store the draft. Stage 4
then sends via Graph API POST /{phone_number_id}/messages with the per-account
token. getBotSettings to gain optional botId param (default BOT_ID).

---

## 2026-06-30: Stage 3b done. Signed POST handler on /meta/webhook live.

POST /meta/webhook now verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 over
the RAW request body, keyed by the new WHATSAPP_APP_SECRET secret) before
trusting any byte. Reads request.text() BEFORE parse (re-serialization would
change the hash); constant-time comparison. Missing or wrong signature -> 401;
valid -> fast 200 ("EVENT_RECEIVED") + log only. No payload parsing or reply
pipeline yet. GET handshake unchanged. Logic proven in isolation (valid accepted;
wrong-secret, tampered, malformed-header, re-serialized all rejected) before
deploy. Verified on production: GET wrong-token 403, POST no-sig 401, POST
wrong-sig 401, /health healthy. Live ManyChat /webhook untouched. Prod Worker
version b8735971-0705-4f79-b639-6705b63b6ead.

Secrets now on prod: TOKEN_ENCRYPTION_KEY, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.

Next: Stage 3c. Subscribe the messages field in Meta, send a real WhatsApp test
message, confirm a genuine signed event returns 200; then parse the verified
payload (value.metadata.phone_number_id, contacts[].wa_id, messages[]) and map
phone_number_id -> bot via connected_accounts. (Verify exact payload field names
against Meta docs at 3c.)

---

## 2026-06-30: Stage 3a done. Meta/WhatsApp webhook GET verification live + Meta-verified.

GET /meta/webhook echoes hub.challenge when hub.verify_token matches the new
WHATSAPP_VERIFY_TOKEN secret (production), else 403. Verified on production and
confirmed green via Meta's webhook handshake on the Mu AI app (App ID
1382503777124965, Nella's verified portfolio, simple/direct path, not Tech
Provider). Prod Worker version 09b3849a-d02c-4f3d-b3b9-9935193eb6bb.

Meta app assets (test/sandbox): test number +1 555-649-8389, Phone Number ID
1190161784184058, WABA ID 1010810851319371. messages field deliberately NOT
yet subscribed (waiting for 3b). App Secret captured separately for 3b.

Stage 3 = Plan B: slim WhatsApp orchestration reusing decoupled reply-core
functions; /webhook stays single-client by design. getBotSettings to gain an
optional botId param (default BOT_ID). WhatsApp path multi-tenant via
connected_accounts.

Next: Stage 3b. POST /meta/webhook with HMAC X-Hub-Signature-256 verification
over the RAW body (read request.text() before parse) using a new
WHATSAPP_APP_SECRET secret; return 200 fast, log the verified payload, no
processing yet.

---

## 2026-06-30: Stage 2 done. Token encryption helpers live (AES-256-GCM).

Added encryptToken/decryptToken to the Worker (Web Crypto AES-256-GCM, random
12-byte IV packed in front of ciphertext, base64 self-describing blob). They
encrypt per-account access tokens before storing in
connected_accounts.access_token_encrypted and decrypt on read. New Worker
secret TOKEN_ENCRYPTION_KEY set on production (base64 of 32 random bytes).
Round-trip verified ON PRODUCTION via a temporary /meta/crypto-selftest route
({"ok":true,"keyConfigured":true}); route since removed and redeployed (prod
version 22c300af-7bfa-4ed6-b93f-abac9c250183). Helpers unused until Stage 3. Live ManyChat /webhook
untouched throughout.

Note: sales-bot/src/index.js is the source of truth (wrangler.toml main =
src/index.js, no build step). It carries esbuild-style __name() wrappers and a
sourceMappingURL footer from a past one-time bundling, but is edited directly
and re-bundled by wrangler on deploy, so hand-edits are safe.

Next: Stage 3, the /meta (WhatsApp) inbound webhook. GET hub.challenge echo +
POST HMAC X-Hub-Signature-256 verification over the RAW body (read
request.text() before parse), parse the payload, map the inbound account to a
bot via connected_accounts, reuse the reply core by extracting
processInboundMessage. Do NOT refactor the existing /webhook.

---

## 2026-06-30: connected_accounts table applied to production (Meta build Stage 1)

Branch `feat/connected-accounts-migration` (commit `78514fa`, merge `bc0b597`). Migration `db/migrations/009_add_connected_accounts.sql`. This is Stage 1 of the Meta build sequence in the milestone entry below.

**What:** new isolated table `public.connected_accounts` mapping an external messaging account (WhatsApp phone number, Instagram account, etc.) to a bot and storing the per-account access token encrypted at rest. Channel-agnostic: `platform` distinguishes whatsapp / instagram / messenger and `platform_metadata` jsonb holds channel-specific identifiers (e.g. WABA id). UNIQUE `(platform, external_account_id)`, index on `bot_id`. Foundation for replacing the single hardcoded `BOT_ID` in inbound routing.

**RLS:** ENABLED with no policy, on purpose. The table holds access tokens, so only the Worker (service role, BYPASSRLS via `SUPABASE_SERVICE_KEY`) reads it; the dashboard anon key gets zero rows. Enabled explicitly because a table created via raw SQL does not inherit the table-editor's RLS-on-by-default.

**Applied to PRODUCTION** Supabase (ref `rydkwsjwlgnivlwlvqku`, confirmed from `sales-bot/wrangler.toml` [vars]) via the SQL Editor, by Anthony's explicit decision to go direct to prod (no live traffic right now). No staging apply. Verified: 12 columns correct order/types/defaults, unique constraint `connected_accounts_platform_account_key`, indexes `connected_accounts_pkey` / `connected_accounts_platform_account_key` / `idx_connected_accounts_bot_id`, `relrowsecurity = true`.

**Behavior-neutral:** no current code reads the table, the live `/webhook` (ManyChat) path is untouched, and neither the Worker nor the dashboard was deployed. Next stages (encryption helpers, `/meta/webhook`, Graph API send, deauthorize + data-deletion) are unbuilt; see the milestone entry below.

---

## 2026-06-30: Meta API integration phase mapped and started (milestone)

Privacy + domain + portfolio foundation complete; multi-account Meta build sequence defined. No code shipped this entry beyond the privacy items below; this records phase state and the build plan.

**DONE this period:**
- Domain `getmu.co` live on Cloudflare, attached to the `botos-platform` Pages project (Active, SSL). [www.getmu.co](https://www.getmu.co) still verifying (optional).
- Privacy policy LIVE at `getmu.co/privacy` as a standalone static file (`dashboard/public/privacy.html`, not a React route, publicly reachable, not behind auth). See the two privacy entries below for deploy details.
- Verified Meta Business Portfolio confirmed: "Ornella Kuate", Portfolio ID `25419132507710693`, Verified Nov 21 2025, details match the SIREN registration. REUSE this; do NOT redo Business Verification.
- Worker architecture investigation complete: greenfield for Meta (no existing Meta/Graph code). The AI-reply core (`callClaude`, `resolveNextAction`, retrieval, `append_conversation_turn`) is transport-decoupled and reusable. Personal data spans Supabase tables AND Cloudflare KV (`MEMORY_STORE` key `memory:${customer_id}`). The current `/webhook` has no signature check. The send path is a single-tenant hardcoded Make webhook (`sendToMakeScenario2`) with a hardcoded `BOT_ID`.

**PENDING / NEXT:**
- Privacy page redeploy with Nella's confirmed answers: contact email to `admin@getmu.co`, retention to 12 months, Stripe stays out (not live). DONE, see the 2026-06-30 privacy update entry below. Still to do: set up Cloudflare email forwarding for `admin@getmu.co`.
- Meta integration build (multi-session, multi-account foundation, encryption-at-rest for per-account tokens, live ManyChat path must stay working throughout):
  - Stage 1: `connected_accounts` table migration (IG account id, bot mapping, encrypted token, expiry, deauthorized flag).
  - Stage 2: encryption helpers (Web Crypto, new Worker secret for the key, round-trip tested).
  - Stage 3: `/meta/webhook` GET (verify-token challenge) + POST (HMAC over raw body with `META_APP_SECRET`), parse payload, map account to bot, reuse the reply core via an extracted behavior-preserving `processInboundMessage` shared function (do NOT refactor `/webhook`).
  - Stage 4: Graph API send path (per-account decrypted token, kept strictly separate from `sendToMakeScenario2`).
  - Stage 5: `/auth/deauthorize` + `/auth/data-deletion` (verify `signed_request`; deletion clears Supabase + KV and awaits the delete as a conscious exception to the never-await rule).
- New Worker secrets to add later: `META_APP_SECRET`, `META_VERIFY_TOKEN`, token-encryption key.
- Cutover risk: activate exactly one inbound source per account to avoid double delivery (ManyChat + Meta), since the `append_conversation_turn` dedup will not catch cross-pipeline duplicates.
- After build: create Meta App (Business type, connect verified portfolio, Tech Provider), wire endpoint URLs, reviewer test IG account, screencasts, permission justifications (`instagram_business_basic`, `_manage_messages`, `_manage_comments` + Human Agent; Instagram Login option A), submit App Review.

**ACCESS NOTES:** Anthony does Meta-identity work logged in as Nella/Ornella (she shared FB access). Anthony's own personal Facebook is under Meta review (~20+ days), so keep it OUT of the Business Portfolio. Portfolio 2FA was tied to the stolen phone; she has a new phone now.

---

## 2026-06-30: Privacy page contact email + retention update (shipped to production)

Branch `feat/privacy-contact-retention-update` (commit `51c00d6`, merge `7c0fbf0`). Content-only edit to the live static privacy page `dashboard/public/privacy.html`. No Worker, no schema, no Supabase change, no React/router/auth change, token-neutral.

**What changed (Nella's confirmed details):** two edits, nothing else. (1) Contact email `privacy@getmu.co` to `admin@getmu.co` in all three places (section 1 "Who we are", section 8 "Your rights", section 12 contact block), both the `mailto:` href and the visible text. (2) Data retention "24 months" to "12 months" in section 7. Deliberately unchanged: operator name (Ornella Kuate Konga), address (119 Boulevard Brune, Paris), SIREN 837 927 961, age 16, France/EU framing, and the subprocessor list (no Stripe; billing is not live).

**Deploy:** staging first (Pages `6741cd06`), then production via the `npm run deploy:production` safety chain with `CLOUDFLARE_ACCOUNT_ID=444afb7987a4f1e657e0bad22a528a42`. verify-env [production] ref `rydkwsjwlgnivlwlvqku` (0 staging refs), verify-deploy [production] OK. Prod Pages deployment `9aaff4fa`.

**Verification (prod):** `botos-platform-3ar.pages.dev/privacy` HTTP 200, title "Privacy Policy | Mu AI", `admin@getmu.co` x3, `privacy@getmu.co` 0, "12 months" 1, "24 months" 0, Stripe 0, 0 SPA bundle refs. `getmu.co/privacy` HTTP 200, same updated content (12 months present, 24 months absent); the 3 contact emails render as Cloudflare email-obfuscated `[email&#160;protected]` spans on the proxied zone, and the `data-cfemail` payload decodes to `admin@getmu.co` (so the email is correct, just edge-obfuscated; a browser renders the clickable `mailto:admin@getmu.co`). Dashboard root `/` still serves the SPA (title "MU AI"), non-breakage confirmed.

**Resolves** the open item from the 2026-06-25 entry below: the contact mailbox is now `admin@getmu.co`. Outstanding before relying on it: confirm `admin@getmu.co` actually receives mail (Cloudflare Email Routing on the getmu.co zone) so privacy and data-subject requests land in an inbox.

---

## 2026-06-25: Privacy policy static page (shipped to production)

Branch `feat/privacy-static-page` (commit `71d5871`, merge `373b4b9`). Dashboard-only, static-file-only: no Worker, no schema, no Supabase change, no React/router/auth change, token-neutral.

**What shipped:** a standalone static HTML privacy policy at `dashboard/public/privacy.html`. Vite copies `public/*` verbatim into `dist/`, so Cloudflare Pages serves it directly at `/privacy` (and `/privacy.html`, which 308-redirects to `/privacy`). Static files take precedence over the SPA catch-all, so the page is publicly reachable WITHOUT the dashboard login. This was the deliberate choice over a React route: a route in `App.jsx` would couple the must-be-public policy to the auth-gated bundle and could slip behind the login on a future routing change; the static file cannot, because the React app and AuthContext never load for it.

**Why:** Meta app-review prep. Meta's reviewer needs a publicly reachable privacy policy URL; a login wall fails review. The URL to give Meta is `https://getmu.co/privacy`.

**Content:** palette-matched to the dashboard (gold/champagne `#D4AF37`, Inter + Playfair Display), logo at `/Logo horizontal.png` with a wordmark text fallback, GDPR-oriented policy naming the actual subprocessors (Anthropic, Supabase, Cloudflare, Make, ManyChat, Meta). Operator: Ornella Kuate Konga trading as Mu AI (SIREN 837 927 961), contact `privacy@getmu.co`.

**Domain:** `getmu.co` attached to the `botos-platform` Pages project via Custom domains (Active, SSL) in the Nellakuate Cloudflare account, zone `b196f8ec4b3e8a0b7c9168a2d4904428`.

**Deploy:** staging first (Pages `b0874b6e`), then production via the `npm run deploy:production` safety chain with `CLOUDFLARE_ACCOUNT_ID=444afb7987a4f1e657e0bad22a528a42`. verify-env [production] ref `rydkwsjwlgnivlwlvqku` (0 staging refs), verify-deploy [production] OK. Prod Pages deployment `326df4fe`.

**Verification (prod):** `botos-platform-3ar.pages.dev/privacy` HTTP 200, title "Privacy Policy | Mu AI", SIREN present, 0 SPA bundle refs. `getmu.co/privacy` HTTP 200, same policy (not the SPA landing). Dashboard root `/` still serves the SPA (title "MU AI"), non-breakage confirmed. The getmu.co response is roughly 495 bytes larger than the pages.dev copy because the getmu.co zone applies Cloudflare email-address obfuscation to the `mailto:` links; content is otherwise identical.

**REMAINING before handing Meta the URL:** set up email forwarding for `privacy@getmu.co` so privacy and data-subject requests actually reach an inbox. The policy lists that address as the contact and rights channel, so it must receive mail before the URL goes to reviewers and users.

---

## 2026-06-10 — Auto Followed Up inbox tab (shipped to production)

Branch `feat/inbox-auto-followed-up-tab` (commit `24e5849`, merge `5882081`). Dashboard only: no Worker change, no schema change, no new query, token-neutral (pure client-side filter, no Claude/API call).

**What it shows:** a new orange inbox tab "Auto Followed Up" (between Follow Ups and Escalated) listing leads the T+20h cron auto-nudged that have NOT replied since. Filter: `followed_up=true AND last_followup_source='auto'`, with tester/for_coach exclusions mirroring the other operational tabs. No message-walking needed: when a lead replies, `append_conversation_turn` (migration 004) hardcodes `followed_up=false` and sets `re_engaged=true` while `last_followup_source` persists, so the two-flag filter IS exactly the awaiting-response set, and responders drop out mechanically. The message-level `followup:true` marker was deliberately not used (21 of the current 26 were nudged before thread recording shipped and lack it).

**First real result (prod data, 2026-06-10):** 26 leads auto-nudged awaiting response, 7 re-engaged after the nudge, roughly a 21 percent response rate for the auto follow-up.

**Implementation:** `dashboard/src/pages/Inbox.jsx`, the standard tab pattern: FILTERS entry, new `isAutoFollowedUpLead` helper, matchesFilter branch, badge-count branch, `#ea580c` color entries (matches the orange "auto" thread-header badge convention).

**Deploy:** staging first via safety chain (verify-env/verify-deploy both staging ref, bundle inspected for the new filter), then production Pages deployment `59c29222` (https://59c29222.botos-platform-3ar.pages.dev) via `npm run deploy:production`; verify-env and verify-deploy confirmed prod ref `rydkwsjwlgnivlwlvqku` with zero staging refs, and the live prod bundle contains the tab strings and the minified filter condition. Visual check in the browser: pending Anthony opening the inbox (staging login block prevented a logged-in check; staging data would have shown count 0 anyway).

---

## 2026-06-10 — Soft-close guard for the auto follow-up cron (shipped to production)

Branch `feat/followup-soft-close-guard` (commit `f79aae8`, merge `98758b5`). Staging-first, then production. Worker-only change to the cron path in `sales-bot/src/index.js`.

**Problem:** the T+20h cron nudged leads who politely PARKED the conversation, not dropped it. Confirmed on prod cust `1020307359`: lead "About to get on a Teams call for work. Have a nice day", bot "No worries, enjoy the call. We'll pick this up another time.", cron next day "Haven't heard back from you?". Structurally identical to a dropped lead (last message from bot, 20h+ old, not booked or escalated), so every existing guard passed. A 60-day production scan found this in roughly 11 percent of fired follow-ups (8 of 73).

**What changed (all inside the cron path):**
1. `looksLikeSoftClose(lastBotText)`: skips when the bot's own last message is a sign-off acknowledgement (no worries / no rush / no dramas, enjoy the call/day, pick this up another time, whenever you are ready, take your time, talk soon, good luck, take care, have a nice day, free-content-when-ready). CRITICAL question gate: a last bot message ending in "?" is NEVER a soft close, because the bot re-engaged with a question and a silent lead IS a legitimate nudge target. Data: about half of "no worries" acks end in a question; without the gate the guard would have wrongly suppressed roughly 36 legitimate nudges in the scan window.
2. `looksLikeLeadPark(lastUserText)`: secondary signal for when the bot re-engaged with a question but the LEAD clearly parked (on a Teams/Zoom/work call, in a meeting, have a nice day, get back to you later/next week, been sick/busy, will continue to follow, not right now, do not want to continue/chat). Bare "later", "thanks", "not now" deliberately excluded as too generic.
3. `extractLastUserAndBotMessage` now also returns `lastUserText` (did not exist before).
4. New skip sits right after the escalation_handoff skip, counted as `stats.skipped.soft_close`.

**Invariants:** token-neutral (pure regex, no Claude call), no new Supabase writes, eligibility query unchanged, ctx.waitUntil untouched, timing and once-per-lead logic unchanged.

**Validation:** investigation rule check 8/8 (every fired follow-up the guard would have suppressed in the 60-day scan was a genuinely tone-deaf nudge, zero false suppressions); 27/27 local unit tests against the functions extracted verbatim from the patched file (`test_soft_close_local.mjs`); 4/4 staging matrix via `/__cron-test` on staging Worker `ba01329f-b2dd-4436-90e4-bf8eaf9950c6`: (a) bot sign-off no question SKIPPED, (b) bot ack ending in "?" still NUDGED, (c) lead park with bot question SKIPPED via lead side, (d) normal dropped lead still NUDGED; second run examined=2 sent=0 soft_close=2 (no re-nudge loop). Tester rows cleaned up.

**Production deploy:** Worker `sales-bot` version `8cc53aa7-2afa-43e9-8909-4f0568001aa3`. `/health` 200 (supabase_connected true), cron schedule `0 * * * *` intact, `/__cron-test` 404 (prod env guard). Rollback anchor: previous version `0ead9f3b-f745-4ca7-937a-9abdb70f8a95` via `wrangler rollback`. First live exercise of the guard happens at the next hourly cron tick.

**Still open (unchanged by this):** the structured opt-out gap from the 2026-06-10 entry below. The lead-park list happens to catch "do not want to continue/chat" wording at the cron layer, but there is still no `opted_out` column and no guarantee for other opt-out phrasings; the proper fix remains a separate change.

---

## 2026-06-10 — Auto follow-up: generic line + thread recording + "Auto follow-up" tag (shipped to production)

Branch `feat/followup-generic-line-and-thread-tag` (commit `ff60b65`). Staging-first, then production. Three coordinated changes plus a new migration.

**What changed:**
1. **Message:** the T+20h auto follow-up no longer sends the lead's first name plus "?" (e.g. "James?"). It now sends a fixed generic line `"Haven't heard back from you?"` (`FOLLOWUP_MESSAGE` const in `runFollowUpCron`, sanitized for em dashes; easy to extend to rotating variants later).
2. **Recording:** the cron previously sent the nudge but recorded NOTHING in `conversations.messages` (only PATCHed the followed_up flags), so it never appeared in the dashboard thread or the bot's rehydrated memory. Now it records the sent turn AND sets `followed_up=true, followup_count+1, last_followup_source='auto'` in ONE atomic write via a new RPC. Uses `ctx.waitUntil` (never bare await).
3. **Dashboard tag:** the recorded follow-up renders with a distinct indigo "Auto follow-up" tag (📬) in the thread, separate from approved/edited/manual.

**Migration 008 (`db/migrations/008_append_followup_turn.sql`):** new `append_followup_turn(p_bot_id, p_customer_id, p_new_message, p_source)`. SELECT FOR UPDATE row lock, `(timestamp,role,content)` dedup guard, appends the message and sets the three follow-up columns in one UPDATE. Touches ONLY messages + follow-up columns; never resets `followed_up`. This is the reason it is NOT `append_conversation_turn` (migration 004 hardcodes `followed_up=false`/`followup_count=0` on every call, which from the cron would cause a re-nudge loop and null out profile_facts/running_summary). Idempotent.

**Dashboard tag mechanism (for future reference):** in `Inbox.jsx`, the Manual tag keys off a message-entry boolean (`m.manual === true`); Approved/Edited/Auto-sent are derived from the `reviews` table via `m.review_id`. Auto follow-ups create no reviews row, so they use the manual-style path: the recorded entry carries `followup: true` and the renderer reads `item.followup` directly.

**Staging verification (all passed):** migration applied + catalog-verified; RPC append-then-dedup (`appended:true` then `appended:false`, count stable at 1); row showed `followed_up=true, count=1, source=auto`, recorded content `"Haven't heard back from you?"` with `followup:true`; `/__cron-test` guard pass (examined, sent=0, skips for replied/booking/escalation/tester/no-profile-name); live synthetic send `sent=1` then second run `sent=0` (no re-nudge loop), worker recorded the turn via the RPC; dashboard deployed, verify-deploy confirmed staging ref. The (g) visual tag screenshot was NOT captured (staging dashboard login blocked; tag logic is deterministic and code-verified).

**Production deploy (this session):**
- Migration 008 applied to prod Supabase (`rydkwsjwlgnivlwlvqku`) via SQL editor; catalog-verified (pronargs=4, jsonb, ACL granted).
- Worker `sales-bot` version `0ead9f3b-f745-4ca7-937a-9abdb70f8a95`. `/health` 200, `/__cron-test` 404 (prod env guard). Cron schedule `0 * * * *` intact.
- Dashboard prod Pages deploy `94fd69ec` (`botos-platform-3ar.pages.dev`); verify-deploy confirms live bundle targets prod Supabase, 0 staging refs.
- First production follow-ups with the new line + recording will appear from the next hourly cron tick.

**Rollback anchors:** Worker `wrangler rollback` (reverts to pre-deploy version). Dashboard Pages roll back to `7505f38d`. Migration: `DROP FUNCTION public.append_followup_turn(uuid,text,jsonb,text)` (additive; safe to leave even after a Worker rollback, since the old Worker does not call it).

**Eligibility unchanged on purpose:** kept the no-profile-name skip as a parity gate so the candidate set did not widen (the generic line no longer needs a name; could be relaxed later for more reach, pending Nella).

**KNOWN GAP (flagged, not fixed): opt-out.** There is NO structured opt-out column on `conversations`. Opt-outs are handled only conversationally (system prompt acknowledges and stops). So a lead who said "stop" still satisfies every cron guard (last message is the bot's acknowledgement) and CAN receive a T+20h nudge. Recommended fix (separate change): add an `opted_out boolean` the Worker sets on strong opt-out detection, and `&opted_out=eq.false` to the cron eligibility query. Do not ship the follow-up at scale long-term without closing this.

**OPERATIONAL NOTE:** `sendToMakeScenario2` posts to a hardcoded Make webhook (not env-gated), so the STAGING Worker's cron send hits the SAME production Make Scenario 2 → ManyChat pipeline. Staging "send" tests therefore poke live Make (synthetic numeric IDs error harmlessly at ManyChat, no real DM). Consider env-gating this webhook for true staging isolation.

---

## 2026-05-26 — Phase F+1 opt-out rule + Worker parse-failure fix (both shipped to production)

Two production shipments this session. Staging-first workflow used for both.

### Shipment 1: Phase F+1 opt-out rule

**Problem:** lattrellwalt regression. Lead said "Sorry, Shaun, I do not want to continue this thread. Thank you for your consideration!" Bot replied with a sales pivot ("What's the #1 thing you'd most want to see improve?"). Pre-Phase-F bot handled this correctly (graceful exit). Post-Phase-F bot lost the behavior because nurture-exit language only loads at FOLLOW-UP stage, not at HOOK/GOAL/PRIORITY where most opt-outs actually happen.

**Originally scoped:** 4 structural rules (opt-out, acknowledge-before-pivot, length matching, one-question-per-reply). Scoped down to 1 (opt-out only) after reviewing the actual current prompt — items 2-4 already exist in the prompt and the bot is ignoring them, which is a different problem than "missing rule." Items 2-4 deferred for separate investigation.

**Solution:** new "Opt-out handling" block added to `## GUARDRAILS` section (always-on, loads every turn). Defines STRONG opt-out signals (explicit refusal language) vs soft hesitation (timing, "not now"). On STRONG: short polite acknowledgement only, no question, no nurture, no pivot. On soft hesitation: continue normally. Defers to setter corrections via the existing ABSOLUTE PRIORITY RULE.

**Staging verification:** 6/6 PASS on regression suite (HOOK BOMBER, GOAL, PRIORITY x opt-out, soft-hesitation). Wrangler tail confirmed GUARDRAILS in `sectionsInjected` on every call.

**Production deploy:** Dashboard PromptEditor at ~22:16 UTC. Production prompt now at MD5 `d83e41bf8bf26032b4fce82d04b2b069` (matches staging exactly). Backup row preserved at `prompt_versions` version 23, label "Pre-Phase-F1 opt-out rule (production)", id `d98ffc85-a90e-42df-9e31-8069b3db51ad`.

**PR:** `feat/phase-f1-opt-out-rule` (commit `680d08c`, scripts only — prompt edit applied via Dashboard).

### Shipment 2: Worker parse-failure fix (incident response)

**Problem:** discovered mid-session via Make execution history. Some `/webhook` calls failing with HTTP 500, error `Failed to parse Claude response as JSON: { ...truncated JSON... }`. Earlier-this-week-onset, getting more common. Real failing case captured: customer `894431997` (Kaiser/sciatica conversation, 15 messages of history, rich profile_facts).

**Root cause:** `max_tokens: 768` in `callClaude` was too small for the structured JSON output (15+ fields including freeform `internal_notes` and a growing `running_summary`). On rich conversations Anthropic API truncated mid-JSON, `JSON.parse()` threw, Worker returned 500, Make logged HandledError, lead silently dropped.

**Latent secondary bug found:** existing overload-error safety net was inserting placeholder review rows missing `id` and `action_type` (both NOT NULL per schema). The inserts ran under `ctx.waitUntil` (fire-and-forget) so failures were never observable. Means the "overload safety net" hadn't actually been working — leads were silently dropped during Anthropic overloads too, undiagnosed until now.

**Solution (3 changes in commit `cb9b482`):**
1. `max_tokens: 768` → `2048` in `callClaude`. 985 tokens observed on the worst-case real production case → 48% utilization of new budget.
2. Parse-failure safety net: when JSON parse fails, create inbox-review placeholder (with correct `id` and `action_type`), fire Slack alert, return 200 to Make with empty `bot_reply` so downstream Send DM skips. Lead surfaces in inbox for setter to handle manually.
3. Patch the overload-error path's NOT NULL bug at the same time.
4. Bonus telemetry: `[anthropic] model=... stop_reason=... output_tokens=...` logged on every API call for instant diagnosis.

**Verification:**
- 6/6 PASS on Phase F+1 regression suite (against the new Worker code) — opt-out rule unaffected.
- Real-traffic reproducer: replayed exact production failure case (`894431997`) against staging via `phase_f1_replay_894431997.ps1`. HTTP 200, `output_tokens=985`, clean structured response. The case that was 100% failing in production now succeeds.
- Production confirmation: same customer succeeded post-deploy with `output_tokens=920`.

**Production deploy:** Worker version `6f311745-fec1-4eff-9ad3-098a128dd38c` at ~23:30 UTC. Prior version preserved for rollback via `wrangler rollback`.

**PR:** `fix/parse-failure-and-max-tokens` (commit `cb9b482`).

### Infrastructure side-effects (also shipped)

- **Staging Dashboard access restored.** Anthony's auth user (`thony@gmail.com`) had no `profiles` row in staging, blocking Dashboard access. Inserted `superadmin` profile row with organization_id matching staging Coach Shaun bot's org. Full staging Dashboard now usable for prompt editing.
- **Schema drift catalogued:** staging `profiles.permissions` is `text[]`, production is `jsonb`. Documented for follow-up reconciliation.
- **Wrangler dual-account quirk documented:** Anthony's wrangler OAuth login has access to two Cloudflare accounts. `--namespace-id` flag defaults to wrong account; must use `--binding MEMORY_STORE --env staging` for KV operations. The Phase F+1 cleanup script prints stale `--namespace-id` invocations — flagged for follow-up patch.
- **Reusable test scripts:** `phase_f1_cleanup.ps1`, `phase_f1_seed.ps1`, `phase_f1_runner.ps1`, `phase_f1_replay_894431997.ps1` all committed and reusable for future prompt or Worker changes.

### Production state at session close

- Worker: `6f311745-fec1-4eff-9ad3-098a128dd38c` (Phase F structural + Phase F+1 prompt + parse-failure fix)
- Prompt: MD5 `d83e41bf8bf26032b4fce82d04b2b069`, 16,906 chars, 17 sections (Phase F+1 applied)
- Dashboard production: `0e7be4d3` at `botos-platform-3ar.pages.dev` (no Dashboard changes today)
- Two open PRs awaiting merge (Phase F+1, parse-failure fix)
- main HEAD: `f1991fc` (unchanged from session start)

### Key learnings captured this session

- **Real-traffic reproducers beat synthetic.** The parse-failure fix verification used the EXACT production failing case (customer `894431997`). Synthetic regression suite passed before and after; the real reproducer was the convincing signal.
- **Latent bugs surface when adjacent code is reviewed.** The overload-error NOT NULL bug had been silently failing for who-knows-how-long. We only found it because we were reviewing similar code for the parse-failure handler.
- **Inline em-dash injection.** New pattern for handling non-ASCII test data: `$EM = [char]0x2014` and inject at runtime. Keeps `.ps1` files pure ASCII (no mojibake risk) while preserving real unicode in DB writes.
- **KV cache precedence over Supabase rows.** Phase F+1 staging tests would have given false results without clearing KV memory before each run. The Worker reads `memory:<customer_id>` from KV first; only falls back to Supabase row if KV is empty. Future testers must clear KV.
- **Wrangler `--namespace-id` is account-context-blind.** For dual-account logins, must use `--binding ... --env <name>` instead.


# BotOS / Mu - Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Nothing. Tonight's session (2026-05-18) resolved the CRITICAL cron-writes-flag-but-no-DM bug by identifying the actual root cause (Make Scenario 2 BundleValidationError on a malformed cron payload) and shipping the fix to production. See "Priority 3 cron sending fix + profile_name cleanup" in COMPLETED below. The previous CRITICAL diagnosis ("Worker writes flag but doesn't dispatch Scenario 2") was wrong; the Worker WAS dispatching but Make was rejecting the payload silently from the Worker's perspective. Two open work items remain in NEXT UP. Inbound visibility Phase 1 (priority A) still gated on Nella's response to the three prerequisite questions sent 2026-05-15.

**Production state:** Worker version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c` (deployed 2026-05-18 from `main` at commit `85b69d9`, includes the cron payload shape fix and `resolveFollowUpName` defensive guard against username-shaped profile_name values). Cron schedule `0 * * * *` active; cron is now functional end-to-end (flags AND sends). `/health` returns 200. `/__cron-test` correctly 404s on the environment gate. Dashboard at commit `6fc0f54` (deployed 2026-05-13 via Cloudflare Pages project `botos-platform`, deploy hash `caa2a57e`, bundle `index-JIvVZDjR.js`, served at domain `botos-platform-3ar.pages.dev`). `reviews.lead_intent` column present (migration 005). `conversations.last_followup_source` column and `idx_conversations_followup_eligibility` partial index present (migration 006). 120 production conversations rows had `profile_name` cleaned tonight (108 nulled where it equalled username, 8 suffix-stripped to recover real first names, 4 nulled where suffix-strip produced awkward output). Make Scenario 1 mapping was corrected by Anon_Techie earlier 2026-05-18 to stop concatenating `ig_username` into `profile_name`; new inbound leads should now receive clean `profile_name` values directly from Manychat. Make Scenario 2 routing unchanged. Coach Shaun's bot serving live leads.

**Staging state:** Worker version `57bf8f9f-dcf0-4d1a-b934-cefc040ace55` (deployed 2026-05-18 from `main` at commit `85b69d9`, same fix as production but with empty `crons = []` so the cron handler is in code but does not fire automatically). `/__cron-test` invoked post-deploy returned `ok: true`, examined 0, sent 0 (no eligible rows in staging). Dashboard at commit `6fc0f54` (deployed 2026-05-13 via Cloudflare Pages project `botos-platform-staging`, deploy hash `75847182`). Staging Pages env vars correctly point at staging Supabase (`hlpucysbaqerhwahfolg.supabase.co`). Migrations 005 and 006 present.

**Open monitoring items:** Watch the next 24 hours of production cron activity. Look for `last_followup_source='auto'` rows where `messages` JSONB does not contain a follow-up text we'd expect, and cross-reference with Make Scenario 2 execution history. Note: the Worker cron does NOT append the follow-up bot message to `messages` JSONB; the JSONB-visibility gap is by design pending a separate change. The success criterion right now is "no more BundleValidationError emails from Make Scenario 2's onerror chain".

---

## NEXT UP

The next session should pick up these items in order.

### [ ] PRIORITY A: Inbound visibility Phase 1 (gated on Nella's response)

**State:** As of session start 2026-05-18, awaiting Nella's reply to three prerequisite questions sent 2026-05-15. If she has replied, start Phase 1 prerequisite scoping. If not, continue with B below.

**Three prerequisite questions to Nella:**
1. Confirm Coach Shaun's IG business account is linked to a Facebook page in Meta Business Suite.
2. Decide whether to use Coach Shaun's existing Meta Business Manager or set up a fresh one for the Mu AI white-label.
3. Approve submitting Meta App Review (2-6 weeks turnaround).

**Phase 1 plan once unblocked:**
- Pull conversation history from Meta's Instagram Messaging API `conversations` endpoint. This captures all manual IG replies that bypass our webhook (typed in IG app on phone, typed in Manychat Live Chat). 4-6 focused coding sessions; can run in parallel with App Review.
- Subscribe to Manychat outbound-message webhook as a lower-coverage stopgap. Captures replies via Manychat Live Chat but not direct IG app. Less effort.

**Confirmed via Meta docs 2026-05-13:** technically 100% doable via Meta's Conversations API. Manychat's API does NOT expose conversation history (confirmed via their community moderator).

### [ ] BUG: Lead-source-event re-fires cause duplicate or regenerated drafts (Worker)

**State:** Real bug confirmed via code investigation 2026-05-15. Symptom: setter sees the Suggested Reply panel render text that is identical or near-identical to a previously-sent assistant message in the same thread. Surfaced on production lead `@sethwallace33` (customer_id 190508016); Nella manually corrected by erasing the wrong suggestion and typing a proper reply. The bad pending row is gone now (overwritten by her edit), so the DB no longer carries direct evidence, but the bug pattern is reproducible by the code analysis.

**Root cause:** When ManyChat fires a keyword or comment `lead_source_event` for an already-engaged lead, Make Scenario 1 often passes the lead's PREVIOUS user message (via `last_input_text` resolution), not a new one. The Worker correctly recognizes the duplicate at `sales-bot/src/index.js:1005-1017` (line numbers may have shifted slightly after the 2026-05-18 patch; the logic block is intact) and sets `isDuplicateOfLastMessage=true`. But it does not early-return. It then:
1. Pushes a `lead_source_event` marker into memory with no `content` field.
2. Finds the recent pending review from the prior turn and decides to batch onto it.
3. Removes the last assistant message from memory.
4. Calls Claude again.
5. Claude sees a context nearly identical to the previous turn, with one noisy `"You: undefined"` line added (from the contentless `lead_source_event` marker rendered at `buildDeveloperPrompt`).
6. With temperature 0.7, Claude often returns text identical or near-identical to its previous draft.
7. The fresh `joinedReply` overwrites `bot_reply` on the existing pending review.

**Contributing factor (separate but related):** The Worker's KV memory always stores the ORIGINAL Claude draft as the bot's previous message, never the setter's edited version sent through Make Scenario 2. So Claude is always working from a falsified history of what the bot actually said. This compounds the duplicate-context problem and may cause subtle drift in long conversations even outside `lead_source_event` scenarios.

**Production impact:**
- Bug is rare; only triggers on `lead_source_event` webhooks for already-engaged leads (keyword re-engagement, repeat comments on the same post, etc).
- Not silent. Setters see the wrong suggestion and correct it manually before sending. The end lead does NOT see duplicate or wrong messages.
- Wastes Claude API tokens on a regeneration that should be a no-op.

**Fix plan for next session (2 to 3 hours of work, single Worker change, staging-testable):**

1. Recommendation 2 from the 2026-05-15 investigation: when `isDuplicateOfLastMessage` is true AND `batchReviewId` is set, early-return before pushing the marker, before the batching check, and before the Claude call. The existing pending review already represents the actual unanswered state. Optionally bump `conversations.updated_at` and append a `lead_source_event` marker so the inbox sees the re-engagement event, but skip the regeneration entirely.

2. Recommendation 3 from the same investigation: stop showing Claude a contentless marker. Either give `lead_source_event` entries a real `content` field like `"[System: lead engaged via X]"` or filter them out of the array passed to `buildDeveloperPrompt`. Pick one and apply consistently.

3. Staging test: use the `/__cron-test` route is irrelevant here; instead use a synthetic `lead_source_event` POST to `https://sales-bot-staging.nellakuate.workers.dev/webhook` to confirm the early-return path is taken and no second pending review is created.

4. Production deploy: standard staging-then-prod with version capture.

**Deferred to a separate session: Recommendation 4 from the investigation.** Sync setter edits back to KV memory so Claude works from real conversation history rather than its own (possibly edited away) prior drafts. This is the architectural root-cause fix but spans Worker + dashboard and is a larger scope.

### [ ] FOLLOW-UP from tonight's session: name extraction or bot-asks for missing profile_name

**State:** Designed but not started. Coach Shaun input needed before scoping.

**Why:** After tonight's DB cleanup, 896 Manychat conversations rows have `profile_name = NULL`. The cron will skip these leads on `no_profile_name++`. We lose roughly 80% of potential cron follow-ups on existing leads. Going forward, the corrected Make Scenario 1 mapping should produce clean `profile_name` values from Manychat for new leads, but Manychat can only return a name when Meta has one (per Meta IG User Profile API docs, the `name` field can be null when the user has not set a display name). So even with the Make fix, a meaningful percentage of new leads will still have no `profile_name`.

**Two options to recover those leads:**

Option B1 (name extraction): On the first 2-3 user messages from a lead with no `profile_name`, run a Claude Haiku call to extract a probable first name. Cheap (~$0.0001 per extraction), automatic, has false positive risk (e.g. "Hey Shaun!" extracted as "Shaun"). Needs a known-exclusion list for the coach's names.

Option B2 (bot asks): Add a prompt instruction so Claude works in a casual name ask on turn 2 or 3 if no profile_name is set. Higher data quality. Affects bot brand voice. Needs Coach Shaun's input on tone.

**Recommendation:** B2 is the right long-term answer but needs Coach Shaun in the loop. B1 is a stopgap that can ship without his sign-off. Discuss with Nella whether Coach Shaun has bandwidth for a 15-minute conversation about how the bot should ask for names.

**Not blocking:** No urgent action. The cron will skip leads without names and continue sending to leads with real names. The 195+8=203 Manychat rows with `profile_name='clean'` will start receiving follow-ups starting at the next eligible cron tick.

### [ ] Priority 1: Username resolution monitoring (no build work, just observation)

**State:** Shipped 2026-05-11. No code changes needed unless monitoring surfaces a problem.

**What to do next session:**
- Check production Anthropic billing dashboard for caching cost trend.
- Watch Make Scenario 1 executions over the past few days. Confirm Branch B is firing for missing-username leads.
- Check inbox for emails to `iamanthony1007@gmail.com` with subject `[Mu AI] ManyChat GetSubscriberInfo failed for subscriber...`.
- Spot-check the production dashboard inbox for leads that previously had "Instagram Lead" placeholders.

### [ ] Priority 2: Auto-send based on per-stage approval history + confidence

**Design (locked):** Auto-send when ALL of:
1. Bot has approval rate >= 90% over last 30 reviewed drafts AT this conversation_stage (rolling window).
2. This specific draft's `confidence` >= 0.80.
3. Message does NOT contain a Jotform / booking link.
4. `lead_intent` is not `HIGH`.
5. `escalation_reason` is null.

Per stage, per bot. Auto-sent messages still write a review row with `status: auto_sent`.

**Open questions:**
- Storage of rolling-window state: computed on-the-fly from `reviews` table, or denormalized into a `bot_stage_stats` table?
- Cold-start guard: require at least 30 reviewed drafts before auto-send is considered.
- Dashboard: "Auto Sent" filter tab.
- Settings: should setters be able to manually disable auto-send for a stage even if the rate is high?

### [ ] Priority 4: Custom domain setup (blocked pending Nella's domain docs)

**State:** Nella has purchased a domain. Domain document not yet uploaded to project knowledge. Setup blocked until uploaded.

**Open questions to ask Nella:** domain name, registrar, desired subdomain layout, email on the domain.

### [ ] Future: System audit document

Nella asked for a comprehensive audit document covering the system as a whole. Estimated 8-15 pages. Suggested format: a new `SYSTEM-AUDIT.md` file at the repo root.

### [ ] Deferred (lower priority)

**STAGING.md runbook:** Was the original "next up" before caching work. Should still happen.

**Operational hardening:** Slack alert when Worker errors, reconciliation job for orphaned reviews / conversations, runbook for common production incidents.

---

## COMPLETED

### [x] Priority 3 cron sending fix + profile_name cleanup (2026-05-18)

**Result:** The "cron writes flag but doesn't send" bug is fixed. Worker version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c` deployed to production at commit `85b69d9` on `main`. 120 production conversations rows cleaned of corrupted `profile_name` values (legacy data from the pre-2026-05-18 Make Scenario 1 mapping).

**Original diagnosis (2026-05-13) was wrong.** PROGRESS.md previously theorized that the cron was writing the flag without dispatching to Make Scenario 2. Investigation tonight via Make API (`scenarios_get` on Scenario 2 ID `9057459`) and execution history showed the Worker WAS dispatching, but Make Scenario 2 was failing downstream at the Manychat `SetSubscriberCustomField` module with `BundleValidationError: Missing value of required parameter 'cFieldValue'`. The Worker's `sendToMakeScenario2` `fetch` correctly returned `{ok: true}` because the webhook accepted HTTP 200; the downstream module failure was not visible to the Worker.

**Root cause 1: cron payload shape mismatch.** Make Scenario 2's webhook interface declares the `messages` array as an array of plain strings (matching the normal-reply path which passes `dedupedMessages` as `string[]`). The cron at `sales-bot/src/index.js:734-738` was sending `[{ text: sanitized, typing_delay_ms: FOLLOWUP_TYPING_DELAY_MS }]` instead of `[sanitized]`. The Make `BasicFeeder` module emitted empty `90.value` when iterating over the object-shaped array, which then propagated through to the failing `SetSubscriberCustomField` step.

**Root cause 2 (separate but related): profile_name was polluted with usernames.** Coach Shaun's Make Scenario 1 had been mapping `profile_name = name + ig_username` (concatenated). Anon_Techie noticed this earlier 2026-05-18 and corrected the mapping to `profile_name = name` only. By that point 2,200 Manychat rows had `profile_name` matching `username` (no real name was ever stored) and 17 rows had `profile_name = real_name + username` (concatenated). Even after the fix, the cron would have sent things like `shank_golf_society?` as a follow-up text for any pre-fix row.

**Fixes shipped this session:**

1. **Worker fix 1 (cron payload shape):** Changed line 736 from `[{ text: sanitized, typing_delay_ms: FOLLOWUP_TYPING_DELAY_MS }]` to `[sanitized]`. Matches the normal-reply path and the Scenario 2 webhook interface.

2. **Worker fix 2 (resolveFollowUpName defensive guard):** Tightened the cron's name resolver at `sales-bot/src/index.js:645-672` to return null when `profile_name` looks like the username. Three conditions added:
   - exact match (case-insensitive)
   - normalised match (lowercased, non-alphanumeric stripped)
   - first-word-of-profile-name match (case-insensitive)

   When any condition triggers, the cron skips that lead (`stats.skipped.no_profile_name++`). Defensive guard against any future ingestion source that re-pollutes the data.

3. **Database cleanup (SQL editor, production project `rydkwsjwlgnivlwlvqku`):** Wrapped in a single transaction with row-count verification before COMMIT.
   - **108 Manychat bucket1 rows nulled** (profile_name equalled username exactly, no real name was ever stored).
   - **8 Manychat bucket2 rows suffix-stripped** to recover real first names: customer_ids `1814724376` (Brandon Hasick), `760375173` (Sal Patanio), `307107903` (Arp), `549781706` (Mike Jordan), `305848261` (Tim Kassen), `1524997550` (David ijimolu), `479028787` (karthik Reddy), `372920459` (Ashley Jane).
   - **4 Manychat bucket2 edge cases nulled** where suffix-strip would produce awkward output: customer_ids `1263315783` ("Mr."), `499481538` ("Laurie54"), `277814276` ("Bobbysykes"), `796282115` ("YB").
   - **All 3,615 `ghl_`-prefixed rows left untouched.** These come from a separate (historical) GHL ingestion path; the cron's customer_id pre-flight check (`sendToMakeScenario2` line 491-494) rejects any `ghl_`-prefixed ID, so these rows cannot trigger a DM regardless of profile_name value.

**Verification path:**

1. Read full Worker source from local at commit `2a67028` (HEAD before patch). Confirmed no other code path writes `last_followup_source`. Confirmed Postgres `append_conversation_turn` RPC resets `followed_up=false, followup_count=0` on every turn but does NOT touch `last_followup_source` (which explained the three "ghost" rows where `followed_up=false` but `last_followup_source='auto'` were observed; lead re-engaged AFTER cron flagged them, RPC reset the followup columns, last_followup_source persisted).
2. Read Make Scenario 2 (`9057459`) blueprint. Confirmed the BasicFeeder emitting empty `90.value` was the failure point.
3. Read Make Scenario 1 (`8264588`) blueprint. Confirmed the mapping had been corrected by Anon_Techie to `profile_name: "{{75.name}}"` without ig_username concatenation.
4. SQL classification preview against production conversations table. Bucket counts confirmed: 108 manychat bucket1, 12 manychat bucket2, 195 manychat clean, 784 manychat null_or_empty, 12 manychat no_username_to_compare, and 3,615 ghl-prefixed rows in various buckets.
5. Eyeballed all 17 bucket2 rows (12 Manychat + 5 GHL) to decide strip-vs-null vs leave-alone per row.
6. Transaction-wrapped UPDATE applied to production Supabase. Verification query after the three UPDATEs returned the predicted bucket distribution exactly. COMMIT.
7. Python patcher script `patch_worker.py` written with explicit CRLF anchor matching, dry-run mode, MD5 verification. Tested in sandbox against a copy of the Worker source; confirmed correct anchor location, syntactically valid output via `node --check`.
8. Patcher run locally in dry-run mode against `C:\Users\Order Account\botos-platform\sales-bot\src\index.js` (MD5 `ce59a740...`). Anchors located at lines 645 and 733, exactly as expected. Patcher run in apply mode; MD5 changed to `074dedca...`. `node --check` clean.
9. Staging Worker deployed via `wrangler deploy --env staging`. Worker version `57bf8f9f-dcf0-4d1a-b934-cefc040ace55`. Smoke-tested `/__cron-test`: returned `{ok: true, stats: {examined: 0, sent: 0, skipped: {all zero}}}`. No eligible rows in staging at deploy time (confirmed via separate SQL preview).
10. Production Worker deployed via `wrangler deploy`. Worker version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c`. Bindings confirmed: ENVIRONMENT=production, SUPABASE_URL=rydkwsjwlgnivlwlvqku, KV namespace `34e52c784a4e4e40925b93b17354cbec`, cron schedule `0 * * * *`. `/health` returns 200. `/__cron-test` returns 404 (env guard working).
11. Feature branch `fix/cron-payload-and-profile-name-guard` pushed to origin. PR #1 opened and squash-merged to `main` (commit `85b69d9`). Local main pulled and synced. Feature branch deleted.

**Trade-offs and design notes:**
- The Worker cron does NOT append the bot's follow-up message to `conversations.messages` JSONB. This is unchanged from the pre-fix behavior. PROGRESS.md previously listed this as a possible silent failure mode; investigation showed it was always intentional. The dashboard's Follow Ups tab is the audit surface for cron-sent follow-ups, not the message thread view. A separate change to append cron-sent messages to JSONB is worth scoping but not a bug.
- The "ghost rows" (3 rows where `followed_up=false, followup_count=0, last_followup_source='auto'`) are explained by `append_conversation_turn` resetting `followed_up` to false on every turn. When a lead replies AFTER the cron flagged them, the RPC resets the followup columns but leaves `last_followup_source` alone. Not a bug.
- The 19 pre-fix cron-flagged rows still have `last_followup_source='auto'` in production. They were NOT reset during tonight's cleanup. Decision: leave them alone, fix is forward-looking only. Resetting them would risk duplicate follow-ups if the leads later age back into the cron's eligibility window.

**Production telemetry to watch over next 24 hours:**
- Make Scenario 2 execution history for cron-originating runs. Should now succeed at the `SetSubscriberCustomField` step.
- Inbox at `iamanthony1007@gmail.com` for the `[Mu AI] Auto-send failed` alerts from Scenario 2 onerror chain. Should stop arriving.
- Production `conversations` table for new rows with `last_followup_source='auto'` and timestamps clearly outside the suspicious "flagged in same minute as a normal turn" pattern.

### [x] Priority 3 dashboard pass: surface `last_followup_source` in Inbox (2026-05-13)

**Result:** Dashboard now reads and writes `conversations.last_followup_source`. Shipped to production via Cloudflare Pages project `botos-platform` (deploy hash `caa2a57e`, bundle `index-JIvVZDjR.js`, domain `botos-platform-3ar.pages.dev`). Commit `6fc0f54` on `main` (fast-forwarded from feature branch `feat-inbox-followup-source`). Only `dashboard/src/pages/Inbox.jsx` changed (+25 / -7).

**Why:** The Worker shipped 2026-05-12 writes `last_followup_source='auto'` when the cron fires, but the dashboard had no awareness of the column. The setter could not tell whether a flagged follow-up was the cron's automatic action or a setter's manual log. The dashboard also had to start writing `'manual'` on the setter-driven path so the column is fully populated from both sides.

**Five edits to `dashboard/src/pages/Inbox.jsx`:**
1. `loadData` conversations SELECT: pull `last_followup_source`.
2. `leadsMap` forEach: carry the column onto each lead object so realtime callbacks do not drop it.
3. `markAsFollowedUp`: write `last_followup_source='manual'` to the Supabase UPDATE and to the local optimistic state patch.
4. `unmarkFollowedUp`: clear `last_followup_source` to NULL on the Supabase UPDATE and on all three local state setters (`setConversation`, `setSelectedLead`, `setLeads`).
5. Lead detail header: new pill rendered as a sibling of the existing follow-up button. Auto variant uses the Follow Ups tab palette (`#fff7ed` / `#fed7aa` / `#d97706`). Manual variant uses a half-shade purple (`#ede9fe` / `#c4b5fd` / `#6d28d9`) to visually separate from the adjacent Mark Follow-Up button. Render guard requires both `followed_up=true` and `last_followup_source` set, so the pill is "current state", not "history". Re-engagement clears `followed_up` via `append_conversation_turn` and the pill stops rendering.

**Verification path:**
1. Local `npm run build` clean. 361 modules transformed, output `index-JIvVZDjR.js`.
2. Deployed to staging Pages project `botos-platform-staging` (deploy hash `75847182`). Seeded two synthetic test rows in staging Supabase, one with `last_followup_source='auto'` and one with `'manual'`. Visited the staging dashboard, opened each lead, confirmed the pills rendered with correct colors and counts. Cleaned up test rows after.
3. Deployed to production Pages project `botos-platform` (deploy hash `caa2a57e`). Opened production lead `@njtexan` (real `last_followup_source='auto'` row populated by the cron). Pill rendered correctly.
4. The production visual verification is what surfaced the Worker-side cron bug separately. The dashboard correctly displayed what the Worker wrote; the Worker was writing the flag without sending the DM. That bug was traced and fixed 2026-05-18 (see entry above).

**Incidental fixes during this session:**
- Cloudflare Pages staging project `botos-platform-staging` had no env vars set before this session. Added `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` pointing at staging Supabase (`hlpucysbaqerhwahfolg.supabase.co`). Before this fix, vite builds running in the Pages staging environment would have fallen back to whatever was in `dashboard/.env`, which is production.
- Staging Supabase had an `auth.users` row for `iamanthony1007@gmail.com` with no matching `public.profiles` row, causing the dashboard to hang on 406 errors during login. Inserted the matching profiles row (admin role, org `00000000-...0001`, bot `00000000-...0002`).

---

### [x] Priority 3: T+20h auto follow-up via Cloudflare cron (2026-05-12)

**Result:** Live in production. Worker `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4` on `main` at commit `b7b70a4`. Migration 006 applied to both staging and production Supabase. First cron tick fires at 22:00 UTC 2026-05-12 (about an hour after deploy).

**Why:** Leads who message the bot and then go quiet for ~20 hours need a nudge before Instagram closes the 24h messaging window. Manual follow-ups via the dashboard require setter attention. This automates the simple case: send `<firstname>?` once at T+20h after the lead's last user message, provided `profile_name` is set and a list of safety guards pass.

**Architecture:**
- Hourly Cloudflare cron trigger fires the Worker `scheduled()` handler at the top of every UTC hour.
- The handler calls `runFollowUpCron(env, ctx, Date.now())` which queries Supabase for eligible leads, post-filters, sends via Make Scenario 2, and PATCHes the conversation.
- Eligibility filter (DB level): `bot_id`, `followed_up=false`, `for_coach=false`, `conversation_stage != 'BOOKED'`, `updated_at` between NOW-21h and NOW-20h.
- Post-filter (JS, per candidate): last message in conversation is from the bot; last user message is in the 20-21h window (defense against `updated_at` being bumped by non-message writes); bot's last message does not contain a booking link or escalation handoff phrase; lead is not a tester (soak prefix, tester prefix, hardcoded set, or `bot tester` username); `profile_name` is non-empty AND is not equal to the lead's username (added 2026-05-18).
- On match, calls `sendToMakeScenario2(customer_id, [sanitized], [1000])` (object shape corrected 2026-05-18), then `ctx.waitUntil(PATCH conversations set followed_up=true, followup_count=1, last_followup_source='auto')`.
- Safety cap: 50 sends per cron run. 200ms sleep between sends.
- Idempotency: `followed_up=true` is part of the eligibility filter, so a followed-up row will not be picked up again on the next tick.

**Schema (migration 006):**
- `conversations.last_followup_source text NULL`. Values: `'auto'` (cron) or `'manual'` (dashboard button).
- `idx_conversations_followup_eligibility ON conversations (bot_id, updated_at) WHERE followed_up=false AND for_coach=false AND conversation_stage <> 'BOOKED'`. Partial index keeps the hourly scan cheap on a 4,664-row table.

**Worker code (commit `b7b70a4`, updated by `85b69d9` on 2026-05-18):**
- 6 new helpers in `b7b70a4`: `isTesterLeadForCron`, `extractLastUserAndBotMessage`, `containsBookingLink`, `looksLikeEscalationHandoff`, `resolveFollowUpName`, `runFollowUpCron`.
- `scheduled()` handler on `index_default`.
- Staging-only `GET /__cron-test` debug endpoint gated by `env.ENVIRONMENT === "staging"`. Production returns 404.

**Wrangler config (commit `b7b70a4`):**
- Production: `[triggers] crons = ["0 * * * *"]`.
- Staging: `[env.staging.triggers] crons = []` so the handler is in code but does not fire automatically.

**Trade-offs and design notes:**
- Dropped the `escalation_reason IS NULL` criterion from the original spec because `escalation_reason` lives on `reviews` not `conversations`. Replaced with pattern-matching on the bot's most recent message text for handoff language ("I'll get Shaun to", "let me pass you to", "a human will", etc.).
- Dropped the `conversations.followed_up_at` column from the original spec because the existing `followed_up` boolean already answers the idempotency question. Avoids two sources of truth.
- No fallback from `profile_name` to `username`. Lead without `profile_name` (or with `profile_name` that looks like the username, post-2026-05-18) is skipped entirely.
- Worker source file `sales-bot/src/index.js` is bundled style (uses `__name` shims and `index_default` indirection). Edits are made directly to this file, no separate build step.
- File on disk uses CRLF line endings. Patcher scripts explicitly handle CRLF.

**Known caveats / monitored items (still applicable):**
- The auto-follow-up "James?" message bypasses the existing review workflow. It does not write a `reviews` row. The setter cannot see in advance that the bot is about to follow up. The dashboard Follow Ups tab will show the lead after T+23h if they did not reply, which is the audit surface.
- The cron does not append the follow-up bot message to `conversations.messages` JSONB. Audit only via the Follow Ups tab and Make Scenario 2 execution history.

---

### [x] Make Scenario 1: router + GetSubscriberInfo for missing-username leads (2026-05-11)

(Entry preserved from prior session. Not modified.)

### [x] Worker empty system-block bugfix (2026-05-11)

(Entry preserved from prior session. Not modified.)

### [x] Inbox UX: manual reply textarea on Needs Response tab (2026-05-09)

(Entry preserved from prior session. Not modified.)

### [x] Phase 1.2: prompt caching deploy + schema fix (2026-05-09)

(Entry preserved from prior session. Not modified.)

---

## DEFERRED - known gaps, not blockers

- **GHL ingestion path data quality (observed 2026-05-18).** Production `conversations` table has 3,615 rows with `customer_id LIKE 'ghl_%'`. These are historical contacts from a separate GoHighLevel ingestion path. Their `profile_name` and `username` fields show various patterns: 2,092 have `profile_name = username` (lowercase first name), 1,514 have `profile_name` containing the username as a non-suffix substring (e.g. `anna` → `anna bowden`), 5 have suffix-match, 4 are clean. The cron pre-flight check rejects all `ghl_` IDs so they cannot trigger a DM. No action needed unless we add a non-Manychat outbound dispatch path in the future.
- **19 pre-fix cron-flagged rows still show `last_followup_source='auto'`.** The 2026-05-18 fix is forward-looking; the historical flagged rows were not reset. They remain ineligible for future cron picks (`followed_up=true` or `followup_count>=1`). Decision: leave alone.
- **Cron does not append follow-up message to `conversations.messages` JSONB.** By design. Could be added in a future session if the audit surface needs to show "the bot sent <firstname>?" in the thread view alongside the Follow Ups tab pill.
- **Pre-existing em-dash count in `sales-bot/src/index.js` is 23.** All in strings/comments (log messages, doc comments, email subject lines). None in code paths that emit messages to leads (the `sanitizeBotMessage` function strips em-dashes from any bot reply before send). Cleanup is a code-hygiene task, not a behavioral one. Schedule for a future session.
- **`sales-bot/node_modules/.cache/wrangler/wrangler-account.json` is tracked by git.** This file contains wrangler OAuth state and should not be in version control. Next session: `git rm --cached sales-bot/node_modules/.cache/wrangler/wrangler-account.json` to untrack, then verify `.gitignore` actually excludes the whole `node_modules/` tree. **Also: audit git history for any prior commits of this file; if OAuth secrets were ever committed, they should be considered exposed and rotated.**
- **Local tooling scripts at the repo root.** `patch_worker_priority3.py`, `diagnose_index_default.py`, and now `patch_worker.py` (from the 2026-05-18 session) are one-shot scripts. They are useful as future reference. Either commit them to a `tools/` directory or add them to `.gitignore`. Currently untracked.
- **Wrangler upgrade (deferred):** local `wrangler` is at `4.65.0`; latest is `4.92.0`. Upgrade is a separate maintenance task.
- **`dashboard/.env` and `dashboard/.env.staging` are tracked in git.** Both files contain Supabase URLs and anon keys. Anon keys are designed to be public and are RLS-gated, so this is not a credential leak, but committing `.env` files is unusual.
- **Deploy ergonomics:** `wrangler deploy` (without `--env`) triggers a warning about multi-environment ambiguity. The 2026-05-18 production deploy used the unflagged form and the warning was informational only. Future deploys can pass `--env=""` to suppress.
- **Phase 1.3:** Worker `/health` endpoint returns hardcoded `supabase_connected: true`. Needs real check.
- **Phase 3:** Logo asset URLs in dashboard hardcoded to production Supabase storage bucket.
- **Phase 4:** Remove dead `OPENAI_API_KEY` references from Worker.
- **Cleanup:** Delete leftover `iamanthony@gmail.com` row from staging `auth.users`.
- **Cleanup:** Soak rows `soak-2026-05-09-001..018` and the synthetic test rows under `race_test_phase_*`, `empty-suffix-*`, `99887766554433`, `staging-smoke-test-003`, `needs-response-ui-test-*` in staging conversations / reviews can be deleted whenever convenient.
- **Future task:** Capture production RLS policies into source-controlled SQL.
- **Open question:** Dashboard's "Test" filter classification logic.
- **Future improvement:** Separate Anthropic API key for staging Worker.

---

*Last updated: 2026-05-18 (Worker cron sending fix + profile_name cleanup. Two Worker patches in `sales-bot/src/index.js` shipped via commit `85b69d9`. 120 production conversations rows cleaned. Production Worker version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c`. The previous CRITICAL diagnosis was wrong; root cause was a Make Scenario 2 BundleValidationError on the cron's payload shape, not a missing Worker dispatch.)*

---

## SESSION PICKUP PROMPT

*This block is designed to be pasted as the first message of the next session.*

PASTE THIS:

> I'm Anon_Techie continuing work on the BotOS / Mu AI sales bot for Coach Shaun (Fairway Performance Golf, Cayman Islands). The project is also being prepped for white-label SaaS handover to Nella, who owns the production Cloudflare and Supabase accounts.
>
> You have full project knowledge including PROGRESS.md, SYSTEM-AUDIT.md, and CLAUDE.md. Read PROGRESS.md first; it is the single source of truth.
>
> Last session (2026-05-18) resolved the CRITICAL cron-writes-flag-but-no-DM bug. Diagnosis was rewritten: the Worker WAS dispatching to Make Scenario 2, but Make Scenario 2 was failing downstream at the Manychat `SetSubscriberCustomField` module with BundleValidationError because the cron's payload shape did not match the webhook interface. Two Worker fixes shipped:
> 1. Cron payload now sends `[sanitized]` instead of `[{ text: sanitized, typing_delay_ms: ... }]`.
> 2. `resolveFollowUpName` returns null when profile_name looks like the username (defensive guard).
>
> 120 production conversations rows had `profile_name` cleaned. 108 nulled (exact-match to username), 8 suffix-stripped to recover real first names, 4 nulled where suffix-strip produced awkward output. All 3,615 `ghl_`-prefixed rows left untouched.
>
> Production state: Worker version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c` (commit `85b69d9` on main). Dashboard at commit `6fc0f54` / Pages deploy `caa2a57e`. Make Scenario 1 mapping was corrected earlier 2026-05-18 to stop concatenating `ig_username` into `profile_name`. Make Scenario 2 unchanged. Coach Shaun's bot serving live leads.
>
> Three open items in NEXT UP, in order:
> - PRIORITY A: Inbound visibility Phase 1, still gated on Nella's reply to three prerequisite questions sent 2026-05-15. Ask if she has replied.
> - BUG: Lead-source-event re-fires (already in NEXT UP, fix plan known, 2-3 hours of Worker work).
> - FOLLOW-UP: profile_name recovery for leads where Meta returns no name. Two options (Claude Haiku extraction or bot-asks-conversationally), needs Coach Shaun input.
>
> Remember the standing rules:
> - No em dashes anywhere in any output.
> - `ctx.waitUntil` stays for Supabase writes (never `await`).
> - PROGRESS.md is the single source of truth; update at end of session.
> - Staging deploys before production.
> - I have zero coding experience; deliver complete files and step-by-step instructions, not diffs or partial edits.
> - Multi-step PowerShell commands should be a single block to paste and run all at once.
> - Push to feature branch, not main; web Claude Code sessions can't push to main directly due to branch protection.

END PASTE.

## 2026-05-19 - Phase A+B+C of Anthropic cost reduction (semantic retrieval foundation)

Goal: reduce Anthropic API spend from ~$80-100/mo to ~$30-50/mo by replacing chronological "newest 30 learnings injection" with semantic retrieval via Voyage AI embeddings + pgvector. Trigger: Anthropic spend cap hit $50 on 2026-05-16. May 2026 caching deploy still firing but only 27.6% hit rate because most leads respond 24h+ later (well past the 5-min TTL).

Decision: caching at any TTL is wrong for this traffic pattern. Architecture change to semantic RAG follows industry standard (TELUS, Zapier, Pinecone, Google ADK patterns).

### Done tonight

Phase A: Voyage AI account
- Account created on Nella's email, payment method added (rate-limit unlock; stays in 200M free tier; ~$0 actual billing at our volume)
- VOYAGE_API_KEY uploaded as Cloudflare Worker secret on production (top-level) AND staging (--env staging)
- Verified key works: voyage-4 model returns 1024-dimensional embeddings

Phase B: Database schema (both Supabase projects)
- pgvector extension enabled on production (rydkwsjwlgnivlwlvqku) and staging (hlpucysbaqerhwahfolg)
- learnings.embedding vector(1024) column added to both
- bot_documents.embedding vector(1024) column added to both
- HNSW cosine_ops indexes on both (m=16, ef_construction=64)
- match_learnings(query_embedding, target_bot_id, match_threshold, match_count) RPC created on both
- match_documents(query_embedding, target_bot_id, match_threshold, match_count) RPC created on both
- All idempotent migrations; safe to re-run

Schema drift discovered and documented (not blocking):
- learnings.tags is jsonb on staging, text[] on production
- match_learnings function signatures differ accordingly between environments
- Both PostgREST-serialize to JS arrays, so Worker code reads identically via tags || []
- Worth a unified-schema cleanup eventually but not blocking Phase D

Phase C: Embedding backfill
- Production: all 296 learnings + 3 documents embedded via Voyage voyage-4
- Staging: 20 sampled production learnings + 3 documents seeded with embeddings (for Phase D testing)
- Smoke test on both: top-result similarity = 1.000 (self-match), descending naturally to ~0.58-0.84
- Production semantic retrieval working as expected

### Files added (committed in this session)

- scripts/backfill-embeddings.mjs (idempotent, filters embedding IS NULL, Voyage batch=64)
- scripts/seed-staging.mjs (cross-environment copy: prod -> staging with embeddings)
- PHASE-D-BRIEFING.md (24KB comprehensive brief for Phase D execution)

Worker source unchanged. Production Worker still on commit 8afdeb3, version unchanged from 2026-05-18.

### Pre-flight findings for Phase D (verified 2026-05-19 late session)

Anchor lines in sales-bot/src/index.js:
- BOT_ID const at line 5 (module-level, also redeclared at line 1780 locally)
- getSupabaseUrl(env) at line 11
- async function fetchRelevantLearnings(env, memory, limit = 30) at line 2115
- async function fetchActiveDocuments(env) at line 2146
- async function callClaude(env, memory, learnings, documents, systemPrompt, ...) at line 2167
- max_tokens: 1024 at line 2383
- /learnings endpoint call: await fetchRelevantLearnings(env, {}, 50) at line 2092
- Main webhook call: Promise.all at lines 1129-1132 (calls both fetchRelevantLearnings(env, memory) and fetchActiveDocuments(env))

File state:
- 130,358 bytes
- CRLF line endings confirmed (1024 CRLF in first 50KB sample, 0 LF-only)

Untracked at end of session (not Phase D related):
- patch_worker.py: 9,350-byte leftover from 2026-05-18 cron fix session
- scripts/check-cron-deploy-2026-05-18.mjs: another leftover from same session

### Lessons learned this session

- Schema-first: always query column types before writing migrations. Lost 30 min on tags jsonb vs text[].
- Always check third-party API rate limits, not just pricing. Voyage's 3 RPM free tier without payment method blocked production backfill.
- PowerShell env vars don't survive across new shell windows. Re-prompt for keys when shell recycles.
- Staging schemas can drift from production silently.
- Idempotent scripts (embedding IS NULL filter) saved us when transient fetch failures hit mid-batch.
- Use absolute paths for [System.IO.File] methods in PowerShell; CWD doesn't propagate to .NET. Hit this twice tonight.
- Browser Claude Code is the right tool for Worker mechanical edits, not web chat.

### Handoff to browser Claude Code

Phase D and E to be executed by browser Claude Code in a new session. Reads PHASE-D-BRIEFING.md from repo. Anthony continues as planner via web chat. Pre-flight findings above are the verified ground truth; Claude Code does not need to re-discover them.

### Next session deliverables

- Phase D: Worker code changes per PHASE-D-BRIEFING.md
  - embedQueryText() helper for Voyage (input_type: query)
  - fetchRelevantLearningsSemantic via match_learnings RPC
  - fetchRelevantDocumentsSemantic via match_documents RPC
  - max_tokens 1024 -> 512
  - Keep legacy functions for rollback
- Phase E: staging deploy, synthetic test, production deploy, 30-60 min monitor
- 24h measurement of actual savings via [cache] log lines + Anthropic billing dashboard
- Followup tomorrow with Nella to share results

## 2026-05-21 - Phase D shipped to production (semantic retrieval live)

Phase D of the Anthropic cost reduction work is live on production.
sales-bot.nellakuate.workers.dev now uses Voyage AI semantic retrieval
instead of chronological "newest 30 learnings" injection.

### Production state at end of session

- Worker version: a1b9ec9c-4425-4ff7-9a5c-d84ebcc09178
- Branch: feat-semantic-retrieval-phase-d (commit 21b3c19)
- Deployed via wrangler deploy at 2026-05-21 01:07 UTC

### Synthetic test on production (one-call measurement)

Single test call to /webhook with customer_id=phase-d-prod-test-001-DELETE-ME:

  [retrieval] learnings=8 docs=2 embed_dim=1024 similarity_top=0.666
  [cache] model=claude-sonnet-4-6 input=2410 cache_create=7399 cache_read=0 output=447

Latency: 12,471 ms (comparable to pre-Phase-D ~12,000-13,000 range).
Bot reply was coherent and slightly improved over staging quality.

### Measured impact (preliminary, one call)

Static prefix size: 10,248 tokens (pre-Phase-D) -> 7,399 tokens (Phase D)
Reduction: 28%

Output token count: 447 (well under the new 512 cap).

### Cost projection

Pre-Phase-D monthly bill: ~$80-100 (per dashboard CSV through 2026-05-16).
Post-Phase-D projection: 24% bill reduction = ~$60-76/month.

This is below the original "ambitious 50%+" target. To hit 50%+, additional
phases needed (deferred):
- Phase E: model routing (Haiku for simple turns)
- Phase F: system prompt trim (the 4,300-token systemPrompt is now the
  dominant chunk of the static prefix)
- Phase G: remove caching entirely (write surcharge no longer worth it)

24h of production data will be the real measurement. The single-call test
is directional, not definitive.

### Test data to clean up

One row in production database:
- reviews.customer_id = 'phase-d-prod-test-001-DELETE-ME'
- conversations.customer_id = 'phase-d-prod-test-001-DELETE-ME'

Delete tomorrow morning. SQL:
  DELETE FROM reviews WHERE customer_id = 'phase-d-prod-test-001-DELETE-ME';
  DELETE FROM conversations WHERE customer_id = 'phase-d-prod-test-001-DELETE-ME';

### What was NOT touched

- /train endpoint and dashboard prompt editor
- /explain-learning endpoint
- Cron handler (T+20h follow-up still on hourly schedule)
- Make.com scenarios
- ManyChat integration
- Dashboard pages
- Learning insertion via Inbox (still inserts to learnings table; no auto-embedding yet)

### Known issue: new learnings will not be auto-embedded

When setters edit a bot reply via Inbox, the new learning gets inserted
into the learnings table with embedding=NULL. The semantic match function
filters out NULL-embedding rows, so new learnings won't surface in the
bot's context until they're embedded. Currently this requires manually
re-running scripts/backfill-embeddings.mjs.

This is a Phase 2 polish item: add a Postgres trigger or Edge Function
that auto-embeds new learnings on insert. Documented as a known gap.

### Lessons from this session

- 40-60% reduction projection was too optimistic for Phase D alone.
  Honest measured reduction is 28%. Hitting 50%+ requires stacking
  multiple phases.
- Two-terminal pattern for wrangler tail + curl works reliably on
  Windows where Start-Job has subtle subprocess streaming issues.
- ECONNRESET on wrangler tail is a known transient issue. Retry usually
  works.
- Production has stronger semantic match quality than staging
  (similarity_top 0.666 vs 0.598) because of larger learning pool.

### Follow-up actions

For Anthony tomorrow:
- Send Nella update with honest 28% reduction number
- Delete the DELETE-ME test row in production database
- Schedule Phase E session (model routing) within next 1-2 weeks
- Schedule Phase F session (prompt trim) after Phase E lands

## 2026-05-21 (late session) - Phase G1 shipped + Phase D merged to main

Continuation of cost reduction work the same UTC day as Phase D shipped earlier. Two architectural fixes plus the operational cleanup of getting deployed code onto main.

### Done tonight

**Phase D merged into main (PR #2, merge commit bbaa723)**

Phase A+B+C and Phase D were both sitting on feature branches while production ran the code. Anyone reading main on GitHub would see pre-Phase-D code that did not match production. Tonight's merge brought deployed code onto main as the single source of truth. No code changes; pure branch hygiene. Project knowledge now auto-syncs to current state from main.

Files arriving on main from the merge: .gitignore, PROGRESS.md (Phase D entry), sales-bot/src/index.js (Phase D code), scripts/backfill-embeddings.mjs, scripts/seed-staging.mjs.

**Phase G1 deployed to production (PR #3, merge commit b1fb053)**

Two-line change to sales-bot/src/index.js:
- Removed cache_control from systemBlocks (no more 1.25x cache write surcharge)
- Bumped max_tokens 512 to 768 (avoid the JSON truncation failure mode discovered tonight)

Deployed:
- Staging worker version 286e66d6-aa92-4606-926e-ffdd905ded5a at 2026-05-21 04:43 UTC
- Production worker version a0858eed-38f7-4dcc-9d44-4784b08e4086 at 2026-05-21 04:48 UTC

Synthetic test on production confirmed the change took effect:

Before G1 (from Phase D ship test):
[cache] model=claude-sonnet-4-6 input=2410 cache_create=7399 cache_read=0 output=447

After G1 (production test tonight):
[cache] model=claude-sonnet-4-6 input=9857 cache_create=0 cache_read=0 output=400

The 7,400 cached-prefix tokens now flow as regular input tokens. No more surcharge being paid for cache writes that never get read. Semantic retrieval [retrieval] line unchanged.

### The architectural finding that drove Phase G1

Diagnostics tonight revealed that cache_read=0 on every observable production call, not just the 2 AM synthetic test that shipped Phase D. Real production traffic from two unrelated leads at 03:11 and 04:11 UTC both showed cache_read=0. A controlled identical-message test with three calls in a 2-minute window against a fresh customer_id ALSO showed cache_read=0 on all three.

Root cause traced through three sequential diagnostics:
1. Read deployed Phase D Worker source. Confirmed staticPrefix includes learningsSection.
2. Re-ran controlled identical-message test. Confirmed cache miss persists even with identical user input.
3. Read embedQueryText function and its call site. Found the call site concatenates retrievalBotMessage (the most recent bot reply) with the user message before embedding.

The embed query changes every turn because retrievalBotMessage changes every turn. Different embed query produces different top-8 semantic-match learnings, which produces different learningsSection text, which produces different staticPrefix bytes, which breaks the cache key. The cache has effectively been dead since Phase D shipped.

### Why Phase G1 instead of fixing the cache

Two reasons. First, the embed query could be stabilized by passing only the user message, but that would degrade retrieval quality (bot message context currently helps Voyage find relevant learnings). Tradeoff with product implications.

Second and decisive: the bot operates in manual-review mode. Setters review and approve bot replies in the Inbox before they are sent via Make Scenario 2. Real lead turn-gaps frequently exceed 1 hour, well past both the 5-min and 1-hour Anthropic cache TTLs. Even a byte-stable prefix would rarely produce cache hits under current operating mode. Caching becomes worth re-enabling only when auto_send_enabled is flipped to true for trusted bots and turn-gaps compress to minutes.

### Empirical cost impact

Per-call savings on the static prefix: roughly $0.006 (cache_create 7400 at $3.75/MTok = $0.0278 vs input 9857 at $3.00/MTok = $0.0296 with the saved surcharge differential).

This works out to approximately 15% per-call cost reduction on the static prefix line item. At current production volume, estimated monthly impact is $3-8.

Not transformative. The operational benefit of getting deployed code onto main (PR #2) is arguably more valuable than the cost savings itself. Honest accounting: this was a small win that was worth doing because the cache surcharge was pure waste, not because the headline number is impressive.

The 20% projection from theoretical pricing math was slightly optimistic. Actual savings comes only from the cache-write surcharge differential ($0.75/MTok on the prefix portion), not from removing prefix tokens entirely.

### Diagnostic surfacing the max_tokens issue

During diagnostic 1's 3-call synthetic test, call 3 returned a 500 to the client. The Worker successfully called Anthropic and received a response, but the JSON body was truncated at output=511 (one token below the 512 cap), causing the JSON parse to fail. The response was structurally valid up to the truncation point but missing the closing brace.

This is happening in production on similar verbose turns where Claude generates detailed internal_notes plus full memory_update plus tags. The 768 bump should eliminate this failure mode without bloating typical output costs (Claude only generates as many tokens as needed; the cap just prevents truncation).

### Open follow-ups (carried forward)

Phase F still the highest-value remaining lever: the 4,300-token systemPrompt is now ~44% of the 9,857-token total prefix-as-input. Trimming it reduces every call's input cost directly. Could plausibly deliver 15-25% additional savings depending on how aggressive the trim, but requires careful product testing because the systemPrompt encodes bot behavior.

Phase E (model routing Haiku vs Sonnet) deferred further. Highest theoretical savings but highest product risk; a bad routing decision means worse customer experience. Wait until we have more confidence in measuring bot output quality.

The "fix the cache" path (stabilize embed query OR move learningsSection out of cached prefix) becomes worth revisiting when auto_send_enabled is flipped to true. Not before.

Auto-embedding new learnings inserted via Inbox: still broken. Setters edit a reply, the new learning gets embedding=NULL, semantic match filters out NULL rows, the lesson is invisible to the bot until manual backfill. Real product gap that gets worse over time. Needs a Postgres trigger or Edge Function for auto-embedding on insert.

Schema drift learnings.tags jsonb (staging) vs text[] (production) still present. PostgREST serializes identically so Worker is unaffected, but the divergence will bite eventually.

Voyage AI payment method: still on Anthony's personal card. Transfer to Nella when she sets up her own.

### Cleanup queue (to batch in next session)

Five DELETE-ME test rows accumulated this session and the prior Phase D session. Production:
- phase-d-prod-test-001-DELETE-ME (Phase D ship test, 2026-05-21 01:07 UTC)
- phase-test-1779331900-DELETE-ME (diagnostic 1, 02:53 UTC)
- phase-test-diag2-1779337354-DELETE-ME (diagnostic 2, 04:22 UTC)
- phase-g1-prod-1779342529-DELETE-ME (G1 production verification, 05:48 UTC)

Staging:
- phase-g1-staging-1779342216-DELETE-ME (G1 staging verification, 05:43 UTC)

Cleanup approach: SELECT first to verify exact rows, then DELETE with explicit IN list (not LIKE pattern). To be done with fresh eyes, not at 6 AM after a long session.

### Files added on main this session

- PHASE-G1-BRIEFING.md (Claude Code execution brief)

### Worker version IDs deployed this session

- Production: a0858eed-38f7-4dcc-9d44-4784b08e4086 (Phase G1)
- Staging: 286e66d6-aa92-4606-926e-ffdd905ded5a (Phase G1)

Previous: a1b9ec9c-4425-4ff7-9a5c-d84ebcc09178 (Phase D), now superseded.

### Lessons this session

- Real-traffic data beats synthetic. The 28% Phase D measurement was one synthetic call. Real production calls tonight showed semantic retrieval working but cache failing for an architectural reason we did not understand at Phase D ship time.
- Diagnostics in sequence, not in parallel. Three rounds of diagnosis tonight, each refining the theory based on the previous round. Resisted the urge to commit to fix design after diagnostic 1 (when I thought semantic drift was the cause); diagnostic 2 forced me to look deeper, diagnostic 3 found the real mechanism.
- Verify deployed code on the branch, not on main. Project knowledge was stale to deployed code throughout this session until the Phase D merge. Branch-vs-main drift is its own operational risk; PR #2 addressed it.
- Conservative percentage promises. Last session promised 40-60% for Phase D, delivered 28%. This session promised "about 20%" for Phase G1, measured 15%. Stay conservative. Real production traffic will be the final word, not theoretical math.
- Two-window tail+fire pattern works reliably. SSL/TLS intermittent errors on Invoke-WebRequest now seem to be tolerable: retry once and proceed. Cause likely a transient network issue on the client side, not a Worker problem.
- max_tokens=512 was too aggressive. Phase D's reduction caused a real 500 to a client tonight. Always test verbose response paths before clamping output limits.

### Standing rules reaffirmed

No em dashes anywhere. ctx.waitUntil for Supabase writes. Staging before production. Feature branches only, never push to main directly. PROGRESS.md updated at session end (this entry). Long commit messages via temp file plus git commit --file=. PowerShell multi-step commands as single blocks. Use absolute paths in [System.IO.File] .NET calls.

## 2026-05-22 - Phase F shipped + setter correction bug found and fixed

Phase F of the Anthropic cost reduction work is live on production. The Worker now uses section-marker lazy loading for Coach Shaun's system prompt, injecting only the sections relevant to the current conversation stage. Measured per-call input token reduction: 24-42% depending on stage, ~33% average on real-traffic-shape synthetic tests.

Mid-session a separate pre-existing bug was discovered and fixed: the /feedback endpoint had been silently failing to embed new setter corrections since 2026-05-15, leaving 26 corrections invisible to semantic retrieval. This was the root cause of Nella's pre-shipment observation that "the bot wasn't catching the recent corrections." Fix shipped same session, all 26 orphan rows backfilled, end-to-end verification confirms the active-vs-passive correction now fires.

### Production state at end of session

- Worker version: ec34452c-e711-4ace-a35a-5e90b180182b
- Branch: feat-phase-f-systemprompt-redesign (3 commits)
  - da581a6 feat(worker): Phase F section-marker lazy loading
  - 63c12bc fix(worker): generate embeddings for new learnings in /feedback
  - 68ec504 docs(phase-f): briefings, patcher, backfill scripts
- Deployed via wrangler deploy at 2026-05-23 05:00 UTC (Phase F bugfix combined)
- Coach Shaun's system_prompt updated to section-marker format (production prompt_versions has version 22 backup of pre-flip prompt)

### What shipped in Phase F (the systemPrompt redesign)

Five code changes to sales-bot/src/index.js:

1. callClaude signature gains priorStage and hasLeadSourceEvent parameters (defaults null/false for backward compat)
2. /webhook call site passes priorStage and isLeadSourceEvent from surrounding scope
3. New staticPrefix assembly: parses systemPrompt via parseSystemPrompt, picks per-stage sections via decideRequestedSections + STAGE_GRAPH, joins into lazyPromptBody
4. /train endpoint system message instructs the prompt engineering assistant to preserve ## SECTION_NAME markdown headers (also drops a stray em-dash)
5. New module-scope helpers: parseSystemPrompt, decideRequestedSections, STAGE_GRAPH (10 stages), ALWAYS_ON_SECTIONS

Coach Shaun's prompt restructured into 17 named sections (6 always-on, 11 lazy). Raw size: 14,991 chars (down 13% from 17,246). Runtime size after lazy load: ~10,000 chars average (down ~42%).

### Measured impact (per-call input tokens, real traffic)

Pre-Phase-F production baseline: 9,548 input tokens (one synthetic call against old prompt + new Worker code = backward-compat path)

Phase F production: 7,217 input tokens on first post-flip call. 24% reduction on a HOOK / ENTRY call.

10-case regression test against production (all stages):
- HOOK / ENTRY: 5,076-7,231 tokens (depending on prior history depth)
- GOAL: 7,861 tokens
- DIAGNOSTIC: 6,343-7,812 tokens
- PRIORITY: 8,022 tokens
- INVITE: 5,343 tokens
- SCHEDULE: 6,001 tokens

Average across 10 real-traffic-shape replays: ~7,009 tokens = 27% reduction vs 9,548 baseline.

### Cost projection

Pre-Phase-F monthly bill estimate: ~$60-76/month (post-Phase-D, pre-Phase-F).
Post-Phase-F projection: ~$45-60/month (~25% additional reduction).

Combined with Phase D (28%) and Phase G1 (caching removal), the stack now delivers roughly 50-55% total reduction vs the pre-Phase-D May 2026 baseline. The "ambitious 50%+" target across the cost reduction work is hit.

### The bugfix (the surprise of the session)

Investigation triggered by regression test results: 4 of 10 cases showed the bot ignoring the active-vs-passive setter correction even though learnings retrieval was returning 8 corrections per call.

Root cause: /feedback endpoint at line 1888 was inserting new learnings without an embedding field. The match_learnings RPC filters out rows where embedding IS NULL. So the 26 setter corrections created since 2026-05-15 were stored but invisible to retrieval.

Database snapshot at investigation time:
- 322 total learnings on the bot
- 296 had embedding (created on or before 2026-05-15)
- 26 had embedding=NULL (created 2026-05-21 onward)

The boundary was 2026-05-15 17:29 -> 2026-05-21 11:47 (5-day gap with zero learnings created), suggesting embedding generation broke during a deploy in that window but symptom only surfaced when Nella resumed correcting reviews.

Fix: wrapped the supabaseInsert in an async IIFE inside ctx.waitUntil, called the existing embedQueryText() helper before the insert, included the returned 1024-dim vector in the row. If Voyage fails the row still inserts with embedding=NULL and a warning logs. Endpoint response latency unchanged.

Verified on staging then production: /feedback now emits `[feedback] embedding generated for review_id=..., dim=1024` log line on every successful Save.

### The backfill (the same-session catch-up)

backfill_inline.ps1 script run against production. Talks Supabase REST + Voyage REST directly. 26 orphan rows processed. 23 succeeded on first run. 2 failed with transient TCP connection drops (retried, both succeeded). 1 failed with Voyage 400 Bad Request - root cause was smart quotes (U+2018, U+2019, U+201C, U+201D, U+2014) in Nella's reason field. fix_one_orphan.ps1 added Unicode normalisation and that row backfilled successfully too.

Final state: 322/322 learnings have embeddings. Zero orphans.

End-to-end verification: re-ran Test 9 (bradentuckian "Just loved the content!") against production. Bot reply was "Glad the content is resonating with you. Are you actively working on improving your golf game right now, or more just keeping an eye on tips for the future?" - exact application of the previously-failing setter correction.

### Regression test methodology

Before deciding to commit Phase F, ran a 10-case regression test against real edited reviews from the prior 48 hours. Methodology:

1. SELECT recent reviews where status=edited and ABS(LENGTH(bot_reply) - LENGTH(final_reply)) >= 15 (substantive edits, not 1-word touch-ups)
2. For each, pre-seed a tester_phase_f_rg_NN_<username> conversation row in production with the prior message history and the same conversation_stage
3. Send the original trigger message to /webhook via run_phase_f_regression_v2.ps1
4. Compare new Phase F bot reply against (a) the old Phase D bot reply that was edited and (b) what Nella actually sent

Results saved to phase_f_regression_results.json. Findings:

Strong positives:
- Voice preserved across all 10 (no em-dashes, Aussie phrasing, no AI-isms)
- Stage routing correct in 9/10 (Test 7 moved PRIORITY -> INVITE which is correct given context)
- Tests 3 and 7 demonstrably better than Phase D output
- Token reduction confirmed in real-traffic-shape calls

Identified pre-existing issues (not Phase F caused):
- Active-vs-passive setter correction not firing (tests 2, 4, 5, 9) - root caused to /feedback embedding bug, fixed
- Length-mirroring rule weak (test 10) - prompt rule issue, deferred
- "Read what lead said first" rule sometimes ignored (test 5) - prompt rule issue, deferred

Decision: Phase F is neutral-or-better on quality, and the regressions identified are independent prompt-instruction-priority issues, not Phase F regressions. Ship and continue.

### Files added on this branch

- PHASE-F-WORKER-PATCH.md (design doc with all 5 anchors)
- PHASE-F-CLAUDE-CODE-BRIEFING.md (Phase F Claude Code session brief)
- PHASE-F-BUGFIX-CLAUDE-CODE-BRIEFING.md (bugfix Claude Code session brief)
- patch_phase_f.py (Python patcher with idempotency check, CRLF preservation)
- backfill_inline.ps1 (env-var-driven embedding backfill)
- fix_one_orphan.ps1 (smart-quote-normalising one-off variant)

.gitignore updated to exclude:
- .claude/ (Claude Code per-user state)
- phase-*-diff.txt (local diff dumps)
- COMMIT_MSG_*.txt (long commit message temp files)

### Worker version IDs deployed this session

- Production after Phase F only: 1078252b-d7b9-4c54-a823-a034efa176e4
- Production after Phase F + bugfix: ec34452c-e711-4ace-a35a-5e90b180182b (current)
- Staging after Phase F only: 8bba0a4a-b901-4d7b-b442-84fee5b09ed8
- Staging after Phase F + bugfix: 14cd3003-bac8-4d4d-89e9-1de27d66c6bf

Rollback targets:
- Phase F only -> 1078252b (still has the bugfix gap)
- Pre-Phase-F (safe full rollback) -> a0858eed-38f7-4dcc-9d44-4784b08e4086 (Phase G1)

### Test data created and cleaned up

Created in production during session:
- 1 conv: tester_phase_f_prod_backcompat (backward-compat verification)
- 1 conv: tester_phase_f_prod_postflip (post-flip verification)
- 10 convs: tester_phase_f_rg_NN_<username> (regression tests)
- 1 conv + review: tester_bugfix_verify_bradentuckian (bugfix verification)
- 1 review: prod_bugfix_test_<random> (bugfix endpoint test)

All cleaned up before commit. 0 tester_phase_f% rows remain. 0 prod_bugfix_test% rows remain.

Note: 73 older tester_ rows from prior sessions (2026-03-21 through 2026-05-03) remain in production conversations table. Not cleaned this session. Add to housekeeping queue.

### Open follow-ups (carried forward)

- VOYAGE_API_KEY rotation needed: Anthony pasted it in web chat by accident during the session. Treat as compromised. Rotate at voyageai.com -> API Keys, update Cloudflare Worker secret via wrangler secret put VOYAGE_API_KEY on both production and --env staging.

- Smart-quote normalisation should be added to the /feedback endpoint Worker code so future corrections with smart quotes don't hit the same Voyage 400 we saw on row 384576c2. Low frequency, low impact (row stores with embedding=NULL and warning logs), but worth fixing during the next Worker patch session.

- The 4 prompt-level issues surfaced by the regression test (active-vs-passive correction priority, length-mirroring, "read what lead said first", expert-reframe-then-question pattern at DIAGNOSTIC) remain. Two of four are likely fixed automatically by the bugfix (setter corrections now retrievable), but the other two are prompt-instruction-priority issues. Plan a Phase F+1 prompt iteration once we have 7 days of real production data showing whether the corrections are firing in real conversations.

- 73 legacy tester_ rows in production conversations from prior sessions, oldest from 2026-03-21. Safe to delete but skipped tonight to avoid hasty SQL. Schedule a cleanup pass with explicit ID list, not LIKE pattern.

- The pre-existing UNIQUE constraint on conversations(bot_id, username) that staging doesn't have caused friction tonight (had to use unique usernames per tester row). Document the constraint divergence or unify schemas.

- sales-bot/node_modules/.cache/wrangler/wrangler-account.json still tracked in git (carried over from prior session). Untrack and audit history.

- Two-window tail+test workflow proven again. Standard practice from here.

### Lessons this session

- Project knowledge index lags deployed code. Throughout this session, project_knowledge_search returned stale source (max_tokens=512 etc) until we web_fetched the canonical GitHub raw URL. Verify against main branch source, not the indexed snapshot, for any anchor-sensitive edits.

- Stale knowledge isn't always wrong but isn't always right. Schema-first verification (column names, types, constraints) before writing SQL prevented at least three would-be SQL errors tonight. The conversations table UNIQUE constraint on (bot_id, username) was discovered this way before we shipped a broken seed.

- Supabase SQL Editor wraps each Run in an implicit transaction. BEGIN/COMMIT split across Runs does NOT preserve transaction state. Tonight's first prompt-flip attempt rolled back when COMMIT was run in a fresh editor tab. Lesson: put backup + update + verify in a single Run, no explicit transaction wrappers.

- Claude Code is the right tool for source patches once we have a verified anchor design. Tonight's bugfix took 1 Claude Code session with a tight briefing to apply correctly. The Python patcher workflow was overkill for a single-hunk change.

- Real-traffic regression beats synthetic test. The 10-case replay against actual edited reviews surfaced a bug the synthetic tests would have missed (the /feedback embedding bug). When in doubt, replay actual production data shapes.

- Time-boxed investigation works. 30 minute window declared mid-session for the bugfix investigation produced a clear diagnosis and shipped fix without scope creep. Worth doing more often.

- Smart quotes in user-typed content (Nella's reason field) can fail Voyage AI with a generic 400. PowerShell ConvertTo-Json -Compress passes Unicode through to the API, which sometimes rejects it. Normalise U+2018, U+2019, U+201C, U+201D, U+2014 before sending to embeddings APIs. Worth backporting to the Worker /feedback endpoint.

- Secrets in chat history are a real risk. Anthony pasted a Voyage API key in chat tonight. The bounded-damage nature (Voyage credits only, not customer data) made it tolerable, but the lesson is: never paste secrets, even when "just for one quick test." Read keys from env vars from the start.

### Standing rules reaffirmed

No em dashes anywhere. ctx.waitUntil for Supabase writes. Staging before production. Feature branches only, never push to main directly. PROGRESS.md updated at session end (this entry). Long commit messages via temp file plus git commit --file=. PowerShell multi-step commands as single blocks. Use absolute paths in [System.IO.File] .NET calls. Schema-first verification before any SQL. Verify against deployed code, not stale index.

---

*Last updated: 2026-05-22 / 2026-05-23 (Phase F section-marker lazy loading shipped to production, ~27% per-call token reduction measured. /feedback embedding bug found mid-session and fixed same session. 26 orphan learnings backfilled. Coach Shaun bot fully functional with setter corrections firing. Branch feat-phase-f-systemprompt-redesign has 3 commits ready to PR. Production Worker version ec34452c-e711-4ace-a35a-5e90b180182b.)*

---

## 2026-05-23 - Run 3 regression test + cost analysis + flywheel distinction

After Phase F shipment, a third regression test was run using truly fresh leads (no Run 1 or Run 2 overlap) to get a clean apples-to-apples measurement of the bugfix + backfill impact.

### Run 3 methodology (corrected from Run 2)

Run 2 had been contaminated: re-seeding the same 10 leads from Run 1 caused the bot to retrieve learnings that included prior turns of those exact conversations, producing "your message came through twice" hallucinations on tests 1 and 2.

Run 3 fixed this by selecting 10 reviews from 2026-05-12 through 2026-05-14 (pre-embedding-cutover, never touched as testers in this session). 9 unique usernames, no overlap with Run 1's bradentuckian / jdusich / dannydigog / jadiews / reezy6 / iamacockeral / noname pool.

### Run 3 results (clean baseline)

10 tests, all succeeded, no hallucinations:
- Exact or near-verbatim match to Nella's edit: 4/10 (tests 2, 4, 9, 10)
- Strong improvement / matches Nella's pattern: 2/10 (tests 5, 7)
- Different but valid approach: 3/10 (tests 3, 6, 8)
- Regression: 1/10 (test 1, opt-out handling)

Token usage: 6,803-7,652 input tokens, avg 7,261. 24% reduction vs pre-Phase-F baseline of 9,548.

### New regression discovered: opt-out handling

Test 1 (lattrellwalt, GOAL stage): lead said "Sorry, Shaun, I do not want to continue this thread. Thank you for your consideration!"

Pre-Phase F bot reply: "No worries hope your recovery goes well." (graceful exit)
Nella's edit: "No worries if you need anything just reach out, cheers mate" (graceful exit)
Post-Phase F bot reply: pushed back with sales pitch including "I share a lot of free content that might help when you're ready to dive deeper. What's the #1 thing you'd most want to see improve..."

The bot ignored an explicit opt-out signal and asked a GOAL-stage qualifying question instead. This is a behavior regression introduced by Phase F (the pre-Phase-F bot handled this correctly).

This is NOT a learning gap. It's a prompt instruction priority issue: the nurture script outranks the "respect explicit disengagement" signal. Fix needs to go in the GUARDRAILS or VOICE section of the system prompt, not in the learnings pipeline.

### Cost reduction analysis (honest, real-measured)

Per-call input cost progression (production, measured from [cache] log lines):

| Phase | Avg tokens | $/call | vs baseline |
|-------|-----------|--------|-------------|
| Pre-Phase D (caching @ 27.6% hit rate) | ~10,500 | $0.02938 | baseline |
| Post-Phase D (semantic retrieval + caching) | 7,399 prefix | $0.02070 | -30% |
| Post-Phase G1 (caching removed) | 9,548 | $0.02864 | -2.5% |
| Post-Phase F (lazy loading, no cache) | 7,261 | $0.02178 | -26% |

Phase G1 was a strategy change, not an additive savings: caching had become wrong for the traffic pattern (low hit rate, expired TTLs, cache_create surcharge). Removing it eliminated operational risk (cost spikes from cache_create misses) but increased per-call billed tokens. The real measurable savings live in Phase D's prefix reduction and Phase F's lazy loading.

Honest input cost reduction: ~26% from pre-Phase-D baseline. Annual savings at Coach Shaun's traffic volume (~3,000 calls/month): roughly $279/year. Below the original "ambitious 50%+" target but in the right direction.

Hitting 50%+ would require either Phase E (model routing - Haiku for simple turns) or further system prompt trimming. Both deferred pending sufficient real-traffic data to make decisions safely.

Non-cost-savings wins from this stack:
- Predictable billing (no cache_create spike risk)
- Setter correction loop actually works (was silently broken for 7 days)
- Faster bot replies (smaller prompts mean faster Claude responses)
- White-label ready (Phase F section markers are the foundation for per-tenant prompt customization)

### The learnings flywheel vs prompt rules distinction

A question came up during analysis: will Nella's continued corrections gradually fix all bot quality issues over time?

Honest answer: yes for SOME issues, no for others. The system has two distinct mechanisms with different scope:

**Learnings (semantic retrieval)** are pattern-matching. Each correction nudges cosine similarity in the right direction. As Nella corrects more replies:
- Voice and phrasing refine
- Stage-specific habits emerge
- Edge cases get covered
- Late-stage performance improves (currently learnings cluster in HOOK / ENTRY and DIAGNOSTIC)

This is the flywheel. The more corrections, the better the bot at scenarios similar to those corrections.

**Prompt rules (GUARDRAILS, VOICE, PERSONA sections)** are hard rules. They override pattern-matching. Things that need to be prompt rules, not learnings:

- Opt-out detection (Test 1 of Run 3)
- "Read what the lead just said first" enforcement
- Structural length matching (when no similar learning exists)
- One-question-at-a-time enforcement

No amount of learning corrections will fix these structural behaviors because they require the bot to do something other than pattern-match. They need explicit instruction priority in the prompt.

Implication for future work: two parallel workstreams.

**Workstream 1 (Nella's day-to-day):** Continue inbox corrections. The flywheel is now turning since tonight's bugfix. Every correction improves the bot incrementally for similar future scenarios.

**Workstream 2 (Phase F+1 prompt iteration):** Add structural rules to the system prompt that no learning can teach. Targets:
- Opt-out detection rule (highest priority - Test 1 regression)
- Acknowledge-before-pivot enforcement
- Length-matching as a structural voice rule
- One-question-at-a-time enforcement

Phase F+1 is a separate session, planned after 7 days of real production data showing which prompt rules need updating.

### Open follow-ups added this session

- **Opt-out detection rule in prompt.** Test 1 of Run 3 showed the bot ignores explicit disengagement signals. Needs GUARDRAILS-level rule in next prompt iteration.
- **The learnings vs prompt-rules distinction** documented above. Helps future sessions plan correctly.

### Run 3 test data cleanup

10 tester_run3_* conversations and any associated reviews deleted from production. Verified 0 remaining.


## 2026-05-25 - Bugfix-2 shipped + cron verification + backlog discovery

Sunday session triggered by Nella's complaint "the bot didn't learn anything I input from last week." Investigation revealed a second instance of the /feedback embedding bug, this one on the Dashboard side. Same root cause area as Phase F bugfix-1 (commit 63c12bc on May 22) but a separate code path that the original fix didn't cover.

### What was discovered

Bugfix-1 from May 22 added embedding generation to the Worker's POST /feedback endpoint. Synthetic curl POSTs to that endpoint correctly emit [feedback] embedding generated, dim=1024 log lines. Looked verified at the time.

Today, while preparing for a customer call, ran a SQL check on production learnings created today:

- 9 (then 11) rows from today's date all had embedding IS NULL
- None of them were synthetic test data
- They were real Nella corrections from this morning AND our own test edit

The /feedback fix was working for synthetic tests but bypassed by the live Dashboard Save flow.

### Root cause

dashboard/src/pages/Inbox.jsx saveTraining() handler (lines 467-534) writes directly to Supabase via supabase.from('learnings').insert(...) at line 476. Never calls the Worker. The Voyage API key lives in Worker secrets, so embedding can only be generated server-side. Every Save-with-edit was producing an orphan.

The previous synthetic verification was therefore inadequate. Voyage embedding worked when called from a curl POST that hit /feedback, but the real production path never went through /feedback at all.

### Fix shipped (Option B)

Two options were considered (analysis by Claude Code):

Option A: Point Dashboard at existing /feedback endpoint. Smaller diff, ~10 lines on Dashboard side only. Caveat: /feedback hardcodes bot_id: BOT_ID = Coach Shaun. Multi-tenant landmine for white-label handover.

Option B (chosen): New POST /learnings Worker endpoint accepts bot_id from request body. Multi-tenant safe. Preserves /feedback byte-identical as canonical path.

Implementation:

- sales-bot/src/index.js: +70/-0 (new POST /learnings endpoint, inserted before existing GET /learnings handler, distinguished by request.method)
- dashboard/src/pages/Inbox.jsx: +40/-6 (saveTraining redirected to Worker, env-aware WORKER_URL constant)

Production Worker version after fix: 70e69912-ad59-4e03-9265-b2acf63f3b2d
Production Dashboard deploy: 0e7be4d3 (aliased to botos-platform-3ar.pages.dev)

### Verification methodology (corrected from May 22)

Last weekend's verification only used synthetic curl POSTs. This time three layers:

1. Worker smoke test (synthetic curl POST to /learnings): status 200, tail showed [learnings] embedding generated dim=1024.
2. Preview Dashboard test (real Save click on Cloudflare Pages preview URL hitting production Worker + Supabase): real review_id created, tail showed dim=1024, Supabase row confirmed has_embedding=true.
3. Production Dashboard test (real Save click on botos-platform-3ar.pages.dev): real review_id, dim=1024, Supabase row confirmed.

All three layers passed cleanly. The bug pattern from earlier today (orphan rows from real Saves) no longer reproduces.

### Backfill

11 orphan rows from earlier today (12:40 to 13:35 UTC, all before production fix deployed at 14:25 UTC) were backfilled with embeddings. Same backfill_inline.ps1 script as the 26-row backfill from May 22. All 11 succeeded on first run, no smart-quote issues this time. Final state: 0 orphans remaining, 335 total learnings on Coach Shaun's bot (322 from Saturday + 11 backfilled + 2 verification test rows that we did NOT delete since they're real test edits from your IG account).

### Cron verification (parked, mostly OK)

Tried to confirm the May 18 follow-up cron fix is working end-to-end. Findings:

- Supabase shows 4 rows with last_followup_source='auto' since May 18 (brandongmcs May 20, iamacockeral May 22, beastr1959 May 23, zellie_short May 23). Cron IS firing at the Worker level.
- All 4 show followed_up=false because append_conversation_turn RPC resets it when the lead replies. This is expected behavior and indicates successful end-to-end cycles (cron flagged, follow-up presumably sent, lead replied).
- Make Scenario 2 execution history was hard to navigate. Anthony couldn't easily distinguish cron-originated runs from normal webhook runs.
- Decision: park the Make-side verification for now. The Worker side is provably working. Direct ground-truth check via Coach Shaun's Instagram inbox (asking Nella to verify the 4 follow-up DMs arrived) is the cleanest verification path but requires Nella's involvement.

Status: cron fix is shipped and firing correctly at the Worker level. End-to-end Make delivery confirmation still pending but no evidence of failure.

### Backlog finding (the bigger issue)

While investigating cron, surfaced the actual operational problem: production has 60 pending reviews that Nella hasn't touched since approximately Friday May 22 morning Cayman time. 69 hours of inbox backlog as of investigation. The "bot isn't learning" complaint is partially the embedding bug we just fixed, partially the fact that there hasn't been much volume of corrections to learn from in the past few days.

Implication: auto-send is not just a nice-to-have, it's a real operational need. Nella's bandwidth is the bottleneck. The per-stage approval tracker work (her stated criterion: 30 approvals at a pattern triggers auto-send for that pattern) is the highest-leverage thing to scope and build next.

### Known fast-follow

dashboard/src/pages/Tester.jsx has the same direct-insert orphan-creating bug at lines 234 and 467 (identified by Claude Code during this fix). Lower volume than Inbox saves (testers use this page much less frequently). Deferred to next session.

### Files added/modified this session

Modified:
- sales-bot/src/index.js
- dashboard/src/pages/Inbox.jsx

Used (not modified):
- backfill_inline.ps1 (existing from May 22, ran for the 11-row backfill)
- BUGFIX-2-CLAUDE-CODE-BRIEFING.md, BUGFIX-2-GO-AHEAD-CLAUDE-CODE-BRIEFING.md (chat artifacts, not committed)

### Worker version IDs

Before today: ec34452c-e711-4ace-a35a-5e90b180182b (Phase F + bugfix-1)
After today: 70e69912-ad59-4e03-9265-b2acf63f3b2d (added POST /learnings endpoint)

Rollback target if needed: ec34452c

### Security action

Voyage API key (pa-6WTAj0u74K-...) was inadvertently pasted in chat during the Saturday session. Treated as compromised. Today: generated new key, updated Worker secret on production and staging, revoked old key at Voyage. New key working confirmed via post-rotation smoke test. Local env vars wiped.

### Open follow-ups (carried forward + new)

Carried from earlier:
- Phase F+1 prompt iteration (opt-out detection rule, acknowledge-before-pivot, length-matching, one-question-at-a-time enforcement)
- Inbound visibility Phase 1 (gated on Nella replying to 3 Meta API prerequisite questions)
- Lead-source-event re-fire bug (2-3h Worker work)
- 73 legacy tester_ rows in production conversations from prior sessions
- sales-bot/node_modules/.cache/wrangler/wrangler-account.json still tracked in git

New from today:
- Tester.jsx fast-follow (same orphan-minting bug at lines 234 and 467)
- Auto-send approval tracker (build per-stage/per-pattern approval counter in Dashboard). Nella's criterion: 30 approvals at a pattern triggers auto-send for that pattern. Feature does NOT currently exist. Needs scoping with Nella first (what counts as "same pattern", safety net design, kickoff cadence). 2-3 weeks of build work after scoping. Highest business value remaining item.
- Cron message to JSONB (currently the cron does not append the follow-up to conversations.messages by design). Worth scoping a fix so the inbox thread is the single source of truth.
- Customer call with Nella did not happen today. Setup-balance + retainer conversation still pending.

### Lessons this session

- Synthetic verification is not enough for fixes that touch the Dashboard. Must test the LIVE path (real Save click in real Dashboard against real Worker) before declaring a fix verified. Last weekend's miss was testing /feedback directly with curl, never actually clicking Save in the production Dashboard. Today's miss was deploying the Dashboard but to a preview URL (Cloudflare auto-deploys feature branches to preview URLs, NOT to the main production URL) and not catching it before announcing the fix.
- Cloudflare Pages deploys from a non-main branch go to a preview URL by default. Use --branch=main to force production deployment.
- Claude Code's investigation pass (analyze and report before changing anything) was useful for catching the multi-tenant landmine in Option A. Worth using this two-pass flow for any bug where the obvious fix might have hidden side effects.
- The backlog (60 pending reviews) explains why the embedding bug felt urgent: Nella has been queuing up corrections she expects to apply, but the bot couldn't actually use them. Now that the bug is fixed, the next bottleneck is review volume (her time), which auto-send addresses.
- "Verified" should mean verified on the real production path, not the test path. Project rule going forward: any fix that touches Dashboard or user-facing endpoints requires a real click-through test before declaring done.

### Standing rules reaffirmed (no changes)

No em dashes anywhere. ctx.waitUntil for Supabase writes. Feature branches only, never push directly to main. PROGRESS.md updated at session end. Long commit messages via temp file plus git commit --file=. PowerShell multi-step commands as single blocks. Use absolute paths in [System.IO.File] .NET calls. Schema-first verification before any SQL. Verify against deployed code, not stale index. Never paste secrets in chat.


## 2026-05-31 - Fix B shipped + deploy safety overhaul + 2026-05-29 incident

Three things tonight, in order: investigation of the 2026-05-29 production auth outage (resolved by Anthony rolling back via Cloudflare Pages before this session opened), a deploy-safety overhaul that makes that incident class structurally impossible (PR #9, merge `6f653dc`), and Fix B for the inbox sibling-pending bug shipped end-to-end to staging then production via the new safety chain (PR #10, merge `370adbb`). Production healthy at session close. Fix B live. Deploy story no longer "ad hoc wrangler with a stale dist".

### 2026-05-29 production auth outage (investigation only this session)

Earlier in the week Anthony attempted a production deploy of Fix B. The deploy that landed pointed `botos-platform-3ar.pages.dev` at staging Supabase (`hlpucysbaqerhwahfolg`) instead of production (`rydkwsjwlgnivlwlvqku`). Real users (Nella, setters) were locked out because their production accounts do not exist in staging. Anthony rolled back via the Pages dashboard before this session. Investigation tonight was read-only.

Root cause: failure path C with a twist. Anthony deployed yesterday's stale `dashboard/dist/` (built 2026-05-28 at 17:35 BST during the staging-Dashboard auth-fix session under `vite build --mode staging`) directly to the production Pages project without rebuilding.

Evidence trail:
- `dashboard/dist/assets/index-zeH4aPhH.js` on disk had mtime 2026-05-28 17:35:45 +0100. Exact match to the staging build from the auth-fix session.
- No git commits in the prior 24 hours. No branch switches in reflog.
- That bundle had the staging `createClient` URL baked in: `hs(\`https://hlpucysbaqerhwahfolg.supabase.co\`, ...)`. Plus the 5 hardcoded production logo asset URLs.
- The deployment was uploaded ad hoc to the `botos-platform` (prod) Pages project via wrangler.
- Twist: because the source tree's Fix B working-tree change was not yet committed and therefore not in the staging-mode build either, the broken deploy also did not contain Fix B. Anthony lost both ways.

Independent landmine found during investigation: `dashboard/.env.staging` was edited that day to swap the URL to production while leaving the staging anon key in place. Frankenstein state (production URL, staging anon key) was a separate hazard, reverted in Part 1 of the deploy-safety work.

Live prod bundle at investigation time confirmed healthy after the rollback: `index-qWoFL2zw.js`, 0 occurrences of staging ref, 6 occurrences of production ref (1 auth + 5 logos).

### Deploy-safety overhaul (PR #9, merged `6f653dc`)

Branch `fix/deploy-safety`, branched off `main` at `8133756`. Five commits. Merged to `main` without code review since it is the structural fix to prevent recurrence.

Commits on the branch:
- `515febc` chore(dashboard): add .env.production and mark .env as legacy fallback
- `df6c248` feat(dashboard): add verify-env pre-build guard
- `6ed840d` feat(dashboard): add verify-deploy post-deploy bundle check
- `9e54d76` refactor(dashboard): replace bare build with explicit deploy chains
- `eadf2ee` docs(dashboard): add DEPLOY.md operational guide

Mechanics:
- `npm run build` removed entirely. No ambient default-mode script exists. The only build scripts are `build:staging` and `build:production`, each with `--mode` baked in.
- Two env files. `dashboard/.env.production` mirrors `.env` content for explicit production-mode reads. `.env` annotated as legacy fallback so Vite default mode (if accidentally invoked) still works.
- `dashboard/scripts/verify-env.mjs` runs as `prebuild:staging` and `prebuild:production`. Asserts the matching env file's `VITE_SUPABASE_URL` and the JWT `ref` and `role` claims in `VITE_SUPABASE_ANON_KEY` all match the intended target. Catches the 2026-05-29 mismatch state. Node builtins only.
- `dashboard/scripts/verify-deploy.mjs` runs as `postdeploy:staging` and `postdeploy:production`. Fetches the live Pages URL, locates the bundle, regex-checks the `createClient` Supabase URL against the expected project. Pattern requires the hostname to be followed by a string terminator (backtick or double quote), so the 5 hardcoded logo URLs (followed by `/storage/`) do not cause false positives. Exits 1 with a "ROLL BACK NOW" message on mismatch.
- `dashboard/package.json` deploy chain: `npm run deploy:staging` triggers `predeploy:staging` then `deploy:staging` then `postdeploy:staging` automatically. `predeploy:staging` runs `npm run build:staging`, which auto-triggers `prebuild:staging` (verify-env) before the Vite build. `deploy:staging` is `wrangler pages deploy dist --project-name=botos-platform-staging --branch=main --commit-dirty=false`. Same shape for production.
- `dashboard/DEPLOY.md` is the operator's one-page guide. Two canonical commands, what each safety check catches, rollback procedure.

Verification before merge:
- `npm run prebuild:staging` and `npm run prebuild:production` both exit 0 against the existing env files.
- Negative test: injected the exact 2026-05-29 mismatch (URL flipped to prod ref, staging anon key untouched) into `.env.staging`, ran `npm run prebuild:staging`, exit 1 with a file-specific message naming the expected ref. Reverted clean.
- `verify-deploy.mjs production` against live `botos-platform-3ar.pages.dev`: expected ref 1 match, wrong ref 0 matches, exit 0.
- `verify-deploy.mjs staging` against live `botos-platform-staging.pages.dev`: expected ref 1 match, wrong ref 0 matches, exit 0.

### Fix B shipped end-to-end (PR #10, merged `370adbb`)

Branch `fix/inbox-sibling-pending`, single commit `e785034`, merged to `main` via PR #10. Then deployed through the new safety chain to staging then production.

Fix B targets the inbox sibling-pending bug diagnosed last session: when a lead sends a rapid burst of messages, the Worker batch-window check at 60s runs BEFORE the parallel webhooks finish inserting their reviews, so multiple pending reviews get created for one lead. The dashboard's `approve()` and `saveTraining()` handlers only resolved `activeReview.id`, so siblings stayed pending forever until the lead sent another message (which would trigger the Worker's auto-discard). Symptom Nella saw: "messages she already answered stay in the pending inbox".

Code change in `dashboard/src/pages/Inbox.jsx`: `approve()` and `saveTraining()` now PATCH all other `status=pending` reviews on the same `(bot_id, customer_id)` to `status=discarded` immediately after the active review's own status flip. The discarded siblings carry `internal_notes` ending with `[System: Auto-discarded sibling of approved review <activeReview.id>]` so the auto-clean is auditable in the database.

Staging deploy:
- `npm run deploy:staging` ran the full chain end-to-end.
- Bundle `index-zeH4aPhH.js` produced and uploaded. Cloudflare deploy hash `936dd63b`.
- `verify-deploy.mjs staging` exit 0, 1 expected ref match, 0 wrong ref matches.

Staging end-to-end verification through the real Approve button:
- Seeded synthetic customer `tester_fixb_1779986967` via two `/webhook` POSTs 300ms apart to simulate a rapid burst.
- Worker created two pending reviews on that customer as expected.
- Anthony opened the staging Dashboard Inbox and clicked Approve on the visible draft `review_1779986979851_fgmjd9c2m`.
- Post-approve database snapshot for that customer: approved=1, discarded=1, pending=0.
- The discarded sibling's `internal_notes` ended with the exact `[System: Auto-discarded sibling of approved review review_1779986979851_fgmjd9c2m]` marker. That marker only exists in this patch's source, so the fix is provably what ran.

Production deploy:
- `npm run deploy:production` ran the full chain.
- Bundle `index-DgaCbrqm.js` produced and uploaded. Cloudflare deploy hash `77eb9bd4`.
- `verify-deploy.mjs production` exit 0, 1 expected ref match (`rydkwsjwlgnivlwlvqku`), 0 wrong ref matches.
- Anthony confirmed manual login to `botos-platform-3ar.pages.dev` from his account succeeded immediately after deploy. No lockout this time.

### Production state at session close

- Worker: unchanged. Version `5889c5dc-6104-46e0-ae9a-a1b9926ddf2c` at commit `85b69d9` from the 2026-05-18 session.
- Dashboard production: commit `370adbb`, bundle `index-DgaCbrqm.js`, Cloudflare deploy hash `77eb9bd4`. Fix B present. `createClient` points at production Supabase. Verified by `verify-deploy.mjs` and Anthony's manual login.
- Dashboard staging: commit `370adbb`, bundle `index-zeH4aPhH.js`, Cloudflare deploy hash `936dd63b`. Fix B present. `createClient` points at staging Supabase.
- `main` HEAD: `370adbb`.
- Two PRs merged to `main` today: #9 (deploy safety) and #10 (Fix B).

### Operational findings worth filing

- Both `botos-platform` and `botos-platform-staging` Cloudflare Pages projects are Direct Upload only. Neither is git-connected. Every deploy is a manual `wrangler pages deploy`. PROGRESS noted this for staging on 2026-05-28; tonight confirmed it also holds for production.
- wrangler OAuth login defaults to the operator's primary Cloudflare account. Anthony's wrangler defaults to `iamanthony1007@gmail.com`'s account, but the Pages projects (prod and staging) live under `Nellakuate@gmail.com`'s account (`444afb7987a4f1e657e0bad22a528a42`). Without `CLOUDFLARE_ACCOUNT_ID=444afb...` set in the shell, wrangler returns API error code 10000 on the deployment-list endpoint and silently picks the wrong account for `wrangler pages deploy`.
- The current wrangler OAuth scope set does not include `user_details:read`. Explicit `CLOUDFLARE_ACCOUNT_ID` dodges the issue until OAuth is upgraded or auth moves to a scoped Cloudflare API token.
- `wrangler pages deploy --commit-dirty=false` behaves as "warn and proceed" rather than "refuse and halt". Adequate for now since the operator sees the warning in console output, but worth a future review.
- Five logo image URLs in `Layout.jsx`, `Landing.jsx`, `Login.jsx`, and `AcceptInvite.jsx` are hardcoded to production Supabase storage (`rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo...`). They bake into every dashboard bundle regardless of build mode. Public PNG fetches, not data access, so functionally harmless. `verify-deploy.mjs` distinguishes them from the auth client URL via the regex pattern (hostname followed by string terminator vs hostname followed by `/storage/`). ARCHITECTURE.md already flagged this as a deferred cleanup.

### Open items deferred to next session

- Fix A (Worker race fix at the batch check). The Worker still creates duplicate pending reviews on rapid lead-message bursts. Fix B masks the symptom on the Dashboard side; Fix A would prevent the duplicates from being inserted in the first place. Three valid designs in play: KV-based mutex on `(bot_id, customer_id)`, Cloudflare Durable Object as a single point of serialization, Postgres partial unique index on pending reviews. Each has tradeoffs around latency, cost, and operational complexity. Needs design review with Anthony before committing. Estimated 3-4 hour session.
- `.wrangler/cache/wrangler-account.json` (repo root) and `sales-bot/node_modules/.cache/wrangler/wrangler-account.json` tracked-state hygiene. Tonight's pre-flight on the repo-root file confirmed 83 bytes, only an `account` field, no JWTs, no token-named fields. NOT an active credential leak. Outstanding hygiene work: untrack via `git rm --cached`, audit history for any previously committed OAuth secrets, ensure `.gitignore` patterns actively exclude these paths.
- Switch wrangler authentication from OAuth (with the dual-account quirk) to a scoped Cloudflare API token. Cleaner story for handover to Nella. Logged for the next operations session.

### Lessons this session

- "Verified" is not "deployed". Fix B was patched on disk and committed locally earlier in the week, but the end-to-end Approve test against the real Dashboard was never run (the auth lockout interrupted the flow) before the 2026-05-29 prod deploy attempt. When a session is interrupted by a side quest, the resume checkpoint must explicitly state which verifications were done and which were skipped. Otherwise the operator treats "code in main" as proxy for "tested through the real path", which on 2026-05-29 it was not.
- Multi-step PowerShell guard patterns like `if (!$env:KEY) { return }` do not halt subsequent pasted statements at the interactive prompt. The `return` only exits the immediate scope, not the pasted block. Use explicit `if/else` wrapping the subsequent code, or run the guard as one block and the body as a second block.
- Bundle hash collisions are not "essentially impossible" when the patch shape is small enough. Two different sources that produce the same minified output produce the same hash. Trust the content check (string presence and absence) for verification, not the filename. `verify-deploy.mjs` works on content.
- The wrangler OAuth dual-account quirk has bitten twice this week. Always set `CLOUDFLARE_ACCOUNT_ID=444afb7987a4f1e657e0bad22a528a42` before any wrangler call against Pages or Workers. Codify in DEPLOY.md or a session-init script the next time the operations docs get touched.
- Default to delegating clearly-scoped investigative or mechanical work to Claude Code in a separate session. Reserve interactive chat for design decisions, review of returned artifacts, and small surgical steps with explicit verification gates. Tonight's pattern (investigation as one chat run, deploy-safety overhaul as a Claude Code branch with 5 commits, Fix B verification by the operator with chat as the review layer) was efficient.

### Standing rules reaffirmed (with two additions)

Existing rules unchanged: No em dashes anywhere. ctx.waitUntil for Supabase writes. Feature branches only, never push directly to main (PROGRESS.md docs-only commits excepted). PROGRESS.md updated at session end. Long commit messages via temp file plus git commit --file=. PowerShell multi-step commands as single blocks. Use absolute paths in [System.IO.File] .NET calls. Schema-first verification before any SQL. Verify against deployed code, not stale index. Never paste secrets in chat.

New as of tonight:
- Always set `CLOUDFLARE_ACCOUNT_ID=444afb7987a4f1e657e0bad22a528a42` before any wrangler invocation. The dual-account quirk in Anthony's OAuth login otherwise routes to the wrong account.
- Never invoke `wrangler pages deploy` directly. Always go through `npm run deploy:staging` or `npm run deploy:production` from the `dashboard/` directory. The chain enforces fresh build, env match, and post-deploy URL verification. Bare wrangler invocations bypass all three.

## 2026-06-02 - Per-stage gradual automation shipped to production (behavior unchanged)

The per-stage gradual auto-send feature (built and verified on staging in prior sessions) was deployed to production this session in the gated order: merge, migration plus verify, Worker plus verify, dashboard plus verify. Every verification gate passed. No behavior change at ship time: `auto_send_enabled` stays false and no stage is enabled, so the bot continues routing every draft to setter review exactly as before. Turning the master switch on or unlocking any stage is a separate Nella decision, deliberately not part of this deploy.

### What shipped

- **Worker enforcement** (`sales-bot/src/index.js`, commit `2351b1d`): `getBotSettings` now selects `stage_automation`; new `isStageUnlocked` helper; `resolveNextAction` takes the `stage_automation` map and gates AUTO_SEND on a per-stage human unlock (Layer 1), on top of the existing per-message safety guards (Layer 2). Closes the prior HIGH-intent bypass where HIGH intent could auto-send at any stage on confidence alone, including closing stages.
- **Dashboard** (`Settings.jsx` plus `stageReadiness.js`): per-stage readiness view and unlock controls. Force-on of a below-threshold stage now opens a confirmation dialog stating the stage's current clean rate and sample size, that it is below the 85% bar, and the plain-language risk; cancel writes nothing (commit `6df9278`). OFF stays frictionless and deletes the stage key, so a re-qualifying stage can resurface as eligible (no sticky hold).
- **DB migration 007**: adds `bots.stage_automation jsonb NOT NULL DEFAULT '{}'`. Idempotent (`ADD COLUMN IF NOT EXISTS`).

### Deploy record

- **Merge to main:** no-ff merge commit `e92cc33` (merged branch tip `6df9278`), pushed `4017df6..e92cc33`.
- **Migration on prod** (`rydkwsjwlgnivlwlvqku`): run by Anthony in the prod SQL editor ("Success. No rows returned"). Verified read-only: column present, BOT_ID row reads `stage_automation = {}`. DDL cannot go through the PostgREST service-role key and no Management API PAT was available here, hence the manual SQL-editor step.
- **Worker to prod:** `npx wrangler deploy` (top-level production config), version id `ca98e334-18cd-40b1-91ba-321f2d2836ef`. Smoke webhook (tester_ id, browser UA): HTTP 200, real Claude reply, resolved to `SEND_TO_INBOX_REVIEW` (master off), `review_insert.success=true`. Proves the new `stage_automation` SELECT works against prod and the live path is intact. Two tester rows created by the smoke (reviews plus conversations) deleted afterward; `tester_ship_prod*` confirmed 0 remaining.
- **Dashboard to prod:** `npm run deploy:production`. Bundle hash `index-BgkxXnMX.js` (1,118,078 bytes), deployment `7505f38d.botos-platform-3ar.pages.dev`. `verify-deploy [production]` confirms the live bundle calls `createClient` against `rydkwsjwlgnivlwlvqku` (prod), staging ref `hlpucysbaqerhwahfolg` matches 0.

### Production state at session close

- Worker: `ca98e334-18cd-40b1-91ba-321f2d2836ef` (per-stage unlock gate live, HIGH-intent bypass closed).
- Dashboard production: bundle `index-BgkxXnMX.js` at `botos-platform-3ar.pages.dev`.
- Bot config: `auto_send_enabled = false`, `stage_automation = {}` (nothing enabled, nothing eligible). Behavior identical to pre-deploy.
- main HEAD: merge commit `e92cc33` plus this PROGRESS.md docs commit.

### Flags

- A broad `tester_*` sweep on prod shows 222 reviews and 73 conversations of pre-existing historical test data from earlier sessions (e.g. `tester_step5_probe`). These predate this deploy and were left untouched; only this session's two smoke rows were cleaned. Candidate for a separate housekeeping pass.
- Column type, NOT NULL, and default for `stage_automation` are asserted from the migration DDL plus Anthony's success confirmation; PostgREST does not expose `information_schema` over the service-role key, so the row-level `{}` read is the available behavioral proof.


## 2026-06-03 - Learning-loop repair: retrieval fix + memory fix shipped to production

Two Worker-only, read-path fixes from the learning-loop diagnosis shipped to production tonight, each through its own gated deploy with a prod smoke verification. Both are read-path changes with NO new Supabase writes. The bot's normal behavior is intact: a real lead still gets one coherent reply routed to one inbox review (auto_send stays off).

### Deploy 1: stage-aware, deduped, reduced-count retrieval

Merge commit `2f11593` on main (branch `feat/retrieval-stage-aware-dedup`). Production Worker version `5718ce4d-3194-4e5c-b6e1-b1c7696f50c9`.

`fetchRelevantLearningsSemantic` now pulls a candidate pool (`match_learnings` threshold 0.3, count 15) and trims Worker-side once the lead's prior stage is known: normalize off-taxonomy stage names through a source-controlled `STAGE_NORMALIZATION` map, stage-prefer fill (same normalized stage first by similarity, then fill from the rest of the pool), near-duplicate dedup on corrected_reply text (threshold 0.9), trim to 5. No RPC signature change. The live `match_learnings` DDL is now captured under `db/functions/match_learnings.sql` for version control (function unchanged). Extra pool rows cost Supabase bandwidth only, never Claude tokens.

Staging A/B (carried from the build session): per-message learnings-block tokens down about 34 percent; stage-match up from about 55 percent to about 75 percent. Fewer, better-targeted lessons at lower per-message cost. Prod smoke: HTTP 200, real reply, tail showed `[retrieval] pool=15` then `[retrieval-select] pool=15 selected=5`.

### Deploy 2: reconcile KV memory with the actually-sent text

Merge commit `ba56692` on main (branch `feat/memory-reconcile-sent-text`), merged on top of the retrieval merge. The `sales-bot/src/index.js` overlap auto-merged cleanly (no conflict markers); post-merge `node --check` passed and both features were confirmed present (retrieval `STAGE_NORMALIZATION` / `selectStageAwareLearnings` AND the memory `reconcileMemoryWithSentText` helper, the read-fold, and the call site). Production Worker version `d7cfe230-d576-4f26-b957-89f59d4cf56a`.

The Worker reads KV memory as the per-turn history and never reconciled it against the conversations DB, so the bot read back its own original draft instead of what the lead actually received. Now, each turn, the recent assistant turns (bounded to the last 10) are reconciled against `conversations.messages`: edited/approved drafts are swapped in by `review_id` (this also self-heals stale drafts on the next turn), and manual replies (`manual:true`, no `review_id`) are merged in timestamp order so the bot sees the human reply. The `messages` read is folded into the existing priorStage fetch (no extra round trip); the reconciled memory persists via the pre-existing `MEMORY_STORE.put`. No new write, tokens neutral. Prod smoke: turn 1 HTTP 200; turn 2 HTTP 200 with `[memory-reconcile] swapped=0 mergedManual=0 dbMsgs=1` (read-fold runs cleanly) and `[retrieval-select] priorStage=GOAL normalized=GOAL pool=4 selected=4` (stage-aware select with a real stage).

Rollback reference: prior prod version `ca98e334-18cd-40b1-91ba-321f2d2836ef`. Operational rollback is `wrangler rollback` (immediate previous). All prod smoke tester rows (`tester_prodverify_*`) were deleted; 0 remain.

### IMPORTANT: the prompt rebuild is still pending and is the missing third piece

These two fixes make corrections reach the bot reliably and compound in-thread, but they do NOT resolve the core reason Nella still feels the bot ignores corrections. The 2026-06-03 contradiction investigation found the system prompt hardcodes absolutes that out-argue the injected corrections every turn (the prompt's hard rules are always-on; a correction only competes if it is retrieved that turn). Until the prompt rebuild ships, the bot may still appear to ignore corrections.

The prompt rebuild is blocked on Nella answering three questions:
1. Longer replies yes/no: should the bot be allowed to send replies longer than the lead's message to add expert insight? The prompt currently forbids this ("never exceed the length of their message", "whoever talks the most loses"), but she corrects toward longer expert-insight replies more often than shorter ones.
2. LONGEVITY keyword: confirm it is a HIGH-intent keyword and provide the exact standard reply. The prompt does not mention LONGEVITY at all, so she has to re-teach it via corrections every time.
3. BOMBER opener: confirm the correct opener wording. The prompt hardcodes one BOMBER opener that diverges from the one she repeatedly corrects toward.

### ROADMAP (deferred): Safe prompt editing for Nella

Context: the 2026-06-03 prompt contradiction investigation found the system prompt hardcodes absolutes that fight setter corrections (length law vs taught longer expert replies; LONGEVITY keyword missing; BOMBER opener divergent; internal self-contradictions from 6 prompt versions). Root process cause: Nella edits the raw prompt via the dashboard PromptEditor with ZERO validation; this accumulates contradictions and a renamed header can silently drop a lazy-loaded section (incl GUARDRAILS).

Deferred work (revisit AFTER the prompt rebuild ships; OWN item, NOT part of the learning-fix deploy), sequence smallest-first:
  1. Editor validation: on save, warn/block if a required section header (ALWAYS_ON_SECTIONS + expected SECTION:STAGE_* markers) is missing or renamed.
  2. Separate editable content (persona, per-stage scripts, openers) from load-bearing scaffolding (section markers, correction-precedence framing, guardrails).
  3. (Later/optional) Conflict flagging on save.

Also still open (logged, not scheduled): capture-successful-approvals as a learning signal; fail-open-empty retrieval alerting (Voyage failure -> silent no-corrections); prod tester-data cleanup (222 reviews/73 conversations); dead intent_definitions decision (never wired, never editable); cost-per-message analysis (parked, needs daily message counts).

## 2026-06-03 (later) - Keyword_longevity / Keyword_power intent recognition shipped to production

Nella is adding two ManyChat tags (set as lead_source): `Keyword_longevity` and `Keyword_power`. The Worker did not recognize them, so their intent went unclassified. This small Worker-only change makes the Worker classify them. Merge commit `dd198e3` on main (branch `feat/keyword-longevity-power-intent`). Production Worker version `2dee7da4-9964-4ef2-9c9f-5e910233e599`. Prior version for rollback: `d7cfe230-d576-4f26-b957-89f59d4cf56a` (wrangler rollback is the operational path; the deployments-list call errors on the dual-account quirk).

### What changed (+2/-1 in classifyIntentFromLeadMessage)

- **Keyword_longevity = HIGH**, mirroring bomber exactly: added `/longevity/i` to the highSignals regex list. Intent is assigned by regex against lastUserMessage, and for keyword-only events the Worker sets message = lead_source, so the tag string flows through the same path. bomber's HIGH comes solely from its `/bomber/i` message regex; there is no separate lead_source-to-intent path, so this is the faithful mirror. The first-message safety net does not reset it because detectedIntent is HIGH.
- **Keyword_power = LOW** (lead magnet): added the literal token `keyword_power` to the magnet low-signal regex (`/hipflow|15min|speedandpower|keyword_power/i`). Deliberately used the exact tag token rather than a bare `/power/` so that legitimate "more power / distance" goal messages are NOT misclassified as LOW magnet leads.
- Prompt untouched (how the bot talks to these leads is the separate prompt rebuild). No new Supabase write, ctx.waitUntil untouched, token-neutral.

### Production smoke (version 2dee7da4)

- lead_source=Keyword_longevity (keyword-only) -> lead_intent HIGH.
- lead_source=Keyword_power (keyword-only) -> lead_intent LOW.
- control lead, neither token -> unchanged (LOW, coherent reply; the new regexes do not match it).
All HTTP 200. Tester rows deleted, zero remain.

### Known limitation

Classification fires for keyword-only events (where message = lead_source). If a longevity or power lead instead sends a real free-text message alongside the tag, the tag's intent signal is not captured, the same limitation bomber already has, because there is no separate lead_source-to-intent path. Building that path would be a larger, separate change.

## 2026-06-05 - System prompt rebuild deployed to production (DB write, not a Worker deploy)

The rebuilt Coach Shaun system prompt is live on production. This was a write to the production bots row `system_prompt` (BOT_ID ...0002, ref rydkwsjwlgnivlwlvqku), not a Worker code change. It resolves the prompt contradictions that the 2026-06-03 investigation traced as the dominant cause of "the bot ignores my corrections."

### What changed
- **Three-tier override precedence** stated near the top and reinforced in the corrections framing: Tier 1 FIRM (safety guardrails + the anti-stacking rule, corrections cannot override), Tier 2 deferring defaults (style/approach, setter corrections win), Tier 3 scripts (illustrations, overridable, must obey Tier 1).
- **ONE THING PER MESSAGE (Tier 1 firm):** one move per turn, the question MAY be a this-or-that two-option choice, but no stacking separate questions or a standalone statement plus a separate question. This fixes the screenshot bug (customer 222742523) while keeping the this-or-that format Nella uses.
- **This-or-that format kept** throughout (an earlier draft had wrongly de-optioned to single questions; reversed).
- **Nella's exact openers** baked in: BOMBER, LONGEVITY, GLUTES, POWER (two-message), GOAL three-option opener, PRIORITY now-or-later.
- **Medical-claims guardrail** added (Tier 1): no medical or diagnostic claims or cure promises; speak to movement, mobility, performance.
- Length stated once (Tier 2 default, never longer than the lead); opt-out vs nurture scoping fixed; "got it" example fixed; ICP trimmed.

### Token impact (cheaper)
Total 17,540 -> 16,824 chars (~4,385 -> ~4,206 tok, about -179). Always-on sections (load every message) ~2,575 -> ~2,335 tok (about -240). The ICP trim more than absorbed the new precedence statement and medical guardrail. Net cheaper per message.

### Deploy record
- Pre-flight: prod prompt md5 confirmed unchanged at `7d7729977af543b3899d27bd09dc6933` before write; backed up to `prod_prompt_backup_2026-06-05.txt` (repo root, rollback source, md5 match confirmed).
- Extracted deployable prompt md5 `c0fab087ef64eb05110a3e59ff417806`, byte-identical to the staging-validated prompt. Integrity check: 17/17 headers present, names exact.
- Wrote to prod bots row; re-read md5 confirmed `c0fab087...`. Inserted `prompt_versions` row, label "v27 rebuild 2026-06-05: precedence tiers, anti-stacking, Nella openers, follow-up default".

### Validation (staging earlier, then prod smoke today)
- Staging: this-or-that kept, no stacking, precedence working (a style correction overrode the default; safety + opt-out + anti-stacking held firm), 17/17 sections loaded.
- Prod smoke (tester rows, deleted after): (a) all always-on sections load, no failure; (b) this-or-that used (power, glutes); (c) anti-stacking holds, the squats/never-trained DIAGNOSTIC turn returned one message, one question; (d) openers fire, LONGEVITY exact + HIGH, GLUTES exact + LOW, POWER LOW this-or-that, BOMBER HIGH (the bot used the setter-corrected bomber opener, which is precedence working as designed: prod has many bomber corrections that as Tier 2 override the Tier 3 script opener); (e) replies short; (f) cure request refused (medical guardrail held). No rollback needed.

### Known pending item (flagged)
The FOLLOW-UP line is a DEFAULT awaiting Nella's confirmation: "No worries. When you are ready, what is the main thing you would want to improve, distance, consistency, or playing without the aches?" (free-content offer dropped to respect the opt-out guardrail). When she confirms her wording, a small separate prompt update will swap her version in.

### Notes
- Production Worker code unchanged (still version 2dee7da4 from the longevity/power deploy). This was prompt-only.
- Staging bot left on the rebuilt prompt for inspection. Full draft and rationale in `db/prompts/rebuild_proposal_2026-06-03.md`.

## 2026-06-05 (later) - Bomber opener cleanup + follow-up blocker-probe + recency-preference (prod)

Three approved production changes in one gated pass. Worker code unchanged; this was learnings data plus a prompt update.

### Action 1: deleted 18 bomber opener-competing learnings
Removed 18 HOOK/ENTRY bomber corrections that taught an opener competing with Nella's mandated BOMBER opener (12 bucket-A greeting/permission variants + 6 bucket-C bare "what are you working on" qualifiers). All 18 backed up first (complete rows incl embeddings) to learnings_bomber_deletion_backup_2026-06-05.json (md5 c26aa708...). Verified: 18 deleted, 0 remain, total bomber-mentioning learnings dropped 33 to 15, bucket-B keepers intact (incl the LONGEVITY row f6a9ecb9). Reversible from the backup file.

### Action 2: follow-up line replaced with a data-grounded blocker-probe
Old (the default we wrote): "No worries. When you are ready, what is the main thing you would want to improve, distance, consistency, or playing without the aches?"
New: "No worries mate. Out of curiosity, whats holding you back from working on your game right now, is it more the timing or more that its just not a priority yet?"
Grounded in her real FOLLOW-UP reviews (the "No worries" + blocker-probe this-or-that pattern). Still flagged as awaiting Nella's final confirm; the "flagged for Nella" status is tracked here, not inside the live prompt (kept clean so the model does not read meta-notes).

### Action 3: recency-preference wording added
Appended to the precedence statement: "When two of the provided corrections conflict for the same situation, prefer the most recently created one." Worded to govern how the bot weighs the corrections it is given, not to claim access to unseen ones.
KNOWN LIMITATION (flag for Anthony): the injected learnings section currently lists corrections in similarity order with no dates or recency markers, so the model cannot actually tell which correction is most recent. This instruction is therefore inert until retrieval injects corrections with recency/order info (a future retrieval tweak). Added as approved, but it will not change behavior on its own yet.

### Prompt deploy record
Pre-edit prod md5 confirmed c0fab087...; backed up to prod_prompt_backup_2026-06-05b.txt (md5 match). Two edits only (line diff confirmed: the precedence line gained the recency sentence; the follow-up line was replaced). 17/17 headers unchanged. New prod prompt md5 dcb152b8f6bed6b4dda32fadd231965d, read-back confirmed. prompt_versions row inserted, label "v28: follow-up blocker-probe, recency-preference, bomber openers cleaned".

### Smoke (prod, tester rows deleted after)
- BOMBER opener now returns the exact mandated opener "Hey! Thanks for writing me BOMBER on my post. Mind if I ask you a few questions to see if I can help?" (HIGH), not the old "Saw you commented Bomber..." wording. Confirms the deletion took effect.
- Normal lead (sore back) got a coherent DIAGNOSTIC reply. Non-breakage confirmed.

### Pending / flags
- FOLLOW-UP blocker-probe still awaiting Nella's confirm (swap her exact wording when given).
- Recency-preference line is inert until corrections are injected with recency/order (future retrieval change).
- Production Worker code unchanged (still version 2dee7da4).
