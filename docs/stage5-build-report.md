# Stage 5 build report, 2026-08-17

Branch feat/stage-5-instagram-send. Committed because the paste transport dropped
the matrix twice; this file is the witnessed record.

## Commits

    40f9df8 docs(stage5): Step 1 read-only mapping (reviewed)
    652e675 feat(stage5): instagram_api send via the Graph API, JWT auth armed in
            the same commit
    d9b6bc0 feat(inbox): approve and save-training deliver instagram_api reviews
            via the Worker
    <this>  fix(stage5): atomic instagram send, all parts joined into one Graph
            call, plus this report and the PROGRESS notes

## What shipped

Worker (/meta/send): accepts instagram_api alongside whatsapp, channel always from
the review row. verifyDashboardJwt validates the caller's Supabase user JWT against
/auth/v1/user (apikey: the new SUPABASE_ANON_KEY var, public and RLS-gated;
service-key fallback) and 401s before any lookup. getInstagramSendCreds resolves
bot_id + platform=instagram_api + deauthorized=false, newest-first, LOUD log on
multiple rows. Token decrypted server-side, one Graph call per review: all message
parts joined with a blank-line separator (atomic send ruling; the sequential loop
it replaced could deliver part 1, fail on part 2, and the retry duplicated part 1).
POST {GRAPH_BASE_URL|graph.instagram.com}/v23.0/<IG_ID>/messages with
recipient/message, token in the Authorization header, explicit account id with the
/me/messages fallback noted at the call site. Success flips the review to "sent"
(awaited; the flip IS the idempotency, "sent" is absent from the status gate) and
appends [sent <ISO> mid=...] to internal_notes; edited flows to sent identically.
Failure keeps approved/edited (retriable), appends the truncated error, logs the
FULL Graph error body (never echoes Authorization), and keys windowClosed on the
community-documented code 10 / subcode 2534022 (WhatsApp's 131047 is a different
code space). Follow-up cron candidates gain channel=in.(instagram,manychat),
closing the instagram_api and whatsapp leaks into the ManyChat webhook while
keeping the manychat cohort that holds 73 of 111 historical follow-ups.

Dashboard (Inbox.jsx): approve() and saveTraining() branch on channel:
instagram_api posts {review_id} to WORKER_URL/meta/send with the session JWT and
toasts the actual result (sent, window-closed, or saved-but-failed with the plain
reason). Failed sends leave the review approved/edited, so retry-by-design exists.
Legacy channels keep sendToMake; whatsapp stays blocked; manual send keeps the
blocked toast (no review row; the route is review-driven on purpose). The three
isSent checks and the approved progress counter include the new "sent" status.

## Local matrix, final re-run (mocked Graph, Supabase REST, and auth; no real
## sends, no credits)

    PASS 1  happy path -> sent, ONE Graph call for 2 parts, joined text
            http=200 success=true graphCalls=1 status=sent
            notes="model notes [sent 2026-08-17T01:11:18.863Z mid=mid_test_1]"
            (body verified verbatim: recipient.id=<lead>, message.text=
            "Msg one\n\nMsg two", Authorization: Bearer <decrypted test token>)
    PASS 1b edited -> sent on success            http=200 status=sent
    PASS 2  window closed -> retriable, windowClosed flag, note appended
            http=200 windowClosed=true status=approved (note patched WITHOUT a
            status field; subcode 2534022 recorded in internal_notes)
    PASS 3  graph 500 -> honest failure, status kept
            http=200 windowClosed=false status=approved
    PASS 4  no connected account -> hard 400, review untouched
            http=400 err="no instagram send credentials for this bot"
            graph=0 patches=0
    PASS 5  unauthenticated -> 401, nothing read, nothing sent, nothing written
            missing JWT=401, wrong JWT=401, reviews never read, graph=0
    PASS 6  legacy channel -> 400 unsupported
    PASS 7  whatsapp path regression -> unchanged no-creds 400 (see PROGRESS
            note: "unchanged" now means unchanged BEHIND the JWT)
    PASS 8  cron candidates carry channel=in.(instagram,manychat)
            (captured candidate URL, filter present verbatim)
    PASS 9  double-send on sent -> 400 "review not approved" status:sent,
            zero Graph calls (idempotency via the status machine)

Case 1 also exercised decryptToken on the send path: the driver encrypted the test
token in the exact iv12+ct+tag16 layout with the dev key, and the Graph mock
received the decrypted plaintext in the Authorization header.

Hygiene: node --check clean, CRLF preserved (0 lone-LF), 0 em dashes in added
lines, wrangler dry-run build clean with SUPABASE_ANON_KEY bound, ESLint at the 19
pre-existing problems with zero on changed lines.

## Next

Staging: deploy Worker and dashboard from the branch, re-run this matrix against
the staging Worker with GRAPH_BASE_URL pointed at a mock, the 16-case compliance
regression, one Stage 4 pipeline event as the upstream canary. Report committed as
docs/stage5-staging-report.md. Merge and production only after that report is
signed off. The production cycle (Anthony, recorded) is the first real decrypt of
a production token and the screencast footage.
