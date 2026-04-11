import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const FILTERS = ['All', 'Pending', 'Escalated', 'Resolved']

const STAGE_ORDER = [
  'CALL BOOKING', 'CALL OFFERED', 'CALL BOOK BRIDGE', 'COACHING HAT',
  'PRIORITY GATE', 'PROGRESS CHECK', 'BODY LINK ACCEPTANCE + MOBILITY HISTORY',
  'TRANSLATION / PROGRESS CHECK', "WHAT THEY'VE TRIED (PAST + CURRENT)",
  'GOAL DEPTH (MAKE IT SPECIFIC)', 'GOAL LOCK', 'LOCATION ANCHOR',
  'OPEN LOOP', 'ENTRY', 'LONG TERM NURTURE'
]

const READINESS_ORDER = { HOT: 0, WARM: 1, COLD: 2 }

export default function Inbox() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [selectedLead, setSelectedLead] = useState(null)
  const [conversation, setConversation] = useState(null)
  const [reviews, setReviews] = useState([])
  const [activeReview, setActiveReview] = useState(null)
  const [replyMessages, setReplyMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: '' })
  const [showTrainModal, setShowTrainModal] = useState(false)
  const [trainReason, setTrainReason] = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [botId, setBotId] = useState(null)
  const [showMobileThread, setShowMobileThread] = useState(false)
  const channelRef = useRef(null)
  const msgEndRef = useRef(null)
  const searchRef = useRef(null)
  const location = useLocation()

  useEffect(() => {
    if (!profile) return
    loadData()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [profile])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, reviews, activeReview])

  // Auto-open a specific lead when navigated from Dashboard
  useEffect(() => {
    if (!location.state?.openLead || !leads.length || !botId) return
    const target = leads.find(l => String(l.customer_id) === String(location.state.openLead))
    if (target) selectLead(target)
  }, [location.state, leads, botId])

  async function loadData() {
    setLoading(true)
    const bot = await getAssignedBot(profile, 'id')
    if (!bot) { setLoading(false); return }
    setBotId(bot.id)

    const [{ data: allReviews }, { data: convos }] = await Promise.all([
      supabase.from('reviews').select('*').eq('bot_id', bot.id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('customer_id, channel, lead_readiness, lead_intent, primary_goal, conversation_stage, profile_facts, running_summary, username, profile_name, updated_at').eq('bot_id', bot.id).order('updated_at', { ascending: false })
    ])

    const leadsMap = {}

    ;(convos || []).forEach(c => {
      let identity = null, pf = {}
      try { pf = typeof c.profile_facts === 'string' ? JSON.parse(c.profile_facts) : (c.profile_facts || {}); identity = pf?.golf_identity || null } catch {}
      leadsMap[c.customer_id] = {
        customer_id: c.customer_id, identity, username: c.username || null, profile_name: c.profile_name || null, lead_intent: c.lead_intent || null, channel: c.channel,
        lead_readiness: c.lead_readiness, primary_goal: c.primary_goal,
        conversation_stage: c.conversation_stage, running_summary: c.running_summary,
        profile_facts: pf, last_activity: c.updated_at,
        pending_count: 0, handoff_count: 0, latest_preview: '', all_reviews: []
      }
    })

    ;(allReviews || []).forEach(r => {
      if (!leadsMap[r.customer_id]) {
        leadsMap[r.customer_id] = {
          customer_id: r.customer_id, identity: null, channel: 'tester',
          lead_readiness: null, primary_goal: null, conversation_stage: r.conversation_stage,
          running_summary: null, profile_facts: {}, last_activity: r.created_at,
          pending_count: 0, handoff_count: 0, latest_preview: '', all_reviews: []
        }
      }
      leadsMap[r.customer_id].all_reviews.push(r)
      if (r.status === 'pending') leadsMap[r.customer_id].pending_count++
      if ((r.action_type === 'HANDOFF_TO_SETTER' || r.action_type === 'ESCALATE_TO_HUMAN') && r.status === 'pending') leadsMap[r.customer_id].handoff_count++
      if (!leadsMap[r.customer_id].latest_preview) leadsMap[r.customer_id].latest_preview = r.bot_reply || ''
    })

    // Handoffs and pending always float to top, rest sorted by recency by default
    const allLeads = Object.values(leadsMap)
    const handoffs = allLeads.filter(l => l.handoff_count > 0)
    const pending = allLeads.filter(l => l.handoff_count === 0 && l.pending_count > 0)
    const rest = allLeads.filter(l => l.handoff_count === 0 && l.pending_count === 0)
    rest.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity))

    setLeads([...handoffs, ...pending, ...rest])
    setLoading(false)

    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const ch = supabase.channel(`inbox-${bot.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `bot_id=eq.${bot.id}` }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `bot_id=eq.${bot.id}` }, () => { loadData(); if (selectedLead) loadThread(selectedLead.customer_id, bot.id) })
      .subscribe()
    channelRef.current = ch
    if (Notification.permission === 'default') Notification.requestPermission()
  }

  async function selectLead(lead) {
    setSelectedLead(lead)
    setActiveReview(null)
    setReplyMessages([])
    setShowProfile(false)
    setShowMobileThread(true)
    setThreadLoading(true)
    await loadThread(lead.customer_id, botId)
    setThreadLoading(false)
  }

  function goBackToList() {
    setSelectedLead(null)
    setShowMobileThread(false)
    setActiveReview(null)
    setReplyMessages([])
    setShowProfile(false)
  }

  async function loadThread(customerId, bid) {
    const [{ data: convo }, { data: revs }] = await Promise.all([
      supabase.from('conversations').select('*').eq('bot_id', bid).eq('customer_id', customerId).single(),
      supabase.from('reviews').select('*').eq('bot_id', bid).eq('customer_id', customerId).order('created_at', { ascending: true })
    ])
    setConversation(convo || null)
    setReviews(revs || [])
    const firstPending = (revs || []).find(r => r.status === 'pending')
    if (firstPending) {
      setActiveReview(firstPending)
      const msgs = Array.isArray(firstPending.bot_messages) && firstPending.bot_messages.length > 0
        ? firstPending.bot_messages
        : [firstPending.bot_reply || '']
      setReplyMessages(msgs)
    }
  }

  function getReviewMessages(review) {
    if (Array.isArray(review.bot_messages) && review.bot_messages.length > 0) return review.bot_messages
    return [review.bot_reply || '']
  }

  function updateReplyMessage(idx, val) {
    setReplyMessages(prev => { const n = [...prev]; n[idx] = val; return n })
  }

  function addReplyMessage() {
    if (replyMessages.length >= 3) return
    setReplyMessages(prev => [...prev, ''])
  }

  function removeReplyMessage(idx) {
    if (replyMessages.length <= 1) return
    setReplyMessages(prev => prev.filter((_, i) => i !== idx))
  }

  async function approve() {
    if (!activeReview) return
    setSending(true)
    const validMessages = replyMessages.filter(m => m.trim())
    const joinedReply = validMessages.join(' ')
    await supabase.from('reviews').update({
      status: 'approved', final_reply: joinedReply, final_messages: validMessages,
      resolved_at: new Date().toISOString()
    }).eq('id', activeReview.id)
    showToast('✓ Approved and sent', 'success')
    setSending(false)
    setActiveReview(null)
    setReplyMessages([])
    await loadThread(selectedLead.customer_id, botId)
    loadData()
  }

  async function saveTraining() {
    if (!trainReason.trim()) { showToast('Please add a reason', 'error'); return }
    setSending(true)
    const validMessages = replyMessages.filter(m => m.trim())
    const joinedReply = validMessages.join(' ')
    const originalJoined = activeReview.bot_reply || ''
    await supabase.from('reviews').update({
      status: 'edited', final_reply: joinedReply, final_messages: validMessages,
      resolved_at: new Date().toISOString()
    }).eq('id', activeReview.id)
    await supabase.from('learnings').insert({
      bot_id: botId, customer_id: activeReview.customer_id, review_id: activeReview.id,
      conversation_stage: activeReview.conversation_stage, original_reply: originalJoined,
      corrected_reply: joinedReply, corrected_messages: validMessages, reason: trainReason, source: 'inbox'
    })
    setShowTrainModal(false)
    showToast('🧠 Learning saved and sent', 'success')
    setSending(false)
    setActiveReview(null)
    setReplyMessages([])
    await loadThread(selectedLead.customer_id, botId)
    loadData()
  }

  async function discard() {
    if (!activeReview) return
    await supabase.from('reviews').update({ status: 'discarded', resolved_at: new Date().toISOString() }).eq('id', activeReview.id)
    showToast('Discarded', 'info')
    setActiveReview(null)
    setReplyMessages([])
    await loadThread(selectedLead.customer_id, botId)
    loadData()
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '' }), 3000)
  }

  function getLeadName(lead) {
    if (!lead) return ''
    if (String(lead.customer_id).startsWith('tester_')) return 'Bot Tester'
    if (lead.username) return `@${lead.username}`
    if (lead.profile_name) return lead.profile_name
    if (lead.identity) return lead.identity
    // Channel-based fallback instead of raw ID
    const ch = (lead.channel || '').toLowerCase()
    if (ch.includes('instagram') || ch === 'manychat') return 'Instagram Lead'
    if (ch.includes('facebook')) return 'Facebook Lead'
    if (ch.includes('whatsapp')) return 'WhatsApp Lead'
    if (ch.includes('sms') || ch.includes('text')) return 'SMS Lead'
    if (ch.includes('email')) return 'Email Lead'
    return 'Unknown Lead'
  }

  function intentStyle(i) {
    if (i === 'HIGH') return { color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7' }
    if (i === 'MEDIUM') return { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
    return { color: 'var(--tx3)', background: 'var(--surf2)', border: '1px solid var(--bdr)' }
  }

  function readinessStyle(r) {
    if (r === 'HOT') return { color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7' }
    if (r === 'WARM') return { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
    return { color: 'var(--tx3)', background: 'var(--surf2)', border: '1px solid var(--bdr)' }
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

  function fmtDate(ts) {
    if (!ts) return ''
    const d = new Date(ts), now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diff = today - msgDay
    if (diff === 0) return 'Today'
    if (diff === 86400000) return 'Yesterday'
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  }

  function buildTimeline() {
    const messages = conversation?.messages || []
    const reviewMap = {}
    reviews.forEach(r => { if (r.id) reviewMap[r.id] = r })
    const items = []
    let lastDate = null
    messages.forEach((m, i) => {
      const ts = m.timestamp ? new Date(m.timestamp) : null
      const dateLabel = ts ? fmtDate(ts) : null
      if (dateLabel && dateLabel !== lastDate) {
        items.push({ type: 'separator', label: dateLabel, key: `sep-${i}` })
        lastDate = dateLabel
      }
      const botMessages = m.bot_messages || (m.content ? [m.content] : [])
      items.push({
        type: 'message', ...m, botMessages, _index: i,
        _review: m.review_id ? reviewMap[m.review_id] : null,
        key: `msg-${i}`
      })
    })
    return items
  }

  const filteredLeads = leads.filter(l => {
    const matchesSearch = !search || getLeadName(l).toLowerCase().includes(search.toLowerCase()) || String(l.customer_id).includes(search) || (l.username && l.username.toLowerCase().includes(search.toLowerCase().replace('@', ''))) || (l.profile_name && l.profile_name.toLowerCase().includes(search.toLowerCase()))
    const matchesFilter =
      filter === 'All' ? true :
      filter === 'Pending' ? l.pending_count > 0 :
      filter === 'Escalated' ? l.handoff_count > 0 :
      filter === 'Resolved' ? l.pending_count === 0 && l.all_reviews.length > 0 : true
    return matchesSearch && matchesFilter
  }).sort((a, b) => {
    if (a.handoff_count > 0 && b.handoff_count === 0) return -1
    if (b.handoff_count > 0 && a.handoff_count === 0) return 1
    if (sortBy === 'readiness') {
      const ra = READINESS_ORDER[a.lead_readiness] ?? 3
      const rb = READINESS_ORDER[b.lead_readiness] ?? 3
      return ra - rb
    }
    if (sortBy === 'stage') {
      const ia = STAGE_ORDER.indexOf(a.conversation_stage)
      const ib = STAGE_ORDER.indexOf(b.conversation_stage)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    }
    return new Date(b.last_activity) - new Date(a.last_activity)
  })

  const totalPending = leads.reduce((a, l) => a + l.pending_count, 0)
  const timeline = selectedLead ? buildTimeline() : []

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      {toast.msg && <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>{toast.msg}</div>}

      {/* ══ LEFT PANEL ══ */}
      <div style={{
        width: '320px', flexShrink: 0, borderRight: '1px solid var(--bdr)',
        display: selectedLead ? 'none' : 'flex', flexDirection: 'column', background: 'var(--surf)'
      }} className="inbox-list">

        {/* Search */}
        <div style={{ padding: '12px 12px 8px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--tx3)', fontSize: '.84rem', pointerEvents: 'none' }}>🔍</span>
            <input
              ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search leads..."
              style={{ width: '100%', padding: '8px 10px 8px 32px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '20px', fontSize: '.83rem', color: 'var(--tx)', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--fn)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '.8rem', padding: 0 }}>✕</button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', padding: '0 10px 8px', gap: '4px', flexShrink: 0 }}>
          {FILTERS.map(f => {
            const count = f === 'Pending' ? totalPending : f === 'Escalated' ? leads.reduce((a, l) => a + l.handoff_count, 0) : null
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                flex: 1, padding: '5px 4px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '.72rem', fontWeight: filter === f ? 600 : 400,
                background: filter === f ? 'var(--acc)' : 'var(--surf2)',
                color: filter === f ? '#fff' : 'var(--tx2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all .15s'
              }}>
                {f}
                {count > 0 && (
                  <span style={{ background: filter === f ? 'rgba(255,255,255,.3)' : '#e53e3e', color: '#fff', borderRadius: '999px', fontSize: '.6rem', minWidth: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Sort bar */}
        <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '.7rem', color: 'var(--tx3)', flexShrink: 0 }}>Sort:</span>
          <select
            value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ flex: 1, fontSize: '.72rem', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--bdr)', background: 'var(--surf2)', color: 'var(--tx2)', cursor: 'pointer', outline: 'none', fontFamily: 'var(--fn)' }}
          >
            <option value="recent">Last Interaction — Most Recent</option>
            <option value="readiness">Readiness — HOT to COLD</option>
            <option value="stage">Stage — Latest to Earliest</option>
          </select>
        </div>

        {/* Lead list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredLeads.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--tx3)', fontSize: '.84rem' }}>
              {search ? 'No leads match your search' : 'No conversations yet'}
            </div>
          ) : filteredLeads.map(lead => {
            const isSelected = selectedLead?.customer_id === lead.customer_id
            return (
              <div key={lead.customer_id} onClick={() => selectLead(lead)} style={{
                padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--bdr)',
                background: isSelected ? 'var(--accp)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--acc)' : '3px solid transparent',
                transition: 'background .15s'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.9rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {getLeadName(lead).charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getLeadName(lead)}</span>
                      {lead.handoff_count > 0 && <span style={{ fontSize: '.68rem', background: '#e53e3e', color: '#fff', padding: '1px 6px', borderRadius: '999px' }}>🚨</span>}
                      {lead.pending_count > 0 && lead.handoff_count === 0 && <span style={{ fontSize: '.68rem', background: '#d97706', color: '#fff', padding: '1px 6px', borderRadius: '999px' }}>{lead.pending_count}</span>}
                    </div>
                    <div style={{ fontSize: '.76rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                      {lead.latest_preview || lead.conversation_stage || 'No messages yet'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                    <div style={{ fontSize: '.68rem', color: 'var(--tx3)' }}>{fmtTime(lead.last_activity)}</div>
                    {lead.lead_readiness && (() => {
                      const ri = readinessInfo(lead.lead_readiness, lead.conversation_stage)
                      return <span style={{ fontSize: '.75rem' }} title={ri.label}>{ri.emoji}</span>
                    })()}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ══ RIGHT PANEL ══ */}
      <div style={{
        flex: 1, display: selectedLead ? 'flex' : 'none', flexDirection: 'column',
        overflow: 'hidden', background: 'var(--bg)'
      }} className="inbox-thread">
        {!selectedLead ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx3)', fontSize: '.9rem' }}>
            Select a conversation to view
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surf)', flexShrink: 0 }}>
              <button
                onClick={goBackToList}
                style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', color: 'var(--tx2)', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accl)'; e.currentTarget.style.color = 'var(--acc)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--surf2)'; e.currentTarget.style.color = 'var(--tx2)' }}
              >
                ← <span style={{ fontSize: '.8rem', fontWeight: 500 }}>Back</span>
              </button>

              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                {getLeadName(selectedLead).charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{getLeadName(selectedLead)}</div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>{selectedLead.conversation_stage || 'Unknown stage'}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {selectedLead.lead_readiness && (() => {
                  const ri = readinessInfo(selectedLead.lead_readiness, selectedLead.conversation_stage)
                  return (
                    <span style={{ fontSize: '.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', color: ri.color, background: ri.bg, border: ri.border }}>
                      {ri.emoji} {ri.label}
                    </span>
                  )
                })()}
                {selectedLead.lead_intent && (
                  <span style={{ fontSize: '.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', ...intentStyle(selectedLead.lead_intent) }}>
                    {selectedLead.lead_intent}
                  </span>
                )}
                {selectedLead.pending_count > 0 && (
                  <span style={{ background: '#e53e3e', color: '#fff', borderRadius: '999px', fontSize: '.68rem', fontWeight: 700, padding: '2px 8px' }}>
                    {selectedLead.pending_count} pending
                  </span>
                )}
                <button onClick={() => setShowProfile(p => !p)} style={{ background: showProfile ? 'var(--accl)' : 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.75rem', color: showProfile ? 'var(--acc)' : 'var(--tx2)', fontWeight: showProfile ? 600 : 400 }}>
                  Profile
                </button>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {threadLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}><div className="spinner" /></div>
                ) : timeline.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx3)', fontSize: '.84rem' }}>No messages yet</div>
                ) : timeline.map(item => {
                  if (item.type === 'separator') {
                    return (
                      <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 0' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--bdr)' }} />
                        <span style={{ fontSize: '.7rem', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{item.label}</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--bdr)' }} />
                      </div>
                    )
                  }
                  const isLead = item.role === 'user'
                  const botMessages = item.botMessages || []
                  const review = item._review
                  const isSent = review?.status === 'approved' || review?.status === 'edited' || (!review && !isLead)
                  const isPending = review?.status === 'pending'

                  return (
                    <div key={item.key} style={{ display: 'flex', flexDirection: 'column', alignItems: isLead ? 'flex-start' : 'flex-end', marginBottom: '6px' }}>
                      <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {isLead ? (
                          <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: 'var(--surf)', border: '1px solid var(--bdr)', fontSize: '.87rem', lineHeight: 1.55, color: 'var(--tx)' }}>
                            {item.content}
                          </div>
                        ) : (
                          botMessages.map((bubble, bi) => (
                            <div key={bi}
                              onClick={() => { if (isPending && review) { setActiveReview(review); setReplyMessages(getReviewMessages(review)) } }}
                              style={{
                                padding: '10px 14px',
                                borderRadius: bi === 0 ? '16px 16px 4px 16px' : bi === botMessages.length - 1 ? '4px 16px 16px 16px' : '4px 16px',
                                background: isPending ? '#fffbeb' : isSent ? 'var(--accp)' : 'var(--surf2)',
                                border: isPending ? '1px solid #fde68a' : isSent ? '1px solid var(--accl)' : '1px solid var(--bdr)',
                                fontSize: '.87rem', lineHeight: 1.55, color: 'var(--tx)',
                                cursor: isPending ? 'pointer' : 'default', transition: 'all .15s'
                              }}>
                              {isPending && bi === 0 && '⚠ '}{bubble}
                            </div>
                          ))
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', padding: '0 2px' }}>
                        <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }}>
                          {item.timestamp ? fmtTime(new Date(item.timestamp)) : ''}
                        </span>
                        {!isLead && botMessages.length > 1 && <span style={{ fontSize: '.65rem', color: 'var(--blu)' }}>{botMessages.length} msgs</span>}
                        {!isLead && isSent && <span style={{ fontSize: '.65rem', color: 'var(--acc)', fontWeight: 600 }}>✓✓</span>}
                        {!isLead && isPending && <span style={{ fontSize: '.65rem', color: '#d97706' }}>⏱ Pending</span>}
                        {!isLead && review?.status === 'discarded' && <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }}>✕ Discarded</span>}
                      </div>
                    </div>
                  )
                })}
                <div ref={msgEndRef} />
              </div>

              {/* Profile sidebar */}
              {showProfile && selectedLead && (
                <div style={{ width: '260px', flexShrink: 0, borderLeft: '1px solid var(--bdr)', background: 'var(--surf)', overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem' }}>Lead Profile</div>
                    <button onClick={() => setShowProfile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '1.1rem' }}>×</button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px 0', borderBottom: '1px solid var(--bdr)' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>
                      {getLeadName(selectedLead).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '.9rem', textAlign: 'center' }}>{getLeadName(selectedLead)}</div>
                    {selectedLead.username && (
                      <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>@{selectedLead.username}</div>
                    )}
                    {selectedLead.lead_readiness && (() => {
                      const ri = readinessInfo(selectedLead.lead_readiness, selectedLead.conversation_stage)
                      return (
                        <span style={{ fontSize: '.75rem', fontWeight: 700, padding: '3px 12px', borderRadius: '999px', color: ri.color, background: ri.bg, border: ri.border }}>
                          {ri.emoji} {ri.label}
                        </span>
                      )
                    })()}
                  </div>

                  {[
                    { label: 'Lead Intent', value: selectedLead.lead_intent },
                    { label: 'Primary Goal', value: selectedLead.primary_goal },
                    { label: 'Stage', value: selectedLead.conversation_stage },
                    { label: 'Channel', value: selectedLead.channel },
                    { label: 'Golf Identity', value: selectedLead.profile_facts?.golf_identity },
                    { label: 'Timeframe', value: selectedLead.profile_facts?.timeframe },
                    { label: "What They've Tried", value: selectedLead.profile_facts?.what_theyve_tried },
                    { label: 'Current Approach', value: selectedLead.profile_facts?.current_approach_working },
                    { label: 'Priority Level', value: selectedLead.profile_facts?.priority_level },
                  ].filter(f => f.value && f.value !== '').map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize: '.67rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px' }}>{f.label}</div>
                      <div style={{ fontSize: '.81rem', color: 'var(--tx)', lineHeight: 1.5 }}>{f.value}</div>
                    </div>
                  ))}

                  {selectedLead.running_summary && (
                    <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '14px' }}>
                      <div style={{ fontSize: '.67rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>Summary</div>
                      <div style={{ fontSize: '.79rem', color: 'var(--tx2)', lineHeight: 1.6 }}>{selectedLead.running_summary}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ══ REVIEW ACTION PANEL ══ */}
            {activeReview && (
              <div style={{ background: 'var(--surf)', borderTop: '1px solid var(--bdr)', flexShrink: 0, boxShadow: '0 -4px 20px rgba(0,0,0,.08)' }}>

                <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, color: (activeReview.action_type === 'HANDOFF_TO_SETTER' || activeReview.action_type === 'ESCALATE_TO_HUMAN') ? '#e53e3e' : '#d97706' }}>
                      {(activeReview.action_type === 'HANDOFF_TO_SETTER' || activeReview.action_type === 'ESCALATE_TO_HUMAN') ? '🚨 Escalated to Human' : '⚠ Review needed'}
                    </span>
                    <span style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>
                      {Math.round((activeReview.confidence || 0) * 100)}% confidence
                    </span>
                    {activeReview.conversation_stage && (
                      <span style={{ fontSize: '.68rem', background: 'var(--surf2)', border: '1px solid var(--bdr)', padding: '1px 8px', borderRadius: '999px', color: 'var(--tx3)' }}>
                        {activeReview.conversation_stage}
                      </span>
                    )}
                    {activeReview.escalation_reason && (
                      <span style={{ fontSize: '.68rem', background: '#fff5f5', border: '1px solid #fed7d7', padding: '1px 8px', borderRadius: '999px', color: '#e53e3e', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={activeReview.escalation_reason}>
                        Reason: {activeReview.escalation_reason}
                      </span>
                    )}
                    <span style={{ fontSize: '.68rem', background: 'var(--blubg)', border: '1px solid var(--blubd)', padding: '1px 8px', borderRadius: '999px', color: 'var(--blu)' }}>
                      {replyMessages.length} message{replyMessages.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <button onClick={() => { setActiveReview(null); setReplyMessages([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}>×</button>
                </div>

                <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {replyMessages.map((msg, idx) => (
                    <div key={idx} style={{ position: 'relative' }}>
                      <textarea
                        value={msg} onChange={e => updateReplyMessage(idx, e.target.value)} rows={2}
                        style={{ width: '100%', background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.85rem', padding: '10px 40px 10px 13px', borderRadius: '12px', resize: 'none', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box', transition: 'border-color .15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--accm)'}
                        onBlur={e => e.target.style.borderColor = 'var(--bdr)'}
                        placeholder={`Message ${idx + 1}...`}
                      />
                      {replyMessages.length > 1 && (
                        <button onClick={() => removeReplyMessage(idx)} style={{ position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.75rem', color: '#e53e3e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      )}
                      <div style={{ position: 'absolute', bottom: '8px', left: '13px', fontSize: '.65rem', color: 'var(--tx3)' }}>Msg {idx + 1}</div>
                    </div>
                  ))}
                  {replyMessages.length < 3 && (
                    <button onClick={addReplyMessage} style={{ alignSelf: 'flex-start', padding: '4px 12px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: 'var(--tx3)' }}>+ Add another message</button>
                  )}
                </div>

                <div style={{ padding: '0 16px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => { setTrainReason(''); setShowTrainModal(true) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '10px', cursor: 'pointer', fontSize: '.8rem', color: 'var(--tx2)', fontWeight: 500, transition: 'all .15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accm)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bdr)'}
                  >
                    ✏ Edit &amp; Train
                  </button>
                  <button onClick={discard} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: '10px', cursor: 'pointer', fontSize: '.8rem', color: '#e53e3e', fontWeight: 500 }}>
                    ✕ Discard
                  </button>
                  <button
                    onClick={approve}
                    disabled={sending || replyMessages.filter(m => m.trim()).length === 0}
                    style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', background: 'var(--acc)', border: 'none', borderRadius: '10px', cursor: sending ? 'not-allowed' : 'pointer', fontSize: '.84rem', color: '#fff', fontWeight: 600, opacity: sending || replyMessages.filter(m => m.trim()).length === 0 ? .7 : 1, boxShadow: '0 2px 8px rgba(45,106,79,.3)', transition: 'all .15s' }}
                  >
                    {sending ? 'Sending...' : `✓ Approve (${replyMessages.filter(m => m.trim()).length})`}
                  </button>
                </div>

                {activeReview.internal_notes && (
                  <div style={{ padding: '0 16px 12px', fontSize: '.74rem', color: 'var(--tx3)', fontStyle: 'italic', borderTop: '1px solid var(--bdr)', paddingTop: '10px', margin: '0 16px 12px' }}>
                    Bot reasoning: {activeReview.internal_notes}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ TRAIN MODAL ══ */}
      {showTrainModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--surf)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '520px', boxShadow: '0 20px 60px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '4px' }}>Edit &amp; Save as Training</div>
              <div style={{ fontSize: '.81rem', color: 'var(--tx3)' }}>Your correction will teach the bot to respond better next time.</div>
            </div>

            <div className="form-group">
              <label className="form-label">Corrected Reply ({replyMessages.filter(m => m.trim()).length} message{replyMessages.filter(m => m.trim()).length > 1 ? 's' : ''})</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {replyMessages.map((msg, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <textarea
                      className="form-input" rows={2} value={msg}
                      onChange={e => updateReplyMessage(idx, e.target.value)}
                      style={{ borderRadius: '10px', paddingRight: '36px' }}
                      placeholder={`Message ${idx + 1}...`}
                    />
                    {replyMessages.length > 1 && (
                      <button onClick={() => removeReplyMessage(idx)} style={{ position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.7rem', color: '#e53e3e' }}>×</button>
                    )}
                  </div>
                ))}
                {replyMessages.length < 3 && (
                  <button onClick={addReplyMessage} style={{ alignSelf: 'flex-start', padding: '4px 12px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: 'var(--tx3)' }}>+ Add message</button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Why did you change this? <span style={{ color: '#e53e3e' }}>*</span></label>
              <textarea className="form-input" rows={3} placeholder="e.g. Bot skipped acknowledging frustration..." value={trainReason} onChange={e => setTrainReason(e.target.value)} style={{ borderRadius: '10px' }} />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowTrainModal(false)} style={{ borderRadius: '10px' }}>Cancel</button>
              <button
                onClick={saveTraining} disabled={sending || !trainReason.trim()}
                style={{ padding: '9px 20px', background: 'var(--acc)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '.84rem', color: '#fff', fontWeight: 600, opacity: sending || !trainReason.trim() ? .6 : 1 }}
              >
                {sending ? 'Saving...' : '💾 Save & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (min-width: 768px) {
          .inbox-list { display: flex !important; }
          .inbox-thread { display: flex !important; }
        }
      `}</style>
    </div>
  )
}