import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const FILTERS = ['All', 'Pending', 'Escalated', 'Resolved']
const STAGES = ['ENTRY / OPEN LOOP','LOCATION ANCHOR','GOAL LOCK','GOAL DEPTH (MAKE IT SPECIFIC)',"WHAT THEY'VE TRIED (PAST + CURRENT)",'TRANSLATION / PROGRESS CHECK','BODY LINK ACCEPTANCE + MOBILITY HISTORY','PROGRESS CHECK','PRIORITY GATE','COACHING HAT','CALL BOOK BRIDGE','CALL OFFERED','CALL BOOKING','LONG TERM NURTURE']

export default function Inbox() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [filter, setFilter] = useState('All')
  const [sortBy, setSortBy] = useState('lastInteraction')
  const location = useLocation()
  const [search, setSearch] = useState('')
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
  const [correctedStage, setCorrectedStage] = useState(null)
  const [correctedIntent, setCorrectedIntent] = useState(null)
  const [showProfile, setShowProfile] = useState(false)
  const [botId, setBotId] = useState(null)
  const [showMobileThread, setShowMobileThread] = useState(false)
  const [manualReply, setManualReply] = useState('')
  const [manualSending, setManualSending] = useState(false)
  const [pendingLeadCount, setPendingLeadCount] = useState(0)
  const channelRef = useRef(null)
  const selectedLeadRef = useRef(null)
  const msgEndRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (!profile) return
    loadData()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [profile])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, reviews, activeReview])

  useEffect(() => {
    if (activeReview) {
      setCorrectedStage(activeReview.conversation_stage || null)
      setCorrectedIntent(activeReview.lead_intent || null)
    }
  }, [activeReview?.id])

  useEffect(() => {
    if (!location.state?.openLead || !leads.length || !botId) return
    const target = leads.find(l => String(l.customer_id) === String(location.state.openLead))
    if (target) selectLead(target)
  }, [location.state?.openLead, leads.length, botId])

  async function loadData() {
    setLoading(true)
    const bot = await getAssignedBot(profile, 'id')
    if (!bot) { setLoading(false); return }
    setBotId(bot.id)

    const [{ data: allReviews }, { data: convos }, { data: pendingOnly }] = await Promise.all([
      supabase.from('reviews').select('*').eq('bot_id', bot.id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('customer_id, channel, lead_intent, primary_goal, conversation_stage, profile_facts, running_summary, username, profile_name, updated_at').eq('bot_id', bot.id).neq('channel', 'tester').order('updated_at', { ascending: false }),
      supabase.from('reviews').select('customer_id').eq('bot_id', bot.id).eq('status', 'pending').not('customer_id', 'ilike', 'tester_%')
    ])

    const leadsMap = {}

    ;(convos || []).filter(c => !c.username || !c.username.toLowerCase().startsWith('test')).forEach(c => {
      let identity = null, pf = {}
      try { pf = typeof c.profile_facts === 'string' ? JSON.parse(c.profile_facts) : (c.profile_facts || {}); identity = pf?.golf_identity || null } catch {}
      leadsMap[c.customer_id] = {
        customer_id: c.customer_id, identity, username: c.username || null, profile_name: c.profile_name || null,
        lead_intent: c.lead_intent || null, channel: c.channel,
        primary_goal: c.primary_goal,
        conversation_stage: c.conversation_stage, running_summary: c.running_summary,
        profile_facts: pf, last_activity: c.updated_at,
        pending_count: 0, handoff_count: 0, latest_preview: '', all_reviews: []
      }
    })

    ;(allReviews || []).filter(r => !String(r.customer_id).startsWith('tester_')).forEach(r => {
      if (!leadsMap[r.customer_id]) {
        leadsMap[r.customer_id] = {
          customer_id: r.customer_id, identity: null, channel: 'tester',
          lead_intent: null, primary_goal: null, conversation_stage: r.conversation_stage,
          running_summary: null, profile_facts: {}, last_activity: r.created_at,
          pending_count: 0, handoff_count: 0, latest_preview: '', all_reviews: []
        }
      }
      leadsMap[r.customer_id].all_reviews.push(r)
      if (r.status === 'pending') leadsMap[r.customer_id].pending_count = 1
      if ((r.action_type === 'ESCALATE_TO_HUMAN' || r.action_type === 'HANDOFF_TO_SETTER') && r.status === 'pending') leadsMap[r.customer_id].handoff_count++
      if (!leadsMap[r.customer_id].latest_preview) leadsMap[r.customer_id].latest_preview = r.bot_reply || ''
    })

    const sorted = Object.values(leadsMap).sort((a, b) => {
      if (a.handoff_count > 0 && b.handoff_count === 0) return -1
      if (b.handoff_count > 0 && a.handoff_count === 0) return 1
      if (a.pending_count > 0 && b.pending_count === 0) return -1
      if (b.pending_count > 0 && a.pending_count === 0) return 1
      return new Date(b.last_activity) - new Date(a.last_activity)
    })

    // Unique leads with pending reviews — same logic as needsReply in Dashboard/Analytics
    setPendingLeadCount(new Set((pendingOnly || []).map(r => r.customer_id)).size)
    setLeads(sorted)
    setLoading(false)

    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const ch = supabase.channel(`inbox-${bot.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `bot_id=eq.${bot.id}` }, () => { loadData(); setTimeout(() => { if (selectedLeadRef.current) loadThread(selectedLeadRef.current.customer_id, bot.id) }, 1000) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `bot_id=eq.${bot.id}` }, () => { loadData(); setTimeout(() => { if (selectedLeadRef.current) loadThread(selectedLeadRef.current.customer_id, bot.id) }, 2000) })
      .subscribe()
    channelRef.current = ch
    if (Notification.permission === 'default') Notification.requestPermission()
  }

  async function selectLead(lead) {
    selectedLeadRef.current = lead
    setSelectedLead(lead)
    setActiveReview(null)
    setReplyMessages([])
    setShowProfile(false)
    setShowMobileThread(true)
    setThreadLoading(true)
    setManualReply('')
    await loadThread(lead.customer_id, botId)
    setThreadLoading(false)
  }

  function goBackToList() {
    selectedLeadRef.current = null
    setSelectedLead(null)
    setShowMobileThread(false)
    setActiveReview(null)
    setReplyMessages([])
    setShowProfile(false)
    setManualReply('')
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

  async function sendToMake(customerId, messages, typingDelays) {
    try {
      await fetch('https://hook.eu2.make.com/jknvsf64c05m0urc1f7qph523pi310st', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          messages: messages.filter(m => m.trim()),
          typing_delays_ms: typingDelays && typingDelays.length > 0 ? typingDelays : messages.map(() => 1500)
        })
      })
    } catch (e) {
      console.error('Make webhook error:', e)
      throw e
    }
  }

  async function approve() {
    if (!activeReview) return
    setSending(true)
    const validMessages = replyMessages.filter(m => m.trim())
    const joinedReply = validMessages.join(' ')
    await supabase.from('reviews').update({
      status: 'approved', final_reply: joinedReply, final_messages: validMessages,
      resolved_at: new Date().toISOString(),
      ...(correctedStage ? { conversation_stage: correctedStage } : {}),
      ...(correctedIntent ? { lead_intent: correctedIntent } : {})
    }).eq('id', activeReview.id)
    if (correctedStage || correctedIntent) {
      await supabase.from('conversations').update({
        ...(correctedStage ? { conversation_stage: correctedStage } : {}),
        ...(correctedIntent ? { lead_intent: correctedIntent } : {})
      }).eq('bot_id', botId).eq('customer_id', activeReview.customer_id)
    }
    await sendToMake(activeReview.customer_id, validMessages, activeReview.typing_delays || [])
    showToast('Approved - reply sent to lead', 'success')
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
      status: 'edited', final_reply: joinedReply, final_messages: validMessages, resolved_at: new Date().toISOString()
    }).eq('id', activeReview.id)
    await supabase.from('learnings').insert({
      bot_id: botId, customer_id: activeReview.customer_id, review_id: activeReview.id,
      conversation_stage: correctedStage || activeReview.conversation_stage,
      original_reply: originalJoined, corrected_reply: joinedReply, corrected_messages: validMessages,
      reason: trainReason, source: 'inbox'
    })
    if (correctedStage || correctedIntent) {
      await supabase.from('conversations').update({
        ...(correctedStage ? { conversation_stage: correctedStage } : {}),
        ...(correctedIntent ? { lead_intent: correctedIntent } : {})
      }).eq('bot_id', botId).eq('customer_id', activeReview.customer_id)
    }
    await sendToMake(activeReview.customer_id, validMessages, activeReview.typing_delays || [])
    setShowTrainModal(false)
    showToast('Edited - reply sent to lead', 'success')
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

  async function sendManualReply() {
    if (!manualReply.trim() || !selectedLead || !botId) return
    setManualSending(true)
    const text = manualReply.trim()
    setManualReply('')

    // 1. Save to conversations table — append to messages array
    const currentMessages = conversation?.messages || []
    const newMessage = {
      role: 'assistant',
      content: text,
      bot_messages: [text],
      timestamp: Date.now(),
      manual: true
    }
    const updatedMessages = [...currentMessages, newMessage]

    await supabase.from('conversations')
      .update({ messages: updatedMessages, updated_at: new Date().toISOString() })
      .eq('bot_id', botId)
      .eq('customer_id', selectedLead.customer_id)

    // 2. Deliver to Instagram via Make
    try {
      await sendToMake(selectedLead.customer_id, [text], [1500])
      showToast('Manual reply sent', 'success')
    } catch (e) {
      showToast('Saved but failed to deliver to Instagram', 'error')
    }

    // 3. Reload thread so message appears immediately
    await loadThread(selectedLead.customer_id, botId)
    setManualSending(false)
  }

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast({ msg: '' }), 3000) }

  function getLeadName(lead) {
    if (!lead) return ''
    if (String(lead.customer_id).startsWith('tester_')) return 'Bot Tester'
    const ch = (lead.channel || '').toLowerCase()
    const isFb = ch.includes('facebook') || ch === 'fb'
    if (isFb) { if (lead.profile_name) return lead.profile_name; if (lead.username) return `@${lead.username}`; return 'Facebook Lead' }
    if (lead.username) return `@${lead.username}`
    if (lead.profile_name) return lead.profile_name
    if (lead.identity) return lead.identity
    if (ch.includes('instagram') || ch === 'manychat' || ch === 'ig') return 'Instagram Lead'
    if (ch.includes('whatsapp') || ch === 'wa') return 'WhatsApp Lead'
    if (ch.includes('sms')) return 'SMS Lead'
    if (ch.includes('email')) return 'Email Lead'
    if (ch === 'tester') return 'Bot Tester'
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

  function intentBadgeStyle(intent, stage) {
    if (stage === 'CALL BOOKING') return { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
    if (intent === 'HIGH') return { color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7' }
    if (intent === 'MEDIUM') return { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
    return { color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb' }
  }

  function intentEmoji(intent, stage) {
    if (stage === 'CALL BOOKING') return '\u2705'
    if (intent === 'HIGH') return '\uD83D\uDD34'
    if (intent === 'MEDIUM') return '\uD83D\uDFE1'
    return '\u26AA'
  }

  function fmtTime(ts) { if (!ts) return ''; return timeAgo(ts) }

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
      if (dateLabel && dateLabel !== lastDate) { items.push({ type: 'separator', label: dateLabel, key: `sep-${i}` }); lastDate = dateLabel }
      const botMessages = m.bot_messages || (m.content ? [m.content] : [])
      items.push({ type: 'message', ...m, botMessages, _index: i, _review: m.review_id ? reviewMap[m.review_id] : null, key: `msg-${i}` })
    })
    return items
  }

  const sortedLeads = [...leads].sort((a, b) => {
    if (sortBy === 'intent') { const order = { HIGH: 0, MEDIUM: 1, LOW: 2 }; return (order[a.lead_intent] ?? 3) - (order[b.lead_intent] ?? 3) }
    if (sortBy === 'stage') return (a.conversation_stage || '').localeCompare(b.conversation_stage || '')
    return new Date(b.last_activity || 0) - new Date(a.last_activity || 0)
  })

  const filteredLeads = sortedLeads.filter(l => {
    const matchesSearch = !search || getLeadName(l).toLowerCase().includes(search.toLowerCase()) || String(l.customer_id).includes(search) || (l.username && l.username.toLowerCase().includes(search.toLowerCase().replace('@', ''))) || (l.profile_name && l.profile_name.toLowerCase().includes(search.toLowerCase()))
    const matchesFilter = filter === 'All' ? true : filter === 'Pending' ? l.pending_count > 0 : filter === 'Escalated' ? l.handoff_count > 0 : filter === 'Resolved' ? l.pending_count === 0 && l.all_reviews.length > 0 : true
    return matchesSearch && matchesFilter
  })

  const totalPending = pendingLeadCount
  const timeline = selectedLead ? buildTimeline() : []

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="inbox-wrapper">
      {toast.msg && <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>{toast.msg}</div>}

      {/* ═══ LEFT: LEAD LIST ═══ */}
      <div className="inbox-list" style={{ display: selectedLead ? 'none' : 'flex' }}>
        <div style={{ padding: '12px 12px 8px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--tx3)', fontSize: '.84rem', pointerEvents: 'none' }}>{'\uD83D\uDD0D'}</span>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads..." style={{ width: '100%', padding: '8px 10px 8px 32px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '20px', fontSize: '.83rem', color: 'var(--tx)', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--fn)' }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '.8rem', padding: 0 }}>{'\u2715'}</button>}
          </div>
        </div>

        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '4px' }}>
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
                  {count > 0 && <span style={{ background: filter === f ? 'rgba(255,255,255,.3)' : '#e53e3e', color: '#fff', borderRadius: '999px', fontSize: '.6rem', minWidth: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{count}</span>}
                </button>
              )
            })}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: '8px', border: '1px solid var(--bdr)', background: 'var(--surf2)', color: 'var(--tx2)', fontSize: '.72rem', cursor: 'pointer', fontFamily: 'var(--fn)' }}>
            <option value="lastInteraction">Sort: Last Interaction</option>
            <option value="intent">Sort: Intent (High first)</option>
            <option value="stage">Sort: Conversation Stage</option>
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredLeads.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--tx3)', fontSize: '.84rem' }}>{search ? 'No leads match your search' : 'No conversations yet'}</div>
          ) : filteredLeads.map(lead => {
            const isSelected = selectedLead?.customer_id === lead.customer_id
            return (
              <div key={lead.customer_id} onClick={() => selectLead(lead)} style={{ padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--bdr)', background: isSelected ? 'var(--accp)' : 'transparent', borderLeft: isSelected ? '3px solid var(--acc)' : '3px solid transparent', transition: 'background .15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.9rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>{getLeadName(lead).charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontWeight: 600, fontSize: '.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getLeadName(lead)}</span>
                      {lead.lead_intent === 'HIGH' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\uD83D\uDD34'}</span>}
                      {lead.lead_intent === 'MEDIUM' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\uD83D\uDFE1'}</span>}
                      {lead.lead_intent === 'LOW' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\u26AA'}</span>}
                      {lead.handoff_count > 0 && <span style={{ fontSize: '.68rem', background: '#e53e3e', color: '#fff', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{'\uD83D\uDEA8'}</span>}
                      {lead.pending_count > 0 && lead.handoff_count === 0 && <span style={{ fontSize: '.68rem', background: '#d97706', color: '#fff', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{lead.pending_count}</span>}
                    </div>
                    <div style={{ fontSize: '.76rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{lead.latest_preview || lead.conversation_stage || 'No messages yet'}</div>
                  </div>
                  <div style={{ fontSize: '.68rem', color: 'var(--tx3)', flexShrink: 0 }}>{fmtTime(lead.last_activity)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ CENTER + RIGHT: THREAD VIEW ═══ */}
      <div className="inbox-thread" style={{ display: selectedLead ? 'flex' : 'none' }}>
        {!selectedLead ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tx3)', fontSize: '.9rem' }}>Select a conversation to view</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surf)', flexShrink: 0 }}>
              <button onClick={goBackToList} className="back-btn">
                {'\u2190'} <span style={{ fontSize: '.8rem', fontWeight: 500 }}>Back</span>
              </button>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.95rem', fontWeight: 700, color: '#fff' }}>{getLeadName(selectedLead).charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getLeadName(selectedLead)}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLead.conversation_stage || 'Unknown stage'}</div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                {selectedLead.lead_intent && (
                  <span style={{ fontSize: '.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', ...intentBadgeStyle(selectedLead.lead_intent, selectedLead.conversation_stage) }}>
                    {intentEmoji(selectedLead.lead_intent, selectedLead.conversation_stage)} {selectedLead.conversation_stage === 'CALL BOOKING' ? 'Booked' : selectedLead.lead_intent}
                  </span>
                )}
                <button onClick={() => setShowProfile(p => !p)} style={{ background: showProfile ? 'var(--accl)' : 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.75rem', color: showProfile ? 'var(--acc)' : 'var(--tx2)', fontWeight: showProfile ? 600 : 400 }}>Profile</button>
              </div>
            </div>

            {/* Main content area: Conversation + AI Assistant side by side */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* LEFT: Conversation + Manual Reply */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {threadLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}><div className="spinner" /></div>
                  ) : timeline.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--tx3)', fontSize: '.84rem', padding: '60px 0' }}>No conversation history yet.</div>
                  ) : timeline.map(item => {
                    if (item.type === 'separator') return (
                      <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0 10px' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--bdr)' }} />
                        <span style={{ fontSize: '.69rem', color: 'var(--tx3)', background: '#e8ede8', padding: '3px 10px', borderRadius: '999px', fontWeight: 500, whiteSpace: 'nowrap' }}>{item.label}</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--bdr)' }} />
                      </div>
                    )
                    const isLead = item.role === 'user' || item.role === 'Lead'
                    const isManual = item.manual === true
                    const review = item._review
                    const isPending = review?.status === 'pending'
                    const isActive = activeReview?.id === review?.id
                    const isSent = review && (review.status === 'approved' || review.status === 'edited')
                    const botMessages = item.botMessages || [item.content]
                    const showMultiple = !isLead && botMessages.length > 1
                    return (
                      <div key={item.key} style={{ display: 'flex', flexDirection: 'column', alignItems: isLead ? 'flex-start' : 'flex-end', marginBottom: '6px' }}>
                        <div style={{ maxWidth: 'min(80%, 560px)', display: 'flex', flexDirection: 'column', alignItems: isLead ? 'flex-start' : 'flex-end', gap: showMultiple ? '4px' : 0 }}>
                          {isLead && (
                            <div style={{ padding: '9px 13px', borderRadius: '2px 16px 16px 16px', fontSize: '.84rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#fff', color: 'var(--tx)', border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}>{item.content}</div>
                          )}
                          {!isLead && botMessages.map((bubble, bi) => (
                            <div key={bi} onClick={() => isPending ? (setActiveReview(review), setReplyMessages(getReviewMessages(review))) : null}
                              style={{ padding: '9px 13px', borderRadius: '16px 2px 16px 16px', fontSize: '.84rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: isPending ? '#fffbeb' : isManual ? '#e8f0fe' : 'var(--acc)', color: isPending ? '#78350f' : isManual ? '#1a3a8f' : '#e8f7ed', border: isActive ? '2px solid var(--acc)' : isPending ? '1.5px solid #fcd34d' : isManual ? '1px solid #c7d7fc' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,.08)', cursor: isPending ? 'pointer' : 'default', transition: 'all .15s' }}>
                              {isPending && bi === 0 && '\u26A0 '}{bubble}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', padding: '0 2px' }}>
                          <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }}>{item.timestamp ? fmtTime(new Date(item.timestamp)) : ''}</span>
                          {!isLead && isManual && <span style={{ fontSize: '.65rem', color: '#6b7280', fontWeight: 500 }}>Manual</span>}
                          {!isLead && botMessages.length > 1 && <span style={{ fontSize: '.65rem', color: 'var(--blu)' }}>{botMessages.length} msgs</span>}
                          {!isLead && isSent && <span style={{ fontSize: '.65rem', color: 'var(--acc)', fontWeight: 600 }}>{'\u2713\u2713'}</span>}
                          {!isLead && review?.status === 'discarded' && <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }}>{'\u2715'} Discarded</span>}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={msgEndRef} />
                </div>

                {/* Manual Reply Input */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--bdr)', background: 'var(--surf)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                  <input
                    value={manualReply}
                    onChange={e => setManualReply(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendManualReply() } }}
                    placeholder="Type a manual reply..."
                    disabled={manualSending}
                    style={{ flex: 1, padding: '10px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '12px', fontSize: '.84rem', color: 'var(--tx)', outline: 'none', fontFamily: 'var(--fn)', boxSizing: 'border-box', opacity: manualSending ? .6 : 1 }}
                  />
                  <button
                    onClick={sendManualReply}
                    disabled={!manualReply.trim() || manualSending}
                    style={{ padding: '10px 18px', background: manualReply.trim() && !manualSending ? 'var(--acc)' : 'var(--surf2)', border: 'none', borderRadius: '12px', cursor: manualReply.trim() && !manualSending ? 'pointer' : 'default', fontSize: '.84rem', color: manualReply.trim() && !manualSending ? '#fff' : 'var(--tx3)', fontWeight: 600, transition: 'all .15s' }}
                  >{manualSending ? 'Sending...' : 'Send'}</button>
                </div>
              </div>

              {/* RIGHT: AI Assistant Panel (only when pending review exists) */}
              {activeReview && (
                <div className="ai-panel">
                  <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Panel Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--tx)' }}>AI Assistant</div>
                      <button onClick={() => { setActiveReview(null); setReplyMessages([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '1rem' }}>{'\u2715'}</button>
                    </div>

                    {/* AI Insight */}
                    {activeReview.internal_notes && (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '.95rem' }}>{'\uD83D\uDCA1'}</span>
                          <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.05em' }}>AI Insight</span>
                        </div>
                        <div style={{ fontSize: '.8rem', color: '#78350f', lineHeight: 1.65 }}>{activeReview.internal_notes}</div>
                      </div>
                    )}

                    {/* Escalation Warning */}
                    {(activeReview.action_type === 'ESCALATE_TO_HUMAN' || activeReview.action_type === 'HANDOFF_TO_SETTER') && (
                      <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: '10px', padding: '10px 14px' }}>
                        <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#e53e3e', marginBottom: '4px' }}>{'\uD83D\uDEA8'} Escalated to Human</div>
                        {activeReview.escalation_reason && <div style={{ fontSize: '.76rem', color: '#991b1b', lineHeight: 1.5 }}>{activeReview.escalation_reason}</div>}
                      </div>
                    )}

                    {/* Lead Intent */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Lead Intent</span>
                        <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', ...intentBadgeStyle(correctedIntent || activeReview.lead_intent, correctedStage || activeReview.conversation_stage) }}>
                          {correctedIntent || activeReview.lead_intent || 'UNKNOWN'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {['LOW', 'MEDIUM', 'HIGH'].map(i => (
                          <button key={i} onClick={() => setCorrectedIntent(i)} style={{
                            flex: 1, padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '.72rem', fontWeight: 600,
                            background: correctedIntent === i ? (i === 'HIGH' ? '#e53e3e' : i === 'MEDIUM' ? '#d97706' : '#6b7280') : 'var(--surf2)',
                            color: correctedIntent === i ? '#fff' : 'var(--tx3)',
                            outline: correctedIntent === i ? 'none' : '1px solid var(--bdr)'
                          }}>{i}</button>
                        ))}
                      </div>
                    </div>

                    {/* Conversation Stage */}
                    <div>
                      <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '6px' }}>Conversation Stage</div>
                      <select value={correctedStage || ''} onChange={e => setCorrectedStage(e.target.value)}
                        style={{ width: '100%', fontSize: '.78rem', padding: '7px 10px', borderRadius: '8px', border: correctedStage !== activeReview.conversation_stage ? '1.5px solid var(--acc)' : '1px solid var(--bdr)', background: correctedStage !== activeReview.conversation_stage ? 'var(--accp)' : 'var(--surf2)', color: 'var(--tx)', cursor: 'pointer', fontFamily: 'var(--fn)', boxSizing: 'border-box' }}>
                        {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {/* Suggested Reply */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>Suggested Reply</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                        {replyMessages.map((msg, idx) => (
                          <div key={idx} style={{ position: 'relative' }}>
                            <textarea
                              value={msg}
                              onChange={e => updateReplyMessage(idx, e.target.value)}
                              rows={3}
                              style={{ width: '100%', background: 'var(--surf2)', border: '1px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '8px 30px 8px 10px', borderRadius: '8px', resize: 'vertical', outline: 'none', lineHeight: 1.55, boxSizing: 'border-box' }}
                              onFocus={e => e.target.style.borderColor = 'var(--accm)'}
                              onBlur={e => e.target.style.borderColor = 'var(--bdr)'}
                              placeholder={`Message ${idx + 1}...`}
                            />
                            {replyMessages.length > 1 && (
                              <button onClick={() => removeReplyMessage(idx)} style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.6rem', color: '#e53e3e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'\u00D7'}</button>
                            )}
                          </div>
                        ))}
                        {replyMessages.length < 3 && (
                          <button onClick={addReplyMessage} style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: '6px', cursor: 'pointer', fontSize: '.72rem', color: 'var(--tx3)' }}>+ Add message</button>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Action Buttons - pinned to bottom */}
                  <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '12px', display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                    <button onClick={() => { setTrainReason(''); setShowTrainModal(true) }}
                      style={{ padding: '8px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.78rem', color: 'var(--tx2)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {'\u270F'} Edit
                    </button>
                    <button onClick={discard}
                      style={{ padding: '8px 12px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: '8px', cursor: 'pointer', fontSize: '.78rem', color: '#e53e3e', fontWeight: 500 }}>
                      {'\u2715'} Discard
                    </button>
                    <button onClick={approve} disabled={sending || replyMessages.filter(m => m.trim()).length === 0}
                      style={{ marginLeft: 'auto', padding: '8px 18px', background: 'var(--acc)', border: 'none', borderRadius: '8px', cursor: sending ? 'not-allowed' : 'pointer', fontSize: '.82rem', color: '#fff', fontWeight: 600, opacity: sending || replyMessages.filter(m => m.trim()).length === 0 ? .7 : 1, boxShadow: '0 2px 8px rgba(45,106,79,.25)' }}>
                      {sending ? 'Sending...' : 'Approve'}
                    </button>
                  </div>
                </div>
              )}

              {/* Profile Sidebar (slides over) */}
              {showProfile && selectedLead && (
                <div className="profile-panel">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem' }}>Lead Profile</div>
                    <button onClick={() => setShowProfile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '1.1rem' }}>{'\u00D7'}</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px 0', borderBottom: '1px solid var(--bdr)' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>{getLeadName(selectedLead).charAt(0).toUpperCase()}</div>
                    {selectedLead.profile_name && <div style={{ fontWeight: 600, fontSize: '.9rem', textAlign: 'center', color: 'var(--tx)' }}>{selectedLead.profile_name}</div>}
                    {selectedLead.username && <div style={{ fontSize: '.82rem', color: 'var(--tx3)', textAlign: 'center' }}>@{selectedLead.username}</div>}
                    {!selectedLead.profile_name && !selectedLead.username && <div style={{ fontWeight: 600, fontSize: '.9rem', textAlign: 'center' }}>{getLeadName(selectedLead)}</div>}
                    {selectedLead.username && (selectedLead.channel === 'manychat' || (selectedLead.channel || '').toLowerCase().includes('instagram') || (selectedLead.channel || '').toLowerCase() === 'ig') && (
                      <a href={`https://www.instagram.com/${selectedLead.username.replace('@','')}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.75rem', color: '#e1306c', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '999px', background: '#fff0f5', border: '1px solid #f9c0d0' }}>
                        <span>{'\uD83D\uDCF8'}</span> View Instagram
                      </a>
                    )}
                    <div style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>ID: {selectedLead.customer_id}</div>
                  </div>
                  {[
                    { label: 'Lead Intent', value: selectedLead.lead_intent },
                    { label: 'Primary Goal', value: selectedLead.primary_goal },
                    { label: 'Stage', value: selectedLead.conversation_stage },
                    { label: 'Channel', value: selectedLead.channel },
                    { label: 'Last Interaction', value: selectedLead.last_activity ? timeAgo(selectedLead.last_activity) : '—' },
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
          </>
        )}
      </div>

      {/* ── TRAIN MODAL ── */}
      {showTrainModal && activeReview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--surf)', borderRadius: 'var(--rlg)', boxShadow: 'var(--shm)', width: '100%', maxWidth: '560px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.95rem' }}>✏ Edit & Train</div>
                <div style={{ fontSize: '.75rem', color: 'var(--tx3)', marginTop: '2px' }}>The bot will learn from your correction</div>
              </div>
              <button onClick={() => setShowTrainModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'var(--tx3)', lineHeight: 1 }}>{'\u00D7'}</button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '65vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)' }}>Reply ({replyMessages.length} message{replyMessages.length !== 1 ? 's' : ''})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {replyMessages.map((msg, idx) => (
                    <div key={idx} style={{ position: 'relative' }}>
                      <textarea className="form-input" rows={2} value={msg} onChange={e => updateReplyMessage(idx, e.target.value)} style={{ borderRadius: '10px', paddingRight: '36px' }} placeholder={`Message ${idx + 1}...`} />
                      {replyMessages.length > 1 && <button onClick={() => removeReplyMessage(idx)} style={{ position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.7rem', color: '#e53e3e' }}>{'\u00D7'}</button>}
                    </div>
                  ))}
                  {replyMessages.length < 3 && <button onClick={addReplyMessage} style={{ alignSelf: 'flex-start', padding: '4px 12px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: 'var(--tx3)' }}>+ Add message</button>}
                </div>
              </div>
              <div style={{ background: 'var(--surf2)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div><div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Tag Lead Stage and Intent</div></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)' }}>Conversation Stage</label>
                  <select value={correctedStage || ''} onChange={e => setCorrectedStage(e.target.value)} className="form-input" style={{ fontSize: '.8rem', padding: '6px 10px', borderRadius: '8px' }}>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)' }}>Lead Intent</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {['LOW', 'MEDIUM', 'HIGH'].map(i => (
                      <button key={i} onClick={() => setCorrectedIntent(i)} style={{ flex: 1, padding: '7px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, background: correctedIntent === i ? (i === 'HIGH' ? '#e53e3e' : i === 'MEDIUM' ? '#d97706' : '#6b7280') : 'var(--surf)', color: correctedIntent === i ? '#fff' : 'var(--tx3)', outline: correctedIntent === i ? 'none' : '1px solid var(--bdr)' }}>{i}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Why did you make these changes? <span style={{ color: '#e53e3e' }}>*</span></label>
                <textarea className="form-input" rows={3} placeholder="e.g. Bot classified this as GOAL LOCK but the lead already stated their goal." value={trainReason} onChange={e => setTrainReason(e.target.value)} style={{ borderRadius: '10px' }} />
                <div className="form-hint">The more detail you give, the faster the AI learns.</div>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bdr)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowTrainModal(false)} style={{ borderRadius: '10px' }}>Cancel</button>
              <button onClick={saveTraining} disabled={sending || !trainReason.trim()} style={{ padding: '9px 20px', background: 'var(--acc)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '.84rem', color: '#fff', fontWeight: 600, opacity: sending || !trainReason.trim() ? .6 : 1 }}>{sending ? 'Saving...' : 'Save & Train'}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .inbox-wrapper { display: flex; height: 100%; overflow: hidden; background: var(--bg); position: relative; }
        .inbox-list { width: 100%; flex-shrink: 0; border-right: 1px solid var(--bdr); flex-direction: column; background: var(--surf); min-height: 0; }
        .inbox-thread { flex: 1; flex-direction: column; overflow: hidden; background: var(--bg); min-width: 0; }
        .ai-panel { width: 340px; flex-shrink: 0; border-left: 1px solid var(--bdr); background: var(--surf); padding: 16px; display: flex; flex-direction: column; overflow: hidden; }
        .profile-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(85vw, 320px); z-index: 200; background: var(--surf); border-left: 1px solid var(--bdr); overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 16px; box-shadow: -4px 0 24px rgba(0,0,0,.18); animation: slideInRight .2s ease; }
        .back-btn { background: var(--surf2); border: 1px solid var(--bdr); border-radius: 8px; cursor: pointer; font-size: 1rem; color: var(--tx2); padding: 6px 10px; display: flex; align-items: center; gap: 4px; transition: all .15s; }
        .back-btn:hover { background: var(--accl); color: var(--acc); }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (min-width: 1024px) {
          .inbox-list { width: 320px; }
          .profile-panel { position: relative; width: 280px; flex-shrink: 0; box-shadow: none; animation: none; }
        }
        @media (max-width: 1023px) {
          .ai-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(90vw, 360px); z-index: 200; box-shadow: -4px 0 24px rgba(0,0,0,.18); animation: slideInRight .2s ease; }
        }
        @media (min-width: 768px) {
          .inbox-thread { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
