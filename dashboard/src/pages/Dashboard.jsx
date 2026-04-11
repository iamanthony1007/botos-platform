import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const [stats, setStats] = useState({ conversations: 0, autoSend: 0, callsBooked: 0, learnings: 0 })
  const [conversations, setConversations] = useState([])
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [profile])

  async function loadData() {
    if (!profile) return
    setLoading(true)
    try {
      let botsData = []
      const isAdmin = profile.role === 'admin' || profile.role === 'superadmin'
      if (isAdmin && profile.organization_id) {
        const { data } = await supabase.from('bots').select('*').eq('organization_id', profile.organization_id)
        botsData = data || []
      } else if (profile.assigned_bot_id) {
        const { data } = await supabase.from('bots').select('*').eq('id', profile.assigned_bot_id)
        botsData = data || []
      }
      setBots(botsData)

      const botIds = (botsData || []).map(b => b.id)
      if (botIds.length === 0) { setLoading(false); return }

      const { data: convos } = await supabase
        .from('conversations')
        .select('*')
        .in('bot_id', botIds)
        .order('updated_at', { ascending: false })
        .limit(10)
      setConversations(convos || [])

      const { count: totalConvos } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .in('bot_id', botIds)

      const { count: totalLearnings } = await supabase
        .from('learnings')
        .select('*', { count: 'exact', head: true })
        .in('bot_id', botIds)

      const { count: bookedCount } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .in('bot_id', botIds)
        .eq('status', 'booked')

      setStats({
        conversations: totalConvos || 0,
        autoSend: totalConvos > 0 ? Math.round((bookedCount || 0) / totalConvos * 100) : 0,
        callsBooked: bookedCount || 0,
        learnings: totalLearnings || 0,
      })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function getLeadName(c) {
    if (!c) return ''
    if (c.username) return `@${c.username}`
    if (c.profile_name) return c.profile_name
    // Channel-based fallback
    const ch = (c.channel || '').toLowerCase()
    if (ch.includes('instagram') || ch === 'manychat') return 'Instagram Lead'
    if (ch.includes('facebook')) return 'Facebook Lead'
    if (ch.includes('whatsapp')) return 'WhatsApp Lead'
    if (ch.includes('sms') || ch.includes('text')) return 'SMS Lead'
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
    if (stage.includes('READY') || stage.includes('REALITY')) return '#a06800'
    return '#2d6a4f'
  }

  if (loading) return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">{profile?.organizations?.name || 'Platform'} · All bots</div>
        </div>
        <button className="btn btn-primary btn-sm">+ New Bot</button>
      </div>

      {/* STATS */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-num">{stats.conversations}</div>
          <div className="stat-label">Total Conversations</div>
          <div className="stat-change">All time</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--blu)' }}>
          <div className="stat-num" style={{ color: 'var(--blu)' }}>{stats.autoSend}%</div>
          <div className="stat-label">Auto-Send Rate</div>
          <div className="stat-change" style={{ color: 'var(--blu)' }}>Estimated</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--amb)' }}>
          <div className="stat-num" style={{ color: 'var(--amb)' }}>{stats.callsBooked}</div>
          <div className="stat-label">Calls Booked</div>
          <div className="stat-change" style={{ color: 'var(--amb)' }}>All time</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.learnings}</div>
          <div className="stat-label">Bot Learnings</div>
          <div className="stat-change">All corrections</div>
        </div>
      </div>

      {/* RECENT CONVERSATIONS */}
      <div className="card">
        <div className="card-title">Recent Conversations</div>
        {conversations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.84rem' }}>
            No conversations yet. Once leads start messaging, they will appear here.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Stage</th>
                  <th>Readiness</th>
                  <th>Status</th>
                  <th>Last Interaction</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map(c => {
                  const ri = readinessInfo(c.lead_readiness, c.conversation_stage)
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500, fontSize: '.85rem' }}>{getLeadName(c)}</td>
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
                      <td>
                        <span className={`badge ${c.status === 'booked' ? 'badge-blue' : c.status === 'active' ? 'badge-green' : 'badge-gray'}`}>
                          {c.status || 'active'}
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
      {isAdmin && <div className="card">
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
      </div>}
    </div>
  )
}