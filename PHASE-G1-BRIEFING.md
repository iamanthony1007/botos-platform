# Phase G1 Briefing for Claude Code

Session: 2026-05-21 post-Phase-D follow-up.
Planner: web Claude (Anthony driving).
Executor: browser Claude Code (this is you).

Read this whole file before touching anything.

## What this session does

Two surgical edits to the deployed Worker source on a new feature branch, plus a staging-then-production deploy. Total code changes: two lines.

## Why

Tonight's diagnostics on production (Phase D code, Worker version a1b9ec9c) confirmed:

1. **The prompt cache is dead under Phase D semantic retrieval.** Real-traffic logs show `cache_read=0` on every observed call, including calls from the same lead within 2 minutes. Root cause: the embed query for semantic retrieval includes `retrievalBotMessage` (the most recent bot reply), which changes each turn. Different embed query produces different top-8 learnings, which changes `learningsSection`, which changes `staticPrefix`, which breaks the cache key. Pay the 1.25x write surcharge every call, get zero read benefit.

2. **Real lead turn-gaps exceed 5-min cache TTL in manual-review mode.** Setters review and approve replies via the Inbox, which often introduces >1 hour delay between lead message arrival and bot reply send. Even if we fixed the embed query to stabilize the prefix, the 5-min ephemeral cache would still rarely hit. 1-hour cache would help slightly but costs 2x to write.

3. **max_tokens=512 is too aggressive.** Phase D reduced from 1024 to 512. Tonight's diagnostic test produced one call where the JSON response truncated at output=511, the JSON parse failed, and the Worker returned 500 to the client. This is happening in production on similar verbose-response turns.

## Scope of changes

**Change 1: Remove the cache_control breakpoint from systemBlocks**

Search the deployed `sales-bot/src/index.js` for this exact string:

```
{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral" } }
```

There should be exactly ONE occurrence inside the `callClaude` function. Replace with:

```
{ type: "text", text: staticPrefix }
```

That's the entire change. Do not modify the `dynamicSuffix` block below it. Do not modify the `systemBlocks.push` line. Do not modify the conditional that guards against empty dynamic blocks.

**Change 2: Bump max_tokens from 512 to 768**

The file has THREE `max_tokens` instances. Be careful to change only the right one.

The three are:
- `max_tokens: 8000` (prompt engineering helper, unrelated, do not touch)
- `max_tokens: 512` followed by a `system: \`You are a sales psychology expert...\`` system prompt (extract-reason helper, do not touch)
- `max_tokens: 512` followed by `system: systemBlocks,` (the main callClaude path, THIS IS THE ONE TO CHANGE)

Search for the distinctive context. Look for `max_tokens: 512` that appears in the same block as `system: systemBlocks,` and `messages: [` and `{ role: "user", content: buildDeveloperPrompt(memory, lastMessages) }`. That is the callClaude API call to Anthropic. Change `max_tokens: 512` to `max_tokens: 768` ON THAT INSTANCE ONLY.

If you find the wrong one (e.g. the one that has `system: \`You are a sales psychology expert...\``), do NOT change it. The extract-reason helper produces small JSON responses and 512 is fine for it.

## Verification before commit

Before committing, confirm:

1. `git diff sales-bot/src/index.js` shows exactly two changed lines and no others.
2. The cache_control removal still has the same outer object: `{ type: "text", text: staticPrefix }`. The trailing space and closing brace structure should be preserved.
3. The max_tokens change is in the systemBlocks call site, not the extract-reason helper.
4. No other files are modified.

If git diff shows MORE than two changed lines, abort and investigate. Don't commit.

## Branch and commit strategy

Phase D was merged to main earlier this session via PR #2 (merge commit `bbaa723`). Main now matches deployed code. Branch off main:

```
git checkout main
git pull origin main
git checkout -b feat-phase-g1-remove-caching
```

Verify before editing: `git log --oneline -3` on main should show the Phase D merge commit `bbaa723` at the top, then `4c47b29` (Phase D docs), then `21b3c19` (Phase D code). If main does NOT show these commits, the merge did not sync to your local. Stop and re-sync before editing.

Commit message goes in a temp file because long commit messages get mangled by PowerShell `-m`. Write to `commit-msg.txt`, commit with `git commit --file=commit-msg.txt`, then delete the temp file.

Commit message body (write to commit-msg.txt):

```
feat(worker): Phase G1 - remove ineffective cache_control, raise max_tokens 512 to 768

WHY
Tonight's production diagnostic (3 calls, identical message, same fresh customer_id,
all within 2 minutes) showed cache_read=0 on every call. Root cause identified:
the Voyage embed query for semantic retrieval concatenates retrievalBotMessage,
which changes turn-over-turn, producing different top-8 learnings, which produces
different learningsSection text, which produces different staticPrefix bytes,
which breaks the cache key.

Real production traffic confirmed cache_read=0 on two unrelated leads. The 1.25x
write surcharge has been paid on every call since Phase D shipped with zero
read benefit. Removing the cache_control header stops paying the surcharge.

WHY NOT FIX CACHING INSTEAD
The bot operates in manual-review mode. Setters review replies in the Inbox
before they are sent via Make Scenario 2. Real lead turn-gaps frequently exceed
1 hour, far past the 5-min ephemeral cache TTL. Even fixing the prefix to be
byte-stable would not produce meaningful cache hits under current operating
mode. When auto_send_enabled is flipped to true for trusted bots, turn-gaps
will compress to minutes and caching will become worth re-enabling.

MAX_TOKENS CHANGE
Phase D dropped max_tokens 1024 to 512. Tonight's diagnostic produced one
truncated response at output=511 (one token below the cap), causing JSON parse
failure and a 500 to the client. 768 splits the difference: enough headroom
for verbose JSON responses without the truncation risk, while still well below
the original 1024.

CHANGES
- sales-bot/src/index.js: remove cache_control from systemBlocks (1 line)
- sales-bot/src/index.js: max_tokens 512 to 768 in callClaude (1 line)

EXPECTED COST IMPACT
~20% reduction on static prefix line item (cache write 3.75/MTok to plain
input 3.00/MTok). On current ~7,400-token static prefix, this is roughly
$0.006 per call. At ~$60-76/month projected post-Phase-D bill, this is
roughly $5-12/month additional savings. Not transformative, but real money
we are currently throwing away.

VERIFICATION
- Staging deploy via wrangler deploy --env staging
- Synthetic test via /__cron-test path or direct webhook POST
- Confirm [cache] log line shows cache_create=0 cache_read=0 (no more
  unused cache writes)
- Confirm [retrieval] log line still shows learnings=8 docs=2 (semantic
  retrieval untouched)
- Production deploy via wrangler deploy (top-level config)
- Capture Worker version ID for PROGRESS.md
```

## Deploy steps

### Step 1: Staging deploy

```powershell
cd "C:\Users\Order Account\botos-platform\sales-bot"
wrangler deploy --env staging
```

Expected: `Successfully deployed to https://sales-bot-staging.nellakuate.workers.dev`. Capture the version ID printed in the deploy output.

### Step 2: Staging synthetic test

Use the same pattern from tonight's diagnostic. Two PowerShell windows.

Window 1 (tail):
```powershell
cd "C:\Users\Order Account\botos-platform\sales-bot"
$logPath = "$env:USERPROFILE\Desktop\phase-g1-staging-tail-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
npx wrangler tail --env staging --format pretty 2>&1 | Tee-Object -FilePath $logPath
```

Window 2 (fire one call):
```powershell
$workerUrl = "https://sales-bot-staging.nellakuate.workers.dev/webhook"
$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$customerId = "phase-g1-staging-$timestamp-DELETE-ME"
$body = @{
  customer_id = $customerId
  message     = "hey saw your golf ad, looking to improve my swing"
} | ConvertTo-Json -Compress
$resp = Invoke-WebRequest -Uri $workerUrl -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 60
Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Green
Write-Host "Customer ID for cleanup: $customerId" -ForegroundColor Yellow
```

What to verify in the tail output:
- HTTP 200 returned
- `[retrieval] learnings=...` line present (semantic retrieval still working)
- `[cache] ... cache_create=0 cache_read=0 ...` (THIS IS THE EXPECTED CHANGE - no cache write, no cache read, just plain input tokens)
- The `input` field on the [cache] line should now include the full prefix as plain input (expect roughly 7,000-7,500 tokens in the input field, vs the ~2,400 we saw before when prefix went to cache_create)

If you see cache_create > 0 on staging, the change did not take effect or staging is still running old code. Stop and investigate before going to production.

### Step 3: Production deploy

Only after staging verification passes.

```powershell
cd "C:\Users\Order Account\botos-platform\sales-bot"
wrangler deploy
```

Expected: `Successfully deployed to https://sales-bot.nellakuate.workers.dev`. Capture the version ID.

### Step 4: Production synthetic test

Same pattern as staging but against production URL.

Window 2:
```powershell
$workerUrl = "https://sales-bot.nellakuate.workers.dev/webhook"
$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$customerId = "phase-g1-prod-$timestamp-DELETE-ME"
$body = @{
  customer_id = $customerId
  message     = "hey saw your golf ad, looking to improve my swing"
} | ConvertTo-Json -Compress
$resp = Invoke-WebRequest -Uri $workerUrl -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 60
Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Green
Write-Host "Customer ID for cleanup: $customerId" -ForegroundColor Yellow
```

Verify the same [cache] line pattern as staging.

### Step 5: Push and report

```powershell
cd "C:\Users\Order Account\botos-platform"
git push origin feat-phase-g1-remove-caching
```

Report back to web Claude with:
- Staging worker version ID
- Production worker version ID
- The two staging and production [cache] log lines from the synthetic tests
- The test customer_id values for later cleanup

## Cleanup queue (defer to next session)

These DELETE-ME rows in production database accumulate during testing. Do not clean up tonight; web Claude will batch in next session's PROGRESS.md:
- `phase-d-prod-test-001-DELETE-ME` (from Phase D ship, 2026-05-21 01:07 UTC)
- `phase-test-1779331900-DELETE-ME` (tonight's diagnostic, 02:53 UTC)
- `phase-test-diag2-1779337354-DELETE-ME` (tonight's diagnostic 2, 04:22 UTC)
- `phase-g1-staging-{ts}-DELETE-ME` (this session's staging test, staging DB)
- `phase-g1-prod-{ts}-DELETE-ME` (this session's prod test, prod DB)

## Things you must NOT do this session

- Do not push to main. Branch protection blocks it anyway, but do not try.
- Do not merge `feat-phase-g1-remove-caching` into `feat-semantic-retrieval-phase-d` or main. PR creation is fine to leave for Anthony to do via GitHub UI. Open as draft if needed.
- Do not modify Make.com scenarios.
- Do not modify Supabase schema.
- Do not touch the embedQueryText function. The cache miss is a side effect of how it's called, but fixing the call site changes retrieval quality. That is a separate phase, not tonight.
- Do not run cleanup deletes on the DELETE-ME rows. Anthony will batch via PROGRESS.md.
- Do not promise specific percentage savings to Anthony in your report-back. The ~20% number is theoretical math from Anthropic's pricing page, not measured. Use language like "expected" or "projected" with appropriate hedging.

## Standing rules (from CLAUDE.md, do not violate)

- No em dashes anywhere in any output, including commit messages and this brief's verification reports.
- ctx.waitUntil stays for Supabase writes, never await. (Not relevant to this session's changes but stay alert.)
- PROGRESS.md updates happen via web Claude at session end, not by Claude Code mid-session.
- Multi-step PowerShell commands as a single block to paste and run.
- Use absolute paths in any [System.IO.File] .NET calls.
- Push back once if you disagree, then execute what Anthony confirms.

End of brief. Proceed when ready.
