# Phase F-bugfix: Add Embedding Generation to /feedback Endpoint

**Purpose:** Anthony pastes this into a Claude Code session. Claude Code applies the edit, shows the diff, hands control back.

---

## Context

You are Claude Code in `C:\Users\Order Account\botos-platform`. Anthony is shipping a bugfix to the BotOS / Mu AI Worker.

**The bug:** The `/feedback` endpoint in `sales-bot/src/index.js` inserts new `learnings` rows into Supabase **without an embedding**. The `learnings` table has an `embedding` column (1024-dim float vector, pgvector type) but the insert payload omits it. Result: every setter correction since 2026-05-15 has `embedding IS NULL` in production, which means the `match_learnings` RPC (used by `fetchRelevantLearningsSemantic` in the Worker's webhook path) cannot find these rows. Setter corrections are stored but invisible at runtime.

**Evidence in production data:**
- 322 total learnings on the bot
- 296 have embedding (before 2026-05-15)
- 26 are orphan with embedding=NULL (after 2026-05-21)
- The 26 orphans include the active-vs-passive question correction that Nella flagged as not being applied

**The fix:** Add a Voyage AI embedding generation call in the `/feedback` endpoint immediately before the `supabaseInsert(env, "learnings", ...)` call, and include the resulting embedding in the insert payload.

**Working branch:** `feat-phase-f-systemprompt-redesign` (already created, Phase F changes already committed locally? actually, **Phase F changes are NOT yet committed**. Don't commit anything until Anthony tells you to.)

---

## What to do

### Step 1: Confirm location and branch

```powershell
cd C:\Users\Order Account\botos-platform
git status
git branch --show-current
```

Expected:
- Branch is `feat-phase-f-systemprompt-redesign`
- `sales-bot/src/index.js` already shows as modified (Phase F patches from earlier in this session)
- Various untracked files (PHASE-F-*.md, .py, .ps1, .sql, .json files in repo root)

If branch is anything else, STOP and ask Anthony.

### Step 2: Locate the /feedback endpoint in the source

The file `sales-bot/src/index.js` is a single bundled JavaScript file. Read it. Search for the `/feedback` endpoint handler. It starts with:

```javascript
if (url.pathname === "/feedback" && request.method === "POST") {
```

Inside that block, find the `ctx.waitUntil(supabaseInsert(env, "learnings", { ... }));` call. This is the line we're modifying.

### Step 3: Apply the edit

Replace this exact block:

```javascript
    ctx.waitUntil(supabaseInsert(env, "learnings", {
      bot_id: BOT_ID, customer_id: String(customer_id), review_id,
      conversation_stage: conversation_stage || "UNKNOWN",
      situation_context: situation_context || "",
      original_reply: original_reply || "",
      corrected_reply: edited_reply, reason,
      tags: tags || [], source: "inbox",
      created_at: new Date().toISOString()
    }));
```

With this:

```javascript
    // Phase F-bugfix (2026-05-22): generate embedding for the learning row
    // so semantic retrieval can find it later. Pre-this-fix learnings had
    // embedding=NULL and were invisible to match_learnings RPC.
    // Embed text strategy: combine original_reply + corrected_reply + reason
    // so the embedding captures the FULL correction pattern (what was wrong,
    // what was right, why) rather than just one field in isolation.
    // The whole embed+insert sequence runs inside ctx.waitUntil so the
    // /feedback response returns quickly to the dashboard.
    ctx.waitUntil((async () => {
      const learningEmbedText = [
        (original_reply || "").trim(),
        (edited_reply || "").trim() ? "Corrected to: " + (edited_reply || "").trim() : "",
        (reason || "").trim() ? "Reason: " + (reason || "").trim() : ""
      ].filter(s => s.length > 0).join("\n\n");
      const learningEmbedding = await embedQueryText(env, learningEmbedText);
      if (!learningEmbedding) {
        console.warn(`[feedback] embedding generation failed for review_id=${review_id}, learning will be stored without embedding and won't be semantically retrievable`);
      } else {
        console.log(`[feedback] embedding generated for review_id=${review_id}, dim=${learningEmbedding.length}`);
      }
      await supabaseInsert(env, "learnings", {
        bot_id: BOT_ID, customer_id: String(customer_id), review_id,
        conversation_stage: conversation_stage || "UNKNOWN",
        situation_context: situation_context || "",
        original_reply: original_reply || "",
        corrected_reply: edited_reply, reason,
        tags: tags || [], source: "inbox",
        embedding: learningEmbedding,
        created_at: new Date().toISOString()
      });
    })());
```

**Why this design:**
- Wraps the whole embed+insert in `ctx.waitUntil((async () => { ... })())` so the endpoint response is not delayed by ~500-1000ms of Voyage latency. Matches the existing fire-and-forget pattern.
- `learningEmbedText` is built from the three always-populated fields: `original_reply`, `corrected_reply` (which is the `edited_reply` parameter), and `reason`. Empty strings are filtered.
- `embedQueryText(env, ...)` is the existing Worker helper that calls Voyage AI's embeddings API. It returns null on failure, which is then logged as a warning but the insert still happens (so we never lose the row).
- If embedding succeeds, the row is queryable by `match_learnings` RPC. If it fails, the row exists but is invisible to semantic retrieval (same broken state as today's orphans).
- The console.log/warn lines give Anthony observability in Cloudflare tail logs.

**File handling:**
- The file is CRLF (Windows line endings). Preserve them.
- File is UTF-8.
- Do NOT reformat any other part of the file. Only the one block above.

### Step 4: Verify the diff

```powershell
git diff sales-bot/src/index.js
```

Expected diff:
- ONE additional hunk beyond whatever Phase F changes were already there
- The hunk shows: 9 lines removed (the old `ctx.waitUntil(supabaseInsert(...))` block), ~28 lines added (the new IIFE with embedding generation)
- All other Phase F hunks unchanged

If any unrelated lines were touched, STOP and report.

### Step 5: Produce a one-line summary

If Step 4 passes:

```
Phase F-bugfix applied successfully. Added embedding generation to /feedback endpoint. 1 new hunk in sales-bot/src/index.js (~+1.4KB net). Ready for `wrangler deploy --env staging`.
```

Hand control back to Anthony.

---

## What you must NOT do

- Do NOT commit. Anthony commits.
- Do NOT push. Anthony pushes.
- Do NOT deploy. Anthony deploys.
- Do NOT touch any other file.
- Do NOT touch any other part of `index.js`.
- Do NOT add new dependencies or imports.

## Quick sanity check before you start

`embedQueryText` must already exist in the file (it's used by the webhook path's semantic retrieval). Confirm with a grep or read. If for some reason it's missing, STOP - the Phase F state is wrong and this edit won't work.

## Reference: what's already in scope

- `embedQueryText(env, text)` — async function, returns 1024-dim float array or null on failure. Already defined in the file.
- `ctx` — request context, has `.waitUntil()` method. Already available in the `/feedback` handler.
- `env.VOYAGE_API_KEY` — set in production wrangler.toml secrets. Already working (the webhook path uses it on every call successfully).
