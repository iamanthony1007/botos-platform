import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

export default function Settings() {
  const { profile } = useAuth()
  const [bot, setBot] = useState(null)
  const [autoSend, setAutoSend] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)

  // Campaign config
  const [leadType, setLeadType] = useState('Cold')
  const [buyerType, setBuyerType] = useState('Emotional')
  const [commStyle, setCommStyle] = useState('Hybrid')
  const [campaignGoal, setCampaignGoal] = useState('General')
  const [targetAvatar, setTargetAvatar] = useState('')

  useEffect(() => { load() }, [profile])

  async function load() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    if (data) {
      setBot(data)
      setAutoSend(data.auto_send_enabled === true)
      setLeadType(data.lead_type || 'Cold')
      setBuyerType(data.buyer_type || 'Emotional')
      setCommStyle(data.communication_style || 'Hybrid')
      setCampaignGoal(data.campaign_goal || 'General')
      setTargetAvatar(data.target_avatar || '')
    }
    setLoading(false)
  }

  async function saveSettings() {
    if (!bot) return
    setSaving(true)
    const { error } = await supabase
      .from('bots')
      .update({
        auto_send_enabled: autoSend,
        lead_type: leadType,
        buyer_type: buyerType,
        communication_style: commStyle,
        campaign_goal: campaignGoal,
        target_avatar: targetAvatar,
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

  return (
    <div className="page">
      {toast && <div className="toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">{bot?.name} · Bot configuration</div>
        </div>
        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* AUTO-SEND TOGGLE */}
      <div className="card" style={{ border: autoSend ? '2px solid var(--accm)' : '2px solid var(--bdr2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ fontSize: '1rem', fontWeight: 600 }}>Auto-Send Mode</div>
              <span className={`badge ${autoSend ? 'badge-green' : 'badge-amber'}`}>
                {autoSend ? 'ON' : 'OFF — Training Mode'}
              </span>
            </div>
            <div style={{ fontSize: '.84rem', color: 'var(--tx2)', lineHeight: 1.65, marginBottom: '14px' }}>
              {autoSend
                ? <><strong style={{ color: 'var(--acc)' }}>Auto-send is ON.</strong> The bot sends replies directly to leads when confidence and intent thresholds are met.</>
                : <><strong style={{ color: 'var(--amb)' }}>Training mode is ON.</strong> Every bot reply goes to the setter inbox before being sent — regardless of confidence.</>
              }
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{
                padding: '12px 14px', borderRadius: 'var(--rsm)',
                background: !autoSend ? 'var(--accp)' : 'var(--surf2)',
                border: !autoSend ? '1.5px solid var(--accl)' : '1px solid var(--bdr)'
              }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: !autoSend ? 'var(--acc)' : 'var(--tx3)', marginBottom: '5px' }}>
                  {!autoSend ? 'Active now' : 'Training Mode'}
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.5 }}>
                  All replies go to setter inbox<br />
                  Setter reviews every message<br />
                  Bot learns from every correction
                </div>
              </div>
              <div style={{
                padding: '12px 14px', borderRadius: 'var(--rsm)',
                background: autoSend ? 'var(--accp)' : 'var(--surf2)',
                border: autoSend ? '1.5px solid var(--accl)' : '1px solid var(--bdr)'
              }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: autoSend ? 'var(--acc)' : 'var(--tx3)', marginBottom: '5px' }}>
                  {autoSend ? 'Active now' : 'Auto-Send Mode'}
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.5 }}>
                  HIGH intent + 90% confidence → auto<br />
                  MEDIUM intent + 85% early stage → auto<br />
                  LOW intent always goes to inbox
                </div>
              </div>
            </div>
          </div>

          {/* Toggle */}
          <div style={{ flexShrink: 0, paddingTop: '4px' }}>
            <button
              onClick={() => setAutoSend(!autoSend)}
              style={{
                position: 'relative', width: '52px', height: '28px',
                borderRadius: '100px', border: 'none', cursor: 'pointer',
                background: autoSend ? 'var(--acc)' : 'var(--bdr2)',
                transition: 'background .2s', padding: 0
              }}
            >
              <div style={{
                position: 'absolute', top: '3px',
                left: autoSend ? '27px' : '3px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                transition: 'left .2s'
              }} />
            </button>
          </div>
        </div>

        {autoSend && (
          <div style={{
            marginTop: '14px', padding: '10px 14px', borderRadius: 'var(--rsm)',
            background: 'var(--ambbg)', border: '1px solid var(--ambbd)',
            fontSize: '.79rem', color: 'var(--amb)', lineHeight: 1.55
          }}>
            Make sure the bot has been well trained before enabling this. Monitor the inbox for a few days after enabling.
          </div>
        )}
      </div>

      {/* CAMPAIGN CONFIG */}
      <div className="card">
        <div className="card-title">Campaign Configuration</div>
        <div style={{ fontSize: '.82rem', color: 'var(--tx3)', marginBottom: '18px', lineHeight: 1.6 }}>
          Define how this bot should approach leads. These settings are injected into the bot's system prompt to tailor its tone and strategy per campaign.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Row 1 — Lead type + Buyer type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Lead Type</label>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '6px' }}>How warm are the leads coming in?</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['Cold', 'Warm', 'Hot'].map(opt => (
                  <button key={opt} onClick={() => setLeadType(opt)} style={{
                    flex: 1, padding: '8px 6px', borderRadius: '8px', border: 'none',
                    cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
                    background: leadType === opt ? 'var(--acc)' : 'var(--surf2)',
                    color: leadType === opt ? '#fff' : 'var(--tx2)',
                    transition: 'all .15s'
                  }}>{opt}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Buyer Type</label>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '6px' }}>How do leads make decisions?</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['Emotional', 'Logical', 'Transactional'].map(opt => (
                  <button key={opt} onClick={() => setBuyerType(opt)} style={{
                    flex: 1, padding: '8px 6px', borderRadius: '8px', border: 'none',
                    cursor: 'pointer', fontSize: '.78rem', fontWeight: 600,
                    background: buyerType === opt ? 'var(--acc)' : 'var(--surf2)',
                    color: buyerType === opt ? '#fff' : 'var(--tx2)',
                    transition: 'all .15s'
                  }}>{opt}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2 — Communication style + Campaign goal */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Communication Style</label>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '6px' }}>How should the bot communicate?</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['Soft', 'Direct', 'Hybrid'].map(opt => (
                  <button key={opt} onClick={() => setCommStyle(opt)} style={{
                    flex: 1, padding: '8px 6px', borderRadius: '8px', border: 'none',
                    cursor: 'pointer', fontSize: '.8rem', fontWeight: 600,
                    background: commStyle === opt ? 'var(--acc)' : 'var(--surf2)',
                    color: commStyle === opt ? '#fff' : 'var(--tx2)',
                    transition: 'all .15s'
                  }}>{opt}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Primary Campaign Goal</label>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '6px' }}>What is this campaign trying to achieve?</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {['Book Call', 'Qualify Lead', 'Nurture', 'General'].map(opt => (
                  <button key={opt} onClick={() => setCampaignGoal(opt)} style={{
                    flex: 1, padding: '8px 6px', borderRadius: '8px', border: 'none',
                    cursor: 'pointer', fontSize: '.78rem', fontWeight: 600,
                    background: campaignGoal === opt ? 'var(--acc)' : 'var(--surf2)',
                    color: campaignGoal === opt ? '#fff' : 'var(--tx2)',
                    transition: 'all .15s'
                  }}>{opt}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Target avatar */}
          <div className="form-group">
            <label className="form-label">Target Avatar</label>
            <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '6px' }}>Describe the ideal lead for this campaign</div>
            <textarea
              className="form-input"
              rows={3}
              placeholder="e.g. 40-55 year old male golfer, busy professional, family man. Frustrated by losing distance and nagging aches. Has tried generic programs but nothing golf-specific."
              value={targetAvatar}
              onChange={e => setTargetAvatar(e.target.value)}
              style={{ resize: 'none', lineHeight: 1.6 }}
            />
          </div>

          {/* Live preview */}
          {(leadType || buyerType || commStyle) && (
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--rsm)',
              background: 'var(--accp)', border: '1px solid var(--accl)'
            }}>
              <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '6px' }}>
                Bot Approach Preview
              </div>
              <div style={{ fontSize: '.81rem', color: 'var(--tx2)', lineHeight: 1.65 }}>
                {leadType === 'Cold' && buyerType === 'Emotional' && commStyle === 'Soft' &&
                  'Slow-build rapport first. Validate emotions, go deep on pain before any pivot to solution.'}
                {leadType === 'Cold' && buyerType === 'Logical' && commStyle === 'Direct' &&
                  'Short, value-driven messages. Lead with outcomes and structure. Skip the small talk.'}
                {leadType === 'Warm' && buyerType === 'Emotional' && commStyle === 'Hybrid' &&
                  'Balanced approach. Acknowledge, bridge, question. Medium pace. Build on existing interest.'}
                {leadType === 'Hot' && commStyle === 'Direct' &&
                  'Move fast. They\'re ready. Confirm pain, confirm priority, get to the call bridge quickly.'}
                {leadType === 'Hot' && commStyle !== 'Direct' &&
                  'High intent detected. Confirm urgency and pivot to call booking efficiently.'}
                {leadType === 'Cold' && buyerType === 'Transactional' &&
                  'Keep it short and value-focused. They want to know what\'s in it for them quickly.'}
                {leadType === 'Warm' && buyerType === 'Logical' &&
                  'Structured questioning. Show you understand their situation with data and outcomes.'}
                {leadType === 'Warm' && buyerType === 'Transactional' &&
                  'They\'re interested but need a clear reason to move. Make the value obvious and fast.'}
                {!['Cold','Warm','Hot'].includes(leadType) || (!['Emotional','Logical','Transactional'].includes(buyerType)) &&
                  'Select lead type, buyer type and communication style to see the approach preview.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BOT CONFIGURATION */}
      <div className="card">
        <div className="card-title">Bot Configuration</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group">
            <label className="form-label">Bot Name</label>
            <input className="form-input" value={bot?.name || ''} readOnly style={{ background: 'var(--surf2)', color: 'var(--tx3)' }} />
          </div>
          <div className="form-group">
            <label className="form-label">AI Model</label>
            <input className="form-input" value={bot?.model || 'gpt-5.4'} readOnly style={{ background: 'var(--surf2)', color: 'var(--tx3)', fontFamily: 'monospace' }} />
          </div>
          <div className="form-group">
            <label className="form-label">Webhook Endpoint</label>
            <input className="form-input" value={bot?.webhook_url || 'https://sales-bot.nellakuate.workers.dev/webhook'} readOnly style={{ background: 'var(--surf2)', color: 'var(--tx3)', fontFamily: 'monospace', fontSize: '.8rem' }} />
          </div>
          <div className="form-group">
            <label className="form-label">Bot Status</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <span className={`badge ${bot?.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{bot?.status || 'active'}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--r)', padding: '14px 16px' }}>
        <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--acc)', marginBottom: '5px' }}>When to enable Auto-Send</div>
        <div style={{ fontSize: '.78rem', color: 'var(--tx2)', lineHeight: 1.65 }}>
          A good rule of thumb: once the setter has reviewed 50–100 messages without major edits, the bot is ready. Check the Learnings page — if corrections are getting smaller and less frequent, confidence is building. Monitor for a few days after enabling.
        </div>
      </div>
    </div>
  )
}