"""
fix_all_stages.py
Run from: C:\\Users\\Order Account\\botos-platform\\dashboard\\src\\pages\\

Usage:
  python fix_all_stages.py

Fixes stage name references in:
  - Inbox.jsx      (STAGES array, intentBadgeStyle, intentEmoji, inline 'CALL BOOKING' checks)
  - Dashboard.jsx  (STAGE_PRIORITY, intentInfo, stageColor)
  - Analytics.jsx  (STAGE_SEQUENCE)
  - Tester.jsx     (STAGES array) — in case it wasn't already updated
"""

import os, sys

# ─── Run from src/pages dir or pass path as argument ────────────────────────
BASE = sys.argv[1] if len(sys.argv) > 1 else '.'

FIXES = {

  # ══════════════════════════════════════════════════════════════════════════
  'Inbox.jsx': [

    # 1. STAGES constant
    (
      """const STAGES = ['ENTRY / OPEN LOOP','LOCATION ANCHOR','GOAL LOCK','GOAL DEPTH (MAKE IT SPECIFIC)',"WHAT THEY'VE TRIED (PAST + CURRENT)",'TRANSLATION / PROGRESS CHECK','BODY LINK ACCEPTANCE + MOBILITY HISTORY','PROGRESS CHECK','PRIORITY GATE','COACHING HAT','CALL BOOK BRIDGE','CALL OFFERED','CALL BOOKING','LONG TERM NURTURE']""",
      """const STAGES = ['HOOK / ENTRY','GOAL','DIAGNOSTIC','INSIGHT','PRIORITY','DECISION','INVITE','SCHEDULE','BOOKED','FOLLOW-UP']"""
    ),

    # 2. intentBadgeStyle
    (
      """  function intentBadgeStyle(intent, stage) {
    if (stage === 'CALL BOOKING') return { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }""",
      """  function intentBadgeStyle(intent, stage) {
    if (stage === 'BOOKED' || stage === 'SCHEDULE') return { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }"""
    ),

    # 3. intentEmoji
    (
      """  function intentEmoji(intent, stage) {
    if (stage === 'CALL BOOKING') return '\\u2705'""",
      """  function intentEmoji(intent, stage) {
    if (stage === 'BOOKED' || stage === 'SCHEDULE') return '\\u2705'"""
    ),

    # 4. Inline header badge label check
    (
      """selectedLead.conversation_stage === 'CALL BOOKING' ? 'Booked' : selectedLead.lead_intent""",
      """(selectedLead.conversation_stage === 'BOOKED' || selectedLead.conversation_stage === 'SCHEDULE') ? 'Booked' : selectedLead.lead_intent"""
    ),
  ],

  # ══════════════════════════════════════════════════════════════════════════
  'Dashboard.jsx': [

    # 1. STAGE_PRIORITY
    (
      """const STAGE_PRIORITY = {
  'CALL BOOKING': 14, 'CALL OFFERED': 13, 'CALL BOOK BRIDGE': 12,
  'COACHING HAT': 11, 'PRIORITY GATE': 10, 'PROGRESS CHECK': 9,
  'BODY LINK ACCEPTANCE + MOBILITY HISTORY': 8, 'TRANSLATION / PROGRESS CHECK': 7,
  "WHAT THEY'VE TRIED (PAST + CURRENT)": 6, 'GOAL DEPTH (MAKE IT SPECIFIC)': 5,
  'GOAL LOCK': 4, 'LOCATION ANCHOR': 3, 'OPEN LOOP': 2, 'ENTRY / OPEN LOOP': 2,
  'ENTRY': 1, 'LONG TERM NURTURE': 0
}""",
      """const STAGE_PRIORITY = {
  'BOOKED': 9, 'SCHEDULE': 8, 'INVITE': 7,
  'DECISION': 6, 'PRIORITY': 5, 'INSIGHT': 4,
  'DIAGNOSTIC': 3, 'GOAL': 2, 'HOOK / ENTRY': 1,
  'FOLLOW-UP': 0
}"""
    ),

    # 2. intentInfo — checks CALL BOOKING
    (
      """  function intentInfo(intent, stage) {
    if (stage === 'CALL BOOKING') return { emoji: '✅', label: 'Booked', color: '#16a34a', bg: '#f0fdf4', border: '1px solid #bbf7d0' }""",
      """  function intentInfo(intent, stage) {
    if (stage === 'BOOKED' || stage === 'SCHEDULE') return { emoji: '✅', label: 'Booked', color: '#16a34a', bg: '#f0fdf4', border: '1px solid #bbf7d0' }"""
    ),

    # 3. stageColor — checks old keywords
    (
      """  function stageColor(stage) {
    if (!stage) return '#829082'
    if (stage.includes('CALL')) return '#1a4d8a'
    if (stage.includes('PRIORITY') || stage.includes('COACHING')) return '#a06800'
    return '#2d6a4f'
  }""",
      """  function stageColor(stage) {
    if (!stage) return '#829082'
    if (stage === 'BOOKED' || stage === 'SCHEDULE' || stage === 'INVITE' || stage === 'DECISION') return '#1a4d8a'
    if (stage === 'PRIORITY') return '#a06800'
    return '#2d6a4f'
  }"""
    ),
  ],

  # ══════════════════════════════════════════════════════════════════════════
  'Analytics.jsx': [

    # 1. STAGE_SEQUENCE
    (
      """const STAGE_SEQUENCE = [
  'ENTRY / OPEN LOOP', 'ENTRY', 'OPEN LOOP', 'LOCATION ANCHOR', 'GOAL LOCK',
  'GOAL DEPTH (MAKE IT SPECIFIC)', "WHAT THEY'VE TRIED (PAST + CURRENT)",
  'TRANSLATION / PROGRESS CHECK', 'BODY LINK ACCEPTANCE + MOBILITY HISTORY',
  'PROGRESS CHECK', 'PRIORITY GATE', 'COACHING HAT', 'CALL BOOK BRIDGE',
  'CALL OFFERED', 'CALL BOOKING', 'LONG TERM NURTURE'
]""",
      """const STAGE_SEQUENCE = [
  'HOOK / ENTRY', 'GOAL', 'DIAGNOSTIC', 'INSIGHT',
  'PRIORITY', 'DECISION', 'INVITE', 'SCHEDULE', 'BOOKED', 'FOLLOW-UP'
]"""
    ),
  ],

  # ══════════════════════════════════════════════════════════════════════════
  'Tester.jsx': [

    # 1. STAGES array (in case not already patched)
    (
      """const STAGES = [
  'ENTRY / OPEN LOOP',
  'LOCATION ANCHOR',
  'GOAL LOCK',
  'GOAL DEPTH (MAKE IT SPECIFIC)',
  \"WHAT THEY'VE TRIED (PAST + CURRENT)\",
  'TRANSLATION / PROGRESS CHECK',
  'BODY LINK ACCEPTANCE + MOBILITY HISTORY',
  'PROGRESS CHECK',
  'PRIORITY GATE',
  'COACHING HAT',
  'CALL BOOK BRIDGE',
  'CALL OFFERED',
  'CALL BOOKING',
  'LONG TERM NURTURE'""",
      """const STAGES = [
  'HOOK / ENTRY',
  'GOAL',
  'DIAGNOSTIC',
  'INSIGHT',
  'PRIORITY',
  'DECISION',
  'INVITE',
  'SCHEDULE',
  'BOOKED',
  'FOLLOW-UP'"""
    ),
  ],
}

# ─── Apply all fixes ─────────────────────────────────────────────────────────
total_changes = 0
total_files   = 0

for filename, replacements in FIXES.items():
  path = os.path.join(BASE, filename)
  if not os.path.exists(path):
    print(f'⚠  {filename} not found at {path} — skipped')
    continue

  with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

  file_changes = 0
  for old, new in replacements:
    if old in content:
      content = content.replace(old, new)
      file_changes += 1
      total_changes += 1
      print(f'  ✓ {filename}: replaced "{old[:60].strip()}..."')
    else:
      print(f'  ⚠  {filename}: pattern not found — "{old[:60].strip()}..."')
      print(f'     (may already be updated, or whitespace differs)')

  if file_changes > 0:
    with open(path, 'w', encoding='utf-8') as f:
      f.write(content)
    total_files += 1
    print(f'  → Saved {filename} ({file_changes} change{"s" if file_changes > 1 else ""})\n')
  else:
    print(f'  → No changes needed in {filename}\n')

print('═' * 50)
print(f'Done — {total_changes} replacements across {total_files} file(s)')
print()
print('Next step: rebuild and deploy')
print('  cd "C:\\Users\\Order Account\\botos-platform\\dashboard"')
print('  npm run build')
print('  wrangler pages deploy dist --project-name=botos-platform')
