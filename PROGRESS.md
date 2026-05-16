# BotOS / Mu - Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Critical bug discovered tonight (2026-05-13) during post-deploy monitoring of Priority 3. The cron is writing the DB flag (`last_followup_source='auto'`, `followup_count=1`, `followed_up=true`) but NOT actually sending the follow-up DM to the lead. Confirmed on production lead `bradgov313` (customer_id 603832635): DB row marked auto-followed-up, but the conversation's `messages` JSONB has no T+20h follow-up text; the thread ends at the bot's own 14:55 UTC DM from the normal flow. The row's `updated_at` also stayed at 13:55 UTC, suggesting the PATCH wrote the three flag columns but the JSONB append and the Make Scenario 2 dispatch either failed silently or were never attempted. 10 production rows currently flagged `last_followup_source='auto'`; none have actually received the IG DM. Top priority for the next session is investigating the `scheduled()` handler in `sales-bot/src/index.js`, specifically the Make Scenario 2 dispatch and the messages-JSONB append.

**Production state:** Worker version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4` (deployed 2026-05-12 21:05 UTC from `main` at commit `b7b70a4`, includes prompt caching, race-fix, empty-system-block guard, Priority 3 cron handler with `scheduled()` entry point, `/__cron-test` staging-only debug endpoint). Cron schedule `0 * * * *` active but flagging only, NOT sending (see "Currently in progress" above). Dashboard at commit `6fc0f54` (deployed 2026-05-13 via Cloudflare Pages project `botos-platform`, deploy hash `caa2a57e`, bundle `index-JIvVZDjR.js`, served at domain `botos-platform-3ar.pages.dev`). `reviews.lead_intent` column present (migration 005). `conversations.last_followup_source` column and `idx_conversations_followup_eligibility` partial index present (migration 006). Make Scenario 1 `8264588` has router structure with Branch B for missing-username leads (last updated 2026-05-11 18:27 UTC). Coach Shaun's bot serving live leads.

**Staging state:** Worker version `ec5d9b28-4cc8-4cfa-b48c-391f77b03ce3` (deployed 2026-05-12 from `main` at commit `b7b70a4`, same Priority 3 patch as production but with empty `crons = []` so the cron handler is in code but does not fire automatically). Dashboard at commit `6fc0f54` (deployed 2026-05-13 via Cloudflare Pages project `botos-platform-staging`, deploy hash `75847182`). Staging Pages project env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` now correctly point at staging Supabase (`hlpucysbaqerhwahfolg.supabase.co`); this was set up tonight, before this session the staging Pages project had no env vars and any vite build there would have fallen back to whatever was in `dashboard/.env` (which is production). Migrations 005 and 006 present. `feat-prompt-caching` branch retained at `0a461c7` for rollback reference. Previous staging Worker `b23f9121-f660-4260-bacd-94f4ad914345` (pre-Priority-3) retained in Cloudflare version history.

**Open monitoring items:** see "CRITICAL: Priority 3 cron writes flag but doesn't send" and "BUG: Lead-source-event re-fires cause duplicate or regenerated drafts" at the top of NEXT UP.

---

## NEXT UP

The next session should pick up these items in order. The CRITICAL item below is the most urgent and blocks closing the Priority 3 post-deploy watch.

### [ ] CRITICAL: Priority 3 cron writes flag but does NOT send the DM

**State:** Discovered during post-deploy verification on 2026-05-13. The hourly cron is updating Supabase with `followed_up=true`, `followup_count=1`, `last_followup_source='auto'` on eligible rows, but the lead never receives the T+20h IG DM. Production currently has 10 conversation rows with `last_followup_source='auto'`; none have an assistant-role follow-up message appended to their `messages` JSONB and none received the DM through ManyChat.

**Evidence:**
- Production lead `bradgov313` (customer_id 603832635): DB row shows `followed_up=true`, `followup_count=1`, `last_followup_source='auto'`. The conversation's `messages` JSONB ends at the bot's own 14:55 UTC DM from the normal conversation flow, with no T+20h follow-up text appended. The row's `updated_at` is 13:55 UTC, NOT bumped by the cron's PATCH despite the three flag columns being updated. This is consistent with the PATCH succeeding for the flag columns while the JSONB append and the Make Scenario 2 dispatch either failed silently or were never attempted.
- 10 rows in production with `last_followup_source='auto'`, 0 with corresponding follow-up text in `messages`.

**Where to investigate (in order):**
1. `scheduled()` handler in `sales-bot/src/index.js`, specifically `runFollowUpCron(env, ctx, Date.now())`. Read the function end-to-end and trace what fires before the PATCH. The PATCH writes the three flag columns; everything that should happen before it (the `sendToMakeScenario2` call, any `messages` JSONB append) is the suspect zone.
2. Make Scenario 2 execution history (Make UI): filter the last 24 hours for runs originating from the Worker cron path (not from manual setter clicks or the normal bot flow). If there are none, the Worker is never reaching the dispatch and the bug is upstream of the HTTP call.
3. `messages` JSONB append: the cron should append an assistant-role message with the follow-up text. If this path was never wired up (the original Priority 3 spec described it but the code may have been simplified to PATCH the three flag columns only), this is the silent failure.
4. `npx wrangler tail` from `sales-bot/` around the top of the hour (UTC) to see live logs from the handler on the next cron tick.

**Likely outcome:** Worker code change to actually dispatch Scenario 2 and append the message, then a remediation step to reset the 10 incorrectly-flagged production rows back to `followed_up=false`, `followup_count=0`, `last_followup_source=NULL` so they become eligible again. Staging cron does not fire automatically, so testing will go via the `/__cron-test` debug endpoint as before.

**Why this is critical:** The cron silently over-counts follow-ups and removes leads from the dashboard's Closest to Booking list (which excludes `followup_count >= 2`) without ever having reached out to them. Leads can go cold without anyone noticing because the dashboard reports them as followed up. This is a production data-integrity issue, not just a missing feature.

**Status of original Post-deploy monitoring item:** Closed by the discovery of this bug. Monitoring did its job: a silent failure invisible from the DB flag columns alone was caught by manual inspection of `messages` JSONB alongside the flag, then visually confirmed in the dashboard once the Priority 3 dashboard pass was live.

### [ ] BUG: Lead-source-event re-fires cause duplicate or regenerated drafts (Worker)

**State:** Real bug confirmed via code investigation 2026-05-15. Symptom: setter sees the Suggested Reply panel render text that is identical or near-identical to a previously-sent assistant message in the same thread. Surfaced on production lead `@sethwallace33` (customer_id 190508016); Nella manually corrected by erasing the wrong suggestion and typing a proper reply. The bad pending row is gone now (overwritten by her edit), so the DB no longer carries direct evidence, but the bug pattern is reproducible by the code analysis.

**Root cause:** When ManyChat fires a keyword or comment `lead_source_event` for an already-engaged lead, Make Scenario 1 often passes the lead's PREVIOUS user message (via `last_input_text` resolution), not a new one. The Worker correctly recognizes the duplicate at `sales-bot/src/index.js:1005-1017` and sets `isDuplicateOfLastMessage=true`. But it does not early-return. It then:
1. Pushes a `lead_source_event` marker into memory with no `content` field (`sales-bot/src/index.js:1022-1031`).
2. Finds the recent pending review from the prior turn and decides to batch onto it (`sales-bot/src/index.js:1047-1065`).
3. Removes the last assistant message from memory.
4. Calls Claude again at `sales-bot/src/index.js:1173`.
5. Claude sees a context nearly identical to the previous turn, with one noisy `"You: undefined"` line added (from the contentless `lead_source_event` marker rendered at `buildDeveloperPrompt`, `:156`).
6. With temperature 0.7, Claude often returns text identical or near-identical to its previous draft.
7. The fresh `joinedReply` overwrites `bot_reply` on the existing pending review.

**Contributing factor (separate but related):** The Worker's KV memory always stores the ORIGINAL Claude draft as the bot's previous message, never the setter's edited version sent through Make Scenario 2. So Claude is always working from a falsified history of what the bot actually said. This compounds the duplicate-context problem and may cause subtle drift in long conversations even outside `lead_source_event` scenarios.

**Production impact:**
- Bug is rare; only triggers on `lead_source_event` webhooks for already-engaged leads (keyword re-engagement, repeat comments on the same post, etc).
- Not silent. Setters see the wrong suggestion and correct it manually before sending. The end lead does NOT see duplicate or wrong messages.
- Wastes Claude API tokens on a regeneration that should be a no-op.

**Fix plan for next session (2 to 3 hours of work, single Worker change, staging-testable):**

1. Recommendation 2 from the 2026-05-15 investigation: when `isDuplicateOfLastMessage` is true AND `batchReviewId` is set, early-return at `sales-bot/src/index.js:1035` before pushing the marker, before the batching check, and before the Claude call. The existing pending review already represents the actual unanswered state. Optionally bump `conversations.updated_at` and append a `lead_source_event` marker so the inbox sees the re-engagement event, but skip the regeneration entirely.

2. Recommendation 3 from the same investigation: stop showing Claude a contentless marker. Either give `lead_source_event` entries a real `content` field like `"[System: lead engaged via X]"` or filter them out of the array passed to `buildDeveloperPrompt` at `sales-bot/src/index.js:2143`. Pick one and apply consistently.

3. Staging test: use the `/__cron-test` or a synthetic `lead_source_event` POST against staging Worker to confirm the early-return path is taken and no second pending review is created. The staging Worker version is `ec5d9b28-4cc8-4cfa-b48c-391f77b03ce3`, cron handler in code but `crons=[]`, so testable in isolation.

4. Production deploy: standard staging-then-prod with version capture.

**Deferred to a separate session: Recommendation 4 from the investigation.** Sync setter edits back to KV memory so Claude works from real conversation history rather than its own (possibly edited away) prior drafts. This is the architectural root-cause fix but spans Worker + dashboard and is a larger scope.

**Why this is NOT the #1 priority over the CRITICAL cron bug:**
- This bug fails visibly to setters; they correct it manually. The cron bug fails silently and creates production data-integrity issues (10 leads currently flagged as auto-followed-up with zero actual outreach).
- This bug has a known workaround (manual edit before send). The cron bug has no workaround.
- Both bugs probably take similar investigation time to fix; ordering by impact, cron first.

### [ ] Priority 1: Username resolution monitoring (no build work, just observation)

**State:** Shipped 2026-05-11. No code changes needed unless monitoring surfaces a problem.

**What to do next session:**
- Check production Anthropic billing dashboard for caching cost trend.
- Watch Make Scenario 1 executions over the past few days. Confirm Branch B is firing for missing-username leads.
- Check inbox for emails to `iamanthony1007@gmail.com` with subject `[Mu AI] ManyChat GetSubscriberInfo failed for subscriber...`.
- Spot-check the production dashboard inbox for leads that previously had "Instagram Lead" placeholders.

### [ ] Inbound visibility: capture coach's manual IG replies in dashboard

**Why:** Coach Shaun raised that Lead Wizard and GoHighLevel show the full conversation thread including replies he types manually from the IG app on his phone or in ManyChat Live Chat. Mu AI currently only sees messages that flow through the bot's automation pipeline, so manual replies are invisible and the dashboard has gaps. He sees this as a competitive disadvantage. Nella relayed the request 2026-05-13 and called it a top irritation point for the client.

**Current state:**
- Inbound lead messages arrive via ManyChat webhook → Make Scenario 1 → Worker → Supabase. Logged.
- Bot replies (drafted by the Worker, approved by setter in dashboard, sent via Make Scenario 2 → ManyChat → IG). Logged.
- Manual replies typed by Coach Shaun (or any team member) directly in the IG app on their phone: NOT logged. Never touch our pipeline.
- Manual replies typed in ManyChat's Live Chat: NOT logged. Currently bypass our webhook subscription.

**How competitors do it:** Both Lead Wizard and GoHighLevel use Meta's Instagram Messaging API `conversations` endpoint, which returns the full thread including any message regardless of who sent it. ManyChat itself reads from Meta's API for this reason, which is why Coach Shaun's manual replies appear inside ManyChat but not in Mu AI.

**Proposed fix (two parts, both needed):**

1. Subscribe to ManyChat's outbound-message webhook events. When Coach replies via Live Chat, ManyChat fires an event we currently don't listen for. Adding the subscription captures replies that go through ManyChat. Lower effort, narrower coverage.

2. Pull conversation history directly from Meta's Instagram Messaging API. This catches replies that bypass ManyChat entirely (typed directly in the IG app on the coach's phone). Higher effort, full coverage. Probably needs a periodic reconciliation job that, for each open conversation, fetches the recent Meta thread and merges any messages we don't already have into the `conversations.messages` JSONB.

**Open questions before scoping:**
- What Meta App permissions does Coach Shaun's IG business account currently have? Need `instagram_basic`, `instagram_manage_messages`, possibly `pages_messaging` depending on whether the IG account is connected to a Facebook page. To be confirmed with Nella.
- How frequently does Coach Shaun reply via IG app on phone vs. ManyChat Live Chat vs. letting the bot handle it? Affects which path is the higher-impact win. To be confirmed with Nella.
- Rate limits on Meta's API for the `conversations` endpoint. Need to research before designing the reconciliation interval.
- Conflict handling: if the bot drafts a reply while Coach is also typing one manually, who wins? Two messages going out is worse than a small dashboard gap.

**Estimated scope:** Likely 2-3 sessions: one to add the ManyChat outbound webhook subscription (quick win that closes the gap for ManyChat Live Chat users), one to integrate Meta's `conversations` API and the reconciliation logic, one for testing and edge case handling.

**Not blocking other work:** The bot's primary path (draft, approve, send) is unaffected by this gap. Existing customers can use Mu AI as a setter-review platform without it. Coach Shaun's complaint is about audit and visibility, not functionality.

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
4. The production visual verification is what surfaced the Worker-side cron bug separately captured under NEXT UP CRITICAL. The dashboard correctly displays what the Worker wrote; the Worker is writing the flag without sending the DM.

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
- Post-filter (JS, per candidate): last message in conversation is from the bot; last user message is in the 20-21h window (defense against `updated_at` being bumped by non-message writes); bot's last message does not contain a booking link or escalation handoff phrase; lead is not a tester (soak prefix, tester prefix, hardcoded set, or `bot tester` username); `profile_name` is non-empty.
- On match, calls `sendToMakeScenario2(customer_id, [{ text: "${name}?", typing_delay_ms: 1000 }], [1000])`, then `ctx.waitUntil(PATCH conversations set followed_up=true, followup_count=1, last_followup_source='auto')`.
- Safety cap: 50 sends per cron run. 200ms sleep between sends.
- Idempotency: `followed_up=true` is part of the eligibility filter, so a followed-up row will not be picked up again on the next tick.

**Schema (migration 006):**
- `conversations.last_followup_source text NULL`. Values: `'auto'` (cron) or `'manual'` (dashboard button, to be wired in a follow-up).
- `idx_conversations_followup_eligibility ON conversations (bot_id, updated_at) WHERE followed_up=false AND for_coach=false AND conversation_stage <> 'BOOKED'`. Partial index keeps the hourly scan cheap on a 4,664-row table.

**Worker code (commit `b7b70a4`):**
- 6 new helpers: `isTesterLeadForCron`, `extractLastUserAndBotMessage`, `containsBookingLink`, `looksLikeEscalationHandoff`, `resolveFollowUpName`, `runFollowUpCron`.
- `scheduled()` handler on `index_default`.
- Staging-only `GET /__cron-test` debug endpoint gated by `env.ENVIRONMENT === "staging"`. Production returns 404.

**Wrangler config (commit `b7b70a4`):**
- Production: `[triggers] crons = ["0 * * * *"]`.
- Staging: `[env.staging.triggers] crons = []` so the handler is in code but does not fire automatically.

**Verification path:**
1. Migration 006 applied to staging Supabase. Column and index confirmed present via `information_schema` and `pg_indexes`. All 26 staging rows had `last_followup_source = NULL`.
2. Patched Worker deployed to staging (version `ec5d9b28-4cc8-4cfa-b48c-391f77b03ce3`). Smoke tests passed: OPTIONS 200, `/__cron-test` returned valid JSON with `examined: 0` (no leads in the window initially).
3. Synthetic test row seeded in staging Supabase: `customer_id = 1111111111`, `profile_name = TestLead`, `conversation_stage = INSIGHT`, last user message at T-20h31m, last bot message at T-20h30m, `updated_at = NOW() - 20h30m`. Eligibility verification query confirmed the row matched the exact filter the cron would use.
4. `/__cron-test` invoked. Response: `examined: 1, sent: 1, capped: false`, all skip counts 0. Make Scenario 2 webhook fired with `customer_id: 1111111111` (which ManyChat rejected downstream because it's not a real subscriber, generating one alert email to `iamanthony1007@gmail.com` from Scenario 2's onerror chain, as expected). Database row updated to `followed_up: true, followup_count: 1, last_followup_source: 'auto'`. `updated_at` unchanged (PATCH only touched the three target columns).
5. `/__cron-test` re-fired immediately. Response: `examined: 0, sent: 0`. Idempotency at the DB filter level confirmed.
6. Migration 006 applied to production Supabase. Production has 4,664 conversation rows; all have `last_followup_source = NULL` post-migration.
7. Patched Worker deployed to production (version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4`) with `npx wrangler deploy --env=""`. Cron schedule `0 * * * *` registered. Production `/__cron-test` correctly returned 404 (env guard works). Production fetch handler still serving normal traffic.
8. Synthetic test row in staging cleaned up via DELETE.

**Trade-offs and design notes:**
- Dropped the `escalation_reason IS NULL` criterion from the original spec because `escalation_reason` lives on `reviews` not `conversations`. Replaced with pattern-matching on the bot's most recent message text for handoff language ("I'll get Shaun to", "let me pass you to", "a human will", etc.).
- Dropped the `conversations.followed_up_at` column from the original spec because the existing `followed_up` boolean already answers the idempotency question. Avoids two sources of truth.
- No fallback from `profile_name` to `username`. The original spec proposed a fallback to `conversations.name`, but that column does not exist. Falling back to `username` would result in messages like `@captain.wilko?` which is awkward. Lead without `profile_name` is skipped entirely (`skipped.no_profile_name++`).
- Worker source file `sales-bot/src/index.js` is bundled style (uses `__name` shims and `index_default` indirection). Edits are made directly to this file, no separate build step. Confirmed by inspecting `package.json` (no build script) and the absence of `dist/` or `build/` directories.
- File on disk uses CRLF line endings. The patcher script (`patch_worker_priority3.py`) explicitly handles CRLF.

**Known caveats / monitored items:**
- The auto-follow-up "James?" message bypasses the existing review workflow. It does not write a `reviews` row. The setter cannot see in advance that the bot is about to follow up. The dashboard Follow Ups tab will show the lead after T+23h if they did not reply, which is the audit surface.
- A Branch B lead whose ManyChat `GetSubscriberInfo` did not resolve `profile_name` (unlikely but possible) will be skipped by the cron. We log `skipped.no_profile_name` so this is quantifiable.
- The first cron tick after deploy may include leads whose `updated_at` is in the eligibility window because of writes from `pre_followup_stage` resets or other non-user-message updates. The JS post-filter on actual last user message timestamp catches these.

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

- **Pre-existing em-dash count in `sales-bot/src/index.js` is 23.** All in strings/comments (log messages, doc comments, email subject lines). None in code paths that emit messages to leads (the `sanitizeBotMessage` function strips em-dashes from any bot reply before send). Cleanup is a code-hygiene task, not a behavioral one. Schedule for a future session.
- **`sales-bot/node_modules/.cache/wrangler/wrangler-account.json` is tracked by git.** This file contains wrangler OAuth state and should not be in version control. The 2026-05-12 `wrangler login` rotated the file, surfacing this issue. Next session: `git rm --cached sales-bot/node_modules/.cache/wrangler/wrangler-account.json` to untrack, then verify `.gitignore` actually excludes the whole `node_modules/` tree. **Also: audit git history for any prior commits of this file; if OAuth secrets were ever committed, they should be considered exposed and rotated.**
- **Local tooling scripts at the repo root.** `patch_worker_priority3.py` and `diagnose_index_default.py` are one-shot scripts from the 2026-05-12 session. They are useful as future reference. Either commit them to a `tools/` directory or add them to `.gitignore`. Currently untracked.
- **Wrangler upgrade (deferred):** local `wrangler` is at `4.73.0`; latest is `4.90.1`. Upgrade is a separate maintenance task.
- **`dashboard/.env` and `dashboard/.env.staging` are tracked in git.** Both files contain Supabase URLs and anon keys. Anon keys are designed to be public and are RLS-gated, so this is not a credential leak, but committing `.env` files is unusual and the root `.gitignore` already contains `.env`. The files were committed before that rule was added. Either untrack the files and document how setters bootstrap a local dev env, or accept the current state and remove the rule. Discussed 2026-05-13, no change made.
- **Cloudflare Pages project naming clarification.** Production Pages project is named `botos-platform`; the live domain is `botos-platform-3ar.pages.dev`. Earlier PROGRESS.md entries that referred to the project as `botos-platform-3ar` were referring to the domain prefix, not the project name. Corrected in tonight's STATUS block.
- **Staging dashboard Supabase wiring (resolved 2026-05-13).** FYI for future sessions: as of tonight the staging dashboard at Cloudflare Pages project `botos-platform-staging` correctly points at staging Supabase. Before tonight the Pages project had no env vars, so any vite build running there would have fallen back to `dashboard/.env` (production). Earlier "staging" UI testing may have been against production Supabase by accident.
- **Deploy ergonomics:** production deploys should pass `--env=""` to suppress the multi-environment ambiguity warning. Already followed for the 2026-05-12 deploy.
- **Phase 1.3:** Worker `/health` endpoint returns hardcoded `supabase_connected: true`. Needs real check.
- **Phase 3:** Logo asset URLs in dashboard hardcoded to production Supabase storage bucket.
- **Phase 4:** Remove dead `OPENAI_API_KEY` references from Worker.
- **Cleanup:** Delete leftover `iamanthony@gmail.com` row from staging `auth.users`.
- **Cleanup:** Soak rows `soak-2026-05-09-001..018` and the synthetic test rows under `race_test_phase_*`, `empty-suffix-*`, `99887766554433`, `staging-smoke-test-003`, `needs-response-ui-test-*` in staging conversations / reviews can be deleted whenever convenient.
- **Future task:** Capture production RLS policies into source-controlled SQL.
- **Open question:** Dashboard's "Test" filter classification logic.
- **Future improvement:** Separate Anthropic API key for staging Worker.

---

*Last updated: 2026-05-15 (code investigation confirmed a Worker bug where `lead_source_event` re-fires for already-engaged leads cause Claude to regenerate near-identical drafts that overwrite existing pending review rows. Surfaced via @sethwallace33; symptom reproducible by code analysis. Logged as the #2 NEXT UP item; ranked below the CRITICAL cron bug because it fails visibly to setters with a manual workaround. No code changes shipped this session).*

---

## SESSION PICKUP PROMPT

*This block is designed to be pasted as the first message of the next session.*

PASTE THIS:

> I'm Anon_Techie continuing work on the BotOS / Mu AI sales bot for Coach Shaun. You have full project knowledge including PROGRESS.md and SYSTEM-AUDIT.md.
>
> The last session (2026-05-13) shipped the Priority 3 dashboard pass: `dashboard/src/pages/Inbox.jsx` now reads `last_followup_source`, writes `'manual'` on setter-driven follow-ups, clears it on unmark, and renders an auto/manual pill in the lead detail header. Commit `6fc0f54` on `main`. Production dashboard deployed via Cloudflare Pages project `botos-platform` (deploy hash `caa2a57e`, bundle `index-JIvVZDjR.js`, served at `botos-platform-3ar.pages.dev`). Staging dashboard at deploy hash `75847182` on Pages project `botos-platform-staging`, env vars finally wired to staging Supabase.
>
> Tonight's priority is the CRITICAL item in PROGRESS.md NEXT UP: the Priority 3 cron is writing the DB flag but NOT sending the T+20h DM. 10 production rows are incorrectly marked auto-followed-up; no leads have actually received the IG DM. Investigation starts in `sales-bot/src/index.js` `scheduled()` handler and `runFollowUpCron`. See the CRITICAL section in NEXT UP for the full investigation plan.
>
> Production state right now: Worker version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4` (cron flagging but NOT sending, see CRITICAL), dashboard at commit `6fc0f54` / bundle `index-JIvVZDjR.js` / Pages deploy `caa2a57e`, Make Scenario 1 router structure unchanged, Make Scenario 2 unchanged. Coach Shaun's bot serving live traffic.
>
> New NEXT UP item added 2026-05-13 from Nella's client meeting: "Inbound visibility: capture coach's manual IG replies in dashboard". Sits between Priority 1 and Priority 2. Coach Shaun compared us unfavorably to Lead Wizard and GoHighLevel on this; treat it as the next feature work after the CRITICAL cron bug is resolved.
>
> Remember the standing rules:
> - No em dashes anywhere in any output.
> - `ctx.waitUntil` stays for Supabase writes (never `await`).
> - PROGRESS.md is the single source of truth; update at end of session.
> - Staging deploys before production.
> - I have zero coding experience; deliver complete files and step-by-step instructions, not diffs or partial edits.

END PASTE.