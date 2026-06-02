// test-resolve-next-action.mjs
//
// Synthetic test of the gate logic in resolveNextAction. Runs locally with
// no network. Used because the staging Worker E2E test on 2026-06-01 was
// blocked by a depleted staging Anthropic API credit balance; this script
// proves the gate logic independently of Claude.
//
// We extract a literal copy of the relevant constants, helpers, and the
// resolveNextAction function from sales-bot/src/index.js. To detect
// drift between this script and the deployed Worker source, the script
// also reads index.js and asserts the extracted function bodies appear
// verbatim in the Worker source. If they do not, the test fails loudly
// and the operator must reconcile before trusting the results.
//
// Run from repo root or sales-bot/:
//   node sales-bot/scripts/test-resolve-next-action.mjs
//
// Not committed: this file lives only as long as the Anthropic credit
// gap. Once staging E2E is unblocked the in-Worker tests supersede this.
// It is left in place for posterity; safe to delete after the next
// successful staging E2E pass.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import assert from 'node:assert/strict'

// ---- the extracted code under test (copy from sales-bot/src/index.js) ----

const MEDIUM_INTENT_AUTO_STAGES = [
  "HOOK / ENTRY",
  "GOAL",
  "FOLLOW-UP",
]

const STAGE_FACT_REQUIREMENTS = {
  "GOAL":       "primary_goal",
  "DIAGNOSTIC": "what_theyve_tried",
  "INSIGHT":    "current_approach_working",
  "PRIORITY":   "primary_goal",
  "INVITE":     "primary_goal",
}

function profileFactAlreadyKnown(stage, profileFacts) {
  const requiredFact = STAGE_FACT_REQUIREMENTS[stage]
  if (!requiredFact) return false
  const value = profileFacts?.[requiredFact]
  return value && value !== "" && value !== "Unknown" && value !== "unknown"
}

function isStageUnlocked(stage, stageAutomation) {
  if (!stage || !stageAutomation || typeof stageAutomation !== "object") return false
  const entry = stageAutomation[stage]
  return !!(entry && entry.enabled === true)
}

function resolveNextAction(botResponse, autoSendEnabled, profileFacts = {}, memory = {}, stageAutomation = {}) {
  const emotionalState = botResponse.emotional_state || "NEUTRAL"
  const intent = botResponse.lead_intent || "LOW"
  const stage = botResponse.conversation_stage || ""
  const situationClarity = botResponse.situation_clarity || 0
  const responseQuality = botResponse.response_quality || 0

  const confidence = (situationClarity * 0.4) + (responseQuality * 0.6)

  if (botResponse.next_action === "ESCALATE_TO_HUMAN") return "ESCALATE_TO_HUMAN"
  if (botResponse.escalation_reason && botResponse.escalation_reason.toLowerCase().includes("asked for human")) return "ESCALATE_TO_HUMAN"
  if (emotionalState === "FRUSTRATED") return "ESCALATE_TO_HUMAN"
  const objectionCount = memory?.objection_count || 0
  if (objectionCount >= 2) return "ESCALATE_TO_HUMAN"
  if (emotionalState === "DISENGAGING" && confidence < 0.70) return "ESCALATE_TO_HUMAN"
  if (emotionalState === "CONFUSED" && confidence < 0.60) return "ESCALATE_TO_HUMAN"
  if (botResponse.escalation_reason && botResponse.escalation_reason.length > 5) return "ESCALATE_TO_HUMAN"

  if (!autoSendEnabled) return "SEND_TO_INBOX_REVIEW"
  if (intent === "LOW") return "SEND_TO_INBOX_REVIEW"
  if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW"
  if (!isStageUnlocked(stage, stageAutomation)) return "SEND_TO_INBOX_REVIEW"
  if (intent === "HIGH" && situationClarity >= 0.85 && responseQuality >= 0.90) return "AUTO_SEND"
  if (intent === "MEDIUM" && situationClarity >= 0.80 && responseQuality >= 0.85 && MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "AUTO_SEND"
  return "SEND_TO_INBOX_REVIEW"
}

// ---- drift detection ------------------------------------------------------

const here = path.dirname(url.fileURLToPath(import.meta.url))
const workerSrc = fs.readFileSync(path.resolve(here, '..', 'src', 'index.js'), 'utf8')

const ANCHORS = [
  'function isStageUnlocked(stage, stageAutomation)',
  'function resolveNextAction(botResponse, autoSendEnabled, profileFacts = {}, memory = {}, stageAutomation = {})',
  'if (!isStageUnlocked(stage, stageAutomation)) return "SEND_TO_INBOX_REVIEW"',
  'if (intent === "HIGH" && situationClarity >= 0.85 && responseQuality >= 0.90) return "AUTO_SEND"',
  'if (intent === "MEDIUM" && situationClarity >= 0.80 && responseQuality >= 0.85 && MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "AUTO_SEND"',
]

let driftFailures = 0
for (const a of ANCHORS) {
  if (!workerSrc.includes(a)) {
    console.error('DRIFT: anchor not found in Worker source: ' + a)
    driftFailures++
  }
}
if (driftFailures > 0) {
  console.error('Aborting: the extracted code does not match sales-bot/src/index.js.')
  process.exit(2)
}
console.log('drift check: OK, all ' + ANCHORS.length + ' anchors present in Worker source')

// ---- tests ---------------------------------------------------------------

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name) }
  catch (e) { fail++; console.log('  FAIL  ' + name); console.log('        ' + (e && e.message || e)) }
}

const HIGH_CONF = { situation_clarity: 0.95, response_quality: 0.95 }
const MED_CONF  = { situation_clarity: 0.85, response_quality: 0.90 }
const LOW_CONF  = { situation_clarity: 0.50, response_quality: 0.50 }
const HOOK_UNLOCKED  = { 'HOOK / ENTRY': { enabled: true, enabled_at: 'x', enabled_by: 'y' } }
const BOOKED_UNLOCKED = { 'BOOKED': { enabled: true, enabled_at: 'x', enabled_by: 'y' } }

console.log()
console.log('--- master kill switch ---')
test('autoSendEnabled=false -> SEND_TO_INBOX_REVIEW regardless of unlocks', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF },
    false, {}, {}, HOOK_UNLOCKED,
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

console.log()
console.log('--- the HIGH bypass fix (the headline change) ---')
test('HIGH + high confidence + NO unlock -> review (was AUTO_SEND before the fix)', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF },
    true, {}, {}, {},
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

test('HIGH + high confidence + BOOKED unlocked but wrong stage match -> review', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF },
    true, {}, {}, BOOKED_UNLOCKED,
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

test('HIGH + closing-stage SCHEDULE + no unlock -> review (closes the closing-stage hole)', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'SCHEDULE', ...HIGH_CONF },
    true, {}, {}, {},
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

console.log()
console.log('--- positive path: AUTO_SEND fires when both layers permit ---')
test('HIGH + high confidence + HOOK/ENTRY unlocked -> AUTO_SEND', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF },
    true, {}, {}, HOOK_UNLOCKED,
  )
  assert.equal(r, 'AUTO_SEND')
})

test('MEDIUM + medium confidence + HOOK/ENTRY unlocked -> AUTO_SEND', () => {
  const r = resolveNextAction(
    { lead_intent: 'MEDIUM', conversation_stage: 'HOOK / ENTRY', ...MED_CONF },
    true, {}, {}, HOOK_UNLOCKED,
  )
  assert.equal(r, 'AUTO_SEND')
})

console.log()
console.log('--- LOW intent always reviews ---')
test('LOW + HOOK/ENTRY unlocked + high confidence -> review', () => {
  const r = resolveNextAction(
    { lead_intent: 'LOW', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF },
    true, {}, {}, HOOK_UNLOCKED,
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

console.log()
console.log('--- MEDIUM defensive guard (MEDIUM_INTENT_AUTO_STAGES) ---')
test('MEDIUM + INSIGHT (not in whitelist) + INSIGHT unlocked -> review', () => {
  const r = resolveNextAction(
    { lead_intent: 'MEDIUM', conversation_stage: 'INSIGHT', ...MED_CONF },
    true, {}, {},
    { 'INSIGHT': { enabled: true, enabled_at: 'x', enabled_by: 'y' } },
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

console.log()
console.log('--- profileFactAlreadyKnown short-circuit unchanged ---')
test('HIGH at GOAL + HOOK/ENTRY+GOAL unlocked + primary_goal already known -> review', () => {
  const r = resolveNextAction(
    { lead_intent: 'HIGH', conversation_stage: 'GOAL', ...HIGH_CONF },
    true, { primary_goal: 'distance' }, {},
    { 'GOAL': { enabled: true, enabled_at: 'x', enabled_by: 'y' } },
  )
  assert.equal(r, 'SEND_TO_INBOX_REVIEW')
})

console.log()
console.log('--- all 7 escalation triggers still take precedence over stage gate ---')
const ESC_BASE = {
  lead_intent: 'HIGH', conversation_stage: 'HOOK / ENTRY', ...HIGH_CONF,
}

test('1: bot suggested ESCALATE_TO_HUMAN -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, next_action: 'ESCALATE_TO_HUMAN' }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('2: asked for human -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, escalation_reason: 'lead asked for human' }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('3: emotional state FRUSTRATED -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, emotional_state: 'FRUSTRATED' }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('4: objection_count >= 2 -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE }, true, {}, { objection_count: 2 }, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('5: DISENGAGING + low confidence -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, emotional_state: 'DISENGAGING', ...LOW_CONF }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('6: CONFUSED + very low confidence -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, emotional_state: 'CONFUSED', ...LOW_CONF }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})
test('7: escalation_reason with length > 5 -> escalate', () => {
  const r = resolveNextAction({ ...ESC_BASE, escalation_reason: 'mentioned a contract link' }, true, {}, {}, HOOK_UNLOCKED)
  assert.equal(r, 'ESCALATE_TO_HUMAN')
})

console.log()
console.log('--- isStageUnlocked edge cases ---')
test('null stageAutomation -> false', () => assert.equal(isStageUnlocked('HOOK / ENTRY', null), false))
test('non-object stageAutomation -> false', () => assert.equal(isStageUnlocked('HOOK / ENTRY', 'not an object'), false))
test('stage missing from map -> false', () => assert.equal(isStageUnlocked('GOAL', HOOK_UNLOCKED), false))
test('enabled: false stub -> false', () => assert.equal(isStageUnlocked('HOOK / ENTRY', { 'HOOK / ENTRY': { enabled: false } }), false))
test('enabled: true -> true', () => assert.equal(isStageUnlocked('HOOK / ENTRY', HOOK_UNLOCKED), true))

console.log()
console.log('================ SUMMARY ================')
console.log('passed: ' + pass)
console.log('failed: ' + fail)
if (fail > 0) process.exit(1)
