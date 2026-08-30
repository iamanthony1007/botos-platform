# MT Phase 1: Production-Direct Run Record

Ruling by Anthony, 2026-08-29: production-direct, the staging run of
MT-PHASE-1-STAGING-PLAN.md is SKIPPED on his call, with the system paused.
Claude's objection to the staging skip was registered once per protocol
(staging was the only rehearsal of both the policies and the rollback) and
dropped on acknowledgement. This file is the adjusted plan of record,
committed before the first paste.

Target: Mu AI, PRODUCTION, project `rydkwsjwlgnivlwlvqku`. Every chunk served
in chat carries that breadcrumb; Anthony confirms the editor tab matches
before pasting.

## Adjustments from the staging plan

1. Chunk 0 SKIPPED: staging-only grant alignment by design. Production
   already grants authenticated DELETE on bot_documents.
2. The account script step SKIPPED: production has real accounts. Instead,
   before chunk 3, the backfill map is produced from the real profile list
   and Anthony confirms it ROW BY ROW in chat: every profile's target org
   stated, superadmins staying null per D1, disabled rows excluded from the
   gate per D2.
3. Chunk discipline UNCHANGED: one chunk per paste, expected output beside
   each, any mismatch halts the run.
4. Deploy gate (after chunk 4, before chunk 5): Claude deploys the branch
   Worker and dashboard to PRODUCTION under this ruling. Rollback anchors
   recorded FIRST (current Worker version id via wrangler, current dashboard
   bundle and deployment id). Immediately after: browser-context checks,
   CORS preflight on the Worker, 401 on unauthenticated POST /meta/oauth/init,
   dashboard loads and renders.
5. Chunk 12 is a verification no-op on production (RLS already enabled
   everywhere); its SELECT still runs and must match.
6. After chunk 13: the FULL behavioral matrix runs against production BEFORE
   anything unpauses. Nothing reconnects, nothing unpauses, and Nella's
   connect does not happen until the matrix is green.

## Production risk posture, stated

On production RLS is already ON, so each table chunk ENFORCES the moment its
sweep runs; there is no inert window. The chunks are ordered so no table ever
sits at zero policies (create scoped first, sweep second), the backfill
(chunk 3) precedes every policy chunk, and the profiles self-read clause
makes the known lockout shape impossible. Run in a quiet window; a superadmin
dashboard session stays open in one tab as the recovery path; the rollback
script sits in a second SQL editor tab, unexecuted, for the life of the run.

## The backfill map (from the 2026-08-29 baseline, confirmed live by Anthony
## before chunk 3)

Chunk 3's two superadmin statements are both no-ops on production (orgs
already null, assigned bots already set). The tenant-staff update affects
exactly these rows:

| # | email | role | disabled | org today | org after chunk 3 |
|---|---|---|---|---|---|
| 1 | iamanthony1007@gmail.com | superadmin | no | null | null, UNCHANGED (D1) |
| 2 | nellakuate@gmail.com | superadmin | no | null | null, UNCHANGED (D1) |
| 3 | ornellakuate@gmail.com | client | no | null | Bombers Blueprint org (created in chunk 2) |
| 4 | shaun@fairwayperformance.com | client | no | null | Bombers Blueprint org |
| 5 | austinewebdev@gmail.com | setter | no | null | Bombers Blueprint org |
| 6 | meta-review@getmu.co | setter | no | Mu AI Demo (...00d0) | UNCHANGED |
| 7 | loulumagbas90@gmail.com | setter | YES | null | Bombers Blueprint org (hygiene only, excluded from the gate) |
| 8 | abbydeegal@gmail.com | setter | YES | null | Bombers Blueprint org (hygiene only, excluded from the gate) |

Gate after chunk 3: zero active non-superadmin profiles with a null org.

## Matrix adjustments for production

Tier sessions, minted via the admin API (no passwords, established pattern):
superadmin = iamanthony1007@gmail.com, Bombers setter =
austinewebdev@gmail.com, demo setter = meta-review@getmu.co. SuperYOU has no
profiles, so it is the pure "other tenant" read target.

- Cross-tenant READS (rows 1-3): unchanged, SuperYOU and Bombers as the
  cross pair, expected zero rows for the wrong tier.
- Cross-tenant WRITE probes (rows 4-5): aimed at the Mu AI Demo tenant ONLY,
  never at SuperYOU or Bombers real rows. The demo tenant exists for exactly
  this. Expected: zero rows affected / RLS violation.
- Row 10 (service-key path proof): NO synthetic event into production.
  Instead, observe the next scheduled cron run complete cleanly (the hourly
  follow-up and ig-refresh crons run on the service key and bypass RLS; a
  clean run post-migration is the proof).
- Realtime row: exercised on the Mu AI Demo tenant with a service-key
  inserted synthetic review (tester-prefixed customer id), deleted after.
- AcceptInvite end to end: a THROWAWAY invite for a setter role on the Mu AI
  Demo bot, accepted with a throwaway email, then the profile disabled and
  the invite expired. Teardown recorded in PROGRESS.
- oauth 403 trio: cross-tenant /meta/oauth/init (Bombers setter JWT, demo
  bot_id) 403; /meta/oauth/start with no init token 403; replay of a
  consumed init token 403.

## Gate at the end

Matrix green, THEN: unpause decision, reconnects, and Part B choreography,
each its own explicit step. Nothing implicit.

---

# RESULTS (2026-08-30): RUN COMPLETE, MATRIX FULLY GREEN

Executed 2026-08-29 late evening through 2026-08-30 morning, Anthony pasting,
Claude serving chunks and verifying. Every chunk verified against its written
expected output. One deviation, recorded below. Nothing has unpaused.

## Chunk log

| chunk | result |
|---|---|
| 1 helpers | 4 functions, secdef, stable, search_path pinned |
| 2 Bombers org | created `c5fb0844-57d2-4b26-a667-cc1090a52ade`, bot ...0002 repointed, platform org empty of bots as designed |
| 3 backfill | superadmin statements no-ops as predicted; staff rows landed exactly per the confirmed map; gate ZERO rows; map check 8/8 |
| 4 RPC | FAILED FIRST PASTE, 42P13: production invites.permissions is text[], repo schema said jsonb. Clean no-op failure (CREATE is atomic). Fixed with to_jsonb (commit 67df261), re-paste verified. The one live schema-drift find of the run |
| 5-11 policies | all seven chunks exact-match on their policy censuses; conversation_examples inline policies retired; both invites PUBLIC holes swept |
| 12 census | 16/16 tables rls_enabled true, policy counts exact |
| 13 anon revokes | zero anon grants remain; external probes confirm permission denied on all 16 tables, lookup_invite returns 200 empty on bogus token |
| 014 bookkeeping | pasted, zero rows, N-6 closed |

Mid-run eyeballs: Inbox rendered Bombers leads after chunk 5 (first scoped
read proof); dashboard rendered after chunk 9 (profiles self-read fix proof,
the highest-stakes moment of the run).

## Deploy gate

| item | rollback anchor | deployed |
|---|---|---|
| Worker | `3754c1dc-0370-46a3-8938-d5ac2b9c9fd0` | `dcda6447-c43a-492e-a44f-3dc9fbb84ef4` |
| Dashboard | `index-DqhtGDBb.js` | `index-BlDpb7L3.js`, deployment `37e4f90f` |

Verified at deploy time: verify-deploy OK (right ref 1, wrong ref 0), getmu.co
serving the new bundle, login rendering with zero console errors, CORS
preflight allowing Authorization+POST, 401 on unauthenticated init /
connection-status / send, 403 on start without init, bogus init, and the
legacy ?bot_id= form.

## Matrix results

Automated (scripts/mt-prod-matrix.mjs, run by Anthony with the masked service
key): **25/25 PASS.** Highlights: each tier sees exactly its own bots;
Bombers setter reads zero SuperYOU rows; demo setter reads zero Bombers rows
(the read that returned the full lead history pre-011); cross-tenant UPDATE
affected zero rows with the same-tenant control affecting one; cross-tenant
INSERT rejected 42501; connected_accounts empty and ddr/waitlist denied for
all three tiers; /meta/send 403 cross-tenant with the same-tenant control
proving gate ordering (400 not-approved, nothing sent); oauth init 403
cross-tenant, start single-use with replay 403; connection-status 403
cross-tenant, 200 own-bot. Fixture review created on the demo tenant only and
delete-verified in cleanup.

Manual rows, all confirmed by Anthony:
- Row 8 browser walks: superadmin, meta-review, and the throwaway MT Test
  session all rendered, no blank spinners.
- Row 11 Realtime: pending badge moved live on the meta-review session for a
  demo-tenant fixture insert and delete. Realtime-under-RLS works.
- Row 12 AcceptInvite end to end: invite card rendered via the lookup_invite
  RPC over anon, account created, landed scoped to the demo tenant, torn down
  (disabled=true verified).
- Sighting explained during row 12: the MT Test session showed two demo
  conversations (@thonysolutions, @de_anthony001). Verified by bot_id select:
  demo-tenant rows from the 2026-08-19/20 App Review demo cycle, not leakage;
  @thonysolutions also exists separately under the Bombers bot because the
  same human messaged both businesses.
- Row 10 cron: the 2026-08-30 08:00 UTC scheduled run captured live via
  wrangler tail: follow-up cron ok=true (0 candidates, the paused-system
  expectation; a blocked service key errors rather than returning a
  well-formed empty result) and ig-refresh ran clean. Service-key paths
  untouched by RLS, proven on the live system.

## Standing state

Tenant isolation is LIVE on production. The anon role reaches nothing but
auth endpoints and lookup_invite. The system remains PAUSED: unpause,
reconnects, and Part B (Nella's connect, with the separate SuperYOU
tenant-staff account per D3) each await Anthony's explicit word.

Staging is now BEHIND production (the run there was skipped by ruling):
chunks 0-13 must be applied to staging before it is next trusted as a
rehearsal environment. Recorded as the first follow-up.
