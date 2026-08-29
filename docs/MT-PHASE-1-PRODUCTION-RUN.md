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
