import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

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

export default function Settings() {
  const { profile } = useAuth()
  const [bot, setBot] = useState(null)
  const [autoSend, setAutoSend] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const [targetAvatar, setTargetAvatar] = useState('')
  const [aiBehavior, setAiBehavior] = useState(DEFAULT_AI_BEHAVIOR)
  const [automationStats, setAutomationStats] = useState(null)

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

      // Load automation stats
      const { data: reviews } = await supabase
        .from('reviews')
        .select('id, status, confidence, created_at')
        .eq('bot_id', data.id)

      if (reviews) {
        const total = reviews.length
        const approved = reviews.filter(r => r.status === 'approved').length
        const edited = reviews.filter(r => r.status === 'edited').length
        const pending = reviews.filter(r => r.status === 'pending').length
        const discarded = reviews.filter(r => r.status === 'discarded').length
        const resolved = approved + edited + discarded
        const approvalRate = resolved > 0 ? Math.round(((approved + edited) / resolved) * 100) : 0
        const recentReviews = reviews.filter(r => r.confidence != null).slice(-20)
        const avgConfidence = recentReviews.length > 0
          ? Math.round((recentReviews.reduce((a, r) => a + r.confidence, 0) / recentReviews.length) * 100)
          : null

        let progressStage, progressPct, progressMsg
        if (resolved < 20) {
          progressStage = 'Learning'; progressPct = Math.round((resolved / 20) * 33)
          progressMsg = `${resolved} responses reviewed. Keep approving and editing to teach the AI your style.`
        } else if (resolved < 60) {
          progressStage = 'Improving'; progressPct = 33 + Math.round(((resolved - 20) / 40) * 34)
          progressMsg = `${resolved} responses reviewed. The AI is picking up your patterns. Edit frequently to accelerate learning.`
        } else if (resolved < 120) {
          progressStage = 'Trusted'; progressPct = 67 + Math.round(((resolved - 60) / 60) * 23)
          progressMsg = `${resolved} responses reviewed. Strong performance. Consider enabling Auto Mode for high-confidence replies.`
        } else {
          progressStage = 'Auto-Ready'; progressPct = 100
          progressMsg = `${resolved} responses reviewed. The AI is well trained. Auto Mode is recommended.`
        }

        setAutomationStats({ total, approved, edited, pending, discarded, approvalRate, avgConfidence, progressStage, progressPct, progressMsg })
      }
    }
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
          <div className="page-title">AI Behavior Settings</div>
          <div className="page-sub">Define how the AI understands your offer, your leads, and how it drives conversations toward conversion.</div>
        </div>
        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* AI AUTOMATION PROGRESS */}
      {automationStats && (
        <div className="card">
          <div style={{ marginBottom: '16px' }}>
            <div className="card-title" style={{ marginBottom: '4px' }}>AI Automation Progress</div>
            <div style={{ fontSize: '.82rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
              Tracks how well the AI has learned from your corrections and whether it is ready for Auto Mode.
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--tx)' }}>
                  {automationStats.progressStage === 'Learning' && '🌱'}
                  {automationStats.progressStage === 'Improving' && '📈'}
                  {automationStats.progressStage === 'Trusted' && '✅'}
                  {automationStats.progressStage === 'Auto-Ready' && '🚀'}
                  {' '}{automationStats.progressStage}
                </span>
                <span style={{ fontSize: '.72rem', color: 'var(--tx3)', background: 'var(--surf2)', border: '1px solid var(--bdr)', padding: '1px 8px', borderRadius: '999px' }}>
                  {automationStats.progressPct}%
                </span>
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>{automationStats.progressMsg}</div>
            </div>
            <div style={{ height: '8px', background: 'var(--surf3)', borderRadius: '100px', overflow: 'hidden', border: '1px solid var(--bdr)' }}>
              <div style={{
                height: '100%',
                width: `${automationStats.progressPct}%`,
                background: automationStats.progressStage === 'Auto-Ready' ? '#16a34a' : automationStats.progressStage === 'Trusted' ? 'var(--acc)' : automationStats.progressStage === 'Improving' ? 'var(--amb)' : 'var(--blu)',
                borderRadius: '100px',
                transition: 'width 1s ease'
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
              {['Learning', 'Improving', 'Trusted', 'Auto-Ready'].map((s, i) => (
                <span key={s} style={{ fontSize: '.64rem', color: automationStats.progressStage === s ? 'var(--acc)' : 'var(--tx3)', fontWeight: automationStats.progressStage === s ? 700 : 400 }}>{s}</span>
              ))}
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            {[
              { label: 'Total Reviews', value: automationStats.total, color: 'var(--tx)', sub: 'All time' },
              { label: 'Approved & Sent', value: automationStats.approved + automationStats.edited, color: '#16a34a', sub: `${automationStats.approvalRate}% approval rate` },
              { label: 'Edited by You', value: automationStats.edited, color: 'var(--blu)', sub: 'Corrected before sending' },
              { label: 'Pending Review', value: automationStats.pending, color: automationStats.pending > 0 ? '#d97706' : 'var(--tx3)', sub: 'Waiting for you' },
            ].map(s => (
              <div key={s.label} style={{ padding: '12px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', border: '1px solid var(--bdr)' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx)', marginTop: '5px' }}>{s.label}</div>
                <div style={{ fontSize: '.7rem', color: 'var(--tx3)', marginTop: '2px' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Confidence + threshold */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '160px', padding: '12px 14px', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--rsm)' }}>
              <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>Confidence Threshold</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--acc)' }}>75%</div>
              <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: '3px', lineHeight: 1.5 }}>The AI must reach 75% confidence before auto-sending. Below this it sends to your inbox for review.</div>
            </div>
            {automationStats.avgConfidence != null && (
              <div style={{ flex: 1, minWidth: '160px', padding: '12px 14px', background: automationStats.avgConfidence >= 75 ? '#f0fdf4' : '#fffbeb', border: `1px solid ${automationStats.avgConfidence >= 75 ? '#bbf7d0' : '#fde68a'}`, borderRadius: 'var(--rsm)' }}>
                <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>Avg Confidence (Last 20)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: automationStats.avgConfidence >= 75 ? '#16a34a' : '#d97706' }}>{automationStats.avgConfidence}%</div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: '3px', lineHeight: 1.5 }}>
                  {automationStats.avgConfidence >= 75 ? 'Above threshold — AI is performing well.' : 'Below threshold — more training needed before Auto Mode.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI MODE */}
      <div style={{
        background: autoSend
          ? 'linear-gradient(135deg, #faf6e8 0%, #fff9ed 100%)'
          : 'linear-gradient(135deg, #f8f8f5 0%, #f2f1ec 100%)',
        border: autoSend ? '2px solid var(--accm)' : '2px solid var(--bdr2)',
        borderRadius: 'var(--rlg)', padding: '24px 28px', transition: 'all .3s'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: autoSend ? 'var(--acc)' : 'var(--tx3)', marginBottom: '8px' }}>AI Mode</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--tx)', marginBottom: '6px' }}>
              {autoSend ? 'Auto Mode' : 'Training Mode'}
            </div>
            <div style={{ fontSize: '.86rem', color: 'var(--tx2)', lineHeight: 1.65, maxWidth: '520px' }}>
              {autoSend
                ? 'The AI sends messages automatically when it is confident in its response. Monitor the inbox regularly to ensure quality.'
                : 'All AI responses are reviewed by you before being sent to leads. Use this mode while training the AI or when you want full control.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
              <div onClick={() => setAutoSend(false)} style={{ padding: '16px', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .2s', background: !autoSend ? 'var(--surf)' : 'transparent', border: !autoSend ? '2px solid var(--bdr2)' : '2px solid transparent', opacity: autoSend ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: !autoSend ? '#2d6a4f' : 'var(--bdr2)', flexShrink: 0 }} />
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Training Mode</div>
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', lineHeight: 1.55 }}>All responses are reviewed before being sent. Best for teaching the AI your style.</div>
              </div>
              <div onClick={() => setAutoSend(true)} style={{ padding: '16px', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .2s', background: autoSend ? 'var(--accp)' : 'transparent', border: autoSend ? '2px solid var(--accl)' : '2px solid transparent', opacity: !autoSend ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: autoSend ? 'var(--acc)' : 'var(--bdr2)', flexShrink: 0 }} />
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Auto Mode</div>
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', lineHeight: 1.55 }}>AI sends messages automatically when confident. Best when the AI is well trained.</div>
              </div>
            </div>
            {autoSend && (
              <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: 'var(--rsm)', background: 'var(--ambbg)', border: '1px solid var(--ambbd)', fontSize: '.79rem', color: 'var(--amb)', lineHeight: 1.55 }}>
                ⚠ Make sure the AI has been well trained before enabling Auto Mode. Monitor the inbox for a few days after switching.
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', paddingTop: '28px' }}>
            <button onClick={() => setAutoSend(!autoSend)} style={{ position: 'relative', width: '56px', height: '30px', borderRadius: '100px', border: 'none', cursor: 'pointer', background: autoSend ? 'var(--acc)' : 'var(--bdr2)', transition: 'background .2s', padding: 0 }}>
              <div style={{ position: 'absolute', top: '4px', left: autoSend ? '29px' : '4px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s' }} />
            </button>
            <div style={{ fontSize: '.7rem', color: 'var(--tx3)', fontWeight: 500 }}>{autoSend ? 'ON' : 'OFF'}</div>
          </div>
        </div>
      </div>

      {/* ══ AI BEHAVIOR SETTINGS ══ */}
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
              <option value="Coach / Brand Voice">Coach / Brand Voice — speaks as the expert, in your tone</option>
              <option value="Setter / Assistant">Setter / Assistant — qualifies leads on behalf of the coach</option>
              <option value="Hybrid">Hybrid — starts as setter, transitions to coach voice as trust builds</option>
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
              <option value="Book Call">Book Call — goal is to schedule a discovery or sales call</option>
              <option value="Close Sale">Close Sale — goal is to convert the lead directly in the conversation</option>
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
              <textarea className="form-input" rows={3} placeholder="e.g. A 12-week golf fitness coaching program for amateur golfers over 40 who want to add distance, reduce injury risk, and finally play their best golf — without spending more time at the range." value={aiBehavior.offerSummary} onChange={e => setBehavior('offerSummary', e.target.value)} style={{ resize: 'none', lineHeight: 1.6 }} />
              <div className="form-hint">What does your offer do and who is it for? Be specific — the AI uses this to stay on-topic and never misrepresent your offer.</div>
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
            ⚠ This is critical. The AI uses these rules to decide who to push forward and who to disqualify. Be specific.
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
              <option value="Direct & Results-Focused">Direct & Results-Focused — brief, straight to the point, wants the bottom line</option>
              <option value="Expressive & Emotional">Expressive & Emotional — shares context and feelings, responds to warmth</option>
              <option value="Analytical & Detail-Oriented">Analytical & Detail-Oriented — asks questions, wants clarity before committing</option>
              <option value="Mixed (default)">Mixed (default) — AI adapts based on how the lead responds</option>
            </select>
            <div className="form-hint">The AI automatically adjusts its tone, pacing, and level of detail based on this setting. Mixed is recommended unless your audience is very consistent.</div>
          </div>
        </div>
      </div>

      {/* ══ TARGET AVATAR ══ */}
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