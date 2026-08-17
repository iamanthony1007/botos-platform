# Profile-fetch staging report, 2026-08-18

Branch feat/instagram-profile-fetch at a15e60d. Staging Worker
9083827b-f5db-45bc-b99d-6a2a957ac2c7. First FULLY AUTONOMOUS staging run: no
human touched a secret. Events were self-signed with the new META_TEST_SECRET
webhook fallback (tried last, keyMatched=test_secret, inert when unset), which
is exactly what that fallback was built to enable.

## Harness

Local Graph mock (messages + profile endpoints) exposed through a cloudflared
quick tunnel; staging GRAPH_BASE_URL pointed at it for the window, so no request
could reach Meta. TOKEN_ENCRYPTION_KEY rotated to a window-known value (zero
blobs existed), fixture blob encrypted locally, REAL decrypt exercised by the
deployed Worker on every profile fetch. Real Claude on the staging key: 4 calls
total (P1, P4, P2, P3; the dedup event cost nothing).

## Compliance regression first: 16 cases + captured envelope, ALL PASS

Run on the new build before any fixtures existed. Cleanup verified to zero rows.

## Profile-fetch matrix, live: ALL PASS

    PASS P1  first inbound: ONE profile fetch (fields=name,username), decrypted
             token on the call, conversation row got profile_name="Staging Lead
             Name" and username="staging_lead_user", channel instagram_api.
    PASS P4  second inbound from the same lead: ZERO profile fetches, turn
             appended (msgs=2).
    PASS     CANARY (Stage 4 upstream, doubling as dedup proof): redelivered mid
             added nothing; 2 turns, 2 pending instagram_api reviews.
    PASS P2  username-field error: two calls (name,username then name), name-only
             fallback written, username stays null. The empirical answer to the
             username-field question on THIS path: the mock simulated the error;
             the first real callback will now be handled either way.
    PASS P3  full profile failure: profile_name and username stay null, review
             still created, webhook still 200. Pipeline provably unharmed.

## Teardown, verified

Three TEST conversations + four reviews + the connected_accounts fixture
deleted; staging back to 41/53/20, connected_accounts 0, ddr 0. All 7 KV keys
gone (4 ig_seen + 3 memory; one memory key initially survived a truncated
cleanup loop and was caught by a prefix listing, deleted, and re-listed to
zero, which is why cleanup verification lists by prefix rather than trusting
the delete loop). META_TEST_SECRET and GRAPH_BASE_URL deleted; secret list is
exactly the six; TOKEN_ENCRYPTION_KEY rotated to a fresh unknown value with
/__crypto-test all_pass=true under it; tunnel and mock processes stopped.

## Also on this branch

- META_TEST_SECRET webhook fallback (the thing that made this run autonomous),
  local matrix case T1 proving it.
- scripts/tail-supervisor.sh: every wrangler tail now wrapped in a 5-hour hard
  timeout so a tail can never silently outlive its expired session again (the
  mode that left the two production sends unwitnessed). The production
  disconnect watch is already running under it.

## Disconnect watch

Anthony's removal has still not fired as of this report: connected account
still active on production, ddr still at 2, tail quiet. The hardened watch
continues; the third deauthorize + refuse observations and the cycle cleanup
run the moment it lands.

## Verdict

Everything staged is green and torn down. Awaiting the read on this report
before the production deploy of the profile fetch.
