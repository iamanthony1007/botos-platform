# BotOS / Mu - Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Nothing. Two production changes shipped on 2026-05-09: Phase 1.2 (schema fix 1.2.1 + caching deploy 1.2.2) and an inbox UX fix (manual reply textarea now visible on the Needs Response tab). Watching Anthropic billing dashboard over the next 1-2 days separately to confirm input cost trend is downward from caching.

**Production state:** Worker version `1881c4ac-88e0-4b12-bf24-7fcd74572434` (deployed 2026-05-09 from merge commit `3964d10` on `main`, includes prompt caching + race-fix). Dashboard at commit `a7ec441` (deployed 2026-05-09, bundle `index-BRUtjbJE.js`, deployment URL `https://e54a1529.botos-platform-3ar.pages.dev`). `reviews.lead_intent` column present (migration 005). Coach Shaun's bot serving live leads. Traffic gap from 2026-05-07 21:38 UTC to 2026-05-09 ~21:00 UTC was a ManyChat or Make.com credit balance running out; topup restored upstream pipeline.

**Staging state:** Worker version `01d34c93-a8dd-41ff-8cad-3b6809217505` from `feat-prompt-caching` branch (unchanged). Dashboard last redeployed 2026-05-09 to verify the Needs Response UI change before production rollout (bundle `index-Drhe6KdK.js` at https://botos-platform-staging.pages.dev). `reviews.lead_intent` present (migration 005 applied 2026-05-09). `feat-prompt-caching` branch retained at `0a461c7` for rollback reference; also reachable from `main` via merge commit `3964d10`.

---

## NEXT UP

### [ ] 1.1.6 STAGING.md runbook (deferred, still applies)
Was the original "next up" before caching work jumped the queue. Now lower priority because caching has more business impact. Should still happen.

Write `STAGING.md` documenting:
- Environment URLs (Worker, dashboard, Supabase)
- Deploy commands for Worker and dashboard
- Staging Supabase fresh-setup procedure (apply `db/schema.sql`, then create test user, then re-run profile seed from migration 002)
- Verification protocol (JWT decode for any new env var pointing at Supabase; CSV export schema replication if production schema changes)
- Known gaps (RLS off in staging, no email provider, schema-drift risks)
- Test webhook command for ad-hoc smoke testing
- Soak harness: how to re-run the Phase 2 behavior soak (cases file, runner, report). Soak artifacts archived at `C:\Users\Order Account\botos-soak\`.

### [ ] Operational hardening (deferred until caching ships to production)
- Slack alert when Worker errors
- Reconciliation job for orphaned reviews / conversations
- Runbook for common production incidents

---

## COMPLETED

### [x] Inbox UX: manual reply textarea on Needs Response tab (2026-05-09)

**Result:** Live on production. Commit `a7ec441` on `main`. Production dashboard rebuilt and deployed to `botos-platform` Pages project, bundle `index-BRUtjbJE.js`. Deployment URL `https://e54a1529.botos-platform-3ar.pages.dev`, bare URL `https://botos-platform-3ar.pages.dev` confirmed serving the new bundle.

**Why:** the Needs Response tab surfaces leads whose last message is unanswered AND have no AI draft pending (typically because a prior review was discarded). Before this change, leads in this state were listed but the inbox UI offered no way to respond. Setters had to either ignore the lead, flag it as followed-up (which lied about what happened), or switch to Instagram/Business Suite to send the reply. The tab surfaced a problem with no in-product solution.

**Change:** single conditional in `dashboard/src/pages/Inbox.jsx` line 1416 (now 1421). Manual reply textarea was previously gated behind `filter === 'Follow Ups'`; the gate now also matches `filter === 'Needs Response'`. No other code changes. The `sendManualReply` function was already correct: it writes the assistant message to `conversations.messages`, which flips `user_sent_last` to false on the next `loadData` refresh, automatically removing the lead from the tab. The comment block above the gate was rewritten to explain the new dual-tab behavior.

**Verification on staging:**
1. Synthetic webhook against staging Worker (`customer_id=needs-response-ui-test-20260510091254`).
2. Pending review created.
3. Setter discarded the review in the staging dashboard.
4. Lead appeared in Needs Response tab.
5. Textarea visible at the bottom of the conversation thread.
6. Manual reply typed and sent: toast confirmed success, message appeared in thread with "Manual" tag, lead disappeared from Needs Response on the next refresh.
7. Regression checks: textarea still appears on Follow Ups, textarea correctly absent on Pending/All/Escalated/For Coach/Resolved/Test, no console errors.

**Verification on production:**
- Bundle hash match: built locally `index-BRUtjbJE.js`, served at deployment URL and at bare production URL (all three match).
- Real Needs Response leads checked in browser: textarea now visible, AI panel correctly absent (since `pending_count = 0`).
- Follow Ups tab: textarea still present (regression check).
- Pending tab: AI approve panel still present, no textarea (regression check).
- No console errors.

**Path that creates Needs Response leads (root cause analysis from this session):**
The most common path is review discard. When a setter clicks Discard on a pending review, `reviews.status` flips to `discarded`, but `conversations.messages` is not touched. The lead's last user message remains the most recent in `messages`, so `user_sent_last` stays true. `pending_count` becomes 0 because the review is no longer pending. Both conditions of `isNeedsResponseLead` are satisfied. Other possible paths (Worker errors writing partial state, AUTO_SEND-followed-by-new-user-message timing) are theoretically possible but less common.

**Related but not changed:** the for_coach exclusion, the tester filter, and the `isNeedsResponseLead` helper itself were not touched. The only behavioral change is what UI controls render when the user is on the Needs Response tab.

**Deploy ergonomics note:** wrangler 4.73.0 emits a warning if the working directory is dirty (`Your working directory is a git repo and has uncommitted changes`). Suppressed with `--commit-dirty=true` on the production deploy. The change was committed to git after both staging and production deploys verified working.

### [x] 1.2.2 Phase 3: Prompt caching deployed to production (2026-05-09)

**Result:** Live. Worker version `1881c4ac-88e0-4b12-bf24-7fcd74572434`, deployed from merge commit `3964d10` on `main`. `feat-prompt-caching` (`0a461c7`) merged into `main` via no-fast-forward merge commit. Bindings confirm production target: `env.ENVIRONMENT="production"`, `SUPABASE_URL` resolves to `rydkwsjwlgnivlwlvqku`. Previous version `335b133c-d07f-4693-a314-fbffd448fbe1` retained in Cloudflare's version history as rollback target.

**End-to-end verification:** synthetic 2-turn webhook against production (`customer_id=caching-deploy-verify-20260509205655`, since cleaned up from both reviews and conversations tables). Both turns returned HTTP 200. Tail observations:

- Turn 1 (cold): `[cache] model=claude-sonnet-4-6 input=2429 cache_create=10248 cache_read=0 output=537`
- Turn 2 (batched): `Batching: found recent pending review review_1778356630682_ot3pnsc2l ... will update instead of creating new`, then `[cache] input=3 cache_create=2599 cache_read=10248 output=557`

The `cache_read=10248` on Turn 2 exactly matches the `cache_create=10248` from Turn 1, proving the static prefix is byte-stable on production and the cache breakpoint is engaging. Production static prefix is more than 2x larger than staging's (10,248 vs 4,874) because production has accumulated real learnings + documents in the `bots` row, which means proportionally bigger savings per call.

**Database verification of the same synthetic test:** the production `reviews` row written by Turn 2 stored `lead_intent=MEDIUM`, `conversation_stage=DIAGNOSTIC`, `bot_reply` containing the Turn 2 pricing-fit reply, `emotional_state=ENGAGED`, `bot_messages_count=2`, `typing_delays_count=2`, `last_messages_count=3`. All fields that PGRST204 had previously been silently dropping (Part A's bug) are now writing successfully on the same code path that Part B's caching also runs through. Both fixes verified working together on production in a single test.

**Wrangler version note:** deploy ran on `wrangler 4.65.0`. Tool prompted "update available 4.90.0" and emitted a non-fatal warning about multi-environment configs requiring an explicit `--env` flag. Deploy still completed correctly because the top-level `wrangler.toml` config IS the production config and bare `wrangler deploy` still defaults to top-level. **For future deploys**, pass `--env=""` (empty string) to suppress the warning and remove the ambiguity. Wrangler upgrade to 4.90.0 deferred (not blocking).

**Operational follow-ups (not blocking):** monitor Anthropic billing dashboard for next 1-2 days to confirm input-cost trend is downward (target: ~halving). If a regression surfaces, rollback path is `git revert -m 1 3964d10` followed by `npx wrangler deploy --env=""`.

### [x] 1.2.1 Schema fix: `lead_intent` column added to `reviews` on staging and production (2026-05-09)

**Result:** PGRST204 silent failure path closed. Migration `005_add_lead_intent_to_reviews.sql` (committed in `a518b13`) adds `lead_intent text` (nullable, no default; matches `conversations.lead_intent`) to `public.reviews`. `db/schema.sql` updated in the same commit.

**Apply order:**
1. Staging Supabase (`hlpucysbaqerhwahfolg`) first via Dashboard SQL Editor. Schema cache reloaded with `NOTIFY pgrst, 'reload schema';`. Verified column landed via `information_schema.columns` query. Verified writability via direct UPDATE (write `lead_intent='UNKNOWN'`, read back, reset to NULL).
2. End-to-end staging verification: 2-turn synthetic webhook (`customer_id=schema-fix-verify-20260509125735`). Turn 2 hit batching UPDATE path. Worker tail showed `Batching: found recent pending review` followed by `[cache]` line, no PGRST204. Stored row had `lead_intent=MEDIUM`, all turn-2 fields populated correctly. Test row cleaned up from both tables.
3. Production Supabase (`rydkwsjwlgnivlwlvqku`) second via Dashboard SQL Editor. Same sequence: ALTER TABLE, NOTIFY pgrst, verify with information_schema query. No live test traffic at the time of migration (production was in the credit-topup-pending traffic gap). End-to-end verification on production was deferred to the caching-deploy synthetic test described in the Phase 3 entry above; that test exercised the same batching UPDATE path, and the resulting database row (`lead_intent=MEDIUM`, all turn-2 fields populated) confirmed both the schema fix and the caching deploy together.

**Backfill decision: no backfill of historical `reviews.lead_intent`.** Reasoning:
- `lead_intent` on reviews is analytics metadata, not a routing signal. The Worker routes via `next_action` and `conversation_stage`, not `reviews.lead_intent`.
- The PGRST204 corruption was field-wide, not just `lead_intent`. A backfill that only restores `lead_intent` would create the false impression that affected reviews are now "fixed" when most fields (`bot_reply`, `bot_messages`, `typing_delays`, `internal_notes`, `escalation_reason`, `emotional_state`, `last_messages`, `resolved_at`) would still be stale.
- Full restoration is not possible. Per-turn fields like `internal_notes`, `escalation_reason` were never persisted anywhere except the dropped UPDATE itself.
- Identifying affected rows is heuristic at best (e.g. `bot_messages.length=1` plus stale `created_at`), not reliable.
- Going forward is what matters. New batched reviews now write correctly. Historical pollution is bounded and shrinks in relative weight as new clean reviews accumulate.

The historical-corruption audit question stays open in DEFERRED in case Coach Shaun's team ever wants best-effort historical analytics; we can compute a heuristic backfill from `conversations` then with appropriate caveats.

**Findings about the production traffic gap:** PROGRESS.md noted at session start that `reviews.created_at` and `conversations.created_at` both stopped advancing at 2026-05-07 21:38 UTC, ~39 hours before this session. Initial concern was that the Worker had stopped processing webhooks. Investigation showed: ManyChat or Make.com credit balance had run out around the same time the Worker was last uploaded (2026-05-07 18:53 UTC). Coach Shaun topped up during this session. Worker itself was healthy throughout. This is not a recurring issue, but the timing coincidence with the Worker's last upload was misleading and worth flagging for future sessions reading the COMPLETED list out of order.

### [x] 1.2 Phase 3 (aborted at Step 2): Production schema-gap investigation (2026-05-09)

**Result:** Caching deploy correctly aborted before merging or deploying. The session followed the brief's decision tree to outcome (b): production `reviews` schema is confirmed missing the `lead_intent` column. New top-priority item 1.2.1 created to fix the schema; caching deploy renumbered to 1.2.2 and gated on it.

**State verification done:**
- `origin/main` at `76a1d9b` (matches PROGRESS.md as of session start; no commits during session).
- Local `main` clean, in sync with origin, working tree clean.
- `feat-prompt-caching` branch untouched at `0a461c7` both locally and on origin.
- Production Worker live version `335b133c-d07f-4693-a314-fbffd448fbe1` (uploaded 2026-05-07T18:53:34Z), bindings include `env.ENVIRONMENT="production"` and `SUPABASE_URL` pointing at `rydkwsjwlgnivlwlvqku`. `/health` returned 200 with all expected feature flags. Consistent with `b3f5e12` (race-fix) being live.

**Schema-gap investigation done:**
- Read every `lead_intent` write site in `sales-bot/src/index.js` on `main`. Three paths write the column to the `reviews` table: line 1242 (SEND_TO_INBOX_REVIEW batching UPDATE), line 1421 (AUTO_SEND batching UPDATE), line 1541 (Claude API overloaded fallback INSERT). All three are wrapped in `ctx.waitUntil`, so PGRST204 errors are silent. A fourth write site at line 1196 writes to `conversations` via the `append_conversation_turn` RPC (migration 004) and is unaffected.
- Searched all `.sql` files in repo. `db/schema.sql` defines `lead_intent text` only on the `conversations` table (line 96), not on `reviews`. `reviews` definition (lines 129-150) has 20 columns and `lead_intent` is not among them. Migration 004 references `lead_intent` only in the conversations RPC.
- Verified production `reviews` table directly via Supabase Dashboard Table Editor. No `lead_intent` column.

**Impact analysis (more severe than the brief anticipated):**
PGRST204 on a missing column rejects the entire UPDATE statement, not just the offending column. So whenever the batching path fires on production (a second turn lands within the batching window of an existing pending review), the entire batched UPDATE is silently dropped, including `bot_reply`, `bot_messages`, `typing_delays`, `internal_notes`, `escalation_reason`, `emotional_state`, `last_messages`, `lead_intent`, and `resolved_at`. The setter reviewing that batched review in the inbox sees the first-turn version of the bot's reply, not the actual second-turn version. User-facing Make Scenario 2 send is unaffected; the lead does receive the correct second-turn reply. But the inbox record is stale.

This has likely been happening on production for an unknown duration (since whenever the Worker code first started writing `lead_intent` to `reviews`). Whether prior reviews in the production database have stale batched-update content is a separate audit question, captured in DEFERRED.

**Decision:** stopped. Did not merge `feat-prompt-caching`. Did not deploy. Did not touch production Worker or production Supabase. Full per-brief outcome (b) honoured.

### [x] 1.2 Phase 2: Behavior soak on staging (2026-05-09)

**Result:** Clean. 18 of 18 conversation arcs produced sensible on-prompt replies. No regressions vs production behavior. Caching engaged on 20 of 21 webhooks (95% hit rate; the one miss was the cold start, which is by design). Ready to deploy to production in a fresh session.

**Test harness:** `C:\Users\Order Account\botos-soak\` contains `soak-cases.json` (18 cases), `soak-runner.ps1` (PowerShell harness), `soak-report.ps1` (auto-scorer), `soak-results.jsonl` (raw responses, kept for audit). DO NOT delete; needed if we ever debug a production cache regression.

**What the 18 cases covered:** fresh lead welcome flow, fresh keyword-only event, existing lead with keyword in real message, duplicate keyword (already-responded path), price objection (early), price objection (late, with prior context), scheduling question, re-engagement after silence, confused/mistyped message, lead asks for human, lead wants to opt out, multi-turn objection, off-topic question, technical golf question, vague single word ("ok"), lead asks if it's a bot, booking-ready high intent, fresh warm high-intent lead.

**Two-step cases** (priming memory then sending main turn): soak-06 price-objection-late, soak-08 re-engagement, soak-12 multi-turn objection. All three correctly used setup-turn context in the main reply. Memory persistence and conversation-stage continuity both confirmed working with caching active.

**Cache pattern observed:**
- Webhook 1 (cold): `cache_create=4874 cache_read=0`
- Webhooks 2 through 4: `cache_create=0 cache_read=4874` (pure cache hits; no implicit conversation cache yet because these were fresh customer_ids with no history)
- Webhooks 5 through 21: `cache_create≈2400 cache_read=4874` (static prefix still hitting cache; implicit conversation cache also extending)

The static prefix held byte-stable across all 21 webhooks: `cache_read=4874` exactly, every time. Confirms the staticPrefix construction (learnings + documents + campaign + systemPrompt) does not drift between calls.

**Bot behavior signals observed:**
- All replies em-dash free (sanitiser working)
- Response quality (bot's self-reported field) range 0.75 to 0.97, average ~0.85
- Confidence scores correctly scaled to ambiguity (0.52 for "ok", 0.95 for "stop messaging me")
- Tone consistent across all cases (warm, "mate", casual punctuation, qualification-first)
- Escalation triggered on the right cases: `next_action=ESCALATE_TO_HUMAN` for soak-10 (asks-for-human) and soak-18 (high-intent fresh lead, where Shaun's prompt is conservative on warm leads)
- Duplicate-keyword detection (soak-04) fired correctly via `[Step 7]` log path; bot acknowledged + continued without restarting

**Auto-scorer learning:** The first version of `soak-report.ps1` reported 0/18 PASS due to mismatched stage and action vocabulary. The scorer expected `welcome / discover / qualify / schedule / BOOKED / closed / escalate` for stages and `AUTO_SEND / REVIEW_QUEUE` for actions. Coach Shaun's actual production system prompt uses `HOOK / ENTRY / GOAL / DIAGNOSTIC / BOOKED` and the Worker action constant is `SEND_TO_INBOX_REVIEW`. Manual re-scoring after reading every detail dump confirmed all 18 cases as PASS. Lesson captured below.

**Pre-existing schema bug surfaced (not caused by patch):** `Could not find the 'lead_intent' column of 'reviews' in the schema cache` (PostgREST PGRST204) fired 4 times. Once on soak-04 (duplicate keyword path) and once each on the main turns of the three two-step cases (soak-06, soak-08, soak-12). All four occurrences were on the "batching: found recent pending review, will update instead of creating new" code path. The error is silent to the user-facing flow because `ctx.waitUntil` swallows it (consistent with the 1.1.5 lesson). Added to DEFERRED below for investigation BEFORE production deploy.

**Cost confirmation:** Per-call savings ~49% on input tokens, matching the smoke-test estimate. No regressions. On-target for halving production API spend once deployed.

### [x] 1.2 Phase 1 - Prompt caching patch designed, deployed to staging, smoke-tested (2026-05-08)

**Branch:** `feat-prompt-caching` at commit `0a461c7`, pushed to GitHub.

**Patch:** `sales-bot/src/index.js`, `callClaude` function only. 39 insertions, 2 deletions. Split single `finalSystemPrompt` string into `staticPrefix` (cacheable: learnings, documents, campaign, systemPrompt) and `dynamicSuffix` (per-turn: welcome, leadSource, reEngagement). Switched `system` field to array form with one `cache_control: ephemeral` breakpoint between them. Added `[cache]` usage log line for observability.

**Reorder rationale (preserved in code comments):** the dynamic suffix sits at the END of the system field, not the start, so caching can engage. The "READ FIRST" / "CRITICAL" framing of welcome/leadSource/reEngagement is preserved by recency weighting (Claude weights content close to the user message). The "below" wording in `learningsSection`'s "OVERRIDE all default behaviors below" still refers to `systemPrompt` because learnings sits before systemPrompt within the static prefix.

**Pre-test setup on staging:**
- Verified Cloudflare secrets `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_KEY` set on `sales-bot-staging`
- Copied production `bots` row (id `00000000-0000-0000-0000-000000000002`) to staging Supabase via Node.js script. Byte-exact match confirmed (16,616 chars). Specifically copied: `system_prompt`, `welcome_context`, `campaign_goal`, `communication_style`, `lead_type`, `buyer_type`, `intent_definitions`, `ai_behavior_settings`. The previous "seeded" state of the staging bot row was a 73-char placeholder, which would have made caching tests inconclusive.
- Migration 004 (`append_conversation_turn` race-safe RPC) confirmed applied to staging earlier today.

**Smoke test (3 webhooks, customer_id `99887766554433`):**
- Webhook 1: `input=2396 cache_create=4874 cache_read=0    output=399`
- Webhook 2: `input=3    cache_create=2694 cache_read=4874 output=502`
- Webhook 3: `input=3    cache_create=3010 cache_read=4874 output=504`

All three returned valid bot replies. No errors in tail. Bot replies follow expected qualification-first behavior. The `cache_read=4874` consistency on calls 2 and 3 proves the static prefix is byte-identical between calls (no dynamic content leaking into the cached portion).

**Cost analysis:** Static prefix is 4,874 tokens (well above 2,048 minimum). Per-call savings on input ~49% versus uncached baseline. Bonus: Anthropic auto-caches conversation history once any explicit `cache_control` exists in the request (the `cache_create` on calls 2 and 3 is the conversation state, not our static prefix, and refreshes the read window for subsequent turns). On-target for halving production API spend.

**Staging Worker version:** `01d34c93-a8dd-41ff-8cad-3b6809217505` (replaces previous `483827f5-d6db-45c3-95a3-2928f3f9af50`).

### [x] Race-fix conversation writes via append_conversation_turn RPC (2026-05-08, earlier same day)

**Commit:** `b3f5e12` on `main`, deployed to production. Migration 004 created the `append_conversation_turn` Postgres function with `FOR UPDATE` row locking. Worker modified to use new `supabaseRpc` helper and `newTurnMessages` tracking. Verified working in production via 5 active leads showing healthy `msg_count` growth. Migration 004 also applied to staging same day.

### [x] 1.1.5 End-to-end smoke test of staging environment (earlier)

- Worker pipeline verified: webhook received, Anthropic API called, conversations and reviews written to staging Supabase
- Dashboard verified: staging-test user logs in, profile loads, sidebar renders, Active Conversations badge shows 3, inbox displays test reviews
- Three test webhooks (`staging-smoke-test-001..003`) all visible in dashboard inbox
- Realtime subscription connects ("Live" indicator green)

### [x] 1.1.1–1.1.4 Staging environment setup (earlier)

- 1.1.1 Staging branch created and pushed
- 1.1.2 Staging Supabase project created (Free Plan, separate org "Mu AI Staging environment")
- 1.1.3 Worker staging configured: `wrangler.toml [env.staging]` block, `getSupabaseUrl(env)` helper, deployed and reachable
- 1.1.4 Dashboard staging wiring: env-driven Supabase config, separate Pages project (`botos-platform-staging`), deploy command documented (`--branch=main` required)

---

## REFERENCE - always-applicable

### Production (NEVER TOUCH while developing)

- Worker: `sales-bot` at https://sales-bot.nellakuate.workers.dev
- Production KV id: `34e52c784a4e4e40925b93b17354cbec`
- Production Supabase: https://rydkwsjwlgnivlwlvqku.supabase.co (project ref `rydkwsjwlgnivlwlvqku`, owned by Nella, NOT iamanthony1007)
- Production Worker secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `SUPABASE_SERVICE_KEY`
- Make.com Scenario 1 webhook: still points at production Worker (unchanged)
- Make.com Scenario 2 webhook: https://hook.eu2.make.com/jknvsf64c05m0urc1f7qph523pi310st
- Production main HEAD at last update of this file: `b3f5e12`
- Production dashboard: `botos-platform` Pages project at https://botos-platform-3ar.pages.dev
- Production database password: NOT held by user. Owned by Nella. Schema replication for staging done via CSV exports + DDL provided by user (not via pg_dump).

### Staging

- Worker: `sales-bot-staging` at https://sales-bot-staging.nellakuate.workers.dev
  - Latest version: `01d34c93-a8dd-41ff-8cad-3b6809217505` (deployed 2026-05-08 with `feat-prompt-caching` branch; no redeploy during 2026-05-09 soak)
- Staging KV id: `e1bc76417c284a3ebd82758623e1d148`
- Staging Supabase project ref: `hlpucysbaqerhwahfolg`
- Staging Supabase URL: https://hlpucysbaqerhwahfolg.supabase.co
- Staging Supabase region: europe (different from prod, acceptable, slight latency only)
- Staging Worker secrets set: `SUPABASE_SERVICE_KEY` (staging value, JWT-decoded and verified `ref=hlpucysbaqerhwahfolg`), `ANTHROPIC_API_KEY` (currently same as prod, billing flows to Nella's account; future improvement: separate staging API key for spend isolation)
- Staging dashboard: `botos-platform-staging` Pages project at https://botos-platform-staging.pages.dev (Cloudflare account: Nellakuate's, account_id `444afb7987a4f1e657e0bad22a528a42`)
- Staging branch HEAD: see latest commit on `origin/staging` (note: `feat-prompt-caching` is what's actually deployed to the staging Worker right now, not `staging` branch)
- Staging Supabase tables (13): `audit_log`, `bot_documents`, `bots`, `coach_flag_reasons`, `conversation_examples`, `conversations`, `invites`, `learnings`, `organizations`, `profiles`, `prompt_versions`, `reconciliation_queue`, `reviews`
- Staging migrations applied: 001, 002, 003, 004 (all current as of 2026-05-08)
- Staging seeded rows:
  - `bots`: 1 row at id `00000000-0000-0000-0000-000000000002` (Bombers Blueprint staging). **system_prompt is byte-exact copy of production as of 2026-05-08, 16,616 chars**
  - `organizations`: 1 row at id `00000000-0000-0000-0000-000000000001` (Nella Platform staging)
  - `profiles`: 1 row for staging-test@botos-platform.local with role=admin and full permissions
  - `auth.users`: 2 rows (staging-test@botos-platform.local for testing, and iamanthony@gmail.com leftover from earlier exploration; the iamanthony row should be deleted as cleanup)
- Staging test webhook seeded data: 3 conversations / reviews under customer_id `staging-smoke-test-001..003`, 1 from caching smoke test under `99887766554433`, and 21 from 2026-05-09 behavior soak under `soak-2026-05-09-001..018` (some customer_ids appear twice due to two-step cases). Soak data can be cleaned up at any time; not load-bearing.

### Decisions locked in (do not revisit)

- Path A: Manual staging deploy. No Cloudflare Pages Git auto-build. Keep current direct-upload flow via `wrangler pages deploy dist`.
- Worker naming: production stays `sales-bot`. Staging is `sales-bot-staging`. Same `wrangler.toml`, separate `[env.staging]` block.
- Staging Supabase: separate project on Free Plan in a separate org to avoid Pro Plan billing.
- BOT_ID stays the same hardcoded value in both envs: `00000000-0000-0000-0000-000000000002`.
- `SUPABASE_URL` is env-driven in both Worker and dashboard (was hardcoded, refactored).
- `.env.staging` is committed to staging branch (visible in repo). Anon keys are safe by design.
- Skipped on staging: Resend (no email), `OPENAI_API_KEY` (dead code, Phase 4 cleanup target).
- Staging dashboard deploy command must include `--branch=main` to land in the production environment of the staging Pages project. Full canonical command: `npx wrangler pages deploy dist --project-name=botos-platform-staging --branch=main`.
- Staging Supabase: email confirmation disabled at project level (no email provider configured on staging).
- Staging Supabase: RLS disabled on all public tables (single-user dev sandbox; production has RLS on with policies which we have not yet captured to source-controlled SQL).
- Staging schema: maintained in `db/schema.sql` (full baseline) plus numbered migrations in `db/migrations/`. Apply schema.sql on a fresh Supabase project to bring up a complete staging environment in one paste.

### Critical guardrails (MUST FOLLOW always)

- Always use `ctx.waitUntil` for Supabase writes in the Worker. Never `await`. Awaiting causes silent Worker timeouts.
- Worker never returns messages back to Make Scenario 1. Auto-send goes Worker → Scenario 2 direct. Manual approval goes Inbox button → Scenario 2.
- Always check GitHub raw files for current state before editing (`https://raw.githubusercontent.com/iamanthony1007/botos-platform/main/` for production, `.../staging/` for staging branch, `.../<feature-branch>/` for in-progress work).
- Production main branch and the production Worker, KV, Supabase, and Pages project must never be touched while building staging or feature branches.
- Staging dashboard deploys must always pass `--branch=main` to land at the bare staging URL instead of a preview branch alias.
- Staging schema changes must go in `db/migrations/NNN_*.sql` AND be reflected in `db/schema.sql` so fresh setups stay current.
- Verify any new Supabase env var by JWT-decoding the anon/service_role key and confirming the `ref` claim matches the configured URL.
- Never use em dashes in any messages or chat replies.
- Never paste secrets (service_role keys, API keys) into chat. Read them via `Read-Host` into env vars; clear with `Remove-Item Env:...` after use.

### User context

- Anon_Techie has zero coding experience. Step-by-step PowerShell commands required.
- Workflow: Claude edits files in container, hands back via present_files, user copies via PowerShell, deploys, pushes to GitHub.
- Local repo path: `C:\Users\Order Account\botos-platform`
- Soak harness path (kept outside repo): `C:\Users\Order Account\botos-soak`
- OS: Windows / PowerShell 5.1 default. PowerShell 5.1 has UTF-8 encoding bugs in `Invoke-RestMethod`; use Node.js for any cross-API data copy involving non-ASCII characters (see lessons below).
- `git --no-pager diff` to avoid the interactive pager.
- BOM trap on Windows: use `[System.IO.File]::WriteAllText` with `new UTF8Encoding($false)` when creating .env files.
- Supabase project ownership: Nella owns production. Anon_Techie has dashboard access but does NOT have the production database password. Schema replication must work without it (use CSV exports + DDL from user).

### Lessons captured

#### 1.2 Phase 2 lesson: auto-scorer must use the actual stage/action vocabulary, not assumed one
The first behavior-soak report showed 0 of 18 cases passing. Closer reading revealed the scorer was checking against the wrong vocabulary. The scorer expected stages like `welcome / discover / qualify / objection / schedule` and actions like `AUTO_SEND / REVIEW_QUEUE`, taken from ARCHITECTURE.md and Worker code conventions. Coach Shaun's production system prompt actually defines stages as `HOOK / ENTRY / GOAL / DIAGNOSTIC / BOOKED`, and the Worker action constant is `SEND_TO_INBOX_REVIEW` (not `REVIEW_QUEUE`). Once we read the actual replies in the detail dump, all 18 cases were on-prompt and high-quality.

Going forward: before writing any auto-scorer, dump 1-2 real Worker responses from a smoke test and inspect the actual field names and value taxonomies. Do not write the scorer based on what the documentation or code constants suggest the responses look like. The system-prompt-level vocabulary (which the bot returns) does not always match the Worker-level constants (which gate routing). Also: a "0 PASS" result on the first run is more often a scorer bug than a regression. Read the detail dump before reacting.

#### 1.2 Phase 2 lesson: pre-existing schema gaps surface only under multi-turn load
Single-shot smoke tests (the Phase 1 3-webhook test, the 1.1.5 staging smoke test) never exercised the "batching: found recent pending review, will update instead of creating new" code path. That path triggers when a second turn lands within the batching window for a still-pending review row. The Phase 2 soak's three two-step cases (soak-06, soak-08, soak-12) plus the duplicate-keyword case (soak-04) all hit it, and all four failed silently with `Could not find the 'lead_intent' column of 'reviews' in the schema cache` (PGRST204).

The bug is invisible to the user-facing flow because `ctx.waitUntil` swallows the error (consistent with the 1.1.5 lesson on silent waitUntil swallowing). The Worker still returns 200, the bot reply still flows, the conversations row still appends. Only the reviews-row UPDATE fails, meaning the review's most recent fields stay stale.

Going forward: behavior soaks must include multi-turn arcs to exercise update paths, not just first-turn insert paths. Cross-environment schema parity should be confirmed for any column the Worker writes to, not just the existence of the table. See the new DEFERRED entry below for the `reviews.lead_intent` investigation.

#### 1.2 lesson: PowerShell 5.1 silently corrupts UTF-8 strings via Invoke-RestMethod
Running `Invoke-RestMethod` against a Supabase REST API on Windows PowerShell 5.1 decoded the response body using the system code page (CP1252) instead of UTF-8. Every box-drawing character, emoji, and em-dash in the production system_prompt was replaced with `?` literals before we wrote it to staging. The bug was invisible because `length($string)` measured the corrupted version, not the original, and our "match" check compared corrupted-to-corrupted.

The 4-character apparent length difference between Postgres and JavaScript is unrelated and benign: Postgres `length()` counts Unicode code points, JavaScript `.length` counts UTF-16 code units. Supplementary-plane emoji (like 🚨) take 2 code units in UTF-16. With 4 such emoji in the prompt, JS reports 16,620 for what Postgres correctly counts as 16,616 chars. Same string, different counting conventions.

Going forward: use Node.js (native fetch, native UTF-8) for any cross-API data copy involving non-ASCII content. Verify byte-exactness with strict string equality (`===`), not just length. For PowerShell scripts that POST or read non-ASCII bodies, prefer `Invoke-WebRequest` with `RawContentStream` decoded explicitly as UTF-8 (used in the Phase 2 soak runner).

#### 1.2 lesson: Anthropic prompt caching has implicit conversation-history caching as a bonus
We set ONE explicit `cache_control` breakpoint in the system field. Smoke test showed `cache_create` on calls 2 and 3 in addition to the expected `cache_read`. This is not a bug. Once any explicit cache_control exists in a request, Anthropic also caches the conversation history at the implicit user-message boundary. The growing conversation state caches with each turn, refreshing the cache window for subsequent turns. We get the savings for free without adding more breakpoints.

The Phase 2 soak confirmed this scales: `cache_create≈2400` extending the cache held steady across 17 consecutive multi-turn webhooks. The static prefix `cache_read=4874` was byte-stable across all 21 webhooks, proving the staticPrefix construction does not drift.

#### 1.1.4 lesson: silent Supabase URL misconfiguration
The staging Supabase URL was recorded incorrectly in early notes (used a wrong project ref that visually resembled the right one) and propagated into wrangler.toml and .env.staging. The bug went undetected through a passing browser smoke test because the test only verified the URL the request went to, not whether that URL pointed at the intended project. Some endpoint at the wrong URL returned a clean 400 that looked like a real Supabase rejection.

Verification protocol going forward: after writing any new env file or wrangler config that references a Supabase project, decode the anon and service_role JWT payloads and confirm the `ref` claim matches the configured URL. The verification takes 30 seconds and removes an entire class of silent misconfiguration.

#### 1.1.4 lesson: Pages branch routing for Direct Upload
For Cloudflare Pages Direct Upload projects, `wrangler pages deploy` infers the local Git branch and routes accordingly. If the inferred branch matches the project's production branch, the deploy lands in production. Otherwise it lands in preview, and the bare `<project>.pages.dev` URL does not serve it. For the staging Pages project (production branch = `main`) deployed from a local repo on the `staging` branch, the `--branch=main` flag is mandatory.

#### 1.1.5 lesson: silent ctx.waitUntil swallowing schema errors
The Worker upserts conversations rows with `on_conflict=bot_id,customer_id`. Our initial schema did not have that unique constraint. Postgres returned 42P10, but `ctx.waitUntil` swallowed the error and the Worker still returned 200 with a normal-looking response. Reviews row landed; conversations did not. We caught it only by SELECT'ing both tables and noticing the mismatch.

Going forward: when writing or updating schema, cross-check Worker upsert callsites for `on_conflict` parameters and ensure matching unique constraints exist. The Worker will not warn us if they do not match. The 1.2 Phase 2 lesson above is the same pattern, applied to a missing column instead of a missing constraint.

#### 1.1.5 lesson: Supabase enables RLS by default; deny-all is silent
We assumed CREATE TABLE in the public schema would leave RLS off. It does not. Supabase enables RLS by default, and with no policies, every PostgREST query returns "0 rows" silently. The dashboard's `.single()` call on profiles produced PGRST116 ("Cannot coerce to single object") which we initially mis-diagnosed as missing data.

Going forward: every CREATE TABLE in staging schema must be paired with explicit `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (already added to db/schema.sql in 1.1.5). For production, RLS should remain on with real policies, but those policies are not yet captured in source control, which is a known gap.

#### 1.1.5 lesson: schema replication scope is wider than the Worker
Initial schema replication exported the 5 tables the Worker writes to. The dashboard queries 8 more tables we did not anticipate. We discovered each gap as a 404 or 406 error in the browser. Going forward: when replicating production schema for any reason, get the full table list from the Supabase dashboard's Table Editor sidebar before deciding which to export, not just the ones referenced from a particular code path.

#### 1.1.5 lesson: dashboard auth state vs intended test user
Browser localStorage held an old session for an unintended user (iamanthony@gmail.com) which kept routing into staging despite multiple sign-in attempts as the staging-test user. Solution was to sign out fully before signing in as the intended user. The leftover iamanthony row in staging auth.users should be cleaned up.

#### Process lesson: update this file every session
A progress file that is read once at session start and never updated drifts out of sync with reality fast. New facts (Worker version IDs, seed data state, applied migrations) collected during a session must be written back to this file before session end. Otherwise the next session starts from stale assumptions and either repeats work or makes decisions on wrong information.

---

## DEFERRED - known gaps, not blockers

- **CLOSED (2026-05-09): `reviews.lead_intent` schema gap.** Migration 005 added the column on staging and production. Caching deploy synthetic test verified the batching UPDATE path now writes all fields correctly. Decision: **no backfill** of historical reviews; full reasoning in the COMPLETED entry for 1.2.1. **Audit question still open (low priority):** how many historical production reviews have stale batched content from the period when the column was missing. Best-effort heuristic backfill from `conversations` would be possible if Coach Shaun's team ever needs historical lead-intent analytics.
- **Wrangler upgrade (deferred):** local `wrangler` is at `4.65.0`; latest is `4.90.0` as of 2026-05-09. Upgrade is a separate maintenance task, not coupled to any feature work. Run `npm install --save-dev wrangler@latest` in `sales-bot/` and re-test deploy on staging first.
- **Deploy ergonomics:** future production deploys should pass `--env=""` to `npx wrangler deploy` to suppress the multi-environment ambiguity warning that wrangler 4.x emits on bare deploys. Behavior is identical; the flag just removes the warning.
- **Phase 1.3:** Worker `/health` endpoint returns hardcoded `supabase_connected: true`. Needs real check.
- **Phase 3:** Logo asset URLs in dashboard hardcoded to production Supabase storage bucket. Cosmetic, staging dashboard loads logos fine from prod bucket.
- **Phase 4:** Remove dead `OPENAI_API_KEY` references from Worker.
- **Cleanup:** Delete leftover `iamanthony@gmail.com` row from staging `auth.users` (was created accidentally during exploration).
- **Cleanup:** 21 soak rows under `soak-2026-05-09-001..018` in staging conversations / reviews can be deleted whenever convenient. Not load-bearing.
- **Future task:** Capture production RLS policies into source-controlled SQL so we can selectively enable RLS in staging when we want to test policy behavior.
- **Open question:** Dashboard's "Test" filter classification logic. The 3 staging-smoke-test conversations show under the Test filter as "Bot Tester" entries. Whether this is desired behavior or a bug depends on `Inbox.jsx` routing logic which has not been read in detail.
- **Future improvement:** Separate Anthropic API key for staging Worker so cache test traffic doesn't hit Nella's production billing.

---

*Last updated: 2026-05-09 (Phase 1.2 deploy session closed; inbox UX fix shipped same day adding manual reply on Needs Response tab; commit a7ec441 on main, production bundle index-BRUtjbJE.js)*
