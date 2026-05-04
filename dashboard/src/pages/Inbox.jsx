import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'
import { useDataCache } from '../lib/DataCache'

const FILTERS = ['All', 'Pending', 'Needs Response', 'Follow Ups', 'Escalated', 'For Coach', 'Resolved', 'Test']
const FOLLOW_UP_HOURS = 21
// Step 8 (2026-05-03): IG window threshold lowered from 24h to 23h to give
// a 1-hour safety buffer. Meta closes the messaging window exactly 24 hours
// after the lead's last message. We treat 23h as "expired" so that by the
// time a setter notices and tries to send, there's still room before the
// hard Meta cutoff. Used for: lead-list badge, inbox header timer, Follow
// Ups tab filter, and the windowExpired flag.
const IG_WINDOW_HOURS = 23
// Step 12 (2026-05-03): leads whose last message is older than this drop off
// the Follow Ups tab (badge, list, and pill). They're functionally cold and
// would otherwise pile up forever. If the lead replies later,
// last_user_message_at refreshes and they slide back into the active band
// automatically. Display only - no DB writes.
const FOLLOW_UP_STALE_HOURS = 72
const STAGES = ['HOOK / ENTRY','GOAL','DIAGNOSTIC','INSIGHT','PRIORITY','DECISION','INVITE','SCHEDULE','BOOKED','FOLLOW-UP']

// Step 13 (2026-05-03): For Coach routing.
// Categories the setter (or AI) can use when flagging a lead for the Coach.
// Each flag event is logged in coach_flag_reasons - manual flags get a
// category + optional comment, AI flags use the AI's own reasoning text in
// the comment field. Edit this list to change the dropdown options. The
// 'requireComment' flag forces a comment when 'Other' is selected so we
// always have signal for that ambiguous bucket.
const COACH_FLAG_CATEGORIES = [
  { key: 'existing_student',  label: 'Existing student / client' },
  { key: 'personal_contact',  label: 'Personal contact (friend, family, IRL)' },
  { key: 'industry_peer',     label: 'Other coach / industry peer' },
  { key: 'press_media',       label: 'Press / media inquiry' },
  { key: 'past_customer',     label: 'Past customer' },
  { key: 'non_program_topic', label: 'Question about non-program topic' },
  { key: 'spam_random',       label: 'Spam / promo / random' },
  { key: 'other',             label: 'Other', requireComment: true },
]

export default function Inbox() {
  const { profile } = useAuth()
  const { get: getCache, set: setCache } = useDataCache()
  const [leads, setLeads] = useState(() => {
    const cached = getCache('inbox_leads')
    return cached?.data || []
  })
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
  const [loading, setLoading] = useState(() => {
    const cached = getCache('inbox_leads')
    return !cached?.data?.length
  })
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
  const [aiProgress, setAiProgress] = useState(null)
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  // Step 13 (2026-05-03): For Coach modal state.
  // coachModalOpen toggles the modal. coachModalCategory holds the selected
  // category key (one of COACH_FLAG_CATEGORIES). coachModalComment holds the
  // optional free-text comment. All three reset when the modal closes.
  const [coachModalOpen, setCoachModalOpen] = useState(false)
  const [coachModalCategory, setCoachModalCategory] = useState('')
  const [coachModalComment, setCoachModalComment] = useState('')
  const channelRef = useRef(null)
  const selectedLeadRef = useRef(null)
  const msgEndRef = useRef(null)
  const searchRef = useRef(null)
  const manualInputRef = useRef(null)
  const activeReviewRef = useRef(null)
  // Step 4 (2026-04-30): track interaction state so realtime callbacks
  // never reload the open thread mid-typing or mid-action.
  const manualReplyRef = useRef('')
  const sendingRef = useRef(false)
  const loadDataDebounceRef = useRef(null)

  useEffect(() => {
    if (!profile) return
    loadData(true)
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [profile])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, reviews, activeReview])

  useEffect(() => {
    if (activeReview) {
      activeReviewRef.current = activeReview
      setCorrectedStage(activeReview.conversation_stage || null)
      setCorrectedIntent(activeReview.lead_intent || null)
    } else {
      activeReviewRef.current = null
    }
  }, [activeReview?.id])

  useEffect(() => {
    if (!location.state?.openLead || !leads.length || !botId) return
    const target = leads.find(l => String(l.customer_id) === String(location.state.openLead))
    if (target) selectLead(target)
  }, [location.state?.openLead, leads.length, botId])

  // Step 4 (2026-04-30): keep refs in sync with their state counterparts
  // so the realtime callbacks can read the freshest interaction state without re-subscribing.
  useEffect(() => { manualReplyRef.current = manualReply }, [manualReply])
  useEffect(() => { sendingRef.current = sending || manualSending }, [sending, manualSending])

  // Step 4 (2026-04-30): only show full-page spinner on the initial mount when there is no cached data.
  // Realtime callbacks, post-action refreshes, and bot-switch refreshes pass showLoading=false (the default)
  // so the page never whitewashes mid-session. This eliminates the "sudden whiteout with rolling circle"
  // that interrupted setters when reviews/conversations updated in the background.
  async function loadData(showLoading = false) {
    const hasCached = leads.length > 0
    if (showLoading && !hasCached) setLoading(true)
    const bot = await getAssignedBot(profile, 'id')
    if (!bot) { setLoading(false); return }
    setBotId(bot.id)

    const [{ data: allReviews }, { data: convos }, { data: pendingOnly }, { data: progressReviews }] = await Promise.all([
      supabase.from('reviews').select('*').eq('bot_id', bot.id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('customer_id, channel, lead_intent, primary_goal, conversation_stage, profile_facts, running_summary, username, profile_name, updated_at, messages, followed_up, followup_count, re_engaged, pre_followup_stage, lead_source, lead_source_updated_at, for_coach').eq('bot_id', bot.id).neq('channel', 'tester').is('deleted_at', null).order('updated_at', { ascending: false }),
      supabase.from('reviews').select('customer_id').eq('bot_id', bot.id).eq('status', 'pending').not('customer_id', 'ilike', 'tester_%'),
      supabase.from('reviews').select('id, status, confidence').eq('bot_id', bot.id).not('customer_id', 'ilike', 'tester_%')
    ])

    // Compute AI progress stats
    if (progressReviews) {
      const total = progressReviews.length
      const approved = progressReviews.filter(r => r.status === 'approved').length
      const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0
      const recentWithConf = progressReviews.filter(r => r.confidence != null).slice(-20)
      const avgConfidence = recentWithConf.length > 0
        ? Math.round((recentWithConf.reduce((a, r) => a + r.confidence, 0) / recentWithConf.length) * 100)
        : null
      let progressStage, progressPct
      if (approvalRate <= 40) { progressStage = 'Learning'; progressPct = Math.round((approvalRate / 40) * 33) }
      else if (approvalRate <= 65) { progressStage = 'Improving'; progressPct = 33 + Math.round(((approvalRate - 41) / 24) * 34) }
      else if (approvalRate <= 85) { progressStage = 'Trusted'; progressPct = 67 + Math.round(((approvalRate - 66) / 19) * 23) }
      else { progressStage = 'Auto-Ready'; progressPct = 90 + Math.round(((approvalRate - 86) / 14) * 10) }
      setAiProgress({ approvalRate, progressStage, progressPct, avgConfidence, total })
    }

    const leadsMap = {}

    ;(convos || []).filter(c => !c.username || !c.username.toLowerCase().startsWith('test')).forEach(c => {
      let identity = null, pf = {}
      try { pf = typeof c.profile_facts === 'string' ? JSON.parse(c.profile_facts) : (c.profile_facts || {}); identity = pf?.golf_identity || null } catch {}
      // Extract the last message sent by the lead (role: user/Lead) for the preview
      // Also find the timestamp of the last user message and last bot message
      const msgs = Array.isArray(c.messages) ? c.messages : []
      let lastLeadMsg = '', lastUserMsgAt = null, lastBotMsgAt = null
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if ((m.role === 'user' || m.role === 'Lead') && !lastUserMsgAt) {
          lastLeadMsg = m.content || ''
          lastUserMsgAt = m.timestamp || null
        }
        if (m.role === 'assistant' && !lastBotMsgAt) {
          lastBotMsgAt = m.timestamp || null
        }
        if (lastUserMsgAt && lastBotMsgAt) break
      }
      // Lead needs response if their last message came AFTER the last bot message (or no bot message exists)
      const userSentLast = lastUserMsgAt && (!lastBotMsgAt || lastUserMsgAt > lastBotMsgAt)
      leadsMap[c.customer_id] = {
        customer_id: c.customer_id, identity, username: c.username || null, profile_name: c.profile_name || null,
        lead_intent: c.lead_intent || null, channel: c.channel,
        primary_goal: c.primary_goal,
        conversation_stage: c.conversation_stage, running_summary: c.running_summary,
        profile_facts: pf, last_activity: c.updated_at,
        last_bot_sent_at: null,
        last_user_message_at: lastUserMsgAt || null,
        user_sent_last: userSentLast || false,
        followed_up: c.followed_up || false,
        followup_count: c.followup_count || 0,
        re_engaged: c.re_engaged || false,
        pre_followup_stage: c.pre_followup_stage || null,
        // Step 7 (2026-05-03): carry lead_source for inbox UI display.
        lead_source: c.lead_source || null,
        lead_source_updated_at: c.lead_source_updated_at || null,
        // Step 14 (2026-05-03): For Coach hotfix.
        // The leads array is rebuilt from scratch on every loadData() call.
        // Without explicitly carrying for_coach here, the realtime callback
        // (which fires after every flag) would drop the field, the helper
        // would return false, and the flagged lead would bounce out of the
        // For Coach tab within ~2 seconds.
        for_coach: c.for_coach === true,
        pending_count: 0, handoff_count: 0, latest_preview: lastLeadMsg, all_reviews: []
      }
    })

    ;(allReviews || []).forEach(r => {
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
      if (r.status === 'delivery_failed') leadsMap[r.customer_id].delivery_failed_count = (leadsMap[r.customer_id].delivery_failed_count || 0) + 1
      if ((r.action_type === 'ESCALATE_TO_HUMAN' || r.action_type === 'HANDOFF_TO_SETTER') && r.status === 'pending') leadsMap[r.customer_id].handoff_count++
      // Track when the bot last sent a message (approved, edited, auto_sent)
      const isSentByBot = r.status === 'approved' || r.status === 'edited' || r.status === 'auto_sent'
      if (isSentByBot && r.resolved_at) {
        const prev = leadsMap[r.customer_id].last_bot_sent_at
        if (!prev || r.resolved_at > prev) leadsMap[r.customer_id].last_bot_sent_at = r.resolved_at
      }
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
    setCache('inbox_leads', sorted)
    setLoading(false)

    if (channelRef.current) supabase.removeChannel(channelRef.current)

    // Step 4 (2026-04-30): smarter realtime handling.
    //
    // The legacy code called loadData() on every realtime event AND scheduled
    // a loadThread() reload regardless of whether the event was for the
    // currently-open lead. With multiple leads active that produced 5-15
    // re-renders per minute, plus mid-typing thread reloads.
    //
    // Now:
    //   - loadData() is debounced 600ms so a burst of events triggers ONE refresh.
    //   - loadThread() runs only if the realtime event is for the open lead AND
    //     the user is not currently typing or sending.
    //   - All paths use loadData() (no spinner) - the page-level whiteout only
    //     ever fires on the initial mount via loadData(true) above.

    const debouncedLoadData = () => {
      if (loadDataDebounceRef.current) clearTimeout(loadDataDebounceRef.current)
      loadDataDebounceRef.current = setTimeout(() => { loadData(false) }, 600)
    }

    const maybeReloadThread = (payload, delayMs) => {
      // Bail if no lead is open, or there's an active review the user might be working on,
      // or the user is mid-send/approve/edit, or the user is typing a manual reply.
      if (!selectedLeadRef.current) return
      if (activeReviewRef.current) return
      if (sendingRef.current) return
      if (manualReplyRef.current && manualReplyRef.current.trim().length > 0) return

      // Skip cross-lead events: only reload when the change is for the lead we're viewing.
      const eventCustomerId = payload?.new?.customer_id || payload?.old?.customer_id || null
      const openCustomerId = selectedLeadRef.current.customer_id
      if (eventCustomerId && String(eventCustomerId) !== String(openCustomerId)) return

      setTimeout(() => {
        // Re-check at firing time in case state changed during the delay
        if (!selectedLeadRef.current) return
        if (activeReviewRef.current) return
        if (sendingRef.current) return
        if (manualReplyRef.current && manualReplyRef.current.trim().length > 0) return
        loadThread(selectedLeadRef.current.customer_id, bot.id)
      }, delayMs)
    }

    const ch = supabase.channel(`inbox-${bot.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `bot_id=eq.${bot.id}` }, (payload) => {
        debouncedLoadData()
        maybeReloadThread(payload, 1000)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `bot_id=eq.${bot.id}` }, (payload) => {
        debouncedLoadData()
        maybeReloadThread(payload, 2000)
      })
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
    // For sent reviews, show what was actually delivered (final), not the original draft
    if (review.status === 'approved' || review.status === 'edited' || review.status === 'auto_sent') {
      if (Array.isArray(review.final_messages) && review.final_messages.length > 0) return review.final_messages
      if (review.final_reply) return [review.final_reply]
    }
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

    // BOOKED auto-promotion: if the outgoing message contains the booking
    // form link, override stage/intent regardless of what setter set.
    const BOOKING_URL_PATTERN = /form\.jotform\.com/i
    const containsBookingLink = BOOKING_URL_PATTERN.test(joinedReply)
    const finalStage = containsBookingLink ? 'BOOKED' : correctedStage
    const finalIntent = containsBookingLink ? 'HIGH' : correctedIntent

    await supabase.from('reviews').update({
      status: 'approved', final_reply: joinedReply, final_messages: validMessages,
      resolved_at: new Date().toISOString(),
      ...(finalStage ? { conversation_stage: finalStage } : {}),
      ...(finalIntent ? { lead_intent: finalIntent } : {})
    }).eq('id', activeReview.id)

    // Update the matching message in conversations so the thread shows
    // the final sent text instead of the original draft
    if (conversation) {
      const currentMessages = conversation.messages || []
      const hasMatch = currentMessages.some(m => m.review_id === activeReview.id)
      let updatedMessages
      if (hasMatch) {
        updatedMessages = currentMessages.map(m => {
          if (m.review_id === activeReview.id) {
            // Step 6 (2026-05-02): refresh timestamp to send-time, not draft-time.
            // Prior to this fix the message kept the timestamp the Worker stamped
            // when the bot first generated the draft - so the thread showed
            // misleading times like "Bot replied 12:57" when really the setter
            // approved and sent at 1:03. Reflect actual send time instead.
            return { ...m, content: joinedReply, bot_messages: validMessages, final_sent: true, timestamp: Date.now() }
          }
          return m
        })
      } else {
        // No matching message found - append the approved reply to the conversation
        updatedMessages = [...currentMessages, {
          role: 'assistant',
          content: joinedReply,
          bot_messages: validMessages,
          timestamp: Date.now(),
          review_id: activeReview.id,
          final_sent: true,
          message_count: validMessages.length
        }]
      }
      await supabase.from('conversations').update({
        messages: updatedMessages,
        updated_at: new Date().toISOString(),
        ...(finalStage ? { conversation_stage: finalStage } : {}),
        ...(finalIntent ? { lead_intent: finalIntent } : {}),
        ...(containsBookingLink ? { status: 'booked' } : {})
      }).eq('bot_id', botId).eq('customer_id', activeReview.customer_id)
    } else {
      // Step 10 (2026-05-03): no longer bump updated_at on this fallback path.
      // This branch fires only when the conversation record has no matching
      // message to update - meaning we're correcting stage/intent/status but NOT
      // adding a real message. The lead list sort should reflect actual message
      // exchanges, not admin corrections, so updated_at is left alone.
      await supabase.from('conversations').update({
        ...(finalStage ? { conversation_stage: finalStage } : {}),
        ...(finalIntent ? { lead_intent: finalIntent } : {}),
        ...(containsBookingLink ? { status: 'booked' } : {})
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

    // Update the matching message in conversations so the thread shows
    // the final edited text instead of the original draft
    if (conversation) {
      const currentMessages = conversation.messages || []
      const hasMatch = currentMessages.some(m => m.review_id === activeReview.id)
      let updatedMessages
      if (hasMatch) {
        updatedMessages = currentMessages.map(m => {
          if (m.review_id === activeReview.id) {
            // Step 6 (2026-05-02): refresh timestamp to send-time, not draft-time.
            // See approveReview for the same fix; same reasoning applies here.
            return { ...m, content: joinedReply, bot_messages: validMessages, final_sent: true, timestamp: Date.now() }
          }
          return m
        })
      } else {
        // No matching message found - append the edited reply to the conversation
        updatedMessages = [...currentMessages, {
          role: 'assistant',
          content: joinedReply,
          bot_messages: validMessages,
          timestamp: Date.now(),
          review_id: activeReview.id,
          final_sent: true,
          message_count: validMessages.length
        }]
      }
      await supabase.from('conversations').update({
        messages: updatedMessages,
        updated_at: new Date().toISOString(),
        ...(correctedStage ? { conversation_stage: correctedStage } : {}),
        ...(correctedIntent ? { lead_intent: correctedIntent } : {})
      }).eq('bot_id', botId).eq('customer_id', activeReview.customer_id)
    } else {
      // Step 10 (2026-05-03): no longer bump updated_at on this fallback path.
      // Same reasoning as approve(): this branch only corrects stage/intent
      // without adding a message. Lead list sort should reflect message exchanges.
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
    // Step 10 (2026-05-03): no longer bump conversation updated_at on discard.
    // Discard is an admin action, not a message exchange. The realtime subscription
    // on the reviews table handles inbox refresh and pending-count drop on its own.
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

    // BOOKED auto-promotion: if manual reply contains the booking form link,
    // mark the lead as booked. Same rule as approve() and the Worker.
    const BOOKING_URL_PATTERN = /form\.jotform\.com/i
    const containsBookingLink = BOOKING_URL_PATTERN.test(text)

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
      .update({
        messages: updatedMessages,
        updated_at: new Date().toISOString(),
        ...(containsBookingLink ? {
          conversation_stage: 'BOOKED',
          lead_intent: 'HIGH',
          status: 'booked'
        } : {})
      })
      .eq('bot_id', botId)
      .eq('customer_id', selectedLead.customer_id)

    // 2. Deliver to Instagram via Make
    try {
      await sendToMake(selectedLead.customer_id, [text], [1500])
      showToast(containsBookingLink ? 'Manual reply sent - lead marked as Booked' : 'Manual reply sent', 'success')
    } catch (e) {
      showToast('Saved but failed to deliver to Instagram', 'error')
    }

    // 3. Reload thread so message appears immediately
    await loadThread(selectedLead.customer_id, botId)
    setManualSending(false)
  }

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast({ msg: '' }), 3000) }

  async function markAsBooked() {
    if (!selectedLead || !botId) return
    // Step 10 (2026-05-03): no longer bumps updated_at - admin action, not a message.
    await supabase.from('conversations').update({
      status: 'booked',
      conversation_stage: 'BOOKED'
    }).eq('bot_id', botId).eq('customer_id', selectedLead.customer_id)
    setConversation(prev => prev ? { ...prev, status: 'booked', conversation_stage: 'BOOKED' } : prev)
    setSelectedLead(prev => prev ? { ...prev, conversation_stage: 'BOOKED' } : prev)
    showToast('Lead marked as booked', 'success')
    loadData()
  }

  async function unmarkBooked() {
    if (!selectedLead || !botId) return
    if (!confirm('Remove booked status from this lead?')) return
    // Restore the previous stage from the conversation, or default to HOOK / ENTRY
    const previousStage = conversation?.conversation_stage === 'BOOKED' ? 'HOOK / ENTRY' : (conversation?.conversation_stage || 'HOOK / ENTRY')
    // Step 10 (2026-05-03): no longer bumps updated_at - admin action.
    await supabase.from('conversations').update({
      status: 'active',
      conversation_stage: previousStage
    }).eq('bot_id', botId).eq('customer_id', selectedLead.customer_id)
    setConversation(prev => prev ? { ...prev, status: 'active', conversation_stage: previousStage } : prev)
    setSelectedLead(prev => prev ? { ...prev, conversation_stage: previousStage } : prev)
    showToast('Booked status removed', 'info')
    loadData()
  }

  // Step 13 (2026-05-03): For Coach flagging.
  // flagForCoach: setter clicks "For Coach" in the thread header, picks a
  // category in the modal, optionally adds a comment, confirms. We update
  // conversations.for_coach=true AND insert a row in coach_flag_reasons so
  // the AI classifier (Step 16) can later use this as a training example.
  // unflagFromCoach: removes the flag and logs a manual_unflag event.
  // No updated_at bump - admin action, not a tracked message.
  async function flagForCoach(category, comment) {
    if (!selectedLead || !botId) return
    if (!category) { showToast('Please select a category', 'error'); return }
    const cat = COACH_FLAG_CATEGORIES.find(c => c.key === category)
    if (cat?.requireComment && !(comment && comment.trim().length > 0)) {
      showToast('Please add a comment when selecting Other', 'error')
      return
    }
    // 1) flip the flag on the conversation row
    const { error: updErr } = await supabase.from('conversations')
      .update({ for_coach: true })
      .eq('bot_id', botId)
      .eq('customer_id', selectedLead.customer_id)
    if (updErr) { showToast('Failed to flag for Coach', 'error'); return }
    // 2) log the event in coach_flag_reasons
    const { error: insErr } = await supabase.from('coach_flag_reasons').insert({
      bot_id: botId,
      customer_id: String(selectedLead.customer_id),
      event_type: 'manual_flag',
      category,
      comment: comment && comment.trim().length > 0 ? comment.trim() : null,
      flagged_by_user_id: profile?.id || null,
      ai_confidence: null,
    })
    if (insErr) {
      // The flag itself succeeded; the log row didn't. Surface a soft warning
      // but don't roll back - we'd rather have a missing log row than a lead
      // stuck between two states.
      console.error('coach_flag_reasons insert failed:', insErr)
      showToast('Flagged for Coach (log entry failed)', 'success')
    } else {
      showToast('Lead flagged for Coach', 'success')
    }
    // 3) update local state so UI reflects immediately
    setConversation(prev => prev ? { ...prev, for_coach: true } : prev)
    setSelectedLead(prev => prev ? { ...prev, for_coach: true } : prev)
    setLeads(prev => prev.map(l => l.customer_id === selectedLead.customer_id ? { ...l, for_coach: true } : l))
    setCoachModalOpen(false)
    setCoachModalCategory('')
    setCoachModalComment('')
  }

  async function unflagFromCoach() {
    if (!selectedLead || !botId) return
    if (!confirm('Move this lead back out of the For Coach tab?')) return
    const { error: updErr } = await supabase.from('conversations')
      .update({ for_coach: false })
      .eq('bot_id', botId)
      .eq('customer_id', selectedLead.customer_id)
    if (updErr) { showToast('Failed to unflag', 'error'); return }
    const { error: insErr } = await supabase.from('coach_flag_reasons').insert({
      bot_id: botId,
      customer_id: String(selectedLead.customer_id),
      event_type: 'manual_unflag',
      category: null,
      comment: null,
      flagged_by_user_id: profile?.id || null,
      ai_confidence: null,
    })
    if (insErr) console.error('coach_flag_reasons unflag log failed:', insErr)
    setConversation(prev => prev ? { ...prev, for_coach: false } : prev)
    setSelectedLead(prev => prev ? { ...prev, for_coach: false } : prev)
    setLeads(prev => prev.map(l => l.customer_id === selectedLead.customer_id ? { ...l, for_coach: false } : l))
    showToast('Lead moved back out of For Coach', 'success')
  }

  async function markAsFollowedUp() {
    if (!selectedLead || !botId) return
    const currentCount = conversation?.followup_count || selectedLead.followup_count || 0
    const newCount = currentCount + 1
    // Bug 7: Capture the pre-follow-up stage so we can restore it when the lead
    // replies. Only set if there's a meaningful stage to remember and we don't
    // already have one stored. Skip if current stage is already FOLLOW-UP (no
    // meaningful pre-state to capture).
    const currentStage = conversation?.conversation_stage || selectedLead.conversation_stage
    const existingPreStage = conversation?.pre_followup_stage || selectedLead.pre_followup_stage
    const shouldCapturePreStage = currentStage && currentStage !== 'FOLLOW-UP' && !existingPreStage
    // Step 10 (2026-05-03): no longer bumps updated_at - admin action, not a tracked message.
    // The DM was sent through Business Suite, off-platform, so we have no message
    // to add to the thread. The lead list sort should not jump for this.
    const updatePayload = {
      followup_count: newCount,
      followed_up: newCount > 0,
      re_engaged: false
    }
    if (shouldCapturePreStage) updatePayload.pre_followup_stage = currentStage
    await supabase.from('conversations').update(updatePayload).eq('bot_id', botId).eq('customer_id', selectedLead.customer_id)
    const localPatch = { followup_count: newCount, followed_up: true, re_engaged: false, ...(shouldCapturePreStage ? { pre_followup_stage: currentStage } : {}) }
    setConversation(prev => prev ? { ...prev, ...localPatch } : prev)
    setSelectedLead(prev => prev ? { ...prev, ...localPatch } : prev)
    setLeads(prev => prev.map(l => l.customer_id === selectedLead.customer_id ? { ...l, ...localPatch } : l))
    if (newCount >= 2) {
      showToast('2nd follow-up logged. Lead removed from Closest to Booking until they reply.', 'success')
    } else {
      showToast(`Follow-up #${newCount} logged`, 'success')
    }
  }

  async function unmarkFollowedUp() {
    if (!selectedLead || !botId) return
    if (!confirm('Reset follow-up count to 0 for this lead?')) return
    // Step 10 (2026-05-03): no longer bumps updated_at - admin action.
    await supabase.from('conversations').update({
      followup_count: 0,
      followed_up: false
    }).eq('bot_id', botId).eq('customer_id', selectedLead.customer_id)
    setConversation(prev => prev ? { ...prev, followup_count: 0, followed_up: false } : prev)
    setSelectedLead(prev => prev ? { ...prev, followup_count: 0, followed_up: false } : prev)
    setLeads(prev => prev.map(l => l.customer_id === selectedLead.customer_id ? { ...l, followup_count: 0, followed_up: false } : l))
    showToast('Follow-up count reset', 'info')
  }

  async function saveUsername() {
    if (!selectedLead || !botId) return
    const newUsername = usernameInput.trim().replace(/^@/, '')
    if (!newUsername) return
    // Step 10 (2026-05-03): no longer bumps updated_at - admin action, not a message.
    const { error } = await supabase.from('conversations')
      .update({ username: newUsername })
      .eq('bot_id', botId)
      .eq('customer_id', selectedLead.customer_id)
    if (error) { showToast('Failed to save username', 'error'); return }
    // Update local state so it reflects immediately
    setSelectedLead(prev => ({ ...prev, username: newUsername }))
    setLeads(prev => prev.map(l => l.customer_id === selectedLead.customer_id ? { ...l, username: newUsername } : l))
    setEditingUsername(false)
    showToast('Username updated', 'success')
  }

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
    if (stage === 'BOOKED') return { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
    if (intent === 'HIGH') return { color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7' }
    if (intent === 'MEDIUM') return { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
    return { color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb' }
  }

  function intentEmoji(intent, stage) {
    if (stage === 'BOOKED') return '\u2705'
    if (intent === 'HIGH') return '\uD83D\uDD34'
    if (intent === 'MEDIUM') return '\uD83D\uDFE1'
    return '\u26AA'
  }

  function fmtTime(ts) { if (!ts) return ''; return timeAgo(ts) }

  // Step 5 (2026-05-01): precise per-message time stamp.
  // Used in the thread under every lead and bot message so setters can audit
  // exact send times - critical for diagnosing 24-hour window expiry, late
  // deliveries, and gaps that explain ManyChat 400 validation errors.
  function fmtMessageTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const dayDiff = Math.round((today - msgDay) / 86400000)
    const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (dayDiff === 0) return timePart
    if (dayDiff === 1) return `Yesterday ${timePart}`
    const sameYear = d.getFullYear() === now.getFullYear()
    const datePart = sameYear
      ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    return `${datePart}, ${timePart}`
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
      if (dateLabel && dateLabel !== lastDate) { items.push({ type: 'separator', label: dateLabel, key: `sep-${i}` }); lastDate = dateLabel }

      // Step 7 (2026-05-03): lead_source_event entries render as a centered banner,
      // not a chat bubble. They appear inline in the timeline at their natural
      // chronological position so setters can see when the lead engaged via a
      // keyword/comment relative to other messages.
      if (m.role === 'lead_source_event') {
        items.push({
          type: 'lead_source_event',
          lead_source: m.lead_source || 'unknown',
          display_text: m.display_text || `Engaged via "${m.lead_source || 'keyword'}"`,
          timestamp: m.timestamp,
          key: `lse-${i}`
        })
        return
      }

      const botMessages = m.bot_messages || (m.content ? [m.content] : [])
      const matchedReview = m.review_id ? reviewMap[m.review_id] : null

      // Step 4 (2026-04-30): orphan detection.
      // An assistant message with a review_id but no matching review row is an orphan -
      // typically from before Step 1 shipped, or from a Step-3 retry exhaustion where
      // the review insert failed and was stashed in KV but never re-played.
      // We tag it with delivery_status="uncertain" at render time so the existing yellow
      // banner renders instead of a fake-sent green bubble. This does not touch the DB;
      // the underlying conversations.messages JSON is unchanged.
      const isAssistant = m.role === 'assistant' || m.role === 'Bot'
      const isOrphan = isAssistant
        && m.review_id
        && !matchedReview
        && !m.final_sent
        && !m.manual
        && !m.delivery_status

      const renderDeliveryStatus = isOrphan ? 'uncertain' : m.delivery_status
      const renderDeliveryReason = isOrphan
        ? "Couldn't track this older reply. Status unknown."
        : m.delivery_failed_reason

      items.push({
        type: 'message', ...m,
        botMessages,
        _index: i,
        _review: matchedReview,
        delivery_status: renderDeliveryStatus,
        delivery_failed_reason: renderDeliveryReason,
        key: `msg-${i}`
      })
    })
    return items
  }

  const sortedLeads = [...leads].sort((a, b) => {
    if (sortBy === 'intent') { const order = { HIGH: 0, MEDIUM: 1, LOW: 2 }; return (order[a.lead_intent] ?? 3) - (order[b.lead_intent] ?? 3) }
    if (sortBy === 'stage') return (a.conversation_stage || '').localeCompare(b.conversation_stage || '')
    return new Date(b.last_activity || 0) - new Date(a.last_activity || 0)
  })

  // Step 11 (2026-05-03): single source of truth for filter rules.
  // Previously the same logic lived in 3 places (badge counter, list filter,
  // lead-card pill) and they drifted apart. The "Follow Ups badge says 4 but
  // the panel shows more leads" bug was caused by the badge using the old
  // last_bot_sent_at + 21h rule while the list used the post-Step-8
  // last_user_message_at + 23h rule. Both helpers below match the post-Step-8
  // semantics. Use these everywhere a filter rule is needed.
  function isTesterLead(l) {
    return String(l.customer_id).startsWith('tester_') || l.channel === 'tester'
  }
  // Step 13 (2026-05-03): For Coach helper.
  // A lead is "for coach" when conversations.for_coach = true. Set either by
  // the AI classifier (Step 16) or manually by a setter clicking the button
  // in the thread header. For-coach leads are hidden from every operational
  // tab (Pending, Needs Response, Follow Ups, Escalated, Resolved) so the
  // setter can clear those without noise. They show up in the dedicated
  // For Coach tab and in All (so search still finds them).
  function isForCoachLead(l) {
    return l.for_coach === true
  }
  function isFollowUpLead(l) {
    if (isTesterLead(l) || isForCoachLead(l) || !l.last_user_message_at) return false
    const hrs = (Date.now() - new Date(l.last_user_message_at).getTime()) / 3600000
    // Step 12 (2026-05-03): hide leads whose last message is older than
    // FOLLOW_UP_STALE_HOURS (3 days). They're functionally cold; the setter
    // has moved on. If the lead replies later, last_user_message_at updates
    // and they auto-reappear in the band. No DB writes anywhere - this is
    // purely a display filter. The IG window timer and the manual Smart
    // Follow-Up button are intentionally NOT capped this way; they serve
    // different purposes (IG 24h rule and manual logging respectively).
    return hrs >= IG_WINDOW_HOURS && hrs < FOLLOW_UP_STALE_HOURS
  }
  function isNeedsResponseLead(l) {
    return l.user_sent_last && !l.followed_up && !isTesterLead(l) && !isForCoachLead(l) && l.pending_count === 0
  }

  const filteredLeads = sortedLeads.filter(l => {
    const matchesSearch = !search || getLeadName(l).toLowerCase().includes(search.toLowerCase()) || String(l.customer_id).includes(search) || (l.username && l.username.toLowerCase().includes(search.toLowerCase().replace('@', ''))) || (l.profile_name && l.profile_name.toLowerCase().includes(search.toLowerCase()))
    const isTester = isTesterLead(l)
    const isCoach = isForCoachLead(l)
    // Step 11 (2026-05-03): rule lookups use shared helpers (see above) so the
    // badge counter and the list always agree. Pre-Step-11 there was an inline
    // IIFE here for isFollowUp and an inline expression for needsResponse; both
    // are now isFollowUpLead(l) and isNeedsResponseLead(l).
    // Step 13 (2026-05-03): For Coach tab added. for_coach leads are hidden
    // from Pending, Escalated, and Resolved (handled inline below since those
    // don't have helpers). They still appear in All so search works.
    const matchesFilter = filter === 'Test'
      ? isTester
      : isTester ? false
      : filter === 'For Coach' ? isCoach
      : filter === 'All' ? true
      : isCoach ? false
      : filter === 'Pending' ? l.pending_count > 0
      : filter === 'Needs Response' ? isNeedsResponseLead(l)
      : filter === 'Follow Ups' ? isFollowUpLead(l)
      : filter === 'Escalated' ? l.handoff_count > 0
      : filter === 'Resolved' ? l.pending_count === 0 && l.all_reviews.length > 0
      : true
    return matchesSearch && matchesFilter
  })

  const totalPending = pendingLeadCount
  const timeline = selectedLead ? buildTimeline() : []

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="inbox-wrapper">
      {toast.msg && <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>{toast.msg}</div>}

      {/* Step 13 (2026-05-03): For Coach modal.
          Renders only when coachModalOpen is true. Setter picks a category
          (required), optionally adds a comment (required if category=Other),
          clicks Confirm. Cancel and clicking the backdrop close the modal
          without saving. State resets in flagForCoach() on success. */}
      {coachModalOpen && selectedLead && (
        <div onClick={() => { setCoachModalOpen(false); setCoachModalCategory(''); setCoachModalComment('') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: '12px', padding: '20px', width: '100%', maxWidth: '440px', boxShadow: '0 20px 50px rgba(0,0,0,.3)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--tx)', marginBottom: '4px' }}>Flag for Coach</div>
              <div style={{ fontSize: '.78rem', color: 'var(--tx3)', lineHeight: 1.4 }}>
                This message is personal to Coach, not a prospect lead. The setter will skip it; Coach handles it directly. Pick the category that fits best.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '.74rem', fontWeight: 600, color: 'var(--tx2)' }}>Category</label>
              <select value={coachModalCategory} onChange={e => setCoachModalCategory(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--bdr)', background: 'var(--surf2)', color: 'var(--tx)', fontSize: '.84rem', fontFamily: 'var(--fn)', outline: 'none' }}>
                <option value="">Select a category...</option>
                {COACH_FLAG_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '.74rem', fontWeight: 600, color: 'var(--tx2)' }}>
                Comment {COACH_FLAG_CATEGORIES.find(c => c.key === coachModalCategory)?.requireComment ? <span style={{ color: '#dc2626' }}>(required)</span> : <span style={{ color: 'var(--tx3)', fontWeight: 400 }}>(optional)</span>}
              </label>
              <textarea value={coachModalComment} onChange={e => setCoachModalComment(e.target.value)}
                placeholder="Add context that would help the AI learn (optional)..."
                rows={3}
                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--bdr)', background: 'var(--surf2)', color: 'var(--tx)', fontSize: '.82rem', fontFamily: 'var(--fn)', outline: 'none', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button onClick={() => { setCoachModalOpen(false); setCoachModalCategory(''); setCoachModalComment('') }}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--bdr)', background: 'var(--surf2)', color: 'var(--tx2)', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => flagForCoach(coachModalCategory, coachModalComment)}
                disabled={!coachModalCategory}
                style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: coachModalCategory ? '#db2777' : '#fbcfe8', color: '#fff', fontSize: '.82rem', fontWeight: 600, cursor: coachModalCategory ? 'pointer' : 'not-allowed' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {FILTERS.map(f => {
              // Step 11 (2026-05-03): badge counts now use the same helpers
              // as the list filter, so they always agree. The pre-Step-11
              // counter used last_bot_sent_at + 21h here while the list used
              // last_user_message_at + 23h, which caused the badge to
              // under-count leads with an expired IG window.
              // Step 13 (2026-05-03): For Coach added. Pending/Escalated/Resolved
              // now compute from the leads array so we can apply the for_coach
              // exclusion (the old totalPending came from a Supabase query that
              // didn't know about for_coach). Counts now match the list exactly.
              // Step 15 (2026-05-03): exclude testers from Pending/Escalated/Resolved.
              // The merge in loadData() adds review-only leads with channel='tester'
              // to the leads array. The list filter excludes them via isTester
              // gate, but the badge counters didn't, so tester pending reviews
              // were being counted in the Pending badge. This made the Inbox
              // Pending count higher than the sidebar (which filters testers in
              // the Supabase query directly) and the Dashboard "Needs Reply".
              const count = f === 'For Coach' ? leads.filter(isForCoachLead).length
                : f === 'Pending' ? leads.filter(l => !isTesterLead(l) && !isForCoachLead(l) && l.pending_count > 0).length
                : f === 'Escalated' ? leads.filter(l => !isTesterLead(l) && !isForCoachLead(l)).reduce((a, l) => a + l.handoff_count, 0)
                : f === 'Needs Response' ? leads.filter(isNeedsResponseLead).length
                : f === 'Follow Ups' ? leads.filter(isFollowUpLead).length
                : f === 'Resolved' ? leads.filter(l => !isTesterLead(l) && !isForCoachLead(l) && l.pending_count === 0 && l.all_reviews.length > 0).length
                : f === 'Test' ? leads.filter(isTesterLead).length
                : null
              return (
                <button key={f} onClick={() => setFilter(f)} style={{
                  flexShrink: 0, padding: '5px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '.72rem', fontWeight: filter === f ? 600 : 400, whiteSpace: 'nowrap',
                  background: filter === f ? (f === 'Test' ? '#6b7280' : f === 'Needs Response' ? '#7c3aed' : f === 'Follow Ups' ? '#d97706' : f === 'For Coach' ? '#db2777' : 'var(--acc)') : 'var(--surf2)',
                  color: filter === f ? '#fff' : f === 'Test' ? 'var(--tx3)' : f === 'Needs Response' ? '#7c3aed' : f === 'Follow Ups' ? '#d97706' : f === 'For Coach' ? '#db2777' : 'var(--tx2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all .15s'
                }}>
                  {f}
                  {count > 0 && (
                    <span style={{
                      background: filter === f ? 'rgba(255,255,255,.3)' : f === 'Test' ? '#6b7280' : f === 'Needs Response' ? '#7c3aed' : f === 'Follow Ups' ? '#d97706' : f === 'For Coach' ? '#db2777' : '#e53e3e',
                      color: '#fff', borderRadius: '999px', fontSize: '.6rem',
                      minWidth: '14px', height: '14px', display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', padding: '0 3px'
                    }}>{count}</span>
                  )}
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
            // Step 11 (2026-05-03): use shared isFollowUpLead helper.
            // Pre-Step-11 this was an inline IIFE that duplicated the same
            // rule as the list filter and the badge counter.
            const showFollowUpPill = isFollowUpLead(lead)
            return (
              <div key={lead.customer_id} onClick={() => selectLead(lead)} style={{ padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--bdr)', background: isSelected ? 'var(--accp)' : 'transparent', borderLeft: isSelected ? '3px solid var(--acc)' : '3px solid transparent', transition: 'background .15s' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.9rem', fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: '2px' }}>{getLeadName(lead).charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: Name + intent + badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getLeadName(lead)}</span>
                      {lead.lead_intent === 'HIGH' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\uD83D\uDD34'}</span>}
                      {lead.lead_intent === 'MEDIUM' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\uD83D\uDFE1'}</span>}
                      {lead.lead_intent === 'LOW' && <span style={{ fontSize: '.75rem', flexShrink: 0 }}>{'\u26AA'}</span>}
                      {lead.handoff_count > 0 && <span style={{ fontSize: '.68rem', background: '#e53e3e', color: '#fff', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{'\uD83D\uDEA8'}</span>}
                      {lead.delivery_failed_count > 0 && <span title="One or more AI replies failed to send. Developer has been notified." style={{ fontSize: '.68rem', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: '999px', flexShrink: 0, fontWeight: 700 }}>{'\u26A0'} Not sent</span>}
                      {lead.pending_count > 0 && lead.handoff_count === 0 && <span style={{ fontSize: '.68rem', background: '#d97706', color: '#fff', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{lead.pending_count}</span>}
                      {showFollowUpPill && <span style={{ fontSize: '.68rem', background: '#fff7ed', color: '#d97706', border: '1px solid #fed7aa', padding: '1px 5px', borderRadius: '999px', flexShrink: 0 }}>{'\u23F0'} Follow up</span>}
                      {/* Step 13 (2026-05-03): For Coach pill on lead card.
                          Helps the setter recognize at a glance which leads in
                          the All view are routed to Coach. */}
                      {isForCoachLead(lead) && <span style={{ fontSize: '.68rem', background: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8', padding: '1px 5px', borderRadius: '999px', flexShrink: 0, fontWeight: 600 }}>{'\u2606'} Coach</span>}
                      {lead.re_engaged && <span style={{ fontSize: '.68rem', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '999px', flexShrink: 0, fontWeight: 600 }}>{'\u21BB'} Re-engaged</span>}
                      {/* Step 8 (2026-05-03): IG window timer.
                          Shows on any lead with a last_user_message_at, once
                          21+ hours have passed since the lead sent it. Drops
                          the user_sent_last requirement - per Meta's rule,
                          bot replies do NOT extend the window. The window
                          counts down from the lead's last message regardless.
                          Stays hidden under 21h to avoid noise on fresh
                          conversations. Expires at IG_WINDOW_HOURS (23h). */}
                      {lead.last_user_message_at && (() => {
                        const hrsSinceLeadMsg = (Date.now() - new Date(lead.last_user_message_at).getTime()) / 3600000
                        if (hrsSinceLeadMsg < FOLLOW_UP_HOURS) return null
                        const msLeft = (new Date(lead.last_user_message_at).getTime() + IG_WINDOW_HOURS * 3600000) - Date.now()
                        if (msLeft <= 0) return <span style={{ fontSize: '.65rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{'\u26A0'} Window expired</span>
                        const hrsLeft = Math.floor(msLeft / 3600000)
                        const minsLeft = Math.floor((msLeft % 3600000) / 60000)
                        return <span style={{ fontSize: '.65rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: '999px', flexShrink: 0 }}>{'\u23F1'} {hrsLeft}h {minsLeft}m left</span>
                      })()}
                    </div>
                    {/* Row 2: Conversation stage */}
                    <div style={{ fontSize: '.7rem', color: 'var(--acc)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.conversation_stage || '\u00A0'}
                    </div>
                    {/* Row 3: Latest message preview */}
                    <div style={{ fontSize: '.76rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '3px' }}>
                      {lead.latest_preview || 'No messages yet'}
                    </div>
                  </div>
                  <div style={{ fontSize: '.68rem', color: 'var(--tx3)', flexShrink: 0, marginTop: '4px' }}>{fmtTime(lead.last_activity)}</div>
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
                    {intentEmoji(selectedLead.lead_intent, selectedLead.conversation_stage)} {selectedLead.conversation_stage === 'BOOKED' ? 'Booked' : selectedLead.lead_intent}
                  </span>
                )}
                {conversation?.status !== 'booked' ? (
                  <button onClick={markAsBooked} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#16a34a', fontWeight: 600 }}>{'\u2705'} Mark Booked</button>
                ) : (
                  <button onClick={unmarkBooked} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#16a34a', fontWeight: 600, opacity: 0.8 }}>{'\u2705'} Booked</button>
                )}
                {/* Step 13 (2026-05-03): For Coach button.
                    When not flagged, opens the category modal. When flagged,
                    confirms an unflag. Hidden for testers - test leads never
                    need to be routed to Coach. */}
                {!isTesterLead(selectedLead) && (
                  conversation?.for_coach || selectedLead.for_coach ? (
                    <button onClick={unflagFromCoach} title="Lead is currently in the For Coach tab. Click to move back."
                      style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#db2777', fontWeight: 600 }}>{'\u2606'} For Coach</button>
                  ) : (
                    <button onClick={() => setCoachModalOpen(true)} title="Flag this lead as personal-to-Coach. Setter won't reply; Coach will."
                      style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#db2777', fontWeight: 600 }}>{'\u2606'} For Coach</button>
                  )
                )}
                {/* Step 8 (2026-05-03): Smart Follow-Up button visibility simplified.
                    Previously: shown on Follow Ups tab OR window expired OR lead had
                    the "Follow up" badge. With the redefined semantics, all three
                    conditions collapse into a single rule: show when the lead's
                    window has expired (last_user_message_at 23h+). The button
                    remains hidden for booked, pending-review, or test leads. */}
                {(() => {
                  // Hard exclusions - button never shows for these
                  const isTester = String(selectedLead.customer_id).startsWith('tester_') || selectedLead.channel === 'tester'
                  const isBooked = conversation?.status === 'booked' || selectedLead.status === 'booked'
                  const hasPending = selectedLead.pending_count > 0
                  if (isTester || isBooked || hasPending) return null

                  // Single condition: lead's IG window has expired
                  // (last_user_message_at is 23h+ old). This matches the Follow Ups
                  // tab filter and the lead-list "Follow up" badge.
                  const windowExpired = selectedLead.last_user_message_at
                    && (Date.now() - new Date(selectedLead.last_user_message_at).getTime()) >= IG_WINDOW_HOURS * 3600000

                  if (!windowExpired) return null

                  const count = conversation?.followup_count ?? selectedLead.followup_count ?? 0
                  if (count === 0) {
                    return <button onClick={markAsFollowedUp} title="Click after you send the lead a follow-up DM"
                      style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#7c3aed', fontWeight: 600 }}>{'\u2709'} Mark Follow-Up</button>
                  }
                  if (count === 1) {
                    return <button onClick={markAsFollowedUp} title="Click after you send a 2nd follow-up. At 2+ the lead is removed from Closest to Booking."
                      style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#7c3aed', fontWeight: 600 }}>{'\u2709'} Follow-Up (1/2)</button>
                  }
                  return <button onClick={unmarkFollowedUp} title="Lead is now off the Closest to Booking list until they reply. Click to reset count."
                    style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '.72rem', color: '#92400e', fontWeight: 600 }}>{'\u2709'} Follow-Up ({count}/2) {'\u2022'} Off Priority</button>
                })()}
                {/* Step 8 (2026-05-03): IG window timer in header.
                    Same logic as lead list badge: based on last_user_message_at
                    only (bot replies don't extend the window per Meta's rule). */}
                {selectedLead.last_user_message_at && (() => {
                  const hrsSinceLeadMsg = (Date.now() - new Date(selectedLead.last_user_message_at).getTime()) / 3600000
                  if (hrsSinceLeadMsg < FOLLOW_UP_HOURS) return null
                  const msLeft = (new Date(selectedLead.last_user_message_at).getTime() + IG_WINDOW_HOURS * 3600000) - Date.now()
                  if (msLeft <= 0) return <span style={{ fontSize: '.68rem', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{'\u26A0'} IG window expired - use Business Suite</span>
                  const hrsLeft = Math.floor(msLeft / 3600000)
                  const minsLeft = Math.floor((msLeft % 3600000) / 60000)
                  return <span style={{ fontSize: '.68rem', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{'\u23F1'} {hrsLeft}h {minsLeft}m left to respond</span>
                })()}
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
                    // Step 7 (2026-05-03): keyword/comment engagement banner.
                    // Centered pill, distinct from chat bubbles. Shows the lead source
                    // and the time the event was recorded.
                    if (item.type === 'lead_source_event') return (
                      <div key={item.key} style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                        <div
                          title={item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: '#fef3c7',
                            border: '1px solid #fde68a',
                            color: '#92400e',
                            fontSize: '.74rem',
                            fontWeight: 600,
                            padding: '6px 14px',
                            borderRadius: '999px',
                            maxWidth: 'min(80%, 480px)'
                          }}
                        >
                          <span>{'\uD83E\uDE9D'}</span>
                          <span>{item.display_text}</span>
                          {item.timestamp && (
                            <span style={{ fontWeight: 400, color: '#a16207' }}>{'\u00B7'} {fmtMessageTime(item.timestamp)}</span>
                          )}
                        </div>
                      </div>
                    )
                    const isLead = item.role === 'user' || item.role === 'Lead'
                    const isManual = item.manual === true
                    const review = item._review
                    const isPending = review?.status === 'pending'
                    const isActive = activeReview?.id === review?.id
                    const isSent = review && (review.status === 'approved' || review.status === 'edited' || review.status === 'auto_sent')
                    const isDiscarded = review?.status === 'discarded'
                    // For sent reviews show final delivered text; for pending show draft; fallback to message content
                    const botMessages = isLead ? null
                      : isSent ? (Array.isArray(review.final_messages) && review.final_messages.length > 0 ? review.final_messages : review.final_reply ? [review.final_reply] : (item.botMessages || [item.content]))
                      : (item.botMessages || [item.content])
                    const showMultiple = !isLead && botMessages && botMessages.length > 1
                    return (
                      <div key={item.key} style={{ display: 'flex', flexDirection: 'column', alignItems: isLead ? 'flex-start' : 'flex-end', marginBottom: '6px' }}>
                        <div style={{ maxWidth: 'min(80%, 560px)', display: 'flex', flexDirection: 'column', alignItems: isLead ? 'flex-start' : 'flex-end', gap: showMultiple ? '4px' : 0 }}>
                          {isLead && (
                            <div style={{ padding: '9px 13px', borderRadius: '2px 16px 16px 16px', fontSize: '.84rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#fff', color: 'var(--tx)', border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}>{item.content}</div>
                          )}
                          {/* AI suggested — small button below lead's last message, opens review panel on click */}
                          {isLead && (() => {
                            // Find the next assistant message after this lead message
                            // and check if its review is pending
                            const timelineItems = timeline.filter(t => t.type === 'message')
                            const thisIdx = timelineItems.findIndex(t => t.key === item.key)
                            const nextItem = timelineItems[thisIdx + 1]
                            // The next item should be an assistant message with a pending review
                            if (!nextItem || nextItem.role === 'user' || nextItem.role === 'Lead') {
                              // No assistant reply follows this lead message
                              // Check if there's ANY pending review for the last lead message (no bot reply yet in timeline)
                              const isLastMessage = thisIdx === timelineItems.length - 1
                              if (isLastMessage) {
                                // This is the very last message in the thread - find the most recent pending review
                                const latestPending = [...reviews].reverse().find(r => r.status === 'pending')
                                if (latestPending) {
                                  return (
                                    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                                      <button
                                        onClick={() => { setActiveReview(latestPending); setReplyMessages(getReviewMessages(latestPending)) }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: 'var(--accl)', color: 'var(--accm)', border: '1px solid var(--acc)', borderRadius: '999px', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--acc)'; e.currentTarget.style.color = '#fff' }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--accl)'; e.currentTarget.style.color = 'var(--accm)' }}
                                      >
                                        {'\uD83E\uDD16'} AI Reply Ready — Review
                                      </button>
                                    </div>
                                  )
                                }
                              }
                              return null
                            }
                            // Next item is an assistant message - check if its review is pending
                            const matchedReview = nextItem._review
                            if (!matchedReview || matchedReview.status !== 'pending') return null
                            return (
                              <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => { setActiveReview(matchedReview); setReplyMessages(getReviewMessages(matchedReview)) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: 'var(--accl)', color: 'var(--accm)', border: '1px solid var(--acc)', borderRadius: '999px', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--acc)'; e.currentTarget.style.color = '#fff' }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--accl)'; e.currentTarget.style.color = 'var(--accm)' }}
                                >
                                  {'\uD83E\uDD16'} AI Reply Ready — Review
                                </button>
                              </div>
                            )
                          })()}
                          {/* Pending bot bubble — hidden from thread (shown only in sidebar via the button above) */}
                          {/* Step 2 (2026-04-30): if delivery failed, render a red "AI reply was not sent" banner instead of the bubble */}
                          {!isLead && !isPending && item.delivery_status === 'failed' && (
                            <div style={{ background: '#fef2f2', border: '1px dashed #fca5a5', borderRadius: '10px', padding: '10px 14px', maxWidth: 'min(80%, 560px)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '.78rem' }}>{'\u26A0\uFE0F'}</span>
                                <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#b91c1c' }}>AI reply was not sent</span>
                              </div>
                              <div style={{ fontSize: '.74rem', color: '#7f1d1d', lineHeight: 1.5 }}>
                                {item.delivery_failed_reason || 'Delivery failed. Developer has been notified.'}
                              </div>
                            </div>
                          )}
                          {/* Step 3 (2026-04-30): if review tracking failed (DB insert exhausted retries), show yellow "uncertain" banner */}
                          {!isLead && !isPending && item.delivery_status === 'uncertain' && (
                            <div style={{ background: '#fffbeb', border: '1px dashed #fcd34d', borderRadius: '10px', padding: '10px 14px', maxWidth: 'min(80%, 560px)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '.78rem' }}>{'\u26A0\uFE0F'}</span>
                                <span style={{ fontSize: '.78rem', fontWeight: 700, color: '#92400e' }}>AI reply tracking uncertain</span>
                              </div>
                              <div style={{ fontSize: '.74rem', color: '#78350f', lineHeight: 1.5 }}>
                                {item.delivery_failed_reason || "Couldn't track this reply. Developer has been notified."}
                              </div>
                            </div>
                          )}
                          {!isLead && !isPending && item.delivery_status !== 'failed' && item.delivery_status !== 'uncertain' && botMessages.map((bubble, bi) => (
                            <div key={bi} onClick={() => null}
                              style={{ padding: '9px 13px', borderRadius: '16px 2px 16px 16px', fontSize: '.84rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: isDiscarded ? 'var(--surf2)' : isManual ? '#e8f0fe' : 'var(--acc)', color: isDiscarded ? 'var(--tx3)' : isManual ? '#1a3a8f' : '#e8f7ed', border: isActive ? '2px solid var(--acc)' : isDiscarded ? '1px dashed var(--bdr)' : isManual ? '1px solid #c7d7fc' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,.08)', cursor: 'default', transition: 'all .15s', opacity: isDiscarded ? 0.5 : 1, textDecoration: isDiscarded ? 'line-through' : 'none' }}>
                              {bubble}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', padding: '0 2px' }}>
                          <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }} title={item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}>{item.timestamp ? fmtMessageTime(item.timestamp) : ''}</span>
                          {!isLead && isManual && <span style={{ fontSize: '.65rem', color: '#1a3a8f', fontWeight: 600, background: '#e8f0fe', border: '1px solid #c7d7fc', padding: '1px 6px', borderRadius: '999px' }}>{'\u270F\uFE0F'} Manual</span>}
                          {!isLead && !isManual && isSent && review?.status === 'auto_sent' && <span style={{ fontSize: '.65rem', color: '#5b21b6', fontWeight: 600, background: '#ede9fe', border: '1px solid #ddd6fe', padding: '1px 6px', borderRadius: '999px' }}>{'\uD83E\uDD16'} AI · Auto-sent</span>}
                          {!isLead && !isManual && isSent && review?.status === 'edited' && <span style={{ fontSize: '.65rem', color: '#9a3412', fontWeight: 600, background: '#ffedd5', border: '1px solid #fed7aa', padding: '1px 6px', borderRadius: '999px' }}>{'\uD83E\uDD16'} AI · Edited</span>}
                          {!isLead && !isManual && isSent && review?.status === 'approved' && <span style={{ fontSize: '.65rem', color: '#15803d', fontWeight: 600, background: '#dcfce7', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '999px' }}>{'\uD83E\uDD16'} AI · Approved</span>}
                          {!isLead && isManual && <span style={{ fontSize: '.65rem', color: 'var(--acc)', fontWeight: 600 }}>{'\u2713\u2713'} Sent</span>}
                          {!isLead && !isManual && botMessages && botMessages.length > 1 && <span style={{ fontSize: '.65rem', color: 'var(--blu)' }}>{botMessages.length} msgs</span>}
                          {!isLead && !isManual && isSent && <span style={{ fontSize: '.65rem', color: 'var(--acc)', fontWeight: 600 }}>{'\u2713\u2713'} Sent</span>}
                          {!isLead && review?.status === 'discarded' && <span style={{ fontSize: '.65rem', color: 'var(--tx3)' }}>{'\u2715'} Discarded</span>}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={msgEndRef} />
                </div>

                {/* Manual Reply Input - only visible when the user is on the Follow Ups tab.
                    For active prospects, setters should use the AI approve path
                    so the learning system captures their corrections. Manual
                    replies bypass that, which is appropriate for follow-up
                    chasing where the AI may not generate the right tone. */}
                {filter === 'Follow Ups' && (
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--bdr)', background: 'var(--surf)', display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0 }}>
                    <textarea
                      ref={manualInputRef}
                      value={manualReply}
                      onChange={e => {
                        setManualReply(e.target.value)
                        const el = e.target
                        el.style.height = 'auto'
                        el.style.height = Math.min(el.scrollHeight, 120) + 'px'
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendManualReply()
                          if (manualInputRef.current) manualInputRef.current.style.height = 'auto'
                        }
                      }}
                      placeholder="Type a manual reply..."
                      disabled={manualSending}
                      rows={1}
                      style={{ flex: 1, padding: '10px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '12px', fontSize: '.84rem', color: 'var(--tx)', outline: 'none', fontFamily: 'var(--fn)', boxSizing: 'border-box', opacity: manualSending ? .6 : 1, resize: 'none', lineHeight: 1.5, maxHeight: '120px', overflowY: 'auto' }}
                    />
                    <button
                      onClick={() => { sendManualReply(); if (manualInputRef.current) manualInputRef.current.style.height = 'auto' }}
                      disabled={!manualReply.trim() || manualSending}
                      style={{ padding: '10px 18px', background: manualReply.trim() && !manualSending ? 'var(--acc)' : 'var(--surf2)', border: 'none', borderRadius: '12px', cursor: manualReply.trim() && !manualSending ? 'pointer' : 'default', fontSize: '.84rem', color: manualReply.trim() && !manualSending ? '#fff' : 'var(--tx3)', fontWeight: 600, transition: 'all .15s', flexShrink: 0 }}
                    >{manualSending ? 'Sending...' : 'Send'}</button>
                  </div>
                )}
              </div>

              {/* RIGHT: AI Assistant Panel (only when pending review exists) */}
              {activeReview && (
                <div className="ai-panel">
                  <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Panel Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--tx)' }}>AI Assistant</div>
                      <button onClick={() => { setActiveReview(null); activeReviewRef.current = null; setReplyMessages([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '1rem' }}>{'\u2715'}</button>
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

                    {/* AI Progress */}
                    {aiProgress && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                        {/* Notice — Learning/Improving = orange warning, Trusted/Auto-Ready = green */}
                        {(aiProgress.progressStage === 'Learning' || aiProgress.progressStage === 'Improving') ? (
                          <div style={{ background: '#fff7ed', borderLeft: '3px solid #f97316', borderRadius: '0 8px 8px 0', padding: '9px 12px', border: '1px solid #fed7aa', borderLeft: '3px solid #f97316' }}>
                            <div style={{ fontSize: '.76rem', fontWeight: 600, color: '#9a3412', marginBottom: '2px' }}>AI is still learning — review all replies</div>
                            <div style={{ fontSize: '.71rem', color: '#c2410c', lineHeight: 1.5 }}>The AI needs 66% approval rate before its replies can be trusted. Currently at {aiProgress.approvalRate}%. Correct anything that doesn't sound right.</div>
                          </div>
                        ) : (
                          <div style={{ background: '#f0fdf4', borderLeft: '3px solid #16a34a', borderRadius: '0 8px 8px 0', padding: '9px 12px', border: '1px solid #bbf7d0', borderLeft: '3px solid #16a34a' }}>
                            <div style={{ fontSize: '.76rem', fontWeight: 600, color: '#15803d', marginBottom: '2px' }}>✓ AI is performing well</div>
                            <div style={{ fontSize: '.71rem', color: '#166534', lineHeight: 1.5 }}>{aiProgress.approvalRate}% approval rate — {aiProgress.progressStage}. Replies are reliable but always worth a quick check.</div>
                          </div>
                        )}

                        {/* Progress bar */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '.72rem', fontWeight: 600, padding: '1px 8px', borderRadius: '999px',
                              background: aiProgress.progressStage === 'Auto-Ready' || aiProgress.progressStage === 'Trusted' ? '#f0fdf4' : aiProgress.progressStage === 'Improving' ? '#faeeda' : '#e6f1fb',
                              color: aiProgress.progressStage === 'Auto-Ready' || aiProgress.progressStage === 'Trusted' ? '#15803d' : aiProgress.progressStage === 'Improving' ? '#854f0b' : '#185fa5'
                            }}>{aiProgress.progressStage}</span>
                            <span style={{ fontSize: '.71rem', color: 'var(--tx3)' }}>{aiProgress.approvalRate}% approval</span>
                          </div>
                          <div style={{ height: '5px', background: 'var(--surf3)', borderRadius: '100px', overflow: 'hidden', border: '1px solid var(--bdr)' }}>
                            <div style={{ height: '100%', borderRadius: '100px', transition: 'width 1s ease',
                              width: `${aiProgress.progressPct}%`,
                              background: aiProgress.progressStage === 'Auto-Ready' ? '#16a34a' : aiProgress.progressStage === 'Trusted' ? '#2d6a4f' : aiProgress.progressStage === 'Improving' ? '#d97706' : '#378add'
                            }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            {['Learning', 'Improving', 'Trusted', 'Auto-Ready'].map(s => (
                              <span key={s} style={{ fontSize: '.62rem', color: aiProgress.progressStage === s ? 'var(--acc)' : 'var(--tx3)', fontWeight: aiProgress.progressStage === s ? 700 : 400 }}>{s}</span>
                            ))}
                          </div>
                        </div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>Suggested Reply</div>
                        <span style={{ fontSize: '.68rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 7px', borderRadius: '999px', fontWeight: 600 }}>AI Draft</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                        {replyMessages.map((msg, idx) => (
                          <div key={idx} style={{ position: 'relative' }}>
                            <textarea
                              value={msg}
                              onChange={e => updateReplyMessage(idx, e.target.value)}
                              rows={3}
                              style={{ width: '100%', background: '#fffdf0', border: '1px solid #fde68a', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '8px 30px 8px 10px', borderRadius: '8px', resize: 'vertical', outline: 'none', lineHeight: 1.55, boxSizing: 'border-box' }}
                              onFocus={e => { e.target.style.borderColor = '#d97706'; e.target.style.background = '#fffbeb' }}
                              onBlur={e => { e.target.style.borderColor = '#fde68a'; e.target.style.background = '#fffdf0' }}
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

                    {/* Editable username */}
                    {editingUsername ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                        <input
                          value={usernameInput}
                          onChange={e => setUsernameInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveUsername(); if (e.key === 'Escape') setEditingUsername(false) }}
                          autoFocus
                          placeholder="Enter username..."
                          style={{ flex: 1, padding: '5px 8px', border: '1.5px solid var(--acc)', borderRadius: '8px', fontSize: '.8rem', fontFamily: 'var(--fn)', color: 'var(--tx)', background: 'var(--surf2)', outline: 'none' }}
                        />
                        <button onClick={saveUsername} style={{ padding: '5px 10px', background: 'var(--acc)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: '#fff', fontWeight: 600 }}>Save</button>
                        <button onClick={() => setEditingUsername(false)} style={{ padding: '5px 8px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: 'var(--tx3)' }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ fontSize: '.82rem', color: 'var(--tx3)', textAlign: 'center' }}>
                          {selectedLead.username ? `@${selectedLead.username}` : <span style={{ color: 'var(--tx3)', fontStyle: 'italic' }}>No username</span>}
                        </div>
                        <button onClick={() => { setUsernameInput(selectedLead.username || ''); setEditingUsername(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx3)', fontSize: '.72rem', padding: '2px 5px', borderRadius: '4px' }} title="Edit username">✏</button>
                      </div>
                    )}

                    {selectedLead.username && (selectedLead.channel === 'manychat' || (selectedLead.channel || '').toLowerCase().includes('instagram') || (selectedLead.channel || '').toLowerCase() === 'ig') && (
                      <a href={`https://www.instagram.com/${selectedLead.username.replace('@','')}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.75rem', color: '#e1306c', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '999px', background: '#fff0f5', border: '1px solid #f9c0d0' }}>
                        <span>{'\uD83D\uDCF8'}</span> View Instagram
                      </a>
                    )}
                    {/* Lead ID — always visible so setter can identify leads without usernames */}
                    <div style={{ fontSize: '.68rem', color: 'var(--tx3)', background: 'var(--surf2)', border: '1px solid var(--bdr)', padding: '2px 8px', borderRadius: '999px', fontFamily: 'monospace' }}>ID: {selectedLead.customer_id}</div>
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
