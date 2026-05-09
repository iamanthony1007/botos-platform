# BotOS / Mu — Progress

This is the single source of truth for what is done, what is in progress, and what is next on the BotOS / Mu platform. Read this at the start of every session. Update it at the end of every session.

---

## STATUS

**Currently in progress:** Phase 1.2 prompt caching — Phase 1 (staging soak) complete. Awaiting Phase 2 (longer behavior soak + production deploy).

**Production state:** Stable. Running commit `b3f5e12` (race-fix). Coach Shaun's bot serving live leads.

**Staging state:** Running commit `0a461c7` from branch `feat-prompt-caching` on Worker version `01d34c93-a8dd-41ff-8cad-3b6809217505`. Verified caching works.

---

## NEXT UP

### [ ] 1.2 Phase 2 — Behavior soak then production deploy of prompt caching
Goal: prove the caching patch does not regress bot behavior, then ship to production.

Plan:
1. Run a longer behavior comparison test on staging. Suggested: 15-20 webhooks across realistic conversation arcs (price objection, scheduling, follow-up after silence, re-engagement, keyword-only event, lead with welcome flow). For each, compare the staging reply against what production would produce given the same input. Look for tone shifts, missed instructions, formatting differences.
2. If soak is clean, merge `feat-prompt-caching` into `main`, deploy to production with `npx wrangler deploy` (no `--env` flag = production).
3. Watch production for 1-2 days via `[cache]` log lines and Anthropic billing dashboard. Confirm `cache_read` fires on the majority of calls and cost trend is downward.
4. After savings are proven, ship the operational hardening that was deferred.

Hard rules:
- Do not stack staging soak and production deploy in one session. Soak then stop, deploy in a fresh session.
- Do not touch the `feat-prompt-caching` branch unless soak finds a regression.
- Do not add a second cache breakpoint. Single one already hits target savings; more breakpoints means more byte-mismatch surface area.

### [ ] 1.1.6 STAGING.md runbook (deferred, still applies)
Was the original "next up" before caching work jumped the queue. Now lower priority because caching has more business impact. Should still happen.

Write `STAGING.md` documenting:
- Environment URLs (Worker, dashboard, Supabase)
- Deploy commands for Worker and dashboard
- Staging Supabase fresh-setup procedure (apply `db/schema.sql`, then create test user, then re-run profile seed from migration 002)
- Verification protocol (JWT decode for any new env var pointing at Supabase; CSV export schema replication if production schema changes)
- Known gaps (RLS off in staging, no email provider, schema-drift risks)
- Test webhook command for ad-hoc smoke testing

### [ ] Operational hardening (deferred until caching ships to production)
- Slack alert when Worker errors
- Reconciliation job for orphaned reviews / conversations
- Runbook for common production incidents

---

## COMPLETED

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
  - Latest version: `01d34c93-a8dd-41ff-8cad-3b6809217505` (deployed 2026-05-08 with `feat-prompt-caching` branch)
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
- Staging test webhook seeded data: 3 conversations / reviews under customer_id `staging-smoke-test-001..003` plus 1 from caching test under customer_id `99887766554433`

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
- OS: Windows / PowerShell 5.1 default. PowerShell 5.1 has UTF-8 encoding bugs in `Invoke-RestMethod` — use Node.js for any cross-API data copy involving non-ASCII characters (see lessons below).
- `git --no-pager diff` to avoid the interactive pager.
- BOM trap on Windows: use `[System.IO.File]::WriteAllText` with `new UTF8Encoding($false)` when creating .env files.
- Supabase project ownership: Nella owns production. Anon_Techie has dashboard access but does NOT have the production database password. Schema replication must work without it (use CSV exports + DDL from user).

### Lessons captured

#### 1.2 lesson: PowerShell 5.1 silently corrupts UTF-8 strings via Invoke-RestMethod
Running `Invoke-RestMethod` against a Supabase REST API on Windows PowerShell 5.1 decoded the response body using the system code page (CP1252) instead of UTF-8. Every box-drawing character, emoji, and em-dash in the production system_prompt was replaced with `?` literals before we wrote it to staging. The bug was invisible because `length($string)` measured the corrupted version, not the original, and our "match" check compared corrupted-to-corrupted.

The 4-character apparent length difference between Postgres and JavaScript is unrelated and benign: Postgres `length()` counts Unicode code points, JavaScript `.length` counts UTF-16 code units. Supplementary-plane emoji (like 🚨) take 2 code units in UTF-16. With 4 such emoji in the prompt, JS reports 16,620 for what Postgres correctly counts as 16,616 chars. Same string, different counting conventions.

Going forward: use Node.js (native fetch, native UTF-8) for any cross-API data copy involving non-ASCII content. Verify byte-exactness with strict string equality (`===`), not just length.

#### 1.2 lesson: Anthropic prompt caching has implicit conversation-history caching as a bonus
We set ONE explicit `cache_control` breakpoint in the system field. Smoke test showed `cache_create` on calls 2 and 3 in addition to the expected `cache_read`. This is not a bug. Once any explicit cache_control exists in a request, Anthropic also caches the conversation history at the implicit user-message boundary. The growing conversation state caches with each turn, refreshing the cache window for subsequent turns. We get the savings for free without adding more breakpoints.

#### 1.1.4 lesson: silent Supabase URL misconfiguration
The staging Supabase URL was recorded incorrectly in early notes (used a wrong project ref that visually resembled the right one) and propagated into wrangler.toml and .env.staging. The bug went undetected through a passing browser smoke test because the test only verified the URL the request went to, not whether that URL pointed at the intended project. Some endpoint at the wrong URL returned a clean 400 that looked like a real Supabase rejection.

Verification protocol going forward: after writing any new env file or wrangler config that references a Supabase project, decode the anon and service_role JWT payloads and confirm the `ref` claim matches the configured URL. The verification takes 30 seconds and removes an entire class of silent misconfiguration.

#### 1.1.4 lesson: Pages branch routing for Direct Upload
For Cloudflare Pages Direct Upload projects, `wrangler pages deploy` infers the local Git branch and routes accordingly. If the inferred branch matches the project's production branch, the deploy lands in production. Otherwise it lands in preview, and the bare `<project>.pages.dev` URL does not serve it. For the staging Pages project (production branch = `main`) deployed from a local repo on the `staging` branch, the `--branch=main` flag is mandatory.

#### 1.1.5 lesson: silent ctx.waitUntil swallowing schema errors
The Worker upserts conversations rows with `on_conflict=bot_id,customer_id`. Our initial schema did not have that unique constraint. Postgres returned 42P10, but `ctx.waitUntil` swallowed the error and the Worker still returned 200 with a normal-looking response. Reviews row landed; conversations did not. We caught it only by SELECT'ing both tables and noticing the mismatch.

Going forward: when writing or updating schema, cross-check Worker upsert callsites for `on_conflict` parameters and ensure matching unique constraints exist. The Worker will not warn us if they do not match.

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

- **Phase 1.3:** Worker `/health` endpoint returns hardcoded `supabase_connected: true`. Needs real check.
- **Phase 3:** Logo asset URLs in dashboard hardcoded to production Supabase storage bucket. Cosmetic, staging dashboard loads logos fine from prod bucket.
- **Phase 4:** Remove dead `OPENAI_API_KEY` references from Worker.
- **Cleanup:** Delete leftover `iamanthony@gmail.com` row from staging `auth.users` (was created accidentally during exploration).
- **Future task:** Capture production RLS policies into source-controlled SQL so we can selectively enable RLS in staging when we want to test policy behavior.
- **Open question:** Dashboard's "Test" filter classification logic. The 3 staging-smoke-test conversations show under the Test filter as "Bot Tester" entries. Whether this is desired behavior or a bug depends on `Inbox.jsx` routing logic which has not been read in detail.
- **Future improvement:** Separate Anthropic API key for staging Worker so cache test traffic doesn't hit Nella's production billing.

---

*Last updated: 2026-05-08 (end of Phase 1.2 Phase 1 caching session)*
