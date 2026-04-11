import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

export default function Analytics() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ total: 0, booked: 0, learnings: 0, reviews: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [profile])

  async function load() {
    if (!profile) return
    const isAdmin = profile.role === 'admin' || profile.role === 'superadmin'
    let botQuery = supabase.from('bots').select('id')
    if (isAdmin && profile.organization_id) {
      botQuery = botQuery.eq('organization_id', profile.organization_id)
    } else if (profile.assigned_bot_id) {
      botQuery = botQuery.eq('id', profile.assigned_bot_id)
    } else {
      setLoading(false); return
    }
    const { data: bot } = await botQuery.single()
    if (!bot) { setLoading(false); return }
    const [{ count: total }, { count: booked }, { count: learnings }, { count: reviews }] = await Promise.all([
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('bot_id', bot.id),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('bot_id', bot.id).eq('status', 'booked'),
      supabase.from('learnings').select('*', { count: 'exact', head: true }).eq('bot_id', bot.id),
      supabase.from('reviews').select('*', { count: 'exact', head: true }).eq('bot_id', bot.id),
    ])
    setStats({ total: total||0, booked: booked||0, learnings: learnings||0, reviews: reviews||0 })
    setLoading(false)
  }

  function Bar({ label, value, max, color }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '.79rem', color: 'var(--tx2)', minWidth: '130px' }}>{label}</span>
        <div style={{ flex: 1, height: '8px', background: 'var(--surf3)', borderRadius: '100px', overflow: 'hidden', border: '1px solid var(--bdr)' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '100px', transition: 'width .8s' }} />
        </div>
        <span style={{ fontSize: '.77rem', fontWeight: 500, minWidth: '32px', textAlign: 'right', color }}>{value}</span>
      </div>
    )
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const bookingRate = stats.total > 0 ? ((stats.booked / stats.total) * 100).toFixed(1) : 0

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Analytics</div><div className="page-sub">All time · Bombers Blueprint</div></div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num">{stats.total}</div><div className="stat-label">Conversations</div><div className="stat-change">All time</div></div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--amb)' }}><div className="stat-num" style={{ color: 'var(--amb)' }}>{stats.booked}</div><div className="stat-label">Calls Booked</div><div className="stat-change" style={{ color: 'var(--amb)' }}>All time</div></div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--blu)' }}><div className="stat-num" style={{ color: 'var(--blu)' }}>{bookingRate}%</div><div className="stat-label">Booking Rate</div><div className="stat-change" style={{ color: 'var(--blu)' }}>Booked / total</div></div>
        <div className="stat-card"><div className="stat-num">{stats.learnings}</div><div className="stat-label">Bot Learnings</div><div className="stat-change">All corrections</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div className="card">
          <div className="card-title">Conversation Funnel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            <Bar label="Total conversations" value={stats.total} max={stats.total} color="var(--acc)" />
            <Bar label="Calls booked" value={stats.booked} max={stats.total} color="var(--amb)" />
            <Bar label="Reviews flagged" value={stats.reviews} max={stats.total} color="var(--blu)" />
            <Bar label="Learnings captured" value={stats.learnings} max={Math.max(stats.total, stats.learnings)} color="var(--accm)" />
          </div>
        </div>
        <div className="card">
          <div className="card-title">Platform Activity</div>
          {stats.total === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.84rem' }}>
              No activity yet. Once leads start messaging the bot, stats will appear here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--accp)', borderRadius: 'var(--rsm)', border: '1px solid var(--accl)' }}>
                <span style={{ fontSize: '.84rem', color: 'var(--tx2)' }}>Booking conversion</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--acc)' }}>{bookingRate}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', border: '1px solid var(--bdr)' }}>
                <span style={{ fontSize: '.84rem', color: 'var(--tx2)' }}>Reviews sent to setter</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>{stats.reviews}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}