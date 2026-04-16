import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const STAGE_PRIORITY = {
  'CALL BOOKING': 14, 'CALL OFFERED': 13, 'CALL BOOK BRIDGE': 12,
  'COACHING HAT': 11, 'PRIORITY GATE': 10, 'PROGRESS CHECK': 9,
  'BODY LINK ACCEPTANCE + MOBILITY HISTORY': 8, 'TRANSLATION / PROGRESS CHECK': 7,
  "WHAT THEY'VE TRIED (PAST + CURRENT)": 6, 'GOAL DEPTH (MAKE IT SPECIFIC)': 5,
  'GOAL LOCK': 4, 'LOCATION ANCHOR': 3, 'OPEN LOOP': 2, 'ENTRY / OPEN LOOP': 2,
  'ENTRY': 1, 'LONG TERM NURTURE': 0
}
const INTENT_SCORE = { HIGH: 3, MEDIUM: 2, LOW: 1 }
const TIME_RANGES = ['Today', 'Last 7 Days', 'Last 30 Days']

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
        <span style={{ position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)', background: '#1A1A1A', color: '#fff', fontSize: '.72rem', lineHeight: 1.5, padding: '7px 10px', borderRadius: '8px', width: '210px', zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,.25)', pointerEvents: 'none' }}>
          {text}
          <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', border: '5px solid transparent', borderTopColor: '#1A1A1A' }} />
        </span>
      )}
    </span>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [timeRange, setTimeRange] = useState('Last 7 Days')
  const [stats, setStats] = useState({ newConversations: 0, needsReply: 0, highIntent: 0, aiMessagesSent: 0, booked: 0, conversionRate: 0 })
  const [closestToBooking, setClosestToBooking] = useState([])
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const adminRole = profile?.role === 'admin' || profile?.role === 'superadmin'

  useEffect(() => { loadData() }, [profile, timeRange])

  function getDateFilter() {
    const now = new Date()
    if (timeRange === 'Today') { const d = new Date(now); d.setHours(0,0,0,0); return d.toISOString() }
    if (timeRange === 'Last 7 Days') { const d = new Date(now); d.setDate(d.getDate()-7); return d.toISOString() }
    const d = new Date(now); d.setDate(d.getDate()-30); return d.toISOString()
  }

  async function loadData() {
    if (!profile) return
    setLoading(true)
    try {
      let botsData = []
      if (adminRole && profile.organization_id) {
        const { data } = await supabase.from('bots').select('*').eq('organization_id', profile.organization_id)
        botsData = data || []
      } else if (profile.assigned_bot_id) {
        const { data } = await supabase.from('bots').select('*').eq('id', profile.assigned_bot_id)
        botsData = data || []
      }
      setBots(botsData)
      const botIds = botsData.map(b => b.id)
      if (!botIds.length) { setLoading(false); return }

      const since = getDateFilter()
      const [{ data: convos }, { data: allReviews }, { data: pendingReviewsCount }] = await Promise.all([
        supabase.from('conversations').select('customer_id, channel, lead_intent, conversation_stage, username, profile_name, updated_at, status').in('bot_id', botIds).neq('channel', 'tester').gte('updated_at', since),
        supabase.from('reviews').select('id, status').in('bot_id', botIds).gte('created_at', since),
        // Exclude tester leads — same logic as Inbox pendingOnly query
        supabase.from('reviews').select('customer_id').in('bot_id', botIds).eq('status', 'pending').not('customer_id', 'ilike', 'tester_%')
      ])

      const allConvos = (convos || []).filter(c => !c.username || !c.username.toLowerCase().startsWith('test'))
      const reviews = allReviews || []
      const newConversations = allConvos.length
      const needsReply = new Set((pendingReviewsCount || []).map(r => r.customer_id)).size
      const highIntent = allConvos.filter(c => c.lead_intent === 'HIGH').length
      const aiMessagesSent = reviews.filter(r => r.status === 'approved').length + reviews.filter(r => r.status === 'auto_sent').length
      const booked = allConvos.filter(c => c.status === 'booked').length
      const conversionRate = newConversations > 0 ? Math.round((booked / newConversations) * 100) : 0

      setStats({ newConversations, needsReply, highIntent, aiMessagesSent, booked, conversionRate })
      setLastUpdated(new Date())

      const scored = allConvos
        .filter(c => c.status !== 'booked')
        .map(c => {
          const stageScore = STAGE_PRIORITY[c.conversation_stage] ?? 0
          const intentScore = INTENT_SCORE[c.lead_intent] ?? 0
          const hoursAgo = (Date.now() - new Date(c.updated_at).getTime()) / 3600000
          const recencyScore = hoursAgo < 1 ? 3 : hoursAgo < 24 ? 2 : hoursAgo < 72 ? 1 : 0
          return { ...c, _score: (stageScore * 3) + (intentScore * 2) + recencyScore }
        })
        .sort((a, b) => b._score - a._score)
        .slice(0, 7)

      setClosestToBooking(scored)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function getLeadName(c) {
    if (!c) return ''
    if (c.username) return `@${c.username}`
    if (c.profile_name) return c.profile_name
    const ch = (c.channel || '').toLowerCase()
    if (ch.includes('instagram') || ch === 'manychat') return 'Instagram Lead'
    if (ch.includes('facebook')) return 'Facebook Lead'
    if (ch.includes('whatsapp')) return 'WhatsApp Lead'
    return 'Instagram Lead'
  }

  function intentInfo(intent, stage) {
    if (stage === 'CALL BOOKING') return { emoji: '✅', label: 'Booked', color: '#16a34a', bg: '#f0fdf4', border: '1px solid #bbf7d0' }
    if (intent === 'HIGH') return { emoji: '🔴', label: 'HIGH', color: '#e53e3e', bg: '#fff5f5', border: '1px solid #fed7d7' }
    if (intent === 'MEDIUM') return { emoji: '🟡', label: 'MEDIUM', color: '#d97706', bg: '#fffbeb', border: '1px solid #fde68a' }
    return { emoji: '⚪', label: 'LOW', color: '#6b7280', bg: '#f9fafb', border: '1px solid #e5e7eb' }
  }

  function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts), now = new Date(), diff = now - d
    const mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (today - msgDay === 86400000) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  function stageColor(stage) {
    if (!stage) return '#829082'
    if (stage.includes('CALL')) return '#1a4d8a'
    if (stage.includes('PRIORITY') || stage.includes('COACHING')) return '#a06800'
    return '#2d6a4f'
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const StatCard = ({ value, label, sub, color, border, urgent, tooltip }) => (
    <div className="stat-card" style={{ borderLeftColor: border || 'var(--acc)', ...(urgent ? { background: '#fff9f0', borderLeftColor: '#e53e3e' } : {}) }}>
      <div className="stat-num" style={{ color: urgent ? '#e53e3e' : (color || 'var(--acc)') }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px' }}>
        <div className="stat-label" style={{ fontSize: '.8rem', fontWeight: 500, color: 'var(--tx2)' }}>{label}</div>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      {sub && <div className="stat-change" style={{ color: urgent ? '#e53e3e' : (color || 'var(--acc)') }}>{sub}</div>}
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="page-sub">{profile?.organizations?.name || 'Platform'} · All bots</div>
            {lastUpdated && (
              <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>
                Last updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '10px', overflow: 'hidden' }}>
          {TIME_RANGES.map(t => (
            <button key={t} onClick={() => setTimeRange(t)} style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '.76rem', fontWeight: timeRange === t ? 600 : 400, background: timeRange === t ? 'var(--acc)' : 'transparent', color: timeRange === t ? '#fff' : 'var(--tx2)', transition: 'all .15s', fontFamily: 'var(--fn)' }}>{t}</button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--tx3)', marginBottom: '10px' }}>Activity</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <StatCard value={stats.newConversations} label="New Conversations" sub={timeRange}
            tooltip="Unique leads who sent at least one message in the selected period." />
          <StatCard value={stats.needsReply} label="Needs Reply" sub="Pending in Mu AI inbox"
            color="#e53e3e" border="#e53e3e" urgent={stats.needsReply > 0}
            tooltip="Leads with AI replies waiting for approval in the inbox. Conversations replied back to outside Mu AI platform will not be calculated." />
          <StatCard value={stats.highIntent} label="High Intent Leads" sub="High urgency leads"
            color="var(--amb)" border="var(--amb)"
            tooltip="Leads currently tagged as HIGH intent. Indicates strong motivation or urgency to act." />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--tx3)', marginBottom: '10px' }}>Performance</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <StatCard value={stats.aiMessagesSent} label="AI Messages Sent" sub="Auto-approved"
            color="var(--blu)" border="var(--blu)"
            tooltip="AI replies approved and sent, either automatically or manually by a setter." />
          <StatCard value={stats.booked} label="Calls Booked" sub={timeRange}
            color="#16a34a" border="#16a34a"
            tooltip="Leads who reached the CALL BOOKING stage in the conversation." />
          <StatCard value={`${stats.conversionRate}%`} label="Conversion Rate" sub="Booked / Total Conversations"
            color="var(--acc)" border="var(--acc)"
            tooltip="Calls Booked divided by total conversations started in this period." />
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--tx)' }}>Closest to Booking</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)', marginTop: '3px' }}>Top leads ranked by intent, stage, and recent activity</div>
        </div>
        {closestToBooking.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.9rem' }}>No active leads in this time range.</div>
        ) : (
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
              <thead>
                <tr>
                  {['Lead', 'Stage', 'Intent', 'Last Interaction'].map(h => (
                    <th key={h} style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.07em', padding: '10px 16px', borderBottom: '2px solid var(--bdr)', textAlign: 'left', background: 'var(--surf2)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closestToBooking.map((c, i) => {
                  const ii = intentInfo(c.lead_intent, c.conversation_stage)
                  return (
                    <tr key={c.customer_id} onClick={() => navigate('/dashboard/inbox', { state: { openLead: c.customer_id } })} style={{ cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--accp)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: i === 0 ? 'var(--acc)' : 'var(--surf3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.72rem', fontWeight: 700, color: i === 0 ? '#fff' : 'var(--tx3)', flexShrink: 0 }}>{i + 1}</div>
                          <span style={{ fontWeight: 600, fontSize: '.86rem', color: 'var(--tx)' }}>{getLeadName(c)}</span>
                        </div>
                      </td>
                      <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)' }}>
                        <span style={{ fontSize: '.76rem', color: stageColor(c.conversation_stage), fontWeight: 500 }}>{c.conversation_stage || '—'}</span>
                      </td>
                      <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)' }}>
                        <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: ii.bg, color: ii.color, border: ii.border }}>
                          {ii.emoji} {ii.label}
                        </span>
                      </td>
                      <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)', fontSize: '.82rem', color: 'var(--tx3)' }}>
                        {fmtTime(c.updated_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
