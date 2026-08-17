# Stage 5 staging report, 2026-08-17

Branch feat/stage-5-instagram-send at 9268cc6 plus this report. Staging Worker
version b5a76d99-0c27-4fbd-aacc-e891708b73a8, staging dashboard bundle
index-DF0m7omb.js (verify-env and verify-deploy both clean, staging ref 1 /
prod ref 0).

## How the Graph mock reached a Cloudflare Worker

The staging Worker cannot reach localhost, so the local Graph mock was exposed
through a cloudflared quick tunnel (official binary via winget) and staging's
GRAPH_BASE_URL secret pointed at the tunnel for the test window only. No request
could reach Meta by construction: GRAPH_BASE_URL overrode the host for every send,
and the only connected_accounts row was a TEST fixture. The staging
TOKEN_ENCRYPTION_KEY was rotated to a locally-known value for the window (zero
blobs existed, so rotation is free), which is what let the fixture blob be
encrypted locally and REALLY decrypted by the deployed Worker. Auth used a
throwaway admin-created staging user (deleted after) so case 5 exercised REAL
GoTrue validation, not a mock.

## Compliance regression, 16 cases + captured envelope: ALL PASS

Run first, on the Stage 5 build, with a staging META_TEST_SECRET set for the
window and deleted after. Every case green including tampered-writes-nothing
(ddr stable), multipart M1-M5, business REFUSE with fixture untouched, and
cleanup back to zero rows.

## Stage 5 staging matrix: ALL PASS (9 cases + edited-to-sent)

    PASS 1  happy path: ONE Graph call via the tunnel, REAL staging decrypt,
            review -> sent. calls=1, igId=fixture, Authorization carried the
            decrypted plaintext (tokenMatch=true), body text was the two parts
            joined with a blank line, internal_notes gained [sent <ISO> mid=...]
            on the REAL reviews table (the table the 013 drift lived in).
    PASS 1b edited -> sent on success.
    PASS 2  window closed (code 10 / subcode 2534022 from the mock): 200,
            success=false, windowClosed=true, status stayed approved, subcode
            recorded in internal_notes on the real table.
    PASS 3  graph 500: honest failure, windowClosed=false, status kept.
    PASS 4  deauthorized account: hard 400 "no instagram send credentials",
            zero Graph calls. (Fixture flipped deauthorized=true for the case,
            restored after.)
    PASS 5  unauthenticated against REAL GoTrue: missing JWT 401, garbage JWT
            401, zero Graph calls, review untouched. A real password-grant JWT
            from the throwaway user passed on every other case.
    PASS 6  legacy channel -> 400 unsupported.
    PASS 7  whatsapp path behind the JWT: unchanged no-creds 400.
    PASS 8  cron allowlist, behavioral negative: a fixture instagram_api
            conversation INSIDE the follow-up window (updated_at now-20.5h,
            profile_name set, followed_up=false) produced examined=0. Before
            Stage 5 that row would have been examined. The fixture id was
            non-numeric so even a filter failure could never have passed the
            Make digit gate. First run of this case asserted the wrong response
            level (examined is under stats.), fixed and re-run standalone: PASS.
    PASS 9  double-send on the now-sent review: 400 "review not approved"
            status:sent, zero Graph calls.

## Cleanup, verified

TEST reviews (7), connected_accounts fixture, cron fixture conversation, and the
throwaway auth user all deleted. GRAPH_BASE_URL secret DELETED from staging.
TOKEN_ENCRYPTION_KEY rotated again to a fresh random value known to nobody
(/__crypto-test all_pass=true under it), local key files removed, tunnel and mock
processes stopped. Staging secret list is exactly the six. Final staging counts:
conversations 41, reviews 53, learnings 20, connected_accounts 0 at cleanup time,
data_deletion_requests 0.

## Outstanding: the Stage 4 upstream canary (Anthony's window, open now)

One Stage 4 pipeline event through the real staging webhook still needs Anthony,
because it must be signed with INSTAGRAM_APP_SECRET, which cannot be read back.
The connected_accounts canary fixture (TEST-IG-STAGE4-99001) is re-created and
waiting. Same script, same masked SecureString invocation from the script header
(scripts/stage4-staging-events.mjs). Expected: conversation + two instagram_api
reviews created, dedup on event three, then standard cleanup. Cost: 2 Claude
calls on the staging key.

## Verdict

Everything runnable without Anthony is green: the send path proven against the
deployed staging Worker with a real decrypt, real auth, real reviews-table writes,
atomic single-call send, honest failure states, working idempotency, and the cron
leak closed behaviorally. Merge and production wait for the canary plus sign-off
on this report.
