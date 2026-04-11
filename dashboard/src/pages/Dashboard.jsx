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
const READINESS_SCORE = { HOT: 3, WARM: 2, COLD: 1 }
const TIME_RANGES = ['Today', 'Last 7 Days', 'Last 30 Days']

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [timeRange, setTimeRange] = useState('Last 7 Days')
  const [stats, setStats] = useState({ active: 0, qualified: 0, aiAssisted: 0, booked: 0, conversionRate: 0, qualifiedPct: 0 })
  const [closestToBooking, setClosestToBooking] = useState([])
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
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

      const { data: convos } = await supabase
        .from('conversations')
        .select('customer_id, channel, lead_readiness, lead_intent, conversation_stage, username, profile_name, updated_at, status')
        .in('bot_id', botIds)
        .gte('updated_at', since)
      const allConvos = convos || []

      const { data: reviewConvos } = await supabase
        .from('reviews')
        .select('customer_id')
        .in('bot_id', botIds)
        .gte('created_at', since)
      const aiAssistedIds = new Set((reviewConvos || []).map(r => r.customer_id))

      const active = allConvos.length
      const qualified = allConvos.filter(c => c.lead_readiness === 'HOT' || c.lead_readiness === 'WARM').length
      const booked = allConvos.filter(c => c.status === 'booked').length
      const aiAssisted = aiAssistedIds.size
      const qualifiedPct = active > 0 ? Math.round((qualified / active) * 100) : 0
      const conversionRate = qualified > 0 ? Math.round((booked / qualified) * 100) : 0

      setStats({ active, qualified, aiAssisted, booked, conversionRate, qualifiedPct })

      const scored = allConvos
        .filter(c => c.status !== 'booked')
        .map(c => {
          const stageScore = STAGE_PRIORITY[c.conversation_stage] ?? 0
          const readinessScore = READINESS_SCORE[c.lead_readiness] ?? 0
          const hoursAgo = (Date.now() - new Date(c.updated_at).getTime()) / 3600000
          const recencyScore = hoursAgo < 1 ? 3 : hoursAgo < 24 ? 2 : hoursAgo < 72 ? 1 : 0
          return { ...c, _score: (stageScore * 3) + (readinessScore * 2) + recencyScore }
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
    if (ch.includes('sms')) return 'SMS Lead'
    if (ch.includes('email')) return 'Email Lead'
    return 'Unknown Lead'
  }

  function readinessInfo(r, stage) {
    if (stage === 'CALL BOOKING') return { emoji: '✅', label: 'Call Booked', color: '#16a34a', bg: '#f0fdf4', border: '1px solid #bbf7d0' }
    if (r === 'HOT') return { emoji: '🔥', label: 'HOT', color: '#e53e3e', bg: '#fff5f5', border: '1px solid #fed7d7' }
    if (r === 'WARM') return { emoji: '🟡', label: 'WARM', color: '#d97706', bg: '#fffbeb', border: '1px solid #fde68a' }
    return { emoji: '🔵', label: 'COLD', color: '#3b82f6', bg: '#eff6ff', border: '1px solid #bfdbfe' }
  }

  function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts), now = new Date(), diff = now - d
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
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

  const StatCard = ({ value, label, sub, color, border, pct }) => (
    <div className="stat-card" style={{ borderLeftColor: border || 'var(--acc)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <div className="stat-num" style={{ color: color || 'var(--acc)' }}>{value}</div>
        {pct !== undefined && <div style={{ fontSize: '.82rem', fontWeight: 600, color: color || 'var(--acc)' }}>{pct}%</div>}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-change" style={{ color: color || 'var(--acc)' }}>{sub}</div>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">{profile?.organizations?.name || 'Platform'} · All bots</div>
        </div>
        <div style={{ display: 'flex', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '10px', overflow: 'hidden' }}>
          {TIME_RANGES.map(t => (
            <button key={t} onClick={() => setTimeRange(t)} style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '.76rem', fontWeight: timeRange === t ? 600 : 400,
              background: timeRange === t ? 'var(--acc)' : 'transparent',
              color: timeRange === t ? '#fff' : 'var(--tx2)', transition: 'all .15s', fontFamily: 'var(--fn)'
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* STATS — AI-Assisted only visible to admin/superadmin */}
      <div className="stats-grid">
        <StatCard value={stats.active} label="Active Conversations" sub={timeRange} />
        <StatCard value={stats.qualified} label="Number of Qualified Leads" sub={timeRange} color="var(--amb)" border="var(--amb)" pct={stats.qualifiedPct} />
        {adminRole && <StatCard value={stats.aiAssisted} label="AI-Assisted Conversations" sub="Bot generated reply" color="var(--blu)" border="var(--blu)" />}
        <StatCard value={stats.booked} label="Calls Booked" sub={timeRange} color="#16a34a" border="#16a34a" />
        <StatCard value={`${stats.conversionRate}%`} label="Conversion Rate" sub="Booked ÷ Qualified" color="var(--acc)" border="var(--acc)" />
      </div>

      {/* CLOSEST TO BOOKING */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>Closest to Booking</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: '2px' }}>Top leads ranked by readiness, stage, and recent activity</div>
          </div>
        </div>
        {closestToBooking.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.84rem' }}>
            No active leads in this time range.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Stage</th>
                  <th>Readiness</th>
                  <th>Last Interaction</th>
                </tr>
              </thead>
              <tbody>
                {closestToBooking.map((c, i) => {
                  const ri = readinessInfo(c.lead_readiness, c.conversation_stage)
                  return (
                    <tr
                      key={c.customer_id}
                      onClick={() => navigate('/dashboard/inbox', { state: { openLead: c.customer_id } })}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: i === 0 ? 'var(--acc)' : 'var(--surf3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.65rem', fontWeight: 700, color: i === 0 ? '#fff' : 'var(--tx3)', flexShrink: 0 }}>
                            {i + 1}
                          </div>
                          <span style={{ fontWeight: 500, fontSize: '.85rem' }}>{getLeadName(c)}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '.78rem', color: stageColor(c.conversation_stage) }}>
                          {c.conversation_stage || 'Entry'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '.78rem', fontWeight: 700, padding: '2px 10px', borderRadius: '999px', color: ri.color, background: ri.bg, border: ri.border }}>
                          {ri.emoji} {ri.label}
                        </span>
                      </td>
                      <td style={{ fontSize: '.78rem', color: 'var(--tx3)' }}>{fmtTime(c.updated_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* BOTS TABLE - admin only */}
      {adminRole && bots.length > 0 && (
        <div className="card">
          <div className="card-title">Your Bots</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Bot Name</th><th>Model</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {bots.map(b => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td style={{ fontSize: '.78rem', color: 'var(--tx3)', fontFamily: 'monospace' }}>{b.model}</td>
                    <td><span className={`badge ${b.status === 'active' ? 'badge-green' : b.status === 'trial' ? 'badge-blue' : 'badge-gray'}`}>{b.status}</span></td>
                    <td style={{ fontSize: '.78rem', color: 'var(--tx3)' }}>{new Date(b.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}