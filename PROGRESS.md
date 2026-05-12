# BotOS / Mu - Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Nothing. Three production changes shipped 2026-05-12: migration 006 (`conversations.last_followup_source` column plus partial index `idx_conversations_followup_eligibility`), patched Worker with Priority 3 cron handler, and `wrangler.toml` with hourly cron schedule for production. First production cron tick fires at the top of the next UTC hour after deploy (21:05 UTC). Watching the first 24 hours of cron ticks for follow-up volume and any error signals.

**Production state:** Worker version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4` (deployed 2026-05-12 21:05 UTC from `main` at commit `b7b70a4`, includes prompt caching, race-fix, empty-system-block guard, Priority 3 cron handler with `scheduled()` entry point, `/__cron-test` staging-only debug endpoint). Cron schedule `0 * * * *` active. Dashboard at commit `a7ec441` (deployed 2026-05-09, bundle `index-BRUtjbJE.js`). `reviews.lead_intent` column present (migration 005). `conversations.last_followup_source` column and `idx_conversations_followup_eligibility` partial index present (migration 006). Make Scenario 1 `8264588` has router structure with Branch B for missing-username leads (last updated 2026-05-11 18:27 UTC). Coach Shaun's bot serving live leads.

**Staging state:** Worker version `ec5d9b28-4cc8-4cfa-b48c-391f77b03ce3` (deployed 2026-05-12 from `main` at commit `b7b70a4`, same Priority 3 patch as production but with empty `crons = []` so the cron handler is in code but does not fire automatically). Dashboard last redeployed 2026-05-09 (bundle `index-Drhe6KdK.js`). Migrations 005 and 006 present. `feat-prompt-caching` branch retained at `0a461c7` for rollback reference. Previous staging Worker `b23f9121-f660-4260-bacd-94f4ad914345` (pre-Priority-3) retained in Cloudflare version history.

**Open monitoring items:** see "Post-deploy monitoring" at the top of NEXT UP.

---

## NEXT UP

The next session should pick up these items in order. Priority 3 (T+20h auto follow-up) shipped this session, see COMPLETED. The monitoring item below is the first thing to check next session.

### [ ] Post-deploy monitoring: Priority 3 first 24h

Things to verify in the next session, in order:
- Cloudflare Worker logs (`npx wrangler tail` from `sales-bot/`) for the first few cron ticks after 22:00 UTC 2026-05-12. Each tick should log a line starting with `[cron] tick at ...` and ending with `[cron] done. examined=N sent=M skipped=...`. If a tick logs `[cron] eligibility query failed` or `[cron] uncaught:`, investigate the Worker-side error.
- Make Scenario 2 execution history (Make UI) for new runs we did not manually trigger. These are the cron-driven sends. Each should complete successfully (status 1). If many show status 2 or 3, check the bundle payload structure: the cron sends `[{ text: "Name?", typing_delay_ms: 1000 }]` not the typing-delays-with-multiple-messages format Scenario 2 normally sees.
- Production Supabase: `SELECT customer_id, profile_name, followup_count, last_followup_source, updated_at FROM conversations WHERE last_followup_source = 'auto' ORDER BY updated_at DESC LIMIT 20;`. After 24 hours this should show a handful of auto-followed-up leads.
- Inbox spot-check: leads with `followed_up = true AND last_followup_source = 'auto'` should appear in the dashboard's Follow Ups tab once their `last_user_message_at` crosses 23h (the dashboard's `IG_WINDOW_HOURS` threshold).
- Email watch: `iamanthony1007@gmail.com` for Make Scenario 2 alert emails about delivery failures. A small number (under 5%) is normal; a flood means something's wrong.

**Decision point:** after 48 hours of clean cron operation, the post-deploy watch can be closed. If anything is misbehaving, design a fix.

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

### [ ] Priority 3 dashboard pass: show `last_followup_source` in inbox UI

**State:** Worker side complete. Dashboard does not yet read `last_followup_source` and does not yet write `'manual'` when the setter clicks the "Mark as followed up" button.

**What to do:**
- Update `dashboard/src/pages/Inbox.jsx` to pull `last_followup_source` in the conversations select (line ~142).
- Show the source as a small pill in the lead detail header: "auto x1" or "manual x1".
- Update `markAsFollowedUp()` (line ~700) to set `last_followup_source: 'manual'` in the PATCH payload.
- Deploy dashboard via `wrangler pages deploy dist --project-name=botos-platform`.

**Why deferred:** dashboard and Worker ship through different pipelines. Splitting the deploy limits blast radius.

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
- **Wrangler upgrade (deferred):** local `wrangler` is at `4.65.0`; latest is `4.90.0`. Upgrade is a separate maintenance task.
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

*Last updated: 2026-05-12 (Priority 3 shipped: migration 006, Worker `7b4862bc`, cron `0 * * * *` active in production; staging Worker `ec5d9b28`; post-deploy monitoring scheduled for next session).*

---

## SESSION PICKUP PROMPT

*This block is designed to be pasted as the first message of the next session.*

PASTE THIS:

> I'm Anon_Techie continuing work on the BotOS / Mu AI sales bot for Coach Shaun. You have full project knowledge including PROGRESS.md and SYSTEM-AUDIT.md.
>
> The last session (2026-05-12) shipped Priority 3: T+20h auto follow-up via Cloudflare cron. Migration 006 applied to both staging and production Supabase (added `conversations.last_followup_source` text column and partial index `idx_conversations_followup_eligibility`). Patched Worker deployed to production as version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4` (commit `b7b70a4`) with hourly cron schedule. Staging Worker at `ec5d9b28-4cc8-4cfa-b48c-391f77b03ce3` with cron handler in code but `crons=[]` so manual test only via GET `/__cron-test`. Full end-to-end verified on staging with synthetic test row.
>
> Tonight I want to work on **[FILL IN: post-deploy monitoring / priority 1 / priority 2 / priority 3 dashboard pass / priority 4 / something else]**. Read the relevant section in PROGRESS.md.
>
> Production state right now: Worker version `7b4862bc-bb15-4a19-87ef-7aacc14ad6f4`, cron `0 * * * *` active, dashboard at `a7ec441` (unchanged, dashboard pass still pending), Make Scenario 1 has router structure (unchanged), Make Scenario 2 unchanged. Coach Shaun's bot serving live traffic.
>
> Remember the standing rules:
> - No em dashes anywhere in any output.
> - `ctx.waitUntil` stays for Supabase writes (never `await`).
> - PROGRESS.md is the single source of truth; update at end of session.
> - Staging deploys before production.
> - I have zero coding experience; deliver complete files and step-by-step instructions, not diffs or partial edits.

END PASTE.