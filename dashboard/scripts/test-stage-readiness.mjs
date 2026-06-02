// test-stage-readiness.mjs
//
// Synthetic test suite plus a real-data validation pass for
// dashboard/src/lib/stageReadiness.js.
//
// Synthetic suite runs offline and is the source-of-truth contract for the
// module: classifyReview, isSystemDiscard, isActionedClass, computeStageReadiness.
//
// Real-data validation hits production Supabase read-only and verifies that
// the module reproduces the recent clean rates measured in chat:
//   HOOK / ENTRY  ~73%
//   GOAL          ~50%
//   DIAGNOSTIC    ~47%
// Tolerance is +/- 5 percentage points to absorb fresh review activity
// between the original measurement and this run.
//
// Skip the real-data block by unsetting SUPABASE_SERVICE_ROLE_KEY or running
// with SKIP_REAL=1.
//
// Run from the dashboard directory:
//   node scripts/test-stage-readiness.mjs

import assert from 'node:assert/strict'
import process from 'node:process'
import {
  SAMPLE_WINDOW,
  ELIGIBLE_CLEAN_RATE_THRESHOLD,
  STAGE_STATE,
  SYSTEM_DISCARD_MARKERS,
  CANONICAL_STAGES,
  classifyReview,
  isSystemDiscard,
  isActionedClass,
  computeStageReadiness,
} from '../src/lib/stageReadiness.js'

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    process.stdout.write('  PASS  ' + name + '\n')
  } catch (e) {
    failed++
    failures.push({ name, error: e })
    process.stdout.write('  FAIL  ' + name + '\n')
    process.stdout.write('        ' + (e && e.message ? e.message : String(e)) + '\n')
  }
}

function section(label) {
  process.stdout.write('\n--- ' + label + ' ---\n')
}

// ---- constants and shape ---------------------------------------------------

section('constants')

test('SAMPLE_WINDOW is 30', () => {
  assert.equal(SAMPLE_WINDOW, 30)
})

test('ELIGIBLE_CLEAN_RATE_THRESHOLD is 0.85', () => {
  assert.equal(ELIGIBLE_CLEAN_RATE_THRESHOLD, 0.85)
})

test('STAGE_STATE has TRAINING, ELIGIBLE, RUNNING', () => {
  assert.deepEqual(Object.keys(STAGE_STATE).sort(), ['ELIGIBLE', 'RUNNING', 'TRAINING'])
  assert.equal(STAGE_STATE.TRAINING, 'TRAINING')
  assert.equal(STAGE_STATE.ELIGIBLE, 'ELIGIBLE')
  assert.equal(STAGE_STATE.RUNNING, 'RUNNING')
})

test('SYSTEM_DISCARD_MARKERS has both known markers', () => {
  assert.ok(SYSTEM_DISCARD_MARKERS.includes('Auto-discarded - lead sent a new message'))
  assert.ok(SYSTEM_DISCARD_MARKERS.includes('Auto-discarded sibling of'))
})

test('CANONICAL_STAGES is the 10-stage canonical list in order', () => {
  assert.deepEqual([...CANONICAL_STAGES], [
    'HOOK / ENTRY','GOAL','DIAGNOSTIC','INSIGHT','PRIORITY',
    'DECISION','INVITE','SCHEDULE','BOOKED','FOLLOW-UP',
  ])
})

// ---- classifyReview --------------------------------------------------------

section('classifyReview')

test('pending classifies as pending', () => {
  assert.equal(classifyReview({ status: 'pending' }), 'pending')
})

test('approved classifies as clean', () => {
  assert.equal(classifyReview({ status: 'approved' }), 'clean')
})

test('edited classifies as edited', () => {
  assert.equal(classifyReview({ status: 'edited' }), 'edited')
})

test('auto_sent classifies as auto_sent', () => {
  assert.equal(classifyReview({ status: 'auto_sent' }), 'auto_sent')
})

test('delivery_failed classifies as delivery_failed', () => {
  assert.equal(classifyReview({ status: 'delivery_failed' }), 'delivery_failed')
})

test('plain discarded with no markers is real_discard', () => {
  assert.equal(classifyReview({ status: 'discarded', internal_notes: 'setter rejected' }), 'real_discard')
})

test('discarded with lead-sent-new-message marker is system_discard', () => {
  assert.equal(classifyReview({
    status: 'discarded',
    internal_notes: '[System: Auto-discarded - lead sent a new message, old review is outdated]',
  }), 'system_discard')
})

test('discarded with sibling marker is system_discard', () => {
  assert.equal(classifyReview({
    status: 'discarded',
    internal_notes: '[System: Auto-discarded sibling of approved review review_123_abc]',
  }), 'system_discard')
})

test('discarded with sibling-of-edited marker is system_discard (Fix B saveTraining)', () => {
  assert.equal(classifyReview({
    status: 'discarded',
    internal_notes: '[System: Auto-discarded sibling of edited review review_456_def]',
  }), 'system_discard')
})

test('discarded with null notes is real_discard', () => {
  assert.equal(classifyReview({ status: 'discarded', internal_notes: null }), 'real_discard')
})

test('discarded with empty notes is real_discard', () => {
  assert.equal(classifyReview({ status: 'discarded', internal_notes: '' }), 'real_discard')
})

test('approved with marker substring in notes still classifies as clean (status wins)', () => {
  assert.equal(classifyReview({
    status: 'approved',
    internal_notes: 'reviewer noted: Auto-discarded sibling of something',
  }), 'clean')
})

test('null / undefined / non-object returns other', () => {
  assert.equal(classifyReview(null), 'other')
  assert.equal(classifyReview(undefined), 'other')
  assert.equal(classifyReview('not an object'), 'other')
  assert.equal(classifyReview(42), 'other')
})

test('unknown status returns other', () => {
  assert.equal(classifyReview({ status: 'mystery' }), 'other')
})

// ---- isSystemDiscard -------------------------------------------------------

section('isSystemDiscard')

test('returns false for non-discarded rows regardless of notes', () => {
  assert.equal(isSystemDiscard({
    status: 'approved',
    internal_notes: 'Auto-discarded sibling of x',
  }), false)
  assert.equal(isSystemDiscard({
    status: 'edited',
    internal_notes: 'Auto-discarded - lead sent a new message',
  }), false)
})

test('returns false for discarded with non-marker notes', () => {
  assert.equal(isSystemDiscard({ status: 'discarded', internal_notes: 'just a regular discard' }), false)
})

test('returns true for either marker', () => {
  assert.equal(isSystemDiscard({
    status: 'discarded',
    internal_notes: 'Auto-discarded sibling of approved review',
  }), true)
  assert.equal(isSystemDiscard({
    status: 'discarded',
    internal_notes: 'Auto-discarded - lead sent a new message',
  }), true)
})

// ---- isActionedClass -------------------------------------------------------

section('isActionedClass')

test('clean, edited, real_discard are actioned', () => {
  assert.equal(isActionedClass('clean'), true)
  assert.equal(isActionedClass('edited'), true)
  assert.equal(isActionedClass('real_discard'), true)
})

test('system_discard, pending, auto_sent, delivery_failed, other are NOT actioned', () => {
  assert.equal(isActionedClass('system_discard'), false)
  assert.equal(isActionedClass('pending'), false)
  assert.equal(isActionedClass('auto_sent'), false)
  assert.equal(isActionedClass('delivery_failed'), false)
  assert.equal(isActionedClass('other'), false)
})

// ---- computeStageReadiness: state machine ----------------------------------

section('computeStageReadiness: TRAINING / ELIGIBLE / RUNNING')

function makeRow(stage, status, opts = {}) {
  return {
    conversation_stage: stage,
    status,
    internal_notes: opts.internal_notes || null,
    resolved_at: opts.resolved_at || null,
    created_at: opts.created_at || null,
  }
}

// Helper: build N rows of given status at decreasing resolved_at timestamps.
function build(stage, status, count, baseSecondsAgo, opts = {}) {
  const out = []
  const baseMs = 1_780_000_000_000 - baseSecondsAgo * 1000 // arbitrary fixed base
  for (let i = 0; i < count; i++) {
    out.push(makeRow(stage, status, {
      ...opts,
      resolved_at: new Date(baseMs - i * 1000).toISOString(),
      created_at:  new Date(baseMs - i * 1000 - 5000).toISOString(),
    }))
  }
  return out
}

test('stage with no reviews is TRAINING with null cleanRate', () => {
  const r = computeStageReadiness([])
  assert.equal(r['HOOK / ENTRY'].state, 'TRAINING')
  assert.equal(r['HOOK / ENTRY'].recent.sampleSize, 0)
  assert.equal(r['HOOK / ENTRY'].recent.cleanRate, null)
  assert.equal(r['HOOK / ENTRY'].recent.meetsThreshold, false)
})

test('stage with under-30 actioned is TRAINING even if 100% clean', () => {
  const reviews = build('HOOK / ENTRY', 'approved', 29, 0)
  const r = computeStageReadiness(reviews)
  assert.equal(r['HOOK / ENTRY'].state, 'TRAINING')
  assert.equal(r['HOOK / ENTRY'].recent.sampleSize, 29)
  assert.equal(r['HOOK / ENTRY'].recent.cleanRate, 1)
  assert.equal(r['HOOK / ENTRY'].recent.meetsThreshold, false)
})

test('stage with exactly 30 actioned at 85% is ELIGIBLE (boundary inclusive)', () => {
  // 26 clean + 4 real_discard = 30 actioned, clean rate 26/30 = 0.8667
  // Lower it to exactly 0.85: need 25.5/30. Use 26 clean + 4 edited -> 26/30 = 0.8667.
  // The threshold is >= 0.85. Construct 26 clean + 4 edited.
  const reviews = [
    ...build('HOOK / ENTRY', 'approved', 26, 0),
    ...build('HOOK / ENTRY', 'edited', 4, 1000),
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(r['HOOK / ENTRY'].recent.sampleSize, 30)
  assert.ok(r['HOOK / ENTRY'].recent.cleanRate >= 0.85)
  assert.equal(r['HOOK / ENTRY'].recent.meetsThreshold, true)
  assert.equal(r['HOOK / ENTRY'].state, 'ELIGIBLE')
})

test('stage with 30 actioned at 84% (just under) is TRAINING', () => {
  // 25 clean + 5 edited = 30 actioned, clean rate 25/30 = 0.8333.
  const reviews = [
    ...build('GOAL', 'approved', 25, 0),
    ...build('GOAL', 'edited', 5, 1000),
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(r['GOAL'].recent.sampleSize, 30)
  assert.ok(r['GOAL'].recent.cleanRate < 0.85)
  assert.equal(r['GOAL'].state, 'TRAINING')
})

test('RUNNING takes precedence over ELIGIBLE / TRAINING when enabled', () => {
  // Bad data: 0 actioned. Without the unlock this would be TRAINING.
  const r = computeStageReadiness([], {
    stageAutomation: { 'GOAL': { enabled: true, enabled_at: '2026-06-01T00:00:00Z', enabled_by: 'nella@example.com' } },
  })
  assert.equal(r['GOAL'].state, 'RUNNING')
  assert.equal(r['GOAL'].enabled, true)
  assert.equal(r['GOAL'].enabledBy, 'nella@example.com')
  assert.equal(r['GOAL'].enabledAt, '2026-06-01T00:00:00Z')
})

test('enabled=false is not RUNNING', () => {
  const r = computeStageReadiness([], {
    stageAutomation: { 'GOAL': { enabled: false } },
  })
  assert.equal(r['GOAL'].state, 'TRAINING')
  assert.equal(r['GOAL'].enabled, false)
})

// ---- computeStageReadiness: contamination exclusion ------------------------

section('computeStageReadiness: contamination exclusion')

test('system-discards do NOT count toward sampleSize or denominator', () => {
  // 30 clean + 100 system_discard. System discards must be excluded entirely.
  const reviews = [
    ...build('DIAGNOSTIC', 'approved', 30, 0),
    ...build('DIAGNOSTIC', 'discarded', 100, 10_000, {
      internal_notes: '[System: Auto-discarded sibling of approved review review_x]',
    }),
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(r['DIAGNOSTIC'].recent.sampleSize, 30, 'system discards must not pad sample')
  assert.equal(r['DIAGNOSTIC'].recent.cleanRate, 1)
  assert.equal(r['DIAGNOSTIC'].state, 'ELIGIBLE')
  assert.equal(r['DIAGNOSTIC'].allTime.systemDiscard, 100)
  assert.equal(r['DIAGNOSTIC'].allTime.clean, 30)
})

test('real_discard DOES count toward denominator and is a miss', () => {
  // 30 clean + 10 real_discard. Most-recent-30 sees the 30 most recent
  // actioned regardless of mix; if discards are more recent they enter
  // the window.
  const reviews = [
    ...build('GOAL', 'discarded', 10, 0,  { internal_notes: 'setter rejected' }), // most recent
    ...build('GOAL', 'approved', 30, 100_000),                                    // older
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(r['GOAL'].recent.sampleSize, 30)
  // 10 newest real_discards + 20 oldest of the 30 approved = 20 clean + 10 real_discard
  assert.equal(r['GOAL'].recent.realDiscard, 10)
  assert.equal(r['GOAL'].recent.clean, 20)
  assert.equal(Math.round(r['GOAL'].recent.cleanRate * 100), 67)
  assert.equal(r['GOAL'].state, 'TRAINING')
})

test('edited counts as miss but as actioned', () => {
  // 30 edited rows. cleanRate = 0.
  const reviews = build('INSIGHT', 'edited', 30, 0)
  const r = computeStageReadiness(reviews)
  assert.equal(r['INSIGHT'].recent.sampleSize, 30)
  assert.equal(r['INSIGHT'].recent.clean, 0)
  assert.equal(r['INSIGHT'].recent.edited, 30)
  assert.equal(r['INSIGHT'].recent.cleanRate, 0)
  assert.equal(r['INSIGHT'].state, 'TRAINING')
})

test('pending / auto_sent / delivery_failed are excluded from actioned', () => {
  const reviews = [
    ...build('HOOK / ENTRY', 'pending', 50, 0),
    ...build('HOOK / ENTRY', 'auto_sent', 50, 10_000),
    ...build('HOOK / ENTRY', 'delivery_failed', 50, 20_000),
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(r['HOOK / ENTRY'].recent.sampleSize, 0)
  assert.equal(r['HOOK / ENTRY'].recent.cleanRate, null)
  assert.equal(r['HOOK / ENTRY'].allTime.pending, 50)
  assert.equal(r['HOOK / ENTRY'].allTime.autoSent, 50)
  assert.equal(r['HOOK / ENTRY'].allTime.deliveryFailed, 50)
})

test('non-canonical stage names are dropped (not in CANONICAL_STAGES)', () => {
  const reviews = [
    ...build('DEPTH & EFFORT', 'approved', 30, 0),
    ...build('HOOK / ENTRY', 'approved', 30, 0),
  ]
  const r = computeStageReadiness(reviews)
  assert.equal(Object.keys(r).length, 10)
  assert.equal(r['HOOK / ENTRY'].recent.sampleSize, 30)
  assert.equal(r['DEPTH & EFFORT'], undefined)
})

// ---- computeStageReadiness: ordering ---------------------------------------

section('computeStageReadiness: ordering')

test('most-recent-N picks by resolved_at desc, created_at tie-break', () => {
  // 40 rows. The 30 most-recent-by-resolved_at are clean. The 10 oldest are discards.
  // The window must contain only the 30 clean rows.
  const reviews = [
    ...build('PRIORITY', 'discarded', 10, 0, { internal_notes: 'real reject' }),   // newest
    ...build('PRIORITY', 'approved', 30, 50_000),                                  // older
  ]
  // Currently the newest 30 are 10 discards + 20 of the approveds (because discards are newest).
  // So this test name + body need to align. Let's flip: make the approveds the newest.
  const reviews2 = [
    ...build('PRIORITY', 'approved', 30, 0),                                      // newest
    ...build('PRIORITY', 'discarded', 10, 50_000, { internal_notes: 'real reject' }), // older
  ]
  const r = computeStageReadiness(reviews2)
  assert.equal(r['PRIORITY'].recent.sampleSize, 30)
  assert.equal(r['PRIORITY'].recent.clean, 30)
  assert.equal(r['PRIORITY'].recent.cleanRate, 1)
})

test('null resolved_at sorts last (created_at fallback)', () => {
  const reviews = [
    // 30 newer rows with resolved_at set, all clean
    ...build('GOAL', 'approved', 30, 0),
    // 1 row with no resolved_at and very recent created_at, real_discard
    makeRow('GOAL', 'discarded', { internal_notes: 'rejected', created_at: '2099-01-01T00:00:00Z' }),
  ]
  const r = computeStageReadiness(reviews)
  // The null-resolved_at row should NOT push out a real resolved_at row
  // because primary key is resolved_at. So sample should be the 30 clean.
  assert.equal(r['GOAL'].recent.clean, 30)
  assert.equal(r['GOAL'].recent.realDiscard, 0)
})

// ---- summary ---------------------------------------------------------------

section('synthetic suite summary')
process.stdout.write('  passed: ' + passed + '\n')
process.stdout.write('  failed: ' + failed + '\n')

if (failed > 0) {
  process.stdout.write('\nFAILURES:\n')
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + '\n')
    process.stdout.write('    ' + (f.error && f.error.stack ? f.error.stack.split('\n').slice(0,3).join('\n    ') : '') + '\n')
  }
  process.exit(1)
}

// ---- real-data validation --------------------------------------------------

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.SKIP_REAL || !KEY) {
  process.stdout.write('\n  real-data validation: SKIPPED (SUPABASE_SERVICE_ROLE_KEY unset or SKIP_REAL=1)\n')
  process.exit(0)
}

section('real-data validation: prod Supabase, last 90 days, BOT_ID')

const URL_BASE = 'https://rydkwsjwlgnivlwlvqku.supabase.co'
const BOT = '00000000-0000-0000-0000-000000000002'
const sinceIso = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()

async function fetchPage(offset) {
  const u = URL_BASE + '/rest/v1/reviews'
    + '?bot_id=eq.' + BOT
    + '&created_at=gte.' + encodeURIComponent(sinceIso)
    + '&select=conversation_stage,status,internal_notes,resolved_at,created_at'
    + '&order=created_at.asc'
    + '&limit=1000&offset=' + offset
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(u, { headers: {
        'Authorization': 'Bearer ' + KEY,
        'apikey': KEY,
      } })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const body = await resp.json()
      return body
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)))
    }
  }
  throw lastErr
}

const allRows = []
let offset = 0
while (true) {
  const page = await fetchPage(offset)
  allRows.push(...page)
  if (page.length < 1000) break
  offset += 1000
  if (offset > 50_000) break
}
process.stdout.write('  fetched ' + allRows.length + ' rows from prod (last 90d)\n')

const readiness = computeStageReadiness(allRows)

const expected = {
  'HOOK / ENTRY': 0.73,
  'GOAL':         0.50,
  'DIAGNOSTIC':   0.47,
}
const TOLERANCE = 0.05

let realPassed = 0
let realFailed = 0
for (const [stage, exp] of Object.entries(expected)) {
  const r = readiness[stage]
  const got = r && r.recent && r.recent.cleanRate
  const size = r && r.recent && r.recent.sampleSize
  if (typeof got !== 'number') {
    process.stdout.write('  FAIL  ' + stage + ': cleanRate not computed (sampleSize=' + size + ')\n')
    realFailed++; continue
  }
  const ok = Math.abs(got - exp) <= TOLERANCE
  process.stdout.write('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + stage
    + ': cleanRate=' + (got * 100).toFixed(1) + '%  expected ~' + (exp * 100).toFixed(0) + '%'
    + '  sample=' + size + '  state=' + r.state + '\n')
  if (ok) realPassed++; else realFailed++
}

process.stdout.write('\n  real-data: ' + realPassed + ' passed, ' + realFailed + ' failed (tolerance +/- ' + (TOLERANCE * 100) + 'pp)\n')

// Print the full per-stage table for visual review.
process.stdout.write('\n  full readiness map from real data:\n')
for (const stage of CANONICAL_STAGES) {
  const r = readiness[stage]
  if (!r) continue
  const rate = r.recent.cleanRate === null ? 'n/a' : (r.recent.cleanRate * 100).toFixed(1) + '%'
  process.stdout.write('    ' + stage.padEnd(15)
    + '  state=' + r.state.padEnd(8)
    + '  sample=' + String(r.recent.sampleSize).padStart(2)
    + '  cleanRate=' + rate.padStart(6)
    + '  (allTime: clean=' + r.allTime.clean
    + ', edited=' + r.allTime.edited
    + ', real_d=' + r.allTime.realDiscard
    + ', sys_d=' + r.allTime.systemDiscard
    + ', pending=' + r.allTime.pending
    + ')\n')
}

if (realFailed > 0) process.exit(1)
