# Multi-Tenant Phase 1: Staging Execution Plan and Behavioral Matrix

Draft for review. NOTHING in this file runs anywhere, staging included, until
Anthony signs off. Production is not covered here: its runbook is written
after the staging matrix passes, per the briefing's reporting order.

Companion files, all on `feat/mt-phase-1-rls-v2`:
- `db/migrations/011_tenant_rls_policies.sql` (chunks 0 to 13)
- `db/migrations/011_rollback.sql`
- Worker tenant assertions and the oauth init/start pair (`sales-bot/src/index.js`)
- Dashboard: `Connections.jsx` (init handshake), `AcceptInvite.jsx` (lookup RPC)

Staging is the full dress rehearsal and the FIRST place the end state ever
runs: production has RLS on with permissive policies, staging has RLS off, so
chunk 12 on staging is the first time these policies decide anything.

---

## 1. Preconditions

1. Sign-off on the migration draft and this plan.
2. Staging Supabase (`hlpucysbaqerhwahfolg`) reachable and its SQL editor open.
3. Staging Worker and staging dashboard deployable (`npm run deploy:staging`
   in `sales-bot` via wrangler `--env staging`, and in `dashboard`).
4. The staging `authenticated` grants inspected once more in the session
   (chunk 0's verification covers `bot_documents`; the 2026-08-29 baseline
   covers the rest). Staging's grants were once found silently stripped, so
   re-verify rather than trust the three-day-old baseline if time has passed.

## 2. Test accounts and minted sessions

Standing rule: no passwords are minted or handled. Sessions come from the
admin API (established pattern from the reviewer-sim work), using the staging
service key from the machine environment, never pasted into chat.

| account | role | tenant | exists? |
|---|---|---|---|
| thony@gmail.com | superadmin | platform (org null after chunk 3) | yes |
| reviewer-sim@staging.getmu.co | setter | Mu AI Demo | yes |
| bombers-setter-sim@staging.getmu.co | setter, perms ["inbox"] | Bombers Blueprint (staging) | NO, create |

The Bombers setter simulator is created via the admin API (auth user) plus a
service-key insert into `profiles` (role setter, assigned_bot_id `...0002`,
organization_id left null so chunk 3 backfills it, which is itself a test).
It is a staging artifact like reviewer-sim: record it in PROGRESS, leave it in
place afterwards.

Session minting per account: admin API `generate_link` (magiclink), exchange
the emailed-link token server-side for an access token, export it as an env
var for the probe calls. JWTs expire; mint fresh ones at matrix time.

## 3. Execution order on staging

Every chunk paste follows the file's rule: one chunk, check its verification
SELECT against the expected output written in the file, stop on any mismatch.

1. **Chunk 0** (staging only): bot_documents DELETE grant.
2. **Chunks 1 to 4**: helpers, Bombers org, backfill with gate, lookup RPC.
   The chunk 3 gate must return zero rows; the new bombers-setter-sim profile
   is expected to appear backfilled to the Bombers org in the optional map.
3. **Deploy gate**: deploy the Worker to staging, then the dashboard to
   staging. Verify the deploys with the established checks (wrangler output,
   verify-deploy for the dashboard). Smoke: log into the staging dashboard as
   thony, confirm it renders (nothing should have changed yet: policies exist
   but RLS is still off on the core tables).
4. **Chunks 5 to 11**: policies. Still inert on staging (RLS off).
5. **Chunk 12**: RLS goes live. This is the moment.
6. **Chunk 13**: anon revokes (no-op on staging, run for parity).
7. **The behavioral matrix** (Section 4).
8. **Rollback rehearsal** (Section 5).
9. Report, stop. Production runbook is drafted only after all of the above
   is green and reviewed.

## 4. The behavioral matrix

Rows 1 to 10 are the briefing's, adapted to staging's two tenants (staging has
no SuperYOU; the second tenant is Mu AI Demo). Rows 11 to 15 were added by
Phase 0 findings. REST probes use the staging URL with the minted JWT of the
row's account; UI rows are eyeballed in a real browser session.

Record the pre-migration Bombers row counts (conversations, reviews) before
chunk 12 so rows 2 and 3 have exact expected numbers.

| # | As | Action | Expect |
|---|---|---|---|
| 1 | superadmin (thony) | select conversations, reviews, bots with no filter | rows from BOTH tenants; bots returns both bots |
| 2 | bombers-setter-sim | same selects | Bombers rows only; zero Mu AI Demo rows; bots returns exactly `...0002` |
| 3 | reviewer-sim | same selects | Demo rows only; ZERO Bombers rows (the reads that once returned the full Bombers lead history return nothing) |
| 4 | bombers-setter-sim | UPDATE a Mu AI Demo review by id | zero rows affected, no error |
| 5 | bombers-setter-sim | INSERT into learnings with bot_id `...00d1` | denied, RLS violation (42501) |
| 6 | every tier | select connected_accounts, data_deletion_requests, waitlist_applications | connected_accounts 200 with zero rows; ddr and waitlist 401/403 permission denied |
| 7 | anon key | select on every core table, plus lookup_invite with a bogus token | tables: permission denied (post chunk 13 there is no grant); RPC: 200 with zero rows |
| 8 | each tier, browser | every dashboard page renders with data: Inbox, Dashboard, Analytics, Learnings, Documents, PromptEditor, TrainBot, Tester, Settings, Users, Connections | no blank-spinner regressions. fetchProfile fails SILENTLY (the grants incident), so eyeball pixels, not consoles |
| 9 | bombers-setter-sim JWT | POST /meta/send with a Mu AI Demo review_id | 403 forbidden, and the review row is untouched |
| 10 | Worker pipeline | one self-signed staging webhook event end to end (established stage4-staging-events pattern) | processes normally: service-key paths are untouched by RLS |
| 11 | two browser sessions, same tenant | change a review in one, watch the other | sidebar badge and Inbox update live. Realtime evaluates RLS per subscriber and staging has never run it under RLS; a silent failure here looks like "nothing", which is why it is an explicit row |
| 12 | fresh email | full AcceptInvite flow: superadmin mints an invite, open the link logged out, create the account | invite page renders name, role, bot via the RPC; account creation completes; new profile lands with the invite's role and bot and a null org (backfill is a later manual step, and the profiles self-read fix means the new user still sees their own row) |
| 13 | bombers-setter-sim JWT | POST /meta/oauth/init with bot_id `...00d1` (cross-tenant) | 403. Then: GET /meta/oauth/start with no init token: 403. GET with a consumed init token (replay): 403 |
| 14 | bombers-setter-sim JWT | GET /meta/connection-status?bot_id=`...00d1` | 403 forbidden |
| 15 | superadmin (thony), browser | after chunk 3 normalized their org to null: full dashboard walk | renders on the Bombers (staging) bot via the assigned_bot_id fallthrough (D1). This row is the direct regression test for the getAssignedBot .single() hazard |

Matrix row sign-off: every row green, or a written explanation and decision
per red row, before anything else happens.

## 5. Rollback rehearsal (staging, after the matrix)

The rollback must be proven, not assumed:

1. Paste `db/migrations/011_rollback.sql` (single paste, safe by design).
2. Check its verification SELECT: 34 policies, per-table counts in the file.
3. Browser check: superadmin and reviewer-sim dashboards render again under
   the permissive posture. AcceptInvite still works (the RPC survives
   rollback by design; verify with a fresh invite link).
4. Re-apply 011 chunks 5 to 13 (chunks 0 to 4 are still in place: helpers and
   RPC are recreated harmlessly if re-pasted, data chunks are idempotent).
5. Spot-check matrix rows 2, 3, 8, 15 again after re-apply.

This proves the escape hatch AND proves the chunks re-run cleanly, which is
the idempotency claim tested for real.

## 6. What failure looks like, so it is recognized fast

- **Blank page, spinner forever, no console error**: profiles self-read
  failed. This is the exact bug 011 fixes; if it appears, the profiles chunk
  (9) did not apply as written. Rollback is one paste.
- **A page renders but a list is empty for a user who should see rows**:
  auth_bot_ids() returned nothing for that profile. Check the profile's role,
  disabled flag, assigned_bot_id, organization_id against chunk 3's map.
- **Documents delete silently fails on staging only**: chunk 0 was skipped.
- **Invite page says "Invite not found" for a valid link**: the dashboard
  deploy and chunk 11 are out of order, or PostgREST has not reloaded after
  chunk 4 (re-run `notify pgrst, 'reload schema';`).
- **Badge stops moving but pages work**: Realtime under RLS (row 11). Not
  fatal, but a finding to report before production.

## 7. Explicitly out of scope for the staging run

- Production, in any form.
- Part B (Nella's connect). Part B choreography will additionally create a
  separate tenant-staff account for her business per D3: admin role, org
  SuperYOU, assigned to the SuperYOU bot, `connections` permission, so the
  connect click happens as the SuperYOU tenant and never as her superadmin
  login. Recorded here so it is not lost; not executed in this phase.
- The 014 bookkeeping paste (production only, after its chunks).
- Any Make.com change, any Worker BOT_ID work, any grant tightening for
  authenticated beyond chunk 0.
