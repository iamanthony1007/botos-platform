# Phase F Claude Code Briefing

**Purpose:** This document is what Anthony will paste into a Claude Code session to apply the Phase F Worker patches. Claude Code reads this, runs the Python patcher script, verifies the diff, and reports back to Anthony.

**Anthony does NOT execute this directly.** Anthony opens Claude Code in the repo, pastes the contents of this file, and lets Claude Code drive.

---

## Context for the Claude Code session

You are Claude Code working in the local checkout of `botos-platform` for Anthony, who is shipping Phase F of the BotOS / Mu AI sales bot platform.

Phase F adds section-marker-aware lazy loading to the Worker's systemPrompt assembly. The redesigned prompt itself is NOT in scope of this Claude Code session, only the Worker code changes.

Repo location: `C:\Users\Order Account\botos-platform`
Target file: `sales-bot/src/index.js`
Source verified to match deployed Worker version `a0858eed-38f7-4dcc-9d44-4784b08e4086` (Phase G1).
Working branch: `feat-phase-f-systemprompt-redesign` (already created by Anthony before this session)
Web Claude has already produced and provided two artifacts in this same directory:
  - `PHASE-F-WORKER-PATCH.md` - the patch design document with all 5 changes
  - `patch_phase_f.py` - the Python script that applies the 5 changes

Your job: run the Python patcher, verify nothing else changed, and produce a one-line summary for Anthony.

---

## What to do

### Step 1: confirm location and branch state

```powershell
cd C:\Users\Order Account\botos-platform
git status
git branch --show-current
```

Expected:
- Working tree clean (or only `PHASE-F-WORKER-PATCH.md` and `patch_phase_f.py` present as untracked or staged).
- Branch is `feat-phase-f-systemprompt-redesign`.

If branch is NOT `feat-phase-f-systemprompt-redesign`, STOP. Do not proceed. Ask Anthony to fix the branch state.

If `sales-bot/src/index.js` already shows as modified before patches are applied, STOP. Ask Anthony to commit or stash existing changes first.

### Step 2: confirm patcher and patch doc are present

```powershell
Test-Path patch_phase_f.py
Test-Path PHASE-F-WORKER-PATCH.md
```

Both should print `True`. If either is missing, ask Anthony to drop them into the repo root.

### Step 3: dry-run the patcher

```powershell
python patch_phase_f.py --dry-run
```

Expected output:
- Source file: `C:\Users\Order Account\botos-platform\sales-bot\src\index.js`
- Line ending: `'\r\n'` (CRLF, expected on Windows)
- All 5 changes show `OK WOULD_APPLY` status
- "Dry run complete. Would apply 5 patches."
- Exit code 0

If ANY change shows `ANCHOR_NOT_FOUND` or `AMBIGUOUS_ANCHOR`, STOP. Do not proceed to apply mode. Tell Anthony which change failed and what the script said. The script's exit code will be 2 in this case.

If the patcher reports `ALREADY_APPLIED` for all 5 changes, ask Anthony if the patches were already applied in a prior session. If so, skip to Step 5.

### Step 4: apply the patches

Only if Step 3's dry-run reported all 5 as `WOULD_APPLY`:

```powershell
python patch_phase_f.py
```

Expected output:
- All 5 changes show `OK APPLIED`
- "SUCCESS. Wrote N bytes (+M bytes vs original)."
- "Applied 5 of 5 patches."
- Exit code 0

The byte delta should be approximately +4,937 bytes (the sum of the 5 change deltas):
  - Change 1: +3,730
  - Change 2: +47
  - Change 3: +1,008
  - Change 4: +31
  - Change 5: +121
  - Total: +4,937

If the delta is dramatically different (off by more than 200 bytes), report it. The script is correct, but the source file might have had unexpected whitespace differences.

### Step 5: verify the diff

```powershell
git diff sales-bot/src/index.js
```

Read the diff carefully. You should see exactly 5 distinct hunks corresponding to the 5 changes:

1. New helpers block: `parseSystemPrompt`, `STAGE_GRAPH`, `ALWAYS_ON_SECTIONS`, `decideRequestedSections`, and the related `__name` registrations and comment block, inserted between `__name(embedQueryText, "embedQueryText");` and `__name(callClaude, "callClaude");`.

2. callClaude signature gains `, priorStage = null, hasLeadSourceEvent = false` before the closing `)`.

3. The `staticPrefix` assembly block grows: a new "Phase F" comment block plus the `parsedSections`, `requestedNames`, `lazyPromptBody`, and a `console.log` line appear above the assignment. The line `+    systemPrompt;` changes to `+    lazyPromptBody;`. The `dynamicSuffix` block below is unchanged.

4. The `/webhook` call site gains `, priorStage, isLeadSourceEvent` before the closing `)`.

5. The `/train` system message changes: gains "especially any '## SECTION_NAME' markdown headers..." clause and replaces the em-dash `—` with a comma.

If you see ANY hunks outside these 5 areas, STOP. Tell Anthony exactly what other lines were touched. Possible causes: unintended encoding change, line-ending corruption, accidentally edited a different file.

If `git status` shows OTHER files modified beyond `sales-bot/src/index.js`, STOP. Tell Anthony which files. Possible cause: some part of the patch script touched a sibling file (it shouldn't, but worth checking).

### Step 6: produce summary

If Steps 4 and 5 all pass, produce a one-line summary for Anthony:

```
Phase F patches applied successfully. sales-bot/src/index.js: 5 hunks, +N bytes net. Diff verified clean. Ready for `wrangler deploy --env staging`.
```

Where N is the actual byte delta the patcher reported. Do NOT push, deploy, or commit. Anthony drives those steps.

---

## What you must NOT do

- Do NOT push to remote. Anthony pushes after verifying.
- Do NOT run `wrangler deploy`. Anthony deploys after his own verification.
- Do NOT create a commit. Anthony commits with a message he chooses.
- Do NOT modify any other file. Only `sales-bot/src/index.js` should change.
- Do NOT modify the patcher script. Anthony can re-run web Claude if a fix is needed.
- Do NOT modify the patch doc. Same reason.
- Do NOT switch branches or pull from remote.
- Do NOT install packages, add dependencies, or run npm/yarn.
- Do NOT touch `wrangler.toml`, `package.json`, migrations, the dashboard folder, or anything outside `sales-bot/src/index.js`.

---

## If something goes wrong

If Step 3 fails (anchor not found / ambiguous):
- Capture the script's output verbatim.
- Run `git log --oneline -10 sales-bot/src/index.js` to show recent changes.
- Run `wc -c sales-bot/src/index.js` to confirm file size.
- Report all three to Anthony along with the script's failure message.
- Do not attempt to manually edit anchors.

If Step 4 fails mid-apply (very unlikely - the script either applies all 5 or none):
- Run `git diff sales-bot/src/index.js`.
- Report which changes were applied vs missing.
- Anthony will decide whether to `git checkout main -- sales-bot/src/index.js` and start over.

If Step 5 shows unexpected hunks:
- Do not commit.
- Capture the entire diff.
- Report to Anthony for human review.

---

## Quick reference: file locations

```
C:\Users\Order Account\botos-platform\
├── PHASE-F-WORKER-PATCH.md            (patch design doc - read-only reference)
├── patch_phase_f.py                   (the patcher script you run)
└── sales-bot\
    └── src\
        └── index.js                   (the file you patch)
```

---

## Reminder: scope of this session

You are not doing anything else. Not migrating the Dashboard prompt. Not deploying. Not testing. Just applying the patches and verifying the diff. Hand control back to Anthony as soon as Step 6 prints the summary.
