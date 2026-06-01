import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'
import { useDataCache } from '../lib/DataCache'
import {
  CANONICAL_STAGES,
  ELIGIBLE_CLEAN_RATE_THRESHOLD,
  SAMPLE_WINDOW,
  STAGE_STATE,
  computeStageReadiness,
} from '../lib/stageReadiness'

function Tooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ width: '15px', height: '15px', borderRadius: '50%', background: '#e5e7eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '.6rem', color: '#6b7280', cursor: 'default', fontWeight: 700, flexShrink: 0 }}
      >?</span>
      {show && (
        <span style={{ position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)', background: '#1A1A1A', color: '#fff', fontSize: '.72rem', lineHeight: 1.5, padding: '7px 10px', borderRadius: '8px', width: '220px', zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,.25)', pointerEvents: 'none' }}>
          {text}
          <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', border: '5px solid transparent', borderTopColor: '#1A1A1A' }} />
        </span>
      )}
    </span>
  )
}

const DEFAULT_AI_BEHAVIOR = {
  aiRole: 'Setter / Assistant',
  primaryObjective: 'Book Call',
  offerName: '',
  offerSummary: '',
  topPainPoints: '',
  desiredOutcomes: '',
  qualificationCriteria: '',
  disqualifiers: '',
  leadCommStyle: 'Mixed (default)',
}

// Window we pull from the reviews table to compute per-stage readiness in this
// page. 90 days comfortably covers SAMPLE_WINDOW=30 actioned per stage at
// current production volume (HOOK / ENTRY 800+, GOAL 200+, etc). The select
// is small (5 columns); 2000-row cap keeps payload bounded for the busiest
// stages without affecting accuracy of the most-recent-N math.
const READINESS_LOOKBACK_DAYS = 90
const READINESS_FETCH_LIMIT = 2000

// State pill colors for the per-stage list. Kept separate from the rest of
// the dashboard color tokens because these three states are new vocabulary.
const STATE_PILL = {
  [STAGE_STATE.TRAINING]: { bg: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb', label: 'Training' },
  [STAGE_STATE.ELIGIBLE]: { bg: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', label: 'Eligible' },
  [STAGE_STATE.RUNNING]:  { bg: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', label: 'Running' },
}

export default function Settings() {
  const { profile } = useAuth()
  const { get: getCache, set: setCache } = useDataCache()
  const cached = getCache('settings_data')
  const [bot, setBot] = useState(cached?.data?.bot || null)
  const [autoSend, setAutoSend] = useState(cached?.data?.autoSend || false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(!cached?.data)
  const [targetAvatar, setTargetAvatar] = useState(cached?.data?.targetAvatar || '')
  const [aiBehavior, setAiBehavior] = useState(cached?.data?.aiBehavior || DEFAULT_AI_BEHAVIOR)
  const [stageReadiness, setStageReadiness] = useState(cached?.data?.stageReadiness || null)
  const [readinessError, setReadinessError] = useState(null)

  useEffect(() => { load() }, [profile])

  async function load() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    if (data) {
      setBot(data)
      setAutoSend(data.auto_send_enabled === true)
      setTargetAvatar(data.target_avatar || '')
      const saved = data.ai_behavior_settings
      if (saved && typeof saved === 'object') {
        setAiBehavior({ ...DEFAULT_AI_BEHAVIOR, ...saved })
      }

      // Per-stage readiness: pull recent reviews and compute live.
      // RLS is the same as the Inbox loadData reads; this select is
      // identical in shape and runs under the same anon-key session.
      try {
        const sinceIso = new Date(Date.now() - READINESS_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString()
        const { data: reviews, error: revErr } = await supabase
          .from('reviews')
          .select('conversation_stage,status,internal_notes,resolved_at,created_at')
          .eq('bot_id', data.id)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(READINESS_FETCH_LIMIT)
        if (revErr) throw revErr
        // Absence of the stage_automation column (pre-migration-007) means an
        // empty unlock map. No stage can be RUNNING until step 3 ships.
        const stageAutomation = (data.stage_automation && typeof data.stage_automation === 'object')
          ? data.stage_automation
          : {}
        const readiness = computeStageReadiness(reviews || [], { stageAutomation })
        setStageReadiness(readiness)
        setReadinessError(null)
      } catch (e) {
        console.error('[Settings] readiness load failed:', e)
        setReadinessError(e && e.message ? e.message : String(e))
      }
    }
    setCache('settings_data', {
      bot: bot || data,
      autoSend: data?.auto_send_enabled === true,
      targetAvatar: data?.target_avatar || '',
      aiBehavior: data?.ai_behavior_settings || DEFAULT_AI_BEHAVIOR,
      stageReadiness,
    })
    setLoading(false)
  }

  function setBehavior(key, val) {
    setAiBehavior(prev => ({ ...prev, [key]: val }))
  }

  async function saveSettings() {
    if (!bot) return
    setSaving(true)
    const { error } = await supabase
      .from('bots')
      .update({
        auto_send_enabled: autoSend,
        target_avatar: targetAvatar,
        ai_behavior_settings: aiBehavior,
        updated_at: new Date().toISOString()
      })
      .eq('id', bot.id)
    setSaving(false)
    if (error) showToast('Error saving settings')
    else showToast('Settings saved successfully')
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const SectionLabel = ({ num, title }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', marginTop: '4px' }}>
      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>{num}</div>
      <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--tx)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{title}</div>
    </div>
  )

  return (
    <div className="page">
      {toast && <div className="toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Bot Settings</div>
          <div className="page-sub">Stage-by-stage automation, plus the AI behavior config for offer, lead, and tone.</div>
        </div>
        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* ============== STAGE AUTOMATION ============== */}
      <div className="card">
        <div style={{ marginBottom: '14px' }}>
          <div className="card-title" style={{ marginBottom: '4px' }}>Stage Automation</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)', lineHeight: 1.55 }}>
            The bot automates the conversation one stage at a time. Each stage starts in Training. When recent drafts at that stage are clean enough, the stage becomes Eligible. A stage only sends replies on its own once it is explicitly turned on (that control ships in a follow-up). Per-message safety guards always apply.
          </div>
        </div>

        {/* Master kill switch */}
        <div style={{
          padding: '14px 16px',
          background: autoSend ? '#fef2f2' : 'var(--surf2)',
          border: '1px solid ' + (autoSend ? '#fecaca' : 'var(--bdr)'),
          borderRadius: 'var(--rsm)',
          marginBottom: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--tx)' }}>Master auto-send switch</div>
              <Tooltip text="Master kill switch for stage automation. When OFF, no draft auto-sends, regardless of per-stage state. When ON, stages that are explicitly turned on can auto-send (if per-message safety guards pass). Default OFF. Turn this back OFF if you ever need to halt all bot-driven sends instantly." />
            </div>
            <div style={{ fontSize: '.74rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
              {autoSend
                ? 'Master switch is ON. Stages that have been individually turned on can auto-send, subject to per-message safety guards. Per-stage unlock control ships in a follow-up.'
                : 'Master switch is OFF. No draft auto-sends. All replies go to the inbox.'}
            </div>
          </div>
          <button
            onClick={() => setAutoSend(!autoSend)}
            style={{ position: 'relative', width: '52px', height: '28px', borderRadius: '100px', border: 'none', cursor: 'pointer', background: autoSend ? '#dc2626' : 'var(--bdr2)', transition: 'background .2s', padding: 0, flexShrink: 0 }}
            aria-label="Master auto-send switch"
          >
            <div style={{ position: 'absolute', top: '4px', left: autoSend ? '27px' : '4px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s' }} />
          </button>
        </div>

        {/* Readiness sample window note */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '.74rem', fontWeight: 600, color: 'var(--tx)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Per-stage readiness</div>
          <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>
            most recent {SAMPLE_WINDOW} actioned drafts per stage. Eligible threshold is {Math.round(ELIGIBLE_CLEAN_RATE_THRESHOLD * 100)}% clean approvals.
          </div>
        </div>

        {readinessError && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--rsm)', fontSize: '.78rem', color: '#b91c1c', marginBottom: '10px' }}>
            Could not load readiness data: {readinessError}. The stage list below may be stale. Reload the page to retry.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {CANONICAL_STAGES.map(stage => {
            const entry = stageReadiness && stageReadiness[stage]
            const state = entry ? entry.state : STAGE_STATE.TRAINING
            const pill = STATE_PILL[state] || STATE_PILL[STAGE_STATE.TRAINING]
            const sampleSize = entry ? entry.recent.sampleSize : 0
            const cleanRate = entry ? entry.recent.cleanRate : null
            const rateLabel = cleanRate === null
              ? 'no data yet'
              : (cleanRate * 100).toFixed(0) + '% clean'
            const sampleLabel = sampleSize >= SAMPLE_WINDOW
              ? 'over last ' + SAMPLE_WINDOW + ' actioned'
              : 'over last ' + sampleSize + ' actioned (need ' + SAMPLE_WINDOW + ')'
            return (
              <div key={stage} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '11px 14px',
                background: 'var(--surf2)',
                border: '1px solid var(--bdr)',
                borderRadius: 'var(--rsm)',
              }}>
                <div style={{ flex: '0 0 150px', fontSize: '.84rem', fontWeight: 600, color: 'var(--tx)' }}>
                  {stage}
                </div>
                <span style={{
                  fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                  background: pill.bg, color: pill.color, border: pill.border,
                  flexShrink: 0,
                }}>
                  {pill.label}
                </span>
                <div style={{ flex: 1, minWidth: 0, fontSize: '.78rem', color: 'var(--tx2)' }}>
                  {rateLabel} {sampleSize > 0 && (
                    <span style={{ color: 'var(--tx3)' }}>({sampleLabel})</span>
                  )}
                </div>
                {entry && entry.enabled && entry.enabledBy && (
                  <div style={{ fontSize: '.68rem', color: 'var(--tx3)' }}>
                    on by {entry.enabledBy}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '14px', fontSize: '.72rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
          Eligible means the data says this stage performs well enough to consider. It does NOT auto-send. A stage only auto-sends when explicitly turned on by a human (control ships in a follow-up) AND the master switch above is ON AND each draft also passes the per-message safety guards.
        </div>
      </div>

      {/* ============== AI BEHAVIOR SETTINGS ============== */}
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <div className="card-title" style={{ marginBottom: '4px' }}>AI Behavior Settings</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)', lineHeight: 1.6 }}>
            Define how the AI understands your offer, your leads, and how it drives conversations toward conversion.
          </div>
        </div>

        {/* Section 1: AI Role */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px', marginBottom: '20px' }}>
          <SectionLabel num="1" title="AI Role" />
          <div className="form-group">
            <label className="form-label">Who is the AI speaking as?</label>
            <select className="form-input" value={aiBehavior.aiRole} onChange={e => setBehavior('aiRole', e.target.value)}>
              <option value="Coach / Brand Voice">Coach / Brand Voice: speaks as the expert, in your tone</option>
              <option value="Setter / Assistant">Setter / Assistant: qualifies leads on behalf of the coach</option>
              <option value="Hybrid">Hybrid: starts as setter, transitions to coach voice as trust builds</option>
            </select>
            <div className="form-hint">This shapes how the AI introduces itself and maintains its persona throughout the conversation.</div>
          </div>
        </div>

        {/* Section 2: Primary Objective */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px', marginBottom: '20px' }}>
          <SectionLabel num="2" title="Primary Objective" />
          <div className="form-group">
            <label className="form-label">What is the AI optimizing for?</label>
            <select className="form-input" value={aiBehavior.primaryObjective} onChange={e => setBehavior('primaryObjective', e.target.value)}>
              <option value="Book Call">Book Call: goal is to schedule a discovery or sales call</option>
              <option value="Close Sale">Close Sale: goal is to convert the lead directly in the conversation</option>
            </select>
            <div className="form-hint">This determines when the AI pivots toward its end goal and how urgently it pushes forward.</div>
          </div>
        </div>

        {/* Section 3: Offer Context */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px', marginBottom: '20px' }}>
          <SectionLabel num="3" title="Offer Context" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Offer Name</label>
              <input className="form-input" type="text" placeholder="e.g. Bombers Blueprint, The 90-Day Transformation, Elite Coaching Program" value={aiBehavior.offerName} onChange={e => setBehavior('offerName', e.target.value)} />
              <div className="form-hint">What is the name of what you're selling?</div>
            </div>
            <div className="form-group">
              <label className="form-label">Offer Summary</label>
              <textarea className="form-input" rows={3} placeholder="e.g. A 12-week golf fitness coaching program for amateur golfers over 40 who want to add distance, reduce injury risk, and finally play their best golf, without spending more time at the range." value={aiBehavior.offerSummary} onChange={e => setBehavior('offerSummary', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">What does your offer do and who is it for? Be specific. The AI uses this to stay on-topic and never misrepresent your offer.</div>
            </div>
          </div>
        </div>

        {/* Section 4: Lead Understanding */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px', marginBottom: '20px' }}>
          <SectionLabel num="4" title="Lead Understanding" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Top Pain Points</label>
              <textarea className="form-input" rows={3} placeholder="e.g. Losing distance off the tee. Back and hip pain affecting their swing. Inconsistent ball striking. Tried the range but nothing sticks. Feel like their body is the limiting factor." value={aiBehavior.topPainPoints} onChange={e => setBehavior('topPainPoints', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">What problems does your ideal lead struggle with? The AI uses these to identify and reflect back pain during conversations.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Desired Outcomes</label>
              <textarea className="form-input" rows={3} placeholder="e.g. Hit the ball further than they did 10 years ago. Play pain-free. Break 80. Feel athletic and confident on the course again. Impress their playing partners." value={aiBehavior.desiredOutcomes} onChange={e => setBehavior('desiredOutcomes', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">What does your lead want to achieve? The AI uses this to connect your offer to their goals.</div>
            </div>
          </div>
        </div>

        {/* Section 5: Qualification Criteria */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px', marginBottom: '20px' }}>
          <SectionLabel num="5" title="Qualification Criteria" />
          <div style={{ background: 'var(--ambbg)', border: '1px solid var(--ambbd)', borderRadius: 'var(--rsm)', padding: '10px 14px', marginBottom: '14px', fontSize: '.79rem', color: 'var(--amb)', lineHeight: 1.55 }}>
            This is critical. The AI uses these rules to decide who to push forward and who to disqualify. Be specific.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">What qualifies a strong lead?</label>
              <textarea className="form-input" rows={3} placeholder="e.g. Golfer who plays at least once a week. Has a specific goal (distance, pain, consistency). Expresses frustration or urgency. Has tried something before that didn't fully work. Ready to invest in a solution now." value={aiBehavior.qualificationCriteria} onChange={e => setBehavior('qualificationCriteria', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">What must be true for someone to be worth moving forward in the conversation?</div>
            </div>
            <div className="form-group">
              <label className="form-label">Disqualifiers</label>
              <textarea className="form-input" rows={3} placeholder="e.g. Complete beginners with no commitment to improving. Someone looking for free advice or a quick fix. Leads who mention they're happy with how they're playing. Anyone aggressive or rude." value={aiBehavior.disqualifiers} onChange={e => setBehavior('disqualifiers', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">Who should NOT be converted or booked? The AI will politely exit or deprioritise these leads.</div>
            </div>
          </div>
        </div>

        {/* Section 6: Lead Communication Style */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '20px' }}>
          <SectionLabel num="6" title="Lead Communication Style" />
          <div className="form-group">
            <label className="form-label">How do your leads typically communicate?</label>
            <select className="form-input" value={aiBehavior.leadCommStyle} onChange={e => setBehavior('leadCommStyle', e.target.value)}>
              <option value="Direct & Results-Focused">Direct and results-focused: brief, straight to the point, wants the bottom line</option>
              <option value="Expressive & Emotional">Expressive and emotional: shares context and feelings, responds to warmth</option>
              <option value="Analytical & Detail-Oriented">Analytical and detail-oriented: asks questions, wants clarity before committing</option>
              <option value="Mixed (default)">Mixed (default): AI adapts based on how the lead responds</option>
            </select>
            <div className="form-hint">The AI automatically adjusts its tone, pacing, and level of detail based on this setting. Mixed is recommended unless your audience is very consistent.</div>
          </div>
        </div>
      </div>

      {/* ============== TARGET AVATAR ============== */}
      <div className="card">
        <div className="card-title">Target Avatar</div>
        <div style={{ fontSize: '.82rem', color: 'var(--tx3)', marginBottom: '14px', lineHeight: 1.6 }}>
          Describe your ideal lead in detail. This gives the AI a complete picture of who it's talking to.
        </div>
        <div className="form-group">
          <textarea
            className="form-input"
            rows={4}
            placeholder="e.g. 40-55 year old male golfer, busy professional, family man. Frustrated by losing distance and nagging aches. Has tried generic programs but nothing golf-specific. Plays once or twice a week, takes the game seriously, wants to compete with his club friends again."
            value={targetAvatar}
            onChange={e => setTargetAvatar(e.target.value)}
            style={{ resize: 'none', lineHeight: 1.6 }}
          />
          <div className="form-hint">The more specific, the better. Include age, lifestyle, frustrations, goals, and how they typically discover solutions.</div>
        </div>
      </div>
    </div>
  )
}
