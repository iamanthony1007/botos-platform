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
