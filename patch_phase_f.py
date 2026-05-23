#!/usr/bin/env python3
"""
patch_phase_f.py

Applies the 5 Phase F changes to sales-bot/src/index.js.

Source-of-truth verification: anchors verified against GitHub main branch
on 2026-05-21 against deployed Worker version a0858eed (Phase G1).

USAGE
-----
Dry run (recommended first):
    python patch_phase_f.py --dry-run

Apply:
    python patch_phase_f.py

Custom path:
    python patch_phase_f.py --path "C:\\Users\\Order Account\\botos-platform\\sales-bot\\src\\index.js"

EXIT CODES
----------
0: success (changes applied or dry-run printed)
1: file not found
2: anchor not found in file
3: anchor matched more than once (ambiguous patch)
4: file write failed
5: idempotency check failed (script already ran, file already patched)
"""

import argparse
import os
import sys
from pathlib import Path


DEFAULT_PATH = r"C:\Users\Order Account\botos-platform\sales-bot\src\index.js"


# ─────────────────────────────────────────────────────────────────────
# Patches: ordered list of (label, old_str, new_str) tuples.
# Strings use LF line endings; the patcher normalises CRLF/LF at runtime
# so the same anchor matches Windows-checked-out files.
# ─────────────────────────────────────────────────────────────────────

PATCHES = []


# ─── Change 1: add parseSystemPrompt, decideRequestedSections, constants ──
CHANGE_1_OLD = '''__name(embedQueryText, "embedQueryText");

__name(callClaude, "callClaude");'''

CHANGE_1_NEW = '''__name(embedQueryText, "embedQueryText");

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
  const lines = promptText.split(/\\r?\\n/);
  let currentName = "__PRELUDE__";
  let currentBody = [];
  for (const line of lines) {
    const headerMatch = /^##\\s+(.+?)\\s*$/.exec(line);
    if (headerMatch) {
      sections[currentName] = currentBody.join("\\n").trim();
      currentName = headerMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections[currentName] = currentBody.join("\\n").trim();
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

__name(callClaude, "callClaude");'''

PATCHES.append(("Change 1: add parseSystemPrompt + decideRequestedSections helpers", CHANGE_1_OLD, CHANGE_1_NEW))


# ─── Change 2: callClaude signature ────────────────────────────────────────
CHANGE_2_OLD = '''async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}) {'''

CHANGE_2_NEW = '''async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}, priorStage = null, hasLeadSourceEvent = false) {'''

PATCHES.append(("Change 2: callClaude signature gains priorStage and hasLeadSourceEvent", CHANGE_2_OLD, CHANGE_2_NEW))


# ─── Change 3: staticPrefix lazy-load ──────────────────────────────────────
CHANGE_3_OLD = '''  const staticPrefix =
    learningsSection +
    documentSection +
    campaignSection +
    systemPrompt;

  const dynamicSuffix =
    welcomeSection +
    leadSourceSection +
    reEngagementSection;'''

CHANGE_3_NEW = '''  // Phase F (2026-05-21): parse the bot's system_prompt into named sections
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
      return `## ${name}\\n${body}`;
    })
    .filter(s => s && s.length > 0)
    .join("\\n\\n");

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
    reEngagementSection;'''

PATCHES.append(("Change 3: staticPrefix uses lazyPromptBody instead of full systemPrompt", CHANGE_3_OLD, CHANGE_3_NEW))


# ─── Change 4: /webhook call site ──────────────────────────────────────────
CHANGE_4_OLD = '''        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig);'''

CHANGE_4_NEW = '''        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig, priorStage, isLeadSourceEvent);'''

PATCHES.append(("Change 4: /webhook call site passes priorStage and isLeadSourceEvent", CHANGE_4_OLD, CHANGE_4_NEW))


# ─── Change 5: /train system message ───────────────────────────────────────
# IMPORTANT: original contains a literal em-dash (U+2014) at "JSON object — no markdown".
# This script writes the new string with no em-dashes.
CHANGE_5_OLD = '''            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting. Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object \u2014 no markdown, no preamble.",'''

CHANGE_5_NEW = '''            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting, especially any '## SECTION_NAME' markdown headers (these are load-bearing, the runtime parses sections by these markers). Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object, no markdown, no preamble.",'''

PATCHES.append(("Change 5: /train system message preserves ## markers and removes em-dash", CHANGE_5_OLD, CHANGE_5_NEW))


# ─────────────────────────────────────────────────────────────────────
# Patcher logic
# ─────────────────────────────────────────────────────────────────────

def normalise_line_endings(text):
    """Convert any line endings to LF for matching purposes.
    The original file's line ending style is captured separately and restored."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def detect_line_ending(text):
    """Return the line ending style used by the file."""
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def count_occurrences(haystack, needle):
    """Count non-overlapping occurrences of needle in haystack."""
    if not needle:
        return 0
    count = 0
    start = 0
    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            break
        count += 1
        start = idx + len(needle)
    return count


def apply_patches(content, dry_run=False):
    """Apply all patches to the content (LF-normalised). Returns (new_content, summary_list)."""
    summary = []

    for label, old_str, new_str in PATCHES:
        old_normalised = normalise_line_endings(old_str)
        new_normalised = normalise_line_endings(new_str)

        # Check if already applied (idempotency)
        if new_normalised in content and old_normalised not in content:
            summary.append({
                "label": label,
                "status": "ALREADY_APPLIED",
                "detail": "new_str already present, old_str absent. Skipping."
            })
            continue

        # Count occurrences of old_str
        occurrences = count_occurrences(content, old_normalised)

        if occurrences == 0:
            summary.append({
                "label": label,
                "status": "ANCHOR_NOT_FOUND",
                "detail": f"old_str (len={len(old_normalised)}) does not appear in file. First 80 chars of anchor: {repr(old_normalised[:80])}"
            })
            return None, summary

        if occurrences > 1:
            summary.append({
                "label": label,
                "status": "AMBIGUOUS_ANCHOR",
                "detail": f"old_str matches {occurrences} times. Must be unique. First 80 chars: {repr(old_normalised[:80])}"
            })
            return None, summary

        # Apply
        if dry_run:
            summary.append({
                "label": label,
                "status": "WOULD_APPLY",
                "detail": f"Anchor found exactly once at position {content.find(old_normalised)}. Would replace {len(old_normalised)} chars with {len(new_normalised)} chars."
            })
        else:
            content = content.replace(old_normalised, new_normalised, 1)
            summary.append({
                "label": label,
                "status": "APPLIED",
                "detail": f"Replaced {len(old_normalised)} chars with {len(new_normalised)} chars. Net delta: {len(new_normalised) - len(old_normalised):+d} chars."
            })

    return content, summary


def main():
    parser = argparse.ArgumentParser(description="Apply Phase F patches to sales-bot/src/index.js")
    parser.add_argument("--path", default=DEFAULT_PATH, help="Path to index.js")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        sys.exit(1)

    # Read file as bytes, decode as UTF-8 (the source file is UTF-8)
    raw_bytes = path.read_bytes()
    try:
        original_text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as e:
        print(f"ERROR: file is not valid UTF-8: {e}", file=sys.stderr)
        sys.exit(1)

    line_ending = detect_line_ending(original_text)
    original_size = len(raw_bytes)
    print(f"Source file: {path}")
    print(f"Size: {original_size} bytes")
    print(f"Line ending: {repr(line_ending)}")
    print(f"Mode: {'DRY RUN (no write)' if args.dry_run else 'APPLY'}")
    print()

    # Normalise to LF for matching
    normalised = normalise_line_endings(original_text)

    # Apply patches
    new_content, summary = apply_patches(normalised, dry_run=args.dry_run)

    # Print summary
    print("=" * 78)
    print(f"{'#':<3} {'Status':<18} Label")
    print("-" * 78)
    failed = False
    applied_count = 0
    for i, item in enumerate(summary, 1):
        marker = "OK " if item["status"] in ("APPLIED", "WOULD_APPLY", "ALREADY_APPLIED") else "!! "
        if item["status"] not in ("APPLIED", "WOULD_APPLY", "ALREADY_APPLIED"):
            failed = True
        if item["status"] == "APPLIED":
            applied_count += 1
        print(f"{i:<3} {marker}{item['status']:<15} {item['label']}")
        print(f"    {item['detail']}")
    print("=" * 78)

    if failed:
        print()
        print("FAILED. No changes written. See errors above.")
        sys.exit(2)

    if new_content is None:
        print()
        print("FAILED (new_content is None). No changes written.")
        sys.exit(2)

    if args.dry_run:
        print()
        print(f"Dry run complete. Would apply {len([s for s in summary if s['status'] == 'WOULD_APPLY'])} patches.")
        sys.exit(0)

    # Restore line endings
    if line_ending != "\n":
        new_content = new_content.replace("\n", line_ending)

    # Write back
    new_bytes = new_content.encode("utf-8")
    try:
        path.write_bytes(new_bytes)
    except OSError as e:
        print(f"ERROR: write failed: {e}", file=sys.stderr)
        sys.exit(4)

    new_size = len(new_bytes)
    print()
    print(f"SUCCESS. Wrote {new_size} bytes ({new_size - original_size:+d} bytes vs original).")
    print(f"Applied {applied_count} of {len(PATCHES)} patches.")
    print()
    print("Next steps:")
    print("  1. git diff sales-bot/src/index.js")
    print("  2. Verify 5 distinct sections changed and nothing else")
    print("  3. wrangler deploy --env staging")


if __name__ == "__main__":
    main()
