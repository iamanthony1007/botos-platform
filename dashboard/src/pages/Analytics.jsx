import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const TIME_RANGES = ['Today', 'Last 7 Days', 'Last 30 Days']
const STAGE_SEQUENCE = [
  'ENTRY / OPEN LOOP', 'ENTRY', 'OPEN LOOP', 'LOCATION ANCHOR', 'GOAL LOCK',
  'GOAL DEPTH (MAKE IT SPECIFIC)', "WHAT THEY'VE TRIED (PAST + CURRENT)",
  'TRANSLATION / PROGRESS CHECK', 'BODY LINK ACCEPTANCE + MOBILITY HISTORY',
  'PROGRESS CHECK', 'PRIORITY GATE', 'COACHING HAT', 'CALL BOOK BRIDGE',
  'CALL OFFERED', 'CALL BOOKING', 'LONG TERM NURTURE'
]

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

export default function Analytics() {
  const { profile } = useAuth()
  const adminRole = profile?.role === 'admin' || profile?.role === 'superadmin'
  const [timeRange, setTimeRange] = useState('Last 7 Days')
  const [stats, setStats] = useState({ active: 0, qualified: 0, qualifiedPct: 0, aiAssisted: 0, booked: 0, conversionRate: 0 })
  const [funnelData, setFunnelData] = useState([])
  const [stageData, setStageData] = useState([])
  const [systemPerf, setSystemPerf] = useState({ bookingRate: 0, reviewsSent: 0, autoSendRate: 0 })
  const [loading, setLoading] = useState(true)
  const [botName, setBotName] = useState('Bombers Blueprint')
  const [lastUpdated, setLastUpdated] = useState(null)

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
      const isAdmin = profile.role === 'admin' || profile.role === 'superadmin'
      let botQuery = supabase.from('bots').select('id, name')
      if (isAdmin && profile.organization_id) botQuery = botQuery.eq('organization_id', profile.organization_id)
      else if (profile.assigned_bot_id) botQuery = botQuery.eq('id', profile.assigned_bot_id)
      else { setLoading(false); return }

      const { data: botData } = await botQuery
      const bot = Array.isArray(botData) ? botData[0] : botData
      if (!bot) { setLoading(false); return }
      setBotName(bot.name || 'Bombers Blueprint')

      const since = getDateFilter()

      const { data: convos } = await supabase.from('conversations').select('customer_id, lead_intent, conversation_stage, status, updated_at').eq('bot_id', bot.id).neq('channel', 'tester').gte('updated_at', since)
      const allConvos = convos || []
      const { data: reviewData } = await supabase.from('reviews').select('customer_id, action_type, status').eq('bot_id', bot.id).gte('created_at', since)
      const allReviews = reviewData || []

      const active = allConvos.length
      const qualified = allConvos.filter(c => c.lead_intent === 'HIGH' || c.lead_intent === 'MEDIUM').length
      const booked = allConvos.filter(c => c.status === 'booked').length
      const aiAssisted = new Set(allReviews.map(r => r.customer_id)).size
      const qualifiedPct = active > 0 ? Math.round((qualified / active) * 100) : 0
      const conversionRate = active > 0 ? Math.round((booked / active) * 100) : 0
      const autoSent = allReviews.filter(r => r.status === 'approved').length
      const autoSendRate = allReviews.length > 0 ? Math.round((autoSent / allReviews.length) * 100) : 0
      const bookingRate = active > 0 ? parseFloat(((booked / active) * 100).toFixed(1)) : 0

      setStats({ active, qualified, qualifiedPct, aiAssisted, booked, conversionRate })
      setSystemPerf({ bookingRate, reviewsSent: allReviews.length, autoSendRate })
      setLastUpdated(new Date())

      setFunnelData([
        { label: 'Conversations Started', value: active },
        { label: 'Qualified Leads (Medium + High Intent)', value: qualified },
        { label: 'Calls Booked', value: booked },
      ])

      const stageCounts = {}
      allConvos.forEach(c => { if (c.conversation_stage) stageCounts[c.conversation_stage] = (stageCounts[c.conversation_stage] || 0) + 1 })

      const rawStages = STAGE_SEQUENCE.map(s => ({ stage: s, rawCount: stageCounts[s] || 0 })).filter(s => s.rawCount > 0)
      const strictStages = []
      let prevCount = active
      for (const s of rawStages) {
        const capped = Math.min(s.rawCount, prevCount)
        strictStages.push({ stage: s.stage, count: capped })
        prevCount = capped
      }
      setStageData(strictStages.map((s, i) => {
        if (i === 0) return { ...s, dropoffPct: null, entered: s.count, dropped: 0 }
        const prev = strictStages[i-1].count
        const dropped = Math.max(0, prev - s.count)
        return { ...s, dropoffPct: prev > 0 ? Math.round((dropped / prev) * 100) : 0, entered: prev, dropped }
      }))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const StatCard = ({ value, label, sub, color, border, pct, tooltip }) => (
    <div className="stat-card" style={{ borderLeftColor: border || 'var(--acc)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <div className="stat-num" style={{ color: color || 'var(--acc)' }}>{value}</div>
        {pct !== undefined && <div style={{ fontSize: '.82rem', fontWeight: 600, color: color || 'var(--acc)' }}>{pct}%</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
        <div className="stat-label">{label}</div>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <div className="stat-change" style={{ color: color || 'var(--acc)' }}>{sub}</div>
    </div>
  )

  const funnelColors = ['var(--acc)', 'var(--amb)', '#16a34a']
  const maxVal = funnelData[0]?.value || 1

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Analytics</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="page-sub">Understand performance, conversion rates, and where opportunities are being lost.</div>
            {lastUpdated && (
              <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>
                Last updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: '2px' }}>{timeRange} · {botName}</div>
        </div>
        <div style={{ display: 'flex', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '10px', overflow: 'hidden' }}>
          {TIME_RANGES.map(t => (
            <button key={t} onClick={() => setTimeRange(t)} style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '.76rem', fontWeight: timeRange === t ? 600 : 400, background: timeRange === t ? 'var(--acc)' : 'transparent', color: timeRange === t ? '#fff' : 'var(--tx2)', transition: 'all .15s', fontFamily: 'var(--fn)' }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="stats-grid">
        <StatCard value={stats.active} label="Active Conversations" sub={timeRange}
          tooltip="Total unique leads with at least one message in the selected period." />
        <StatCard value={stats.qualified} label="Qualified Leads" sub="Medium + High intent"
          color="var(--amb)" border="var(--amb)" pct={stats.qualifiedPct}
          tooltip="Leads tagged MEDIUM or HIGH intent. These are showing real interest and readiness." />
        {adminRole && <StatCard value={stats.aiAssisted} label="AI-Assisted Conversations" sub="Bot generated reply"
          color="var(--blu)" border="var(--blu)"
          tooltip="Conversations where the AI generated at least one reply, auto-sent or manually approved." />}
        <StatCard value={stats.booked} label="Calls Booked" sub={timeRange}
          color="#16a34a" border="#16a34a"
          tooltip="Leads who reached the CALL BOOKING stage." />
        <StatCard value={`${stats.conversionRate}%`} label="Conversion Rate" sub="Booked / Total Conversations"
          color="var(--acc)" border="var(--acc)"
          tooltip="Calls Booked divided by total conversations started. Shows overall system effectiveness." />
      </div>

      <div className="grid-2col">
        <div className="card">
          <div className="card-title">Conversation Drop-Off (Lead Behaviour)</div>
          <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginBottom: '12px', marginTop: '-8px' }}>
            Shows where leads disengage in the conversation flow. Drop-offs reflect lead behaviour, not system errors.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {funnelData.map((step, i) => {
              const pct = i > 0 && funnelData[i-1].value > 0 ? Math.round((step.value / funnelData[i-1].value) * 100) : null
              const barWidth = Math.round((step.value / maxVal) * 100)
              return (
                <div key={step.label} style={{ padding: '14px 0', borderBottom: i < funnelData.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>{step.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {pct !== null && (
                        <span style={{ fontSize: '.72rem', fontWeight: 600, color: pct >= 50 ? '#16a34a' : pct >= 25 ? '#d97706' : '#e53e3e', background: pct >= 50 ? '#f0fdf4' : pct >= 25 ? '#fffbeb' : '#fff5f5', padding: '1px 8px', borderRadius: '999px' }}>{pct}% conversion</span>
                      )}
                      <span style={{ fontSize: '.9rem', fontWeight: 700, color: funnelColors[i], minWidth: '30px', textAlign: 'right' }}>{step.value}</span>
                    </div>
                  </div>
                  <div style={{ height: '6px', background: 'var(--surf3)', borderRadius: '100px', overflow: 'hidden', border: '1px solid var(--bdr)' }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: funnelColors[i], borderRadius: '100px', transition: 'width .8s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">System Performance</div>
          {stats.active === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--tx3)', fontSize: '.84rem' }}>No activity yet in this period.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--accp)', borderRadius: 'var(--rsm)', border: '1px solid var(--accl)' }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>Booking Conversion</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Bookings / All conversations</div>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--acc)' }}>{systemPerf.bookingRate}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: '#fff5f5', borderRadius: 'var(--rsm)', border: '1px solid #fed7d7' }}>
                <div>
                  <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>Escalate to Human</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Conversations flagged for human review</div>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e53e3e' }}>{systemPerf.reviewsSent}</span>
              </div>
              {adminRole && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: 'var(--blubg)', borderRadius: 'var(--rsm)', border: '1px solid var(--blubd)' }}>
                  <div>
                    <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontWeight: 500 }}>AI Auto-Send Rate</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>Approved / Total reviews</div>
                  </div>
                  <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--blu)' }}>{systemPerf.autoSendRate}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {stageData.length > 1 && (
        <div className="card">
          <div style={{ marginBottom: '14px' }}>
            <div className="card-title" style={{ margin: 0 }}>Drop-Off by Stage</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: '2px' }}>Where leads disengage in the conversation flow. These are lead behaviour patterns, not system errors.</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stageData.map((s, i) => (
              <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: i === 0 ? 'var(--surf2)' : s.dropoffPct >= 50 ? '#fff5f5' : s.dropoffPct >= 30 ? '#fffbeb' : 'var(--surf2)', borderRadius: 'var(--rsm)', border: `1px solid ${s.dropoffPct >= 50 ? '#fed7d7' : s.dropoffPct >= 30 ? '#fde68a' : 'var(--bdr)'}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.82rem', fontWeight: 500, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.stage}</div>
                  {s.dropoffPct !== null && <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>{s.count} of {s.entered} leads reached this stage</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {s.dropoffPct !== null ? (
                    <div>
                      <div style={{ fontSize: '.9rem', fontWeight: 700, color: s.dropoffPct >= 50 ? '#e53e3e' : s.dropoffPct >= 30 ? '#d97706' : '#16a34a' }}>{s.dropoffPct}% drop-off</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--tx3)' }}>({s.dropped} / {s.entered})</div>
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
