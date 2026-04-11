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

      {/* ══ AI MODE — PROMINENT TOP SECTION ══ */}
      <div style={{
        background: autoSend
          ? 'linear-gradient(135deg, #faf6e8 0%, #fff9ed 100%)'
          : 'linear-gradient(135deg, #f8f8f5 0%, #f2f1ec 100%)',
        border: autoSend ? '2px solid var(--accm)' : '2px solid var(--bdr2)',
        borderRadius: 'var(--rlg)', padding: '24px 28px', transition: 'all .3s'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: autoSend ? 'var(--acc)' : 'var(--tx3)', marginBottom: '8px' }}>
              AI Mode
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--tx)', marginBottom: '6px' }}>
              {autoSend ? 'Auto Mode' : 'Training Mode'}
            </div>
            <div style={{ fontSize: '.86rem', color: 'var(--tx2)', lineHeight: 1.65, maxWidth: '520px' }}>
              {autoSend
                ? 'The AI sends messages automatically when it is confident in its response. Monitor the inbox regularly to ensure quality.'
                : 'All AI responses are reviewed by you before being sent to leads. Use this mode while training the AI or when you want full control.'}
            </div>

            {/* Mode cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
              {/* Training Mode card */}
              <div
                onClick={() => setAutoSend(false)}
                style={{
                  padding: '16px', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .2s',
                  background: !autoSend ? 'var(--surf)' : 'transparent',
                  border: !autoSend ? '2px solid var(--bdr2)' : '2px solid transparent',
                  opacity: autoSend ? 0.6 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: !autoSend ? '#2d6a4f' : 'var(--bdr2)', flexShrink: 0 }} />
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Training Mode</div>
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', lineHeight: 1.55 }}>
                  All responses are reviewed before being sent. Best for teaching the AI your style.
                </div>
              </div>

              {/* Auto Mode card */}
              <div
                onClick={() => setAutoSend(true)}
                style={{
                  padding: '16px', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .2s',
                  background: autoSend ? 'var(--accp)' : 'transparent',
                  border: autoSend ? '2px solid var(--accl)' : '2px solid transparent',
                  opacity: !autoSend ? 0.6 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: autoSend ? 'var(--acc)' : 'var(--bdr2)', flexShrink: 0 }} />
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Auto Mode</div>
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--tx3)', lineHeight: 1.55 }}>
                  AI sends messages automatically when confident. Best when the AI is well trained.
                </div>
              </div>
            </div>

            {autoSend && (
              <div style={{
                marginTop: '14px', padding: '10px 14px', borderRadius: 'var(--rsm)',
                background: 'var(--ambbg)', border: '1px solid var(--ambbd)',
                fontSize: '.79rem', color: 'var(--amb)', lineHeight: 1.55
              }}>
                ⚠ Make sure the AI has been well trained before enabling Auto Mode. Monitor the inbox for a few days after switching.
              </div>
            )}
          </div>

          {/* Toggle */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', paddingTop: '28px' }}>
            <button
              onClick={() => setAutoSend(!autoSend)}
              style={{
                position: 'relative', width: '56px', height: '30px',
                borderRadius: '100px', border: 'none', cursor: 'pointer',
                background: autoSend ? 'var(--acc)' : 'var(--bdr2)',
                transition: 'background .2s', padding: 0
              }}
            >
              <div style={{
                position: 'absolute', top: '4px',
                left: autoSend ? '29px' : '4px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                transition: 'left .2s'
              }} />
            </button>
            <div style={{ fontSize: '.7rem', color: 'var(--tx3)', fontWeight: 500 }}>
              {autoSend ? 'ON' : 'OFF'}
            </div>
          </div>
        </div>
      </div>

      {/* CAMPAIGN CONFIG */}
      <div className="card">
        <div className="card-title">Campaign Configuration</div>
        <div style={{ fontSize: '.82rem', color: 'var(--tx3)', marginBottom: '18px', lineHeight: 1.6 }}>
          Define how this bot should approach leads. These settings are injected into the bot's system prompt to tailor its tone and strategy per campaign.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

          <div className="form-group">
            <label className="form-label">Lead Type</label>
            <select className="form-input" value={leadType} onChange={e => setLeadType(e.target.value)}>
              <option value="Cold">Cold</option>
              <option value="Warm">Warm</option>
              <option value="Hot">Hot</option>
            </select>
            <div className="form-hint">How familiar are leads with your offer when they first message?</div>
          </div>

          <div className="form-group">
            <label className="form-label">Buyer Type</label>
            <select className="form-input" value={buyerType} onChange={e => setBuyerType(e.target.value)}>
              <option value="Emotional">Emotional</option>
              <option value="Logical">Logical</option>
              <option value="Transactional">Transactional</option>
            </select>
            <div className="form-hint">How do your leads typically make decisions?</div>
          </div>

          <div className="form-group">
            <label className="form-label">Communication Style</label>
            <select className="form-input" value={commStyle} onChange={e => setCommStyle(e.target.value)}>
              <option value="Soft">Soft</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Direct">Direct</option>
            </select>
            <div className="form-hint">How should the bot communicate with leads?</div>
          </div>

          <div className="form-group">
            <label className="form-label">Campaign Goal</label>
            <select className="form-input" value={campaignGoal} onChange={e => setCampaignGoal(e.target.value)}>
              <option value="General">General</option>
              <option value="Book a Call">Book a Call</option>
              <option value="Qualify Leads">Qualify Leads</option>
              <option value="Nurture">Nurture</option>
            </select>
            <div className="form-hint">What is the primary outcome you want from conversations?</div>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: '8px' }}>
          <label className="form-label">Target Avatar</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="e.g. 40-55 year old male golfer, busy professional, family man. Frustrated by losing distance and nagging aches. Has tried generic programs but nothing golf-specific."
            value={targetAvatar}
            onChange={e => setTargetAvatar(e.target.value)}
            style={{ resize: 'none', lineHeight: 1.6 }}
          />
          <div className="form-hint">Describe your ideal lead so the bot can tailor its approach.</div>
        </div>

        {(leadType || buyerType || commStyle) && (
          <div style={{
            padding: '12px 14px', borderRadius: 'var(--rsm)',
            background: 'var(--accp)', border: '1px solid var(--accl)'
          }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '6px' }}>
              Bot Approach Preview
            </div>
            <div style={{ fontSize: '.81rem', color: 'var(--tx2)', lineHeight: 1.65 }}>
              {leadType === 'Cold' && buyerType === 'Emotional' && commStyle === 'Soft' && 'Slow-build rapport first. Validate emotions, go deep on pain before any pivot to solution.'}
              {leadType === 'Cold' && buyerType === 'Logical' && commStyle === 'Direct' && 'Short, value-driven messages. Lead with outcomes and structure. Skip the small talk.'}
              {leadType === 'Warm' && buyerType === 'Emotional' && commStyle === 'Hybrid' && 'Balanced approach. Acknowledge, bridge, question. Medium pace. Build on existing interest.'}
              {leadType === 'Hot' && commStyle === 'Direct' && "Move fast. They're ready. Confirm pain, confirm priority, get to the call bridge quickly."}
              {leadType === 'Hot' && commStyle !== 'Direct' && 'High intent detected. Confirm urgency and pivot to call booking efficiently.'}
              {leadType === 'Cold' && buyerType === 'Transactional' && "Keep it short and value-focused. They want to know what's in it for them quickly."}
              {leadType === 'Warm' && buyerType === 'Logical' && 'Structured questioning. Show you understand their situation with data and outcomes.'}
              {leadType === 'Warm' && buyerType === 'Transactional' && "They're interested but need a clear reason to move. Make the value obvious and fast."}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}