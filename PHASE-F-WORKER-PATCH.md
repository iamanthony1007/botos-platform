# Phase F Worker Patch: 5 Code Changes

**Target file:** `sales-bot/src/index.js`
**Source verified:** GitHub `main` branch, 2026-05-21, matches deployed Worker version `a0858eed-38f7-4dcc-9d44-4784b08e4086` (Phase G1)
**Branch:** `feat-phase-f-systemprompt-redesign`
**Line endings:** CRLF (Windows). Patcher script must preserve.

## What this patch does

Adds section-marker-aware lazy loading to the systemPrompt assembly inside `callClaude`. The Worker reads the bot's `system_prompt` (from Supabase), parses it into named sections via markdown headers, and at runtime injects only the relevant sections based on the current conversation stage. Backward compatible: a system_prompt with no `##` markers gets treated as a single prelude and loaded in full (existing behavior).

## What this patch does NOT do

- Does not change `max_tokens: 768` (Phase G1 stays)
- Does not change semantic retrieval (Phase D stays)
- Does not change cron logic (Priority 3 stays)
- Does not change ANY other endpoint (/feedback, /train, /extract-document, /explain-learning, /learnings, /health, /__cron-test all unaffected, except /train system message which we update for marker preservation)
- Does not add cache_control (Phase G1 decision stands)
- Does not modify the prompt itself (that ships separately via Dashboard)

## The five changes

### Change 1: Add `parseSystemPrompt` and `decideRequestedSections` helpers

**Location:** Module scope, after `embedQueryText` and its `__name` registration, before the closing `__name(callClaude, "callClaude");` line at the bottom of the helpers section.

**old_str (exact anchor, single occurrence verified):**

```
__name(embedQueryText, "embedQueryText");

__name(callClaude, "callClaude");
```

**new_str:**

```
__name(embedQueryText, "embedQueryText");

// Phase F (2026-05-21): section-marker-aware system prompt assembly.
//
// parseSystemPrompt splits a prompt string into named sections by markdown
// headers. Anything before the first "## " header is the prelude. Each
// "## NAME" header opens a new section that runs until the next header.
//
// decideRequestedSections returns the list of section names to inject based
// on the current conversation stage. Always-on sections load unconditionally;
// lazy sections load per the STAGE_GRAPH below.
//
// Backward compatible: a prompt with no "## " markers parses into a single
// "__PRELUDE__" containing the whole text, and decideRequestedSections
// returns just that key, producing identical behavior to pre-Phase-F.

function parseSystemPrompt(promptText) {
  const sections = {};
  if (!promptText || typeof promptText !== "string") {
    sections.__PRELUDE__ = "";
    return sections;
  }
  const lines = promptText.split(/\r?\n/);
  let currentName = "__PRELUDE__";
  let currentBody = [];
  for (const line of lines) {
    const headerMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headerMatch) {
      sections[currentName] = currentBody.join("\n").trim();
      currentName = headerMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections[currentName] = currentBody.join("\n").trim();
  return sections;
}
__name(parseSystemPrompt, "parseSystemPrompt");

const STAGE_GRAPH = {
  "HOOK / ENTRY": ["SECTION:STAGE_HOOK_ENTRY", "SECTION:STAGE_GOAL", "SECTION:STAGE_INVITE"],
  "GOAL":         ["SECTION:STAGE_HOOK_ENTRY", "SECTION:STAGE_GOAL", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INVITE"],
  "DIAGNOSTIC":   ["SECTION:STAGE_GOAL", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INSIGHT", "SECTION:STAGE_INVITE"],
  "INSIGHT":      ["SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INSIGHT", "SECTION:STAGE_PRIORITY", "SECTION:STAGE_INVITE"],
  "PRIORITY":     ["SECTION:STAGE_INSIGHT", "SECTION:STAGE_PRIORITY", "SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE", "SECTION:STAGE_FOLLOWUP"],
  "DECISION":     ["SECTION:STAGE_PRIORITY", "SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE"],
  "INVITE":       ["SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE", "SECTION:STAGE_SCHEDULE"],
  "SCHEDULE":     ["SECTION:STAGE_INVITE", "SECTION:STAGE_SCHEDULE", "SECTION:STAGE_BOOKED"],
  "BOOKED":       ["SECTION:STAGE_SCHEDULE", "SECTION:STAGE_BOOKED"],
  "FOLLOW-UP":    ["SECTION:STAGE_FOLLOWUP", "SECTION:NURTURE_EXIT", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INVITE"]
};

const ALWAYS_ON_SECTIONS = [
  "PERSONA",
  "VOICE",
  "ICP",
  "INTENT_CLASSIFICATION",
  "GUARDRAILS"
];

function decideRequestedSections(parsedSections, priorStage, hasLeadSourceEvent) {
  const requested = [];

  if (parsedSections.__PRELUDE__ && parsedSections.__PRELUDE__.length > 0) {
    requested.push("__PRELUDE__");
  }

  for (const name of ALWAYS_ON_SECTIONS) {
    if (parsedSections[name]) requested.push(name);
  }

  const stageKey = priorStage && STAGE_GRAPH[priorStage] ? priorStage : "HOOK / ENTRY";
  const stageSections = STAGE_GRAPH[stageKey] || STAGE_GRAPH["HOOK / ENTRY"];
  for (const name of stageSections) {
    if (parsedSections[name] && !requested.includes(name)) {
      requested.push(name);
    }
  }

  if (hasLeadSourceEvent && parsedSections["SECTION:LEAD_SOURCE_EVENT"]) {
    if (!requested.includes("SECTION:LEAD_SOURCE_EVENT")) {
      requested.push("SECTION:LEAD_SOURCE_EVENT");
    }
  }

  if (stageKey === "FOLLOW-UP" && parsedSections["SECTION:NURTURE_EXIT"]) {
    if (!requested.includes("SECTION:NURTURE_EXIT")) {
      requested.push("SECTION:NURTURE_EXIT");
    }
  }

  return requested;
}
__name(decideRequestedSections, "decideRequestedSections");

__name(callClaude, "callClaude");
```

**Why this anchor works:**
- The string `__name(embedQueryText, "embedQueryText");\n\n__name(callClaude, "callClaude");` appears exactly ONCE in the source.
- The two-blank-line gap between them gives us a clean insertion point.
- New helpers slot into module scope (not inside callClaude).

**Common mistakes to avoid:**
- Do NOT insert this block inside `callClaude` itself.
- Do NOT delete the trailing `__name(callClaude, "callClaude");` line.
- Do NOT add `cache_control` anywhere in the new block (Phase G1 removed it on purpose).

---

### Change 2: Update `callClaude` signature to accept `priorStage` and `hasLeadSourceEvent`

**Location:** The `callClaude` function declaration line.

**old_str (exact anchor, single occurrence verified):**

```
async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}) {
```

**new_str:**

```
async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}, priorStage = null, hasLeadSourceEvent = false) {
```

**Why:**
- Adds `priorStage` so the lazy loader knows which stage's sections to inject.
- Adds `hasLeadSourceEvent` so the loader includes the LEAD_SOURCE_EVENT section only when a keyword event fired.
- Default values (`null` and `false`) make this backward compatible.

**Common mistakes:**
- Do NOT reorder parameters. The new ones MUST go at the end with defaults.
- Use single quotes around `claude-sonnet-4-6` to match the original.

---

### Change 3: Replace `staticPrefix` assembly to use lazy-loaded sections

**Location:** Inside `callClaude`, the block that builds `staticPrefix`.

**old_str (exact anchor, single occurrence verified):**

```
  const staticPrefix =
    learningsSection +
    documentSection +
    campaignSection +
    systemPrompt;

  const dynamicSuffix =
    welcomeSection +
    leadSourceSection +
    reEngagementSection;
```

**new_str:**

```
  // Phase F (2026-05-21): parse the bot's system_prompt into named sections
  // and inject only the relevant ones based on the conversation stage.
  // Falls back to identical pre-Phase-F behavior when the prompt has no
  // "## " section markers (parseSystemPrompt returns the whole text under
  // __PRELUDE__ and decideRequestedSections returns just that key).
  const parsedSections = parseSystemPrompt(systemPrompt);
  const requestedNames = decideRequestedSections(
    parsedSections,
    priorStage,
    hasLeadSourceEvent
  );
  const lazyPromptBody = requestedNames
    .map(name => {
      const body = parsedSections[name];
      if (!body) return "";
      if (name === "__PRELUDE__") return body;
      return `## ${name}\n${body}`;
    })
    .filter(s => s && s.length > 0)
    .join("\n\n");

  try {
    console.log(`[phase-f] priorStage=${priorStage || "null"} hasLeadSourceEvent=${hasLeadSourceEvent} sectionsInjected=${requestedNames.join(",")}`);
  } catch (_) { /* non-fatal */ }

  const staticPrefix =
    learningsSection +
    documentSection +
    campaignSection +
    lazyPromptBody;

  const dynamicSuffix =
    welcomeSection +
    leadSourceSection +
    reEngagementSection;
```

**Why:**
- Replaces the full `systemPrompt` string with the lazy-loaded `lazyPromptBody` at the same position in the assembly.
- Preserves the order: learnings + document + campaign + prompt body.
- Preserves `dynamicSuffix` unchanged.
- Adds a `[phase-f]` log line so we can verify in Cloudflare logs that the right sections are being chosen.

**Common mistakes:**
- Do NOT remove `learningsSection + documentSection + campaignSection`. They still come first.
- Do NOT change `dynamicSuffix`. It is identical.

---

### Change 4: Update the `/webhook` call site to pass `priorStage` and `isLeadSourceEvent`

**Location:** Inside `/webhook` POST handler, the single call to `callClaude`.

**old_str (exact anchor, single occurrence verified):**

```
        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig);
```

**new_str:**

```
        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig, priorStage, isLeadSourceEvent);
```

**Why:**
- `priorStage` is already declared in the surrounding scope (fetched from the conversations table via the priorResp block ~30 lines above this call).
- `isLeadSourceEvent` is also already declared in the surrounding scope (set during Step 7 lead source event detection).
- Both variables are in scope at this call site.

**Common mistakes:**
- The CALLER variable is `isLeadSourceEvent` (with `is` prefix). The CALLEE parameter is `hasLeadSourceEvent` (with `has` prefix). They map by position, not name. This is intentional: the local naming convention is `isXxx`, the parameter naming is `hasXxx` to clarify it is a boolean flag input.

---

### Change 5: Update the `/train` endpoint system message to preserve `##` section markers

**Location:** Inside `/train` POST handler, the system message string.

**old_str (exact anchor, single occurrence verified — note the literal em-dash character in the original):**

```
            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting. Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object — no markdown, no preamble.",
```

**new_str:**

```
            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting, especially any '## SECTION_NAME' markdown headers (these are load-bearing, the runtime parses sections by these markers). Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object, no markdown, no preamble.",
```

**Why:**
- The Dashboard's AI Behavior editor flows through `/train` to apply user instructions to the system_prompt. Without this update, an instruction like "make the voice section more casual" might unwittingly remove the `## VOICE` header when restructuring the text, breaking the section parser.
- Telling the prompt-engineering assistant explicitly to preserve `##` headers protects the section markers across edits.
- Also removes the em-dash character that was in the original (replaced with comma). Aligns with the no-em-dashes guardrail in the codebase.

**Common mistakes:**
- The OLD string contains a literal em-dash character (`—`) at "JSON object — no markdown". The anchor MUST contain that character to match. If your editor auto-corrects it to a hyphen, the match will fail.
- The Python patcher script handles encoding correctly via UTF-8.

---

## Backward compatibility analysis

Before we flip Coach Shaun's Dashboard prompt in Phase G, his bot still has the OLD system_prompt (no `## ` markers, just emoji headers like `═══ SETTER CORRECTIONS ═══`).

What happens to that prompt under the new Worker code?

1. `parseSystemPrompt(oldPrompt)` runs. The old prompt has no `## ` headers. Everything lands under `__PRELUDE__`.
2. `decideRequestedSections(parsed, priorStage, false)` returns `["__PRELUDE__"]` (no other keys exist in `parsed`).
3. `lazyPromptBody` becomes the full old prompt text unchanged.
4. `staticPrefix = learningsSection + documentSection + campaignSection + lazyPromptBody` produces a string IDENTICAL to pre-Phase-F.

**Result: zero behavior change.** Coach Shaun's bot continues exactly as before until we flip his prompt in Phase G.

Then in Phase G we paste the section-marker prompt into Dashboard → Save → it writes to Supabase → next webhook call picks it up → lazy loader kicks in.

---

## Verification after Claude Code applies the patches

You will run (PowerShell, in repo root):

```powershell
cd C:\Users\Order Account\botos-platform
git status
git diff sales-bot/src/index.js | Select-String -Pattern '^[-+]' | Select-Object -First 200
```

Expected diff sections:
1. Two new functions (`parseSystemPrompt`, `decideRequestedSections`) plus constants (`STAGE_GRAPH`, `ALWAYS_ON_SECTIONS`) inserted before `__name(callClaude, ...)` at the bottom of helpers.
2. `callClaude` signature gains `priorStage = null, hasLeadSourceEvent = false` parameters.
3. The `staticPrefix` assembly block gets the new parsing block inserted above it and the `+ systemPrompt` line changes to `+ lazyPromptBody`.
4. `/webhook` call site gains two trailing arguments: `priorStage, isLeadSourceEvent`.
5. `/train` system message gains the marker-preservation clause and drops the em-dash.

If `git status` shows any other modified file, abort and ask Anthony.

---

## Rollback plan

If Phase F is misbehaving in staging:
- `git checkout main -- sales-bot/src/index.js` reverts the file locally.
- Or `git reset --hard main` if the feature branch should be fully reset.
- No production deploy happened; production Worker still runs Phase G1 unchanged.

If Phase F is misbehaving in production AFTER we deploy:
- `wrangler rollback` to the prior version (`a0858eed-38f7-4dcc-9d44-4784b08e4086`).
- Coach Shaun's Dashboard prompt is still the OLD one (we don't flip it until after production is verified). So a rollback puts us back to current production state.

If the prompt flip in Phase G regresses behavior:
- Open Dashboard AI Behavior version history.
- Click "Restore" on the OLD prompt version.
- Worker keeps running. Lazy loader sees no `## ` markers, treats the entire prompt as `__PRELUDE__`, behavior identical to pre-Phase-F.

---

## File state after all 5 changes

- Source file should be approximately 134KB (current 130KB + ~3.5KB of new helpers and parameter changes).
- CRLF line endings preserved throughout.
- All `__name(fnName, "fnName")` registrations intact.
- No changes to imports, exports, or `index_default`.
- All other endpoints unaffected.
