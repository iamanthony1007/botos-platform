# patch_soft_close_guard.py
# Anchored patcher: adds the soft-close guard to runFollowUpCron in
# sales-bot/src/index.js. CRLF-preserving. Pure ASCII source (curly
# apostrophes in regexes are written as ’ escapes for the JS engine).
#
# Usage:
#   python patch_soft_close_guard.py            (dry run: verify anchors, print diff)
#   python patch_soft_close_guard.py --apply    (write the patched file)
#
# Edits:
#   E1-E4  extractLastUserAndBotMessage: also capture/return lastUserText
#   E5     new functions looksLikeSoftClose + looksLikeLeadPark after
#          looksLikeEscalationHandoff
#   E6     cron loop destructure: pick up lastUserText
#   E7     stats.skipped: add soft_close counter
#   E8     cron loop: skip on soft close, right after escalation_handoff skip

import sys
import difflib

PATH = r"C:\Users\Order Account\botos-platform\sales-bot\src\index.js"
APPLY = "--apply" in sys.argv

def crlf(s):
    return s.replace("\n", "\r\n")

EDITS = []

def edit(name, old, new):
    EDITS.append((name, crlf(old), crlf(new)))

# E1: early return includes lastUserText
edit("E1 early-return",
"""    return { lastUserAtMs: null, lastBotAtMs: null, lastMsgRole: null, lastBotText: null };
""",
"""    return { lastUserAtMs: null, lastBotAtMs: null, lastMsgRole: null, lastBotText: null, lastUserText: null };
""")

# E2: declare lastUserText
edit("E2 declare",
"""  let lastUserAtMs = null;
  let lastBotAtMs = null;
  let lastBotText = null;
""",
"""  let lastUserAtMs = null;
  let lastBotAtMs = null;
  let lastBotText = null;
  let lastUserText = null;
""")

# E3: capture lastUserText alongside lastUserAtMs
edit("E3 capture",
"""    if (role === "user" && lastUserAtMs === null && tsValid) {
      lastUserAtMs = ts;
    }
""",
"""    if (role === "user" && lastUserAtMs === null && tsValid) {
      lastUserAtMs = ts;
      lastUserText = typeof m.content === "string" ? m.content : null;
    }
""")

# E4: final return includes lastUserText
edit("E4 final-return",
"""  return { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText };
""",
"""  return { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText, lastUserText };
""")

# E5: the two matcher functions, inserted after looksLikeEscalationHandoff
edit("E5 matchers",
"""__name(looksLikeEscalationHandoff, "looksLikeEscalationHandoff");
""",
"""__name(looksLikeEscalationHandoff, "looksLikeEscalationHandoff");

// ---------------------------------------------------------------------------
// Soft-close guard (2026-06-10). Skips the T+20h nudge for leads who politely
// PARKED the conversation rather than going silent. Two signals, both cheap
// string matching (token-neutral, no Claude call, no extra Supabase reads):
//   1. looksLikeSoftClose(lastBotText): the bot's own last message is a
//      sign-off acknowledgement, e.g. "No worries, enjoy the call. We'll pick
//      this up another time." CRITICAL question gate: a trailing "?" means
//      the bot re-engaged with a question, so a silent lead IS a legitimate
//      nudge target and is NOT treated as a soft close. Production data:
//      about half of "no worries" acks end in a question and must still nudge.
//   2. looksLikeLeadPark(lastUserText): the lead's last message explicitly
//      parked ("about to get on a Teams call, have a nice day") even when the
//      bot re-engaged with a question afterwards.
// Phrase lists are data-grounded from a 60-day production scan (2026-06-10):
// the combined rule suppressed 8/8 genuinely tone-deaf nudges with zero false
// suppressions among fired follow-ups. Deliberately NOT matched because they
// are too generic: bare "later", bare "thanks" / "appreciate it", bare
// "not now". Curly apostrophes (\\u2019) are matched because Instagram leads
// often type them.
// ---------------------------------------------------------------------------
function looksLikeSoftClose(text) {
  if (!text || typeof text !== "string") return false;
  // Question gate: the bot asked something and is awaiting a reply.
  if (text.trim().endsWith("?")) return false;
  const patterns = [
    /\\bno (worries|rush|pressure|dramas|problem)\\b/i,
    /\\b(all|sounds) good\\b/i,
    /\\benjoy (the|your) (call|day|meeting|weekend|rest)\\b/i,
    /\\bpick (this|it) (back )?up (another time|later|tomorrow|whenever)\\b/i,
    /\\banother time\\b/i,
    /\\bwhen(ever)? you(['\\u2019]re| are)? ready\\b/i,
    /\\bwhen the time(['\\u2019]s| is) right\\b/i,
    /\\b(take your|in your own) time\\b/i,
    /\\b(talk|speak|chat|catch up) (soon|later)\\b/i,
    /\\breach out (any ?time|whenever)\\b/i,
    /\\bi['\\u2019]?m here (if|when|whenever) you\\b/i,
    /\\bgood luck\\b/i,
    /\\ball the best\\b/i,
    /\\btake care\\b/i,
    /\\bhave a (nice|good|great) (day|weekend|one|evening)\\b/i,
    /free content[\\s\\S]{0,80}when you(['\\u2019]re| are) ready/i
  ];
  return patterns.some(re => re.test(text));
}
__name(looksLikeSoftClose, "looksLikeSoftClose");

function looksLikeLeadPark(text) {
  if (!text || typeof text !== "string") return false;
  const patterns = [
    /\\bhave a (nice|good|great) (day|weekend|evening)\\b/i,
    /\\bon a (teams|zoom|work) call\\b/i,
    /\\bin a meeting\\b/i,
    /\\b(get|circle|reach) back to you (later|tomorrow|next week|soon)\\b/i,
    /\\bpick (this|it) (back )?up (another time|later)\\b/i,
    /\\b(talk|speak) (soon|later)\\b/i,
    /\\bbeen (sick|busy|away)\\b/i,
    /\\bnot (doing much|much) (right now|at the moment)\\b/i,
    /\\bwill (continue to )?follow\\b/i,
    /\\bkeep following\\b/i,
    /\\bnot (right now|at the moment)\\b/i,
    /\\b(do not|don['\\u2019]?t) want to (continue|chat)\\b/i
  ];
  return patterns.some(re => re.test(text));
}
__name(looksLikeLeadPark, "looksLikeLeadPark");
""")

# E6: destructure lastUserText in the cron loop
edit("E6 destructure",
"""    const { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText } =
      extractLastUserAndBotMessage(msgs);
""",
"""    const { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText, lastUserText } =
      extractLastUserAndBotMessage(msgs);
""")

# E7: stats counter
edit("E7 stats",
"""      booking_link: 0,
      escalation_handoff: 0,
""",
"""      booking_link: 0,
      escalation_handoff: 0,
      soft_close: 0,
""")

# E8: the skip, right after the escalation_handoff skip
edit("E8 skip",
"""    if (looksLikeEscalationHandoff(lastBotText)) { stats.skipped.escalation_handoff++; continue; }
""",
"""    if (looksLikeEscalationHandoff(lastBotText)) { stats.skipped.escalation_handoff++; continue; }

    // Soft-close guard: the lead politely parked, or the bot signed off
    // without a question. A nudge here is tone-deaf. See looksLikeSoftClose.
    if (looksLikeSoftClose(lastBotText) || looksLikeLeadPark(lastUserText)) {
      stats.skipped.soft_close++; continue;
    }
""")

with open(PATH, "r", encoding="utf-8", newline="") as f:
    src = f.read()

# Sanity: file must be pure CRLF (no lone LF) so the crlf() anchors are exact.
lone_lf = src.replace("\r\n", "").count("\n")
print(f"file bytes={len(src)} lone-LF count={lone_lf}")
if lone_lf != 0:
    print("FAIL: file is not pure CRLF; aborting.")
    sys.exit(1)

patched = src
ok = True
for name, old, new in EDITS:
    n = patched.count(old)
    if n != 1:
        print(f"FAIL {name}: anchor found {n} times (need exactly 1)")
        ok = False
        continue
    patched = patched.replace(old, new, 1)
    print(f"ok   {name}: anchor unique, replaced")

if not ok:
    print("ABORT: one or more anchors failed. No changes written.")
    sys.exit(1)

# Diff for review
diff = difflib.unified_diff(
    src.splitlines(keepends=False),
    patched.splitlines(keepends=False),
    fromfile="index.js (current)",
    tofile="index.js (patched)",
    lineterm="",
    n=3,
)
print("\n----- UNIFIED DIFF -----")
for line in diff:
    print(line)
print("----- END DIFF -----\n")

if APPLY:
    with open(PATH, "w", encoding="utf-8", newline="") as f:
        f.write(patched)
    print("APPLIED: file written (CRLF preserved).")
else:
    print("DRY RUN: no changes written. Re-run with --apply to write.")
