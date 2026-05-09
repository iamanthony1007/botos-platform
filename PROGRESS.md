# BotOS / Mu — Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Phase 1.2 prompt caching deploy is **paused, gated behind a confirmed production schema gap** on `reviews.lead_intent`. Phase 3 attempted on 2026-05-09 in a fresh session and stopped at Step 2 per the explicit brief decision tree (case b: production schema missing the column means do not deploy on top of an unknown silent bug). New top priority: schema-migration session to add `lead_intent` to the production `reviews` table. Caching deploy resumes after the schema fix.

**Production state:** Stable, untouched. Worker version `335b133c-d07f-4693-a314-fbffd448fbe1` (uploaded 2026-05-07T18:53:34Z), corresponds to commit `b3f5e12` (race-fix). Coach Shaun's bot serving live leads. Schema gap confirmed: `reviews` table on production Supabase (ref `rydkwsjwlgnivlwlvqku`) is missing the `lead_intent` column. The Worker has been silently failing the batching UPDATE path for an unknown duration. See COMPLETED entry below for full impact analysis.

**Staging state:** Running commit `0a461c7` from branch `feat-prompt-caching` on Worker version `01d34c93-a8dd-41ff-8cad-3b6809217505`. Caching verified working (95% cache_read hit rate across 21 webhooks). Behavior verified clean (18 of 18 conversation arcs produced sensible on-prompt replies). Same schema gap as production. `feat-prompt-caching` branch untouched at `0a461c7`.

---

## NEXT UP

### [ ] 1.2.1 Schema fix: add `lead_intent` to production `reviews` table
Goal: stop the silent PGRST204 batching-UPDATE failures on production, then capture the column into source control so staging matches.

Plan:
1. Open a fresh session.
2. Re-read this file and the COMPLETED entry for Phase 1.2 Phase 3 (aborted) so context is loaded.
3. Inspect the production `reviews` table schema in the Supabase dashboard one more time to confirm the column is still missing (no other actor has added it in the meantime).
4. Decide migration approach: ALTER TABLE on production via Supabase SQL Editor, paired with a versioned migration file in `db/migrations/00X_add_lead_intent_to_reviews.sql`, and a corresponding update to `db/schema.sql` to include the column on `reviews`.
5. The column should be `text` (Worker writes literal strings `LOW|MEDIUM|HIGH|UNKNOWN`), nullable, no default. Match the conversations.lead_intent definition for consistency.
6. Apply migration to staging first. Verify the next batching-path event in staging no longer logs PGRST204.
7. Apply migration to production. Watch `wrangler tail` on production for batching-path events to confirm UPDATEs now land cleanly.
8. Decide whether to backfill historical `reviews.lead_intent` from `conversations.lead_intent` for prior batched rows. Likely not worth it (the data's value was for analytics only, not for routing). Document the decision either way.
9. Update PROGRESS.md, commit, push.

Hard rules for the schema session:
- Do not deploy caching during the schema session. Caching is a separate concern.
- Do not paste the production Supabase database password into chat. Apply the migration through the Supabase Dashboard SQL Editor (which authenticates via your dashboard session), not via raw psql or `supabase db push`.
- Migration file must be reversible (include a DOWN comment or paired `00X_revert` file even if not run).
- Apply to staging first. Production second. Never the other way around.

### [ ] 1.2.2 Phase 3: Deploy prompt caching to production
Was the original "next up". Now blocked on 1.2.1 above. Once schema gap is closed, this resumes unchanged from the prior plan:

1. Open a fresh session (do not stack with schema fix or with anything else).
2. Verify production state has not drifted: confirm production Worker is still running `b3f5e12` and that no commits have landed on `main` since the schema-fix session.
3. Confirm `reviews.lead_intent` is now present on production (the schema fix landed). Check the dashboard before deploying.
4. Merge `feat-prompt-caching` into `main` (fast-forward or merge-commit, both acceptable since the patch only touches `callClaude`).
5. Deploy with `npx wrangler deploy` from `sales-bot/` (no `--env` flag = production).
6. Watch production logs via `npx wrangler tail sales-bot --format=pretty` for 10-20 minutes. Confirm `[cache]` log lines appear and `cache_read` is non-zero on most calls.
7. Watch production for 1-2 days via Anthropic billing dashboard. Confirm input cost trend is downward.
8. After savings are proven, ship the operational hardening that was deferred.

Hard rules:
- Do not touch the `feat-prompt-caching` branch unless production deploy reveals a regression.
- Do not add a second cache breakpoint. Single one already hits target savings.
- Do not change anything else in `index.js` during the deploy. Caching merge first, anything else later.

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

### [x] 1.2 Phase 1 — Prompt caching patch designed, deployed to staging, smoke-tested (2026-05-08)

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

## REFERENCE — always-applicable

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
- Staging Worker secrets set: `SUPABASE_SERVICE_KEY` (staging value, JWT-decoded and verified `ref=hlpucysbaqerhwahfolg`), `ANTHROPIC_API_KEY` (currently same as prod — billing flows to Nella's account; future improvement: separate staging API key for spend isolation)
- Staging dashboard: `botos-platform-staging` Pages project at https://botos-platform-staging.pages.dev (Cloudflare account: Nellakuate's, account_id `444afb7987a4f1e657e0bad22a528a42`)
- Staging branch HEAD: see latest commit on `origin/staging` (note: `feat-prompt-caching` is what's actually deployed to the staging Worker right now, not `staging` branch)
- Staging Supabase tables (13): `audit_log`, `bot_documents`, `bots`, `coach_flag_reasons`, `conversation_examples`, `conversations`, `invites`, `learnings`, `organizations`, `profiles`, `prompt_versions`, `reconciliation_queue`, `reviews`
- Staging migrations applied: 001, 002, 003, 004 (all current as of 2026-05-08)
- Staging seeded rows:
  - `bots`: 1 row at id `00000000-0000-0000-0000-000000000002` (Bombers Blueprint staging) — **system_prompt is byte-exact copy of production as of 2026-05-08, 16,616 chars**
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
- OS: Windows / PowerShell 5.1 default. PowerShell 5.1 has UTF-8 encoding bugs in `Invoke-RestMethod` — use Node.js for any cross-API data copy involving non-ASCII characters (see lessons below).
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

## DEFERRED — known gaps, not blockers

- **UPDATED (2026-05-09): `reviews.lead_intent` schema gap CONFIRMED on production.** Both staging and production `reviews` tables are missing the `lead_intent` column. The Worker writes this column on three code paths: SEND_TO_INBOX_REVIEW batching UPDATE (index.js line 1242), AUTO_SEND batching UPDATE (line 1421), and Claude API overloaded fallback INSERT (line 1541). All three are wrapped in `ctx.waitUntil`, so PGRST204 errors are silent and the user-facing flow is unaffected. **However**, PGRST204 rejects the *entire* UPDATE statement, not just the bad column, which means production batching-path UPDATEs have been silently dropping `bot_reply`, `bot_messages`, `typing_delays`, `internal_notes`, `escalation_reason`, `emotional_state`, `last_messages`, `resolved_at` along with `lead_intent` whenever a second turn lands in the batching window. Inbox records for batched reviews are likely stale (showing first-turn data instead of second-turn). The fix is the new top-priority NEXT UP item 1.2.1: add a versioned migration adding `lead_intent text` to `reviews`, apply to staging then production, update `db/schema.sql`. **Open audit question (deferred, not blocking the migration):** how many historical production reviews have stale batched content, and is backfill from the corresponding `conversations` row possible/worth it. Decision and rationale to be captured in the schema-fix session.
- **Phase 1.3:** Worker `/health` endpoint returns hardcoded `supabase_connected: true`. Needs real check.
- **Phase 3:** Logo asset URLs in dashboard hardcoded to production Supabase storage bucket. Cosmetic, staging dashboard loads logos fine from prod bucket.
- **Phase 4:** Remove dead `OPENAI_API_KEY` references from Worker.
- **Cleanup:** Delete leftover `iamanthony@gmail.com` row from staging `auth.users` (was created accidentally during exploration).
- **Cleanup:** 21 soak rows under `soak-2026-05-09-001..018` in staging conversations / reviews can be deleted whenever convenient. Not load-bearing.
- **Future task:** Capture production RLS policies into source-controlled SQL so we can selectively enable RLS in staging when we want to test policy behavior.
- **Open question:** Dashboard's "Test" filter classification logic. The 3 staging-smoke-test conversations show under the Test filter as "Bot Tester" entries. Whether this is desired behavior or a bug depends on `Inbox.jsx` routing logic which has not been read in detail.
- **Future improvement:** Separate Anthropic API key for staging Worker so cache test traffic doesn't hit Nella's production billing.

---

*Last updated: 2026-05-09 (end of Phase 1.2 Phase 3 schema-gap investigation session; deploy aborted at Step 2 per brief decision tree, schema fix promoted to top priority as 1.2.1)*
