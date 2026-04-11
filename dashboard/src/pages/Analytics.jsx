import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const TIME_RANGES = ['Today', 'Last 7 Days', 'Last 30 Days']

const STAGE_ORDER = [
  'ENTRY / OPEN LOOP', 'ENTRY', 'OPEN LOOP',
  'LOCATION ANCHOR', 'GOAL LOCK', 'GOAL DEPTH (MAKE IT SPECIFIC)',
  "WHAT THEY'VE TRIED (PAST + CURRENT)", 'TRANSLATION / PROGRESS CHECK',
  'BODY LINK ACCEPTANCE + MOBILITY HISTORY', 'PROGRESS CHECK',
  'PRIORITY GATE', 'COACHING HAT', 'CALL BOOK BRIDGE', 'CALL OFFERED',
  'CALL BOOKING', 'LONG TERM NURTURE'
]

export default function Analytics() {
  const { profile } = useAuth()
  const [timeRange, setTimeRange] = useState('Last 7 Days')
  const [stats, setStats] = useState({ active: 0, qualified: 0, qualifiedPct: 0, aiAssisted: 0, booked: 0, conversionRate: 0 })
  const [stageData, setStageData] = useState([])
  const [systemPerf, setSystemPerf] = useState({ bookingRate: 0, reviewsSent: 0, autoSendRate: 0 })
  const [loading, setLoading] = useState(true)
  const [botName, setBotName] = useState('Bombers Blueprint')

  useEffect(() => { load() }, [profile, timeRange])

  function getDateFilter() {
    const now = new Date()
    if (timeRange === 'Today') { const d = new Date(now); d.setHours(0,0,0,0); return d.toISOString() }
    if (timeRange === 'Last 7 Days') { const d = new Date(now); d.setDate(d.getDate()-7); return d.toISOString() }
    const d = new Date(now); d.setDate(d.getDate()-30); return d.toISOString()
  }

  async function load() {
    if (!profile) return
    setLoading(true)
    try {
      const adminRole = profile.role === 'admin' || profile.role === 'superadmin'
      let botQuery = supabase.from('bots').select('id, name')
      if (adminRole && profile.organization_id) botQuery = botQuery.eq('organization_id', profile.organization_id)
      else if (profile.assigned_bot_id) botQuery = botQuery.eq('id', profile.assigned_bot_id)
      else { setLoading(false); return }

      const { data: botData } = await botQuery
      const bot = Array.isArray(botData) ? botData[0] : botData
      if (!bot) { setLoading(false); return }
      setBotName(bot.name || 'Bombers Blueprint')

      const since = getDateFilter()

      const { data: convos } = await supabase
        .from('conversations')
        .select('customer_id, lead_readiness, conversation_stage, status, updated_at')
        .eq('bot_id', bot.id)
        .gte('updated_at', since)
      const allConvos = convos || []

      const { data: reviewData } = await supabase
        .from('reviews')
        .select('customer_id, action_type, status')
        .eq('bot_id', bot.id)
        .gte('created_at', since)
      const allReviews = reviewData || []

      const aiAssistedIds = new Set(allReviews.map(r => r.customer_id))
      const active = allConvos.length
      const qualified = allConvos.filter(c => c.lead_readiness === 'HOT' || c.lead_readiness === 'WARM').length
      const booked = allConvos.filter(c => c.status === 'booked').length
      const aiAssisted = aiAssistedIds.size
      const qualifiedPct = active > 0 ? Math.round((qualified / active) * 100) : 0
      const conversionRate = qualified > 0 ? Math.round((booked / qualified) * 100) : 0
      const reviewsSent = allReviews.length
      const autoSent = allReviews.filter(r => r.status === 'approved').length
      const autoSendRate = reviewsSent > 0 ? Math.round((autoSent / reviewsSent) * 100) : 0
      const bookingRate = active > 0 ? parseFloat(((booked / active) * 100).toFixed(1)) : 0

      setStats({ active, qualified, qualifiedPct, aiAssisted, booked, conversionRate })
      setSystemPerf({ bookingRate, reviewsSent, autoSendRate })

      // Stage drop-off analysis
      const stageCounts = {}
      allConvos.forEach(c => {
        const s = c.conversation_stage || 'ENTRY'
        stageCounts[s] = (stageCounts[s] || 0) + 1
      })

      // Build ordered stage data with drop-off
      const stagesWithData = STAGE_ORDER
        .filter(s => stageCounts[s] > 0)
        .map(s => ({ stage: s, count: stageCounts[s] }))

      const stageDataWithDropoff = stagesWithData.map((s, i) => {
        if (i === 0) return { ...s, dropoffPct: null, fromPrev: null }
        const prev = stagesWithData[i - 1].count
        const current = s.count
        const dropoff = prev > 0 ? Math.round(((prev - current) / prev) * 100) : 0
        return { ...s, dropoffPct: dropoff, fromPrev: prev }
      })

      setStageData(stageDataWithDropoff)
    } catch (e) { console.error(e) }
    setLoading(false)
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

  const funnelSteps = [
    { label: 'Conversations Started', value: stats.active, prev: null },
    { label: 'Qualified Leads', value: stats.qualified, prev: stats.active },
    { label: 'Calls Booked', value: stats.booked, prev: stats.qualified },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">{timeRange} · {botName}</div>
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

      {/* TOP METRICS */}
      <div className="stats-grid">
        <StatCard value={stats.active} label="Active Conversations" sub={timeRange} />
        <StatCard value={stats.qualified} label="Qualified Leads" sub="Warm or above" color="var(--amb)" border="var(--amb)" pct={stats.qualifiedPct} />
        <StatCard value={stats.aiAssisted} label="AI-Assisted Conversations" sub="Bot generated reply" color="var(--blu)" border="var(--blu)" />
        <StatCard value={stats.booked} label="Calls Booked" sub={timeRange} color="#16a34a" border="#16a34a" />
        <StatCard value={`${stats.conversionRate}%`} label="Conversion Rate" sub="Booked ÷ Qualified" color="var(--acc)" border="var(--acc)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>

        {/* CONVERSATION FUNNEL */}
        <div className="card">
          <div className="card-title">Conversation Funnel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {funnelSteps.map((step, i) => {
              const pct = step.prev > 0 ? Math.round((step.value / step.prev) * 100) : null
              const maxVal = funnelSteps[0].value || 1
              const barWidth = Math.round((step.value / maxVal) * 100)
              const colors = ['var(--acc)', 'var(--amb)', '#16a34a']
              return (
                <div key={step.label}>
                  <div style={{ padding: '14px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>{step.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {pct !== null && (
                          <span style={{ fontSize: '.72rem', color: pct >= 50 ? '#16a34a' : pct >= 25 ? '#d97706' : '#e53e3e', fontWeight: 600, background: pct >= 50 ? '#f0fdf4' : pct >= 25 ? '#fffbeb' : '#fff5f5', padding: '1px 8px', borderRadius: '999px' }}>
                            {pct}% conversion
                          </span>
                        )}
                        <span style={{ fontSize: '.9rem', fontWeight: 700, color: colors[i], minWidth: '30px', textAlign: 'right' }}>{step.value}</span>
                      </div>
                    </div>
                    <div style={{ height: '6px', background: 'var(--surf3)', borderRadius: '100px', overflow: 'hidden', border: '1px solid var(--bdr)' }}>
                      <div style={{ height: '100%', width: `${barWidth}%`, background: colors[i], borderRadius: '100px', transition: 'width .8s' }} />
                    </div>
                  </div>
                  {i < funnelSteps.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 0 4px 0' }}>
                      <div style={{ flex: 1, height: '1px', background: 'var(--bdr)', marginLeft: '8px' }} />
                      {funnelSteps[i+1].prev > 0 && (
                        <span style={{ fontSize: '.69rem', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>
                          {100 - Math.round((funnelSteps[i+1].value / funnelSteps[i+1].prev) * 100)}% drop-off
                        </span>
                      )}
                      <div style={{ flex: 1, height: '1px', background: 'var(--bdr)', marginRight: '8px' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* SYSTEM PERFORMANCE */}
        <div className="card">
          <div className="card-title">System Performance</div>
          {stats.active === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.84rem' }}>
              No activity yet in this period.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--accp)', borderRadius: 'var(--rsm)', border: '1px solid var(--accl)' }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>Booking Conversion</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Bookings ÷ All conversations</div>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--acc)' }}>{systemPerf.bookingRate}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', border: '1px solid var(--bdr)' }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>Reviews Sent to Setter</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Messages flagged for human review</div>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{systemPerf.reviewsSent}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--blubg)', borderRadius: 'var(--rsm)', border: '1px solid var(--blubd)' }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>AI Auto-Send Rate</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Approved ÷ Total reviews</div>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--blu)' }}>{systemPerf.autoSendRate}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DROP-OFF BY STAGE */}
      {stageData.length > 1 && (
        <div className="card">
          <div style={{ marginBottom: '14px' }}>
            <div className="card-title" style={{ margin: 0 }}>Drop-Off by Stage</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: '2px' }}>Where leads are being lost in the conversation flow</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stageData.map((s, i) => (
              <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: i === 0 ? 'var(--surf2)' : s.dropoffPct >= 50 ? '#fff5f5' : s.dropoffPct >= 30 ? '#fffbeb' : 'var(--surf2)', borderRadius: 'var(--rsm)', border: `1px solid ${s.dropoffPct >= 50 ? '#fed7d7' : s.dropoffPct >= 30 ? '#fde68a' : 'var(--bdr)'}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.82rem', fontWeight: 500, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.stage}</div>
                  {s.dropoffPct !== null && (
                    <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>
                      {s.count} of {s.fromPrev} leads reached this stage
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {s.dropoffPct !== null ? (
                    <div>
                      <div style={{ fontSize: '.9rem', fontWeight: 700, color: s.dropoffPct >= 50 ? '#e53e3e' : s.dropoffPct >= 30 ? '#d97706' : '#16a34a' }}>
                        {s.dropoffPct}% drop-off
                      </div>
                      <div style={{ fontSize: '.7rem', color: 'var(--tx3)' }}>
                        ({s.fromPrev - s.count} / {s.fromPrev})
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '.8rem', color: 'var(--tx3)' }}>Start — {s.count} leads</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}