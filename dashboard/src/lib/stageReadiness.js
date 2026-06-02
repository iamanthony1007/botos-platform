// stageReadiness.js
//
// Pure module. No React, no DOM, no DB calls, no side effects. Browser and
// Node compatible. The dashboard imports `computeStageReadiness` from here to
// drive the per-stage automation view in Settings. The Worker reads
// `bots.stage_automation` directly to gate auto-send; it does NOT import this
// module because the Worker only needs the enabled flag, not the readiness
// math.
//
// Math agreed with Nella (do not change without her):
//
//   - Judge each conversation stage on its most recent SAMPLE_WINDOW (30)
//     ACTIONED drafts, ordered by resolved_at desc (created_at tie-break).
//   - "actioned" = clean + edited + real_discard. System auto-discards do
//     not count as decisions, so they are excluded from the denominator.
//   - "clean" = reviews.status = 'approved' (sent untouched).
//     'edited' is a MISS for readiness purposes (the AI was close but the
//     setter changed the wording before sending). It still counts toward
//     the actioned denominator.
//   - "real_discard" = reviews.status = 'discarded' where internal_notes
//     does NOT match a system-discard marker. Setter explicitly threw the
//     draft away. Counts as a miss.
//   - "system_discard" = reviews.status = 'discarded' where internal_notes
//     contains one of SYSTEM_DISCARD_MARKERS. These are backlog or burst
//     cleanups, not setter decisions. Excluded from scoring entirely.
//   - A stage is ELIGIBLE when sampleSize >= SAMPLE_WINDOW AND
//     cleanRate >= ELIGIBLE_CLEAN_RATE_THRESHOLD.
//
// Two-layer gate (the Worker enforces this; this module only reports state):
//   Layer 1: bots.stage_automation[stage].enabled === true (Nella's unlock).
//   Layer 2: existing per-message safety guards in resolveNextAction.

export const SAMPLE_WINDOW = 30
export const ELIGIBLE_CLEAN_RATE_THRESHOLD = 0.85

export const STAGE_STATE = Object.freeze({
  TRAINING: 'TRAINING',
  ELIGIBLE: 'ELIGIBLE',
  RUNNING:  'RUNNING',
})

// Substrings that mark a discarded review as system-driven. Case sensitive
// because the Worker and dashboard both write these strings in fixed casing.
// New markers must be added here when new auto-clean paths land.
export const SYSTEM_DISCARD_MARKERS = Object.freeze([
  'Auto-discarded - lead sent a new message',     // Worker stale-clean on next inbound
  'Auto-discarded sibling of',                    // Dashboard Fix B (approve + saveTraining)
])

export const CANONICAL_STAGES = Object.freeze([
  'HOOK / ENTRY',
  'GOAL',
  'DIAGNOSTIC',
  'INSIGHT',
  'PRIORITY',
  'DECISION',
  'INVITE',
  'SCHEDULE',
  'BOOKED',
  'FOLLOW-UP',
])

/**
 * Classify a single review row for readiness purposes.
 * Returns one of:
 *   'clean' | 'edited' | 'real_discard' | 'system_discard' |
 *   'pending' | 'auto_sent' | 'delivery_failed' | 'other'
 */
export function classifyReview(review) {
  if (!review || typeof review !== 'object') return 'other'
  const s = review.status
  if (s === 'pending') return 'pending'
  if (s === 'approved') return 'clean'
  if (s === 'edited') return 'edited'
  if (s === 'auto_sent') return 'auto_sent'
  if (s === 'delivery_failed') return 'delivery_failed'
  if (s === 'discarded') return isSystemDiscard(review) ? 'system_discard' : 'real_discard'
  return 'other'
}

/**
 * True when a discarded review carries a system-discard marker in internal_notes.
 * Returns false for any non-discarded row, even if the notes happen to mention
 * a marker substring (status is the primary signal).
 */
export function isSystemDiscard(review) {
  if (!review || review.status !== 'discarded') return false
  const notes = typeof review.internal_notes === 'string' ? review.internal_notes : ''
  if (!notes) return false
  for (const m of SYSTEM_DISCARD_MARKERS) {
    if (notes.includes(m)) return true
  }
  return false
}

/**
 * Whether a classification counts as a setter "decision" toward scoring.
 * auto_sent and delivery_failed are deployment outcomes (the bot already
 * sent), not decisions; we score the setter's review behavior only.
 */
export function isActionedClass(klass) {
  return klass === 'clean' || klass === 'edited' || klass === 'real_discard'
}

/**
 * computeStageReadiness(reviews, options)
 *
 * Inputs:
 *   reviews: Array<Review>. Each row should have at minimum:
 *     status, conversation_stage, internal_notes, resolved_at, created_at.
 *     Missing fields are handled gracefully.
 *   options:
 *     stages: optional list of stage names to report (default CANONICAL_STAGES).
 *     sampleWindow: integer, default SAMPLE_WINDOW.
 *     threshold: float in [0, 1], default ELIGIBLE_CLEAN_RATE_THRESHOLD.
 *     stageAutomation: object shaped like
 *       { "<STAGE>": { enabled: bool, enabled_at: string, enabled_by: string } }
 *       Absence of a stage means TRAINING/ELIGIBLE, never RUNNING.
 *
 * Returns an object keyed by stage name:
 *   {
 *     "<STAGE>": {
 *       state: 'TRAINING' | 'ELIGIBLE' | 'RUNNING',
 *       enabled: boolean,            // raw value from stageAutomation
 *       enabledAt: string | null,
 *       enabledBy: string | null,
 *       recent: {
 *         sampleSize: number,        // <= sampleWindow
 *         clean: number,
 *         edited: number,
 *         realDiscard: number,
 *         cleanRate: number | null,  // clean / sampleSize, null if sampleSize 0
 *         meetsThreshold: boolean,
 *       },
 *       allTime: {                   // window-of-input tallies, for context
 *         clean, edited, realDiscard, systemDiscard, pending,
 *         autoSent, deliveryFailed, other, total,
 *       },
 *     }
 *   }
 *
 * The function is pure: same input always produces the same output. No
 * Date.now(), no IO, no mutation of the input array.
 */
export function computeStageReadiness(reviews, options = {}) {
  const stages = options.stages || CANONICAL_STAGES
  const sampleWindow = Number.isFinite(options.sampleWindow) && options.sampleWindow > 0
    ? Math.floor(options.sampleWindow)
    : SAMPLE_WINDOW
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : ELIGIBLE_CLEAN_RATE_THRESHOLD
  const stageAutomation = (options.stageAutomation && typeof options.stageAutomation === 'object')
    ? options.stageAutomation
    : {}

  // Group by stage. Reviews whose conversation_stage is not in `stages` are
  // ignored. (Older prompt revisions produced non-canonical stage labels.)
  const byStage = new Map()
  for (const s of stages) byStage.set(s, [])
  const input = Array.isArray(reviews) ? reviews : []
  for (const r of input) {
    const s = r && r.conversation_stage
    if (s && byStage.has(s)) byStage.get(s).push(r)
  }

  const result = {}
  for (const stage of stages) {
    const rows = byStage.get(stage) || []

    const allTime = {
      clean: 0, edited: 0, realDiscard: 0, systemDiscard: 0,
      pending: 0, autoSent: 0, deliveryFailed: 0, other: 0,
      total: rows.length,
    }
    for (const r of rows) {
      switch (classifyReview(r)) {
        case 'clean':            allTime.clean++; break
        case 'edited':           allTime.edited++; break
        case 'real_discard':     allTime.realDiscard++; break
        case 'system_discard':   allTime.systemDiscard++; break
        case 'pending':          allTime.pending++; break
        case 'auto_sent':        allTime.autoSent++; break
        case 'delivery_failed':  allTime.deliveryFailed++; break
        default:                 allTime.other++
      }
    }

    // Most-recent-N actioned by resolved_at desc, created_at tie-break.
    const actioned = []
    for (const r of rows) {
      const k = classifyReview(r)
      if (!isActionedClass(k)) continue
      actioned.push({
        klass: k,
        primaryTs: tsOf(r.resolved_at),
        secondaryTs: tsOf(r.created_at),
      })
    }
    actioned.sort(compareDesc)
    const recentSet = actioned.slice(0, sampleWindow)

    const recent = {
      sampleSize: recentSet.length,
      clean: 0, edited: 0, realDiscard: 0,
      cleanRate: null,
      meetsThreshold: false,
    }
    for (const x of recentSet) {
      if (x.klass === 'clean') recent.clean++
      else if (x.klass === 'edited') recent.edited++
      else if (x.klass === 'real_discard') recent.realDiscard++
    }
    if (recent.sampleSize > 0) {
      recent.cleanRate = recent.clean / recent.sampleSize
      recent.meetsThreshold = recent.sampleSize >= sampleWindow && recent.cleanRate >= threshold
    }

    const entry = stageAutomation[stage]
    const enabled = !!(entry && entry.enabled === true)
    const enabledAt = entry && typeof entry.enabled_at === 'string' ? entry.enabled_at : null
    const enabledBy = entry && typeof entry.enabled_by === 'string' ? entry.enabled_by : null

    let state
    if (enabled) state = STAGE_STATE.RUNNING
    else if (recent.meetsThreshold) state = STAGE_STATE.ELIGIBLE
    else state = STAGE_STATE.TRAINING

    result[stage] = {
      state,
      enabled,
      enabledAt,
      enabledBy,
      recent,
      allTime,
    }
  }
  return result
}

// Internal helpers.
function tsOf(s) {
  if (typeof s !== 'string' || s.length === 0) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function compareDesc(a, b) {
  // primary descending, then secondary descending. Nulls sort last.
  const ap = a.primaryTs, bp = b.primaryTs
  if (ap !== bp) {
    if (ap === null) return 1
    if (bp === null) return -1
    return bp - ap
  }
  const as = a.secondaryTs, bs = b.secondaryTs
  if (as === bs) return 0
  if (as === null) return 1
  if (bs === null) return -1
  return bs - as
}
