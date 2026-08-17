# Stage 5, Step 1 mapping (read-only), 2026-08-17

Six mappings for the Instagram send stage, with the two post-report rulings
incorporated. One of them is contradicted by production data, flagged first.

---

## FLAG, READ FIRST: the cron ruling as formulated disables live follow-ups

The ruling "channel=eq.instagram allowlist" closes the instagram_api and whatsapp
leaks, but production data shows it would ALSO turn off follow-ups for the channel
that has received the most of them:

    followed_up=true by channel (production, 2026-08-17):
      manychat  73   <- the majority
      instagram 38
      tester     0   (already excluded by the cron's own tester gate)

channel=eq.instagram makes the 2341 manychat conversations permanently ineligible.
That is a live-behavior change beyond leak-closing, and nothing in the Stage 5
briefing asks for it.

PROPOSED RESOLUTION, one character away from the ruling:

    &channel=in.(instagram,manychat)

Still an allowlist (per the ruling), still closes whatsapp and instagram_api in
the same line, keeps the 73-follow-up manychat cohort alive. Tester is left out
deliberately: the cron already skips tester rows via its own gate and zero tester
follow-ups have ever fired, so listing it would only widen the allowlist for no
behavior. Awaiting the call on eq.instagram versus in.(instagram,manychat) before
the cron line is written.

---

## 3.1 The exact send call

From Meta's current "Send Messages" page for Instagram API with Instagram Login
(developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/):

- Endpoint: POST https://graph.instagram.com/v25.0/<IG_ID>/messages
  (messaging page shows v25.0, platform overview shows v26.0; our OAuth code pins
  v23.0. Recommend one pinned constant, v23.0, matching the existing Graph calls.)
- Body, verbatim:
      {"recipient":{"id":"<IGSID>"},"message":{"text":"<TEXT_OR_LINK>"}}
- Token: Authorization: Bearer <INSTAGRAM_USER_ACCESS_TOKEN> header.
- messaging_type: not mentioned on this path at all. It is a Messenger-Platform
  (graph.facebook.com) concept. Not required.
- Closed-window error: Meta's page states the 24-hour rule but does NOT publish
  the error code. Operator documentation is unanimous:
      code: 10, error_subcode: 2534022,
      message: "This message is sent outside of allowed window"
  Quoted as community-documented, not Meta-verbatim. Design consequence: key the
  specific "window closed" handling on code 10 / subcode 2534022, handle any other
  code generically, and log the exact shape on first real failure so reality
  corrects us if it differs.
- HUMAN_AGENT: requires the human_agent permission through App Review (Advanced
  Access). Not usable under Standard Access with app-role accounts. Explicitly for
  human responses; Meta detects automated misuse. Stage 5 does not touch it:
  closed window = honest failure toast.
- Correction to the briefing's fact table: the WhatsApp branch of /meta/send keys
  its window detection on codes 131047/131026 (WhatsApp-specific). The Instagram
  branch must key on the 10/2534022 pair. The two branches detect different codes.

Sources: Meta Send Messages page and platform overview; n8n community thread on
"outside of allowed window"; InstantDM and Re:amaze error-code references;
Chatwoot app-review and human-agent guides.

## 3.2 The auth model of /meta/send (the critical one)

CURRENT STATE: the route has no authentication at all. It reads {review_id} from
the JSON body, loads the review with the service key, checks channel and status
(approved/edited/auto_sent), resolves creds, decrypts, sends. Nothing calls it
today: Inbox.jsx has zero call sites. It has been harmless only because the sole
whatsapp row holds a null token, so every call dies at "no whatsapp send
credentials".

WHAT A STRANGER COULD DO ONCE ARMED: not send arbitrary text (content and
recipient both come from the review row), but re-fire approved replies at real
leads given a valid review_id, and probe by enumeration. Review ids are
review_<timestamp>_<9 alnum>: the suffix is ~36^9, but ids appear in logs and
docs and were never designed as bearer secrets. Unacceptable armed.

RULING INCORPORATED: the Worker validates the caller's Supabase user JWT against
the auth API, with the ANON key added as a Worker var (SUPABASE_ANON_KEY in
wrangler.toml [vars] and [env.staging.vars]; it is the public RLS-gated key, not
a secret).

    Dashboard: Authorization: Bearer <session JWT from supabase.auth.getSession()>
    Worker:    GET {SUPABASE_URL}/auth/v1/user
                 apikey: env.SUPABASE_ANON_KEY
                 Authorization: the presented JWT
               200 + user id -> proceed. Anything else -> 401 before any lookup.

Why this beats the alternatives:
- Shared secret in the SPA bundle: dead on arrival. VITE_ vars are baked into a
  world-readable bundle. A secret in the browser is not a secret. (This is the
  ruling's own rationale, confirmed.)
- Pages Function proxy: holds a real secret server-side but must still
  authenticate ITS caller, which honestly means validating the same Supabase JWT,
  so it reduces to this design plus an extra hop, a deploy coupling, and the known
  gap that the staging Pages project carries no env secrets.
Note, not a flag: the service key already on the Worker would also serve as the
apikey for /auth/v1/user, so the anon var is not strictly required. The anon key
is still the better choice (least privilege: token validation needs no elevated
key), so the ruling stands as given.

Future hardening, named but not built in Stage 5: JWT -> profiles row -> assigned
bot check, so a setter can only fire sends for their own tenant. Single-tenant
today; becomes real work when the role model lands.

## 3.3 The review status model

Production statuses, exact counts: discarded 3283, approved 1218, edited 439,
pending 1011. No "sent" status exists anywhere. "auto_sent" appears in code (the
dashboard's isSent checks and /meta/send's status gate) but has zero rows. No
CHECK constraint on reviews.status: none in schema.sql, none ever added by
migration, and the four values were all free-written. (pg_constraint is not
readable via PostgREST; stated from the migration record.)

Dashboard usage: pending drives the queue and counters; approved/edited/auto_sent
render as "sent by bot" (lines 240, 361, 1432); approved feeds the progress
counter (line 162); discarded closes.

SMALLEST HONEST EXTENSION (recommended): a new status value "sent", written by
the WORKER on delivery success, plus an internal_notes append carrying the send
time and Meta message id:

    approve  -> status=approved (dashboard, as today)
    send OK  -> status=sent, internal_notes += " [sent <ISO> mid=<id>]"
    send err -> status STAYS approved (retriable: the route already accepts
                approved), internal_notes += truncated Graph error

Approved-but-failed and sent are then distinguishable and queryable with zero
schema change. A delivery column would need migration 014, and constraint 6 rules
migrations out of this stage. Consequence carried into the dashboard commit: the
three isSent checks and the approved-progress counter add "sent".

## 3.4 The follow-up cron leak (real, currently masked by an accident)

The candidate query (index.js:861) filters bot_id, followed_up, for_coach, stage,
and the updated_at window. NO channel filter: an idle instagram_api conversation
IS selected. What saves it today is resolveFollowUpName (line 922): Stage 4
passes profileName=null for instagram_api, so those rows are skipped as
no_profile_name. That is an accident, not a design, and the recorded follow-up to
backfill names via the Graph API would instantly arm the leak: the cron's send
posts to the SAME hardcoded Make webhook the dashboard uses (line 590, Scenario 2
into ManyChat) with an IGSID ManyChat has never seen.

Fix: allowlist on the candidate query, one line, comment naming Graph-based
follow-ups as the deferred proper fix. Form of the allowlist: SEE THE FLAG AT THE
TOP. eq.instagram (the ruling) also disables the manychat cohort that holds the
majority of historical follow-ups; in.(instagram,manychat) closes the same leaks
without the behavior change.

## 3.5 Account lookup by bot

getWhatsAppSendCreds (index.js:4921) is the exact precedent: platform=eq.whatsapp
AND bot_id=eq.<id> AND deauthorized=eq.false, limit 1, returns
{externalAccountId, tokenBlob}. A small mirrored helper is needed:
getInstagramSendCreds(env, botId) with platform=eq.instagram_api, ~20 lines,
WhatsApp helper untouched.

Constraint caveat, honest: the unique constraint is UNIQUE (platform,
external_account_id): one row per platform PER ACCOUNT, not per bot. Two IG
accounts mapped to one bot would make limit=1 arbitrary. Impossible in practice
today (zero rows outside test cycles) and the OAuth different-bot conflict check
blocks cross-tenant claims, but same-bot multi-account is unguarded. Mitigation:
order=created_at.desc for determinism; the business rule (one IG account per bot,
or explicit selection) is future work, out of Stage 5.

## 3.6 The dashboard approve flow

Today: approve() writes status=approved + final_reply + Fix B sibling-clearing +
the conversation text swap, THEN sendToMake(..., activeReview.channel); the gate
returns false for instagram_api and shows the blocked toast. WORKER_URL already
exists with the staging/production hostname switch (Inbox.jsx:16). No /meta/send
call site exists anywhere in the dashboard.

Recommended smallest honest change:
- approve(): after the existing updates, branch on channel === "instagram_api":
  POST WORKER_URL + /meta/send with {review_id} and the session JWT. Toast from
  the actual result:
    sent            -> "Approved - reply sent to lead"
    window closed   -> "Saved, but not sent: the lead's 24-hour reply window has
                       closed" (keyed on code 10 / 2534022)
    other failure   -> "Saved, but sending failed: <plain reason>"
  Legacy channels keep sendToMake untouched; whatsapp stays blocked as today.
- saveTraining(): same branch, trivially. It has the review id and writes
  status=edited, which the route's status gate already accepts. Include it.
- Manual send: KEEP the blocked toast in Stage 5. It has no review row (it posts
  free text), and the Worker route is deliberately review-driven. Wiring it would
  create a Worker surface that sends arbitrary caller-supplied text, exactly what
  the review-anchored design avoids. Deferred, stated in a comment.
- No retry button: a failed send leaves the row approved, which the route accepts
  again, so retry-by-design exists. Surfacing it is future UI work.

---

Build list on sign-off: /meta/send instagram_api branch (GRAPH_BASE_URL override,
JWT auth in the SAME commit that arms the route), "sent" status + notes append,
getInstagramSendCreds, the cron allowlist (form per the flag), the two dashboard
branches + isSent/counter updates, SUPABASE_ANON_KEY in both wrangler.toml var
blocks. Then the 9-case local matrix, staging (compliance regression + one Stage 4
event), GitHub review, and Anthony's recorded production cycle.
