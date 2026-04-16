import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useDataCache } from '../lib/DataCache'

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
  const navigate = useNavigate()
  const { get: getCache, set: setCache } = useDataCache()
  const adminRole = profile?.role === 'admin' || profile?.role === 'superadmin'
  const [timeRange, setTimeRange] = useState('Last 7 Days')
  const cachedAnalytics = getCache('analytics_data')
  const [stats, setStats] = useState(cachedAnalytics?.data?.stats || {
    active: 0, qualified: 0, qualifiedPct: 0, aiAssisted: 0,
    booked: 0, conversionRate: 0, closeRate: 0,
    needsReply: 0, highIntent: 0, aiMessagesSent: 0
  })
  const [funnelData, setFunnelData] = useState(cachedAnalytics?.data?.funnelData || [])
  const [stageData, setStageData] = useState(cachedAnalytics?.data?.stageData || [])
  const [stageLeadsMap, setStageLeadsMap] = useState({})
  const [expandedStage, setExpandedStage] = useState(null)
  const [systemPerf, setSystemPerf] = useState(cachedAnalytics?.data?.systemPerf || { bookingRate: 0, reviewsSent: 0, autoSendRate: 0 })
  const [loading, setLoading] = useState(!cachedAnalytics?.data)
  const [botName, setBotName] = useState('Bombers Blueprint')
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => { load() }, [profile, timeRange])

  function getDateFilter() {
    const now = new Date()
    if (timeRange === 'Today') { const d = new Date(now); d.setHours(0,0,0,0); return d.toISOString() }
    if (timeRange === 'Last 7 Days') { const d = new Date(now); d.setDate(d.getDate()-7); return d.toISOString() }
    const d = new Date(now); d.setDate(d.getDate()-30); return d.toISOString()
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

  function timeAgo(dateStr) {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }

  function intentStyle(intent) {
    if (intent === 'HIGH') return { color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7' }
    if (intent === 'MEDIUM') return { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
    return { color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb' }
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

      const [{ data: convos }, { data: reviewData }, { data: pendingReviews }] = await Promise.all([
        supabase.from('conversations').select('customer_id, username, profile_name, channel, lead_intent, conversation_stage, status, updated_at').eq('bot_id', bot.id).neq('channel', 'tester').gte('updated_at', since),
        supabase.from('reviews').select('customer_id, action_type, status').eq('bot_id', bot.id).gte('created_at', since),
        supabase.from('reviews').select('customer_id').eq('bot_id', bot.id).eq('status', 'pending').not('customer_id', 'ilike', 'tester_%')
      ])

      const allConvos = (convos || []).filter(c => !c.username || !c.username.toLowerCase().startsWith('test'))
      const allReviews = reviewData || []

      const active = allConvos.length
      const qualified = allConvos.filter(c => c.lead_intent === 'HIGH' || c.lead_intent === 'MEDIUM').length
      const booked = allConvos.filter(c => c.status === 'booked').length
      const aiAssisted = new Set(allReviews.map(r => r.customer_id)).size
      const qualifiedPct = active > 0 ? Math.round((qualified / active) * 100) : 0
      const conversionRate = active > 0 ? Math.round((booked / active) * 100) : 0
      const closeRate = qualified > 0 ? Math.round((booked / qualified) * 100) : 0
      const autoSent = allReviews.filter(r => r.status === 'approved').length
      const autoSendRate = allReviews.length > 0 ? Math.round((autoSent / allReviews.length) * 100) : 0
      const bookingRate = active > 0 ? parseFloat(((booked / active) * 100).toFixed(1)) : 0
      const needsReply = new Set((pendingReviews || []).map(r => r.customer_id)).size
      const highIntent = allConvos.filter(c => c.lead_intent === 'HIGH').length
      const aiMessagesSent = allReviews.filter(r => r.status === 'approved').length + allReviews.filter(r => r.status === 'auto_sent').length

      setStats({ active, qualified, qualifiedPct, aiAssisted, booked, conversionRate, closeRate, needsReply, highIntent, aiMessagesSent })
      setSystemPerf({ bookingRate, reviewsSent: allReviews.length, autoSendRate })
      setLastUpdated(new Date())

      setFunnelData([
        { label: 'Conversations Started', value: active },
        { label: 'Qualified Leads (Medium + High Intent)', value: qualified },
        { label: 'Calls Booked', value: booked },
      ])

      // Build stage leads map — group leads by their current stage
      const leadsMap = {}
      allConvos.forEach(c => {
        if (!c.conversation_stage) return
        if (!leadsMap[c.conversation_stage]) leadsMap[c.conversation_stage] = []
        leadsMap[c.conversation_stage].push(c)
      })
      // Sort each stage's leads by updated_at desc
      Object.keys(leadsMap).forEach(stage => {
        leadsMap[stage].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      })
      setStageLeadsMap(leadsMap)

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
      setCache('analytics_data', { stats: { active, qualified, qualifiedPct, aiAssisted, booked, conversionRate, closeRate, needsReply, highIntent, aiMessagesSent }, funnelData: [{ label: 'Conversations Started', value: active }, { label: 'Qualified Leads (Medium + High Intent)', value: qualified }, { label: 'Calls Booked', value: booked }], stageData: strictStages, systemPerf: { bookingRate, reviewsSent: allReviews.length, autoSendRate } })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function toggleStage(stage) {
    setExpandedStage(prev => prev === stage ? null : stage)
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const StatCard = ({ value, label, sub, color, border, pct, tooltip, urgent }) => (
    <div className="stat-card" style={{ borderLeftColor: border || 'var(--acc)', ...(urgent ? { background: '#fff9f0', borderLeftColor: '#e53e3e' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <div className="stat-num" style={{ color: urgent ? '#e53e3e' : (color || 'var(--acc)') }}>{value}</div>
        {pct !== undefined && <div style={{ fontSize: '.82rem', fontWeight: 600, color: color || 'var(--acc)' }}>{pct}%</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
        <div className="stat-label">{label}</div>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <div className="stat-change" style={{ color: urgent ? '#e53e3e' : (color || 'var(--acc)') }}>{sub}</div>
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

      {/* ── Unified stats grid — Option A ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <StatCard value={stats.needsReply} label="Needs Reply" sub="Pending in inbox"
          color="#e53e3e" border="#e53e3e" urgent={stats.needsReply > 0}
          tooltip="Leads with AI replies currently waiting for approval in the inbox." />
        <StatCard value={stats.active} label="Active Conversations" sub={timeRange}
          tooltip="Total unique leads with at least one message in the selected period." />
        <StatCard value={stats.booked} label="Calls Booked" sub={timeRange}
          color="#16a34a" border="#16a34a"
          tooltip="Leads who reached the CALL BOOKING stage." />
        <StatCard value={stats.highIntent} label="High Intent Leads" sub="High urgency leads"
          color="var(--amb)" border="var(--amb)"
          tooltip="Leads currently tagged as HIGH intent — showing strong motivation or urgency to act." />
        <StatCard value={stats.qualified} label="Qualified Leads" sub="Medium + High intent"
          color="var(--amb)" border="var(--amb)" pct={stats.qualifiedPct}
          tooltip="Leads tagged MEDIUM or HIGH intent. These are showing real interest and readiness." />
        <StatCard value={`${stats.conversionRate}%`} label="Conversion Rate" sub="Booked / Total Conversations"
          color="var(--acc)" border="var(--acc)"
          tooltip="Calls Booked divided by total conversations started. Shows overall system effectiveness." />
        <StatCard value={stats.aiMessagesSent} label="AI Messages Sent" sub="Approved + auto-sent"
          color="var(--blu)" border="var(--blu)"
          tooltip="AI replies approved and sent, either automatically or manually by a setter." />
        {adminRole && <StatCard value={stats.aiAssisted} label="AI-Assisted Conversations" sub="Bot generated reply"
          color="var(--blu)" border="var(--blu)"
          tooltip="Conversations where the AI generated at least one reply, auto-sent or manually approved." />}
        <StatCard value={`${stats.closeRate}%`} label="Close Rate" sub="Booked / Qualified Leads"
          color="#16a34a" border="#16a34a"
          tooltip="Calls Booked divided by Qualified Leads (Medium + High intent). Shows how well qualified leads are converted." />
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

      {/* ── Drop-Off by Stage (clickable) ── */}
      {stageData.length > 1 && (
        <div className="card">
          <div style={{ marginBottom: '14px' }}>
            <div className="card-title" style={{ margin: 0 }}>Drop-Off by Stage</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx3)', marginTop: '2px' }}>
              Where leads disengage in the conversation flow. Click any stage to see the leads currently in it.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stageData.map((s, i) => {
              const isExpanded = expandedStage === s.stage
              const leadsInStage = stageLeadsMap[s.stage] || []
              const hasLeads = leadsInStage.length > 0
              return (
                <div key={s.stage}>
                  {/* Stage row — clickable */}
                  <div
                    onClick={() => hasLeads && toggleStage(s.stage)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 14px',
                      background: isExpanded ? 'var(--accp)' : i === 0 ? 'var(--surf2)' : s.dropoffPct >= 50 ? '#fff5f5' : s.dropoffPct >= 30 ? '#fffbeb' : 'var(--surf2)',
                      borderRadius: isExpanded ? 'var(--rsm) var(--rsm) 0 0' : 'var(--rsm)',
                      border: `1px solid ${isExpanded ? 'var(--accm)' : s.dropoffPct >= 50 ? '#fed7d7' : s.dropoffPct >= 30 ? '#fde68a' : 'var(--bdr)'}`,
                      cursor: hasLeads ? 'pointer' : 'default',
                      transition: 'all .15s',
                      userSelect: 'none'
                    }}
                  >
                    {/* Chevron */}
                    <div style={{ flexShrink: 0, width: '16px', color: hasLeads ? 'var(--tx3)' : 'transparent', fontSize: '.7rem', transition: 'transform .2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.82rem', fontWeight: 500, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.stage}</div>
                      {s.dropoffPct !== null && (
                        <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '2px' }}>
                          {s.count} of {s.entered} leads reached this stage
                          {hasLeads && <span style={{ color: 'var(--acc)', marginLeft: '6px' }}>· {leadsInStage.length} currently here</span>}
                        </div>
                      )}
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

                  {/* Expanded leads list */}
                  {isExpanded && leadsInStage.length > 0 && (
                    <div style={{ border: '1px solid var(--accm)', borderTop: 'none', borderRadius: '0 0 var(--rsm) var(--rsm)', background: 'var(--surf)', overflow: 'hidden' }}>
                      {leadsInStage.map((lead, li) => (
                        <div
                          key={lead.customer_id}
                          onClick={() => navigate('/dashboard/inbox', { state: { openLead: lead.customer_id } })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '10px 14px',
                            borderTop: li > 0 ? '1px solid var(--bdr)' : 'none',
                            cursor: 'pointer',
                            transition: 'background .12s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accp)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          {/* Avatar */}
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                            {getLeadName(lead).charAt(0).toUpperCase()}
                          </div>

                          {/* Name + stage */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '.84rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {getLeadName(lead)}
                            </div>
                            <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: '1px' }}>
                              {timeAgo(lead.updated_at)}
                            </div>
                          </div>

                          {/* Intent badge */}
                          {lead.lead_intent && (
                            <span style={{ fontSize: '.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', flexShrink: 0, ...intentStyle(lead.lead_intent) }}>
                              {lead.lead_intent}
                            </span>
                          )}

                          {/* Open in inbox arrow */}
                          <span style={{ fontSize: '.75rem', color: 'var(--acc)', fontWeight: 600, flexShrink: 0 }}>→ Inbox</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
