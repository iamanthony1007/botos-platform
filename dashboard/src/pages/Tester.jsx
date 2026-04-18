import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const WORKER_URL = 'https://sales-bot.nellakuate.workers.dev'

const STAGES = [
  'HOOK / ENTRY',
  'GOAL',
  'DIAGNOSTIC',
  'INSIGHT',
  'PRIORITY',
  'DECISION',
  'INVITE',
  'SCHEDULE',
  'BOOKED',
  'FOLLOW-UP'
]

function calcTypingDelay(text) {
  if (!text) return 1500
  const charCount = text.length
  const baseDelay = 1200
  const typingTime = charCount * 50
  const variation = (Math.random() - 0.5) * 800
  const total = baseDelay + typingTime + variation
  return Math.max(1500, Math.min(8000, Math.round(total)))
}

// ─── Library Panel ────────────────────────────────────────────────────────────
function LibraryPanel({ botId, onSelectConversation, onClose }) {
  const [examples, setExamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')       // all | booked | not_booked
  const [sort, setSort] = useState('messages_desc') // messages_desc | messages_asc | name
  const [search, setSearch] = useState('')

  useEffect(() => { loadExamples() }, [botId])

  async function loadExamples() {
    setLoading(true)
    const { data, error } = await supabase
      .from('conversation_examples')
      .select('id, contact_name, outcome, total_messages, lead_messages, coach_messages, has_zoom, has_booking, has_screening, turns')
      .eq('bot_id', botId)
      .order('total_messages', { ascending: false })
      .limit(648)

    if (!error) setExamples(data || [])
    setLoading(false)
  }

  const filtered = examples
    .filter(e => filter === 'all' || e.outcome === filter)
    .filter(e => !search || e.contact_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'messages_desc') return b.total_messages - a.total_messages
      if (sort === 'messages_asc') return a.total_messages - b.total_messages
      return a.contact_name.localeCompare(b.contact_name)
    })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surf)', borderRadius: 'var(--rlg)',
        width: '92%', maxWidth: 860, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--tx)' }}>📚 Conversation Library</div>
            <div style={{ fontSize: '.75rem', color: 'var(--tx3)', marginTop: 2 }}>
              {examples.length} real conversations · Click one to replay it in the simulator
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--tx3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Filters */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name..."
            style={{ flex: 1, minWidth: 160, background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.84rem', padding: '7px 10px', borderRadius: 'var(--rsm)', outline: 'none' }}
          />
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '7px 10px', borderRadius: 'var(--rsm)', outline: 'none' }}>
            <option value="all">All outcomes</option>
            <option value="booked">✅ Booked leads</option>
            <option value="not_booked">❌ Not booked</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '7px 10px', borderRadius: 'var(--rsm)', outline: 'none' }}>
            <option value="messages_desc">Most messages first</option>
            <option value="messages_asc">Fewest messages first</option>
            <option value="name">Name A–Z</option>
          </select>
          <span style={{ fontSize: '.75rem', color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{filtered.length} shown</span>
        </div>

        {/* Stats bar */}
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--bdr)', background: 'var(--surf2)', display: 'flex', gap: 20 }}>
          {[
            { label: 'Booked', val: examples.filter(e => e.outcome === 'booked').length, color: 'var(--acc)' },
            { label: 'Not Booked', val: examples.filter(e => e.outcome === 'not_booked').length, color: '#6b7280' },
            { label: 'Has Zoom mention', val: examples.filter(e => e.has_zoom).length, color: 'var(--blu)' },
            { label: 'Has Screening', val: examples.filter(e => e.has_screening).length, color: '#d97706' },
          ].map(s => (
            <div key={s.label} style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>
              <span style={{ fontWeight: 700, color: s.color }}>{s.val}</span> {s.label}
            </div>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--tx3)', fontSize: '.85rem' }}>Loading conversations...</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--tx3)', fontSize: '.85rem' }}>
              No conversations found. Make sure the conversation_examples table has been populated.
            </div>
          )}
          {filtered.map(ex => (
            <div
              key={ex.id}
              onClick={() => onSelectConversation(ex)}
              style={{
                padding: '11px 14px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                transition: 'all .15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accl)'; e.currentTarget.style.borderColor = 'var(--acc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surf)'; e.currentTarget.style.borderColor = 'var(--bdr)' }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: ex.outcome === 'booked' ? 'var(--accl)' : 'var(--surf2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem'
              }}>
                {ex.outcome === 'booked' ? '✅' : '❌'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.87rem', fontWeight: 600, color: 'var(--tx)', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ex.contact_name}
                </div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: 1 }}>
                  {ex.total_messages} messages · {ex.lead_messages} from lead · {ex.coach_messages} from coach
                  {ex.has_zoom && ' · 📹 Zoom'}
                  {ex.has_screening && ' · 🔍 Screening'}
                </div>
              </div>
              <div style={{ fontSize: '.75rem', color: 'var(--acc)', fontWeight: 600, flexShrink: 0 }}>
                Replay →
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Tester ─────────────────────────────────────────────────────────────
export default function Tester() {
  const { profile, can } = useAuth()
  const canEdit = can('bot_tester_edit')

  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('tester_messages')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return []
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [bot, setBot] = useState(null)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)
  const [customerId, setCustomerId] = useState(() => {
    try {
      const saved = localStorage.getItem('tester_customer_id')
      if (saved) return saved
      const newId = 'tester_' + Math.random().toString(36).substr(2, 9)
      localStorage.setItem('tester_customer_id', newId)
      return newId
    } catch { return 'tester_' + Math.random().toString(36).substr(2, 9) }
  })
  const [isTyping, setIsTyping] = useState(false)
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef(null)

  // Library state
  const [showLibrary, setShowLibrary] = useState(false)

  // Replay state — persisted to localStorage so navigation away does not reset it
  const [replayMode, setReplayMode] = useState(() => {
    try { return localStorage.getItem('tester_replay_mode') === 'true' } catch { return false }
  })
  const [replayConversation, setReplayConversation] = useState(() => {
    try {
      const saved = localStorage.getItem('tester_replay_conversation')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [replayIndex, setReplayIndex] = useState(() => {
    try { return parseInt(localStorage.getItem('tester_replay_index') || '0', 10) } catch { return 0 }
  })
  const [replayPaused, setReplayPaused] = useState(false)

  useEffect(() => { loadBot() }, [profile])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isTyping])

  // Persist messages
  useEffect(() => {
    if (messages.length === 0) return
    try { localStorage.setItem('tester_messages', JSON.stringify(messages)) } catch {}
  }, [messages])

  // Persist replay state whenever it changes
  useEffect(() => {
    try { localStorage.setItem('tester_replay_mode', replayMode ? 'true' : 'false') } catch {}
  }, [replayMode])
  useEffect(() => {
    try {
      if (replayConversation) localStorage.setItem('tester_replay_conversation', JSON.stringify(replayConversation))
      else localStorage.removeItem('tester_replay_conversation')
    } catch {}
  }, [replayConversation])
  useEffect(() => {
    try { localStorage.setItem('tester_replay_index', String(replayIndex)) } catch {}
  }, [replayIndex])

  async function loadBot() {
    if (!profile) return
    const data = await getAssignedBot(profile)
    if (data) setBot(data)
    setMessages(prev => {
      if (prev.length > 0) return prev
      return [{
        role: 'assistant',
        botMessages: ["G'day mate. How long have you been playing golf for?"],
        stage: 'Entry & Context',
        intent: 'LOW',
        conf: 92,
        editable: false,
        editMessages: ["G'day mate. How long have you been playing golf for?"]
      }]
    })
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Normal send ──────────────────────────────────────────────────────────
  async function send() {
    if (!input.trim() || loading || !bot || isTyping) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    try {
      const workerUrl = bot.webhook_url || `${WORKER_URL}/webhook`
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, message: userMsg, channel: 'tester' })
      })
      const data = await res.json()

      let botMsgs = []
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        botMsgs = data.messages.filter(m => m && m.trim())
      } else if (data.bot_reply && data.bot_reply.trim()) {
        botMsgs = [data.bot_reply]
      } else if (data.reply && data.reply.trim()) {
        botMsgs = [data.reply]
      }
      if (botMsgs.length === 0) botMsgs = ['No reply received']

      setLoading(false)

      const tempId = Date.now()
      setMessages(prev => [...prev, {
        role: 'assistant',
        botMessages: [],
        stage: data.conversation_stage || 'Unknown',
        intent: data.lead_intent || 'LOW',
        conf: Math.round((data.confidence || 0) * 100),
        reviewId: data.review_id,
        originalMessages: [...botMsgs],
        editable: true,
        editMessages: [...botMsgs],
        _tempId: tempId
      }])

      for (let i = 0; i < botMsgs.length; i++) {
        setIsTyping(true)
        await new Promise(resolve => setTimeout(resolve, calcTypingDelay(botMsgs[i])))
        setMessages(prev => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (updated[lastIdx]?._tempId === tempId) {
            updated[lastIdx] = { ...updated[lastIdx], botMessages: [...updated[lastIdx].botMessages, botMsgs[i]] }
          }
          return updated
        })
        setIsTyping(false)
        if (i < botMsgs.length - 1) await new Promise(resolve => setTimeout(resolve, 300))
      }

    } catch (e) {
      console.error('Bot error:', e)
      setLoading(false)
      setIsTyping(false)
      setMessages(prev => [...prev, {
        role: 'assistant',
        botMessages: ['Error connecting to bot. Check the webhook URL in Settings.'],
        stage: 'Error', intent: 'LOW', conf: 0, editable: false, editMessages: []
      }])
    }
  }

  // ── Replay mode ──────────────────────────────────────────────────────────
  function startReplay(example) {
    setShowLibrary(false)
    setReplayMode(true)
    setReplayConversation(example)
    setReplayIndex(0)
    setReplayPaused(false)

    // Reset chat with info card
    const newCid = 'tester_' + Math.random().toString(36).substr(2, 9)
    setCustomerId(newCid)
    localStorage.setItem('tester_customer_id', newCid)

    setMessages([{
      role: 'system_info',
      text: `📖 Replaying real conversation with "${example.contact_name}" · ${example.total_messages} messages · ${example.outcome === 'booked' ? '✅ This lead BOOKED a call' : '❌ This lead did NOT book'}`
    }])
  }

  function exitReplay() {
    setReplayMode(false)
    setReplayConversation(null)
    setReplayIndex(0)
    setReplayPaused(false)
    try {
      localStorage.removeItem('tester_replay_mode')
      localStorage.removeItem('tester_replay_conversation')
      localStorage.removeItem('tester_replay_index')
    } catch {}
  }

  // Send the next turn from the replay conversation
  async function replayNextTurn() {
    if (!replayConversation || replayPaused) return
    const turns = replayConversation.turns
    if (replayIndex >= turns.length) return

    const turn = turns[replayIndex]
    setReplayIndex(prev => prev + 1)

    if (turn.speaker === 'Lead') {
      // Show lead message, then send to bot to get its reply
      setMessages(prev => [...prev, { role: 'user', text: turn.text, replayReal: true }])
      setLoading(true)
      setReplayPaused(true) // pause until bot responds

      try {
        const workerUrl = (bot?.webhook_url) || `${WORKER_URL}/webhook`
        const res = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_id: customerId, message: turn.text, channel: 'tester' })
        })
        const data = await res.json()

        let botMsgs = []
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          botMsgs = data.messages.filter(m => m && m.trim())
        } else if (data.bot_reply) {
          botMsgs = [data.bot_reply]
        }
        if (botMsgs.length === 0) botMsgs = ['(No reply)']

        // Find what Coach Shaun actually said next (skip system messages)
        let realNextIdx = replayIndex
        while (realNextIdx < turns.length && turns[realNextIdx].speaker !== 'Coach Shaun') realNextIdx++
        const realReply = realNextIdx < turns.length ? turns[realNextIdx].text : null

        setLoading(false)
        const tempId = Date.now()

        setMessages(prev => [...prev, {
          role: 'assistant',
          botMessages: [],
          stage: data.conversation_stage || 'Unknown',
          intent: data.lead_intent || 'LOW',
          conf: Math.round((data.confidence || 0) * 100),
          reviewId: data.review_id,
          originalMessages: [...botMsgs],
          editable: true,
          editMessages: [...botMsgs],
          realReply,       // what coach shaun actually said — shown below bot reply
          _tempId: tempId
        }])

        for (let i = 0; i < botMsgs.length; i++) {
          setIsTyping(true)
          await new Promise(resolve => setTimeout(resolve, calcTypingDelay(botMsgs[i])))
          setMessages(prev => {
            const updated = [...prev]
            const lastIdx = updated.length - 1
            if (updated[lastIdx]?._tempId === tempId) {
              updated[lastIdx] = { ...updated[lastIdx], botMessages: [...updated[lastIdx].botMessages, botMsgs[i]] }
            }
            return updated
          })
          setIsTyping(false)
          if (i < botMsgs.length - 1) await new Promise(resolve => setTimeout(resolve, 300))
        }

        setReplayPaused(false)

      } catch (e) {
        console.error('Replay error:', e)
        setLoading(false)
        setIsTyping(false)
        setReplayPaused(false)
      }

    } else {
      // Coach Shaun turn — skip in replay (we already show the bot's version)
      // Just advance index until we hit the next Lead turn
      let nextIdx = replayIndex
      while (nextIdx < turns.length && turns[nextIdx].speaker !== 'Lead') nextIdx++
      setReplayIndex(nextIdx)
    }
  }

  const replayTurns = replayConversation?.turns || []
  const replayDone = replayIndex >= replayTurns.length
  const nextTurn = !replayDone ? replayTurns[replayIndex] : null

  // ── Edit & Train modal ───────────────────────────────────────────────────
  function openTrainModal(msgIdx) {
    const msg = messages[msgIdx]
    setModal({
      msgIdx,
      originalMessages: msg.originalMessages || msg.editMessages || [],
      editedMessages: [...(msg.editMessages || msg.botMessages || [])],
      reason: '',
      stage: msg.stage || '',
      context: '',
      reviewId: msg.reviewId || null,
      realReply: msg.realReply || null,
    })
  }

  function closeModal() { setModal(null) }

  async function saveTraining() {
    if (!modal) return
    if (!modal.reason.trim()) { showToast('Please add an edit reason'); return }
    setSaving(true)
    try {
      const originalJoined = modal.originalMessages.join(' ')
      const editedJoined = modal.editedMessages.join(' ')

      await supabase.from('learnings').insert({
        bot_id: bot?.id,
        customer_id: customerId,
        review_id: modal.reviewId,
        conversation_stage: modal.stage || null,
        situation_context: modal.context || null,
        original_reply: originalJoined,
        corrected_reply: editedJoined,
        corrected_messages: modal.editedMessages,
        reason: modal.reason,
        source: 'tester',
        created_at: new Date().toISOString()
      })

      if (modal.reviewId) {
        await supabase.from('reviews').update({
          status: 'edited',
          final_reply: editedJoined,
          final_messages: modal.editedMessages,
          resolved_at: new Date().toISOString()
        }).eq('id', modal.reviewId)
      }

      setMessages(prev => prev.map((m, i) => i === modal.msgIdx
        ? { ...m, editMessages: [...modal.editedMessages], trained: true }
        : m
      ))

      showToast('✅ Saved — bot will learn from this!')
      closeModal()
    } catch (e) {
      console.error('Save error:', e)
      showToast('Error saving. Try again.')
    }
    setSaving(false)
  }

  function clearChat() {
    setMessages([])
    localStorage.removeItem('tester_messages')
    localStorage.removeItem('tester_replay_mode')
    localStorage.removeItem('tester_replay_conversation')
    localStorage.removeItem('tester_replay_index')
    const newId = 'tester_' + Math.random().toString(36).substr(2, 9)
    setCustomerId(newId)
    localStorage.setItem('tester_customer_id', newId)
    setReplayMode(false)
    setReplayConversation(null)
    setReplayIndex(0)
    setReplayPaused(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: 'var(--acc)', color: '#fff', padding: '10px 18px', borderRadius: 'var(--r)', fontSize: '.84rem', fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,.15)', animation: 'fadeSlideIn .3s ease-out' }}>
          {toast}
        </div>
      )}

      {/* Edit & Train Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={closeModal}>
          <div style={{ background: 'var(--surf)', borderRadius: 'var(--rlg)', width: '100%', maxWidth: 600, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>

            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--tx)' }}>✏️ Edit & Train</div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: 2 }}>Correct the bot response and explain why — this becomes a learning</div>
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--tx3)', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Original */}
              <div>
                <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>❌ Bot's Original Reply</label>
                <div style={{ background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: 'var(--rsm)', padding: '10px 12px', fontSize: '.84rem', color: '#c53030', lineHeight: 1.6 }}>
                  {modal.originalMessages.join(' ')}
                </div>
              </div>

              {/* Real reply from Coach Shaun (if replay mode) */}
              {modal.realReply && (
                <div>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>💡 What Coach Shaun Actually Said</label>
                  <div style={{ background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: 'var(--rsm)', padding: '10px 12px', fontSize: '.84rem', color: '#276749', lineHeight: 1.6 }}>
                    {modal.realReply}
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--tx3)', marginTop: 4 }}>Use this as a reference when writing your corrected reply below</div>
                </div>
              )}

              {/* Edited replies */}
              <div>
                <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>✅ Corrected Reply</label>
                {modal.editedMessages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                    {modal.editedMessages.length > 1 && (
                      <span style={{ fontSize: '.72rem', color: 'var(--tx3)', paddingTop: 10, flexShrink: 0 }}>#{i + 1}</span>
                    )}
                    <textarea
                      value={msg}
                      onChange={e => setModal(prev => {
                        const msgs = [...prev.editedMessages]
                        msgs[i] = e.target.value
                        return { ...prev, editedMessages: msgs }
                      })}
                      rows={3}
                      style={{ flex: 1, background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.84rem', padding: '8px 10px', borderRadius: 'var(--rsm)', outline: 'none', resize: 'vertical', lineHeight: 1.6 }}
                    />
                    {modal.editedMessages.length > 1 && (
                      <button onClick={() => setModal(prev => ({ ...prev, editedMessages: prev.editedMessages.filter((_, j) => j !== i) }))}
                        style={{ background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rsm)', color: 'var(--tx3)', cursor: 'pointer', padding: '6px 8px', fontSize: '.8rem', marginTop: 4 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setModal(prev => ({ ...prev, editedMessages: [...prev.editedMessages, ''] }))}
                  style={{ fontSize: '.78rem', color: 'var(--acc)', background: 'var(--accl)', border: 'none', padding: '5px 12px', borderRadius: 'var(--rsm)', cursor: 'pointer' }}>+ Add message bubble</button>
              </div>

              {/* Edit reason — THE key field */}
              <div>
                <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>🧠 Edit Reason <span style={{ color: '#e53e3e' }}>*</span></label>
                <textarea
                  value={modal.reason}
                  onChange={e => setModal(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Why was the bot's reply wrong? What should it do instead? Be specific — this becomes the learning rule the bot follows forever."
                  rows={4}
                  style={{ width: '100%', background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.84rem', padding: '8px 10px', borderRadius: 'var(--rsm)', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                />
              </div>

              {/* Stage */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>📍 Conversation Stage</label>
                  <select value={modal.stage} onChange={e => setModal(prev => ({ ...prev, stage: e.target.value }))}
                    style={{ width: '100%', background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '8px 10px', borderRadius: 'var(--rsm)', outline: 'none' }}>
                    <option value="">Select stage...</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>💭 Context (optional)</label>
                  <input
                    value={modal.context}
                    onChange={e => setModal(prev => ({ ...prev, context: e.target.value }))}
                    placeholder="e.g. Lead gave price objection"
                    style={{ width: '100%', background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.82rem', padding: '8px 10px', borderRadius: 'var(--rsm)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bdr)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.84rem', padding: '8px 16px', borderRadius: 'var(--rsm)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveTraining} disabled={saving} style={{ background: 'var(--acc)', border: 'none', color: '#fff', fontFamily: 'var(--fn)', fontSize: '.84rem', fontWeight: 600, padding: '8px 20px', borderRadius: 'var(--rsm)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .7 : 1 }}>
                {saving ? 'Saving...' : '💾 Save & Train'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Library Modal */}
      {showLibrary && bot && (
        <LibraryPanel
          botId={bot.id}
          onSelectConversation={startReplay}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Page */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Header */}
        <div className="page-header" style={{ flexShrink: 0 }}>
          <div>
            <div className="page-title">Conversation Simulator</div>
            <div className="page-sub">
              {replayMode
                ? `📖 Replaying: "${replayConversation?.contact_name}" · ${replayConversation?.outcome === 'booked' ? '✅ Booked' : '❌ Not booked'}`
                : 'Test conversations and refine AI responses. Edits made here improve future responses.'
              }
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!replayMode && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowLibrary(true)}>
                📚 Conversation Library
              </button>
            )}
            {replayMode && (
              <button className="btn btn-ghost btn-sm" onClick={exitReplay} style={{ color: '#e53e3e' }}>
                ✕ Exit Replay
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={clearChat}>🗑 Clear</button>
          </div>
        </div>

        {/* Chat */}
        <div className="grid-sidebar" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh)' }}>

            {/* Chat header */}
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.76rem', color: '#fff', fontWeight: 600, flexShrink: 0 }}>BB</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{bot?.name || 'Bot'}</div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>
                  {replayMode ? '📖 Replay mode — step through real conversation' : `Testing as lead · ${bot?.model || 'model'}`}
                </div>
              </div>
              {replayMode && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '.72rem', color: 'var(--tx3)' }}>Turn {replayIndex + 1} of {replayTurns.length}</span>
                  <div style={{ height: 6, width: 100, background: 'var(--bdr)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--acc)', width: `${(replayIndex / replayTurns.length) * 100}%`, transition: 'width .3s' }} />
                  </div>
                </div>
              )}
              {!replayMode && <span className="badge badge-green" style={{ fontSize: '.68rem' }}>Live</span>}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: '#fafcfa' }}>
              {messages.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>

                  {/* System info card */}
                  {m.role === 'system_info' && (
                    <div style={{ alignSelf: 'center', background: 'var(--accl)', border: '1px solid var(--acc)', borderRadius: 'var(--r)', padding: '8px 14px', fontSize: '.8rem', color: 'var(--acc)', fontWeight: 500, textAlign: 'center', maxWidth: '90%' }}>
                      {m.text}
                    </div>
                  )}

                  {/* Lead message */}
                  {m.role === 'user' && (
                    <div style={{ padding: '10px 13px', borderRadius: 'var(--r)', maxWidth: '80%', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: 'var(--blubg)', color: 'var(--blu)', border: '1px solid var(--blubd)' }}>
                      {m.text}
                      {m.replayReal && <span style={{ fontSize: '.68rem', opacity: .6, marginLeft: 8 }}>(real)</span>}
                    </div>
                  )}

                  {/* Bot message */}
                  {m.role === 'assistant' && m.botMessages && m.botMessages.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '80%' }}>
                      {m.botMessages.map((bubble, bi) => (
                        <div key={bi} style={{ padding: '10px 13px', borderRadius: 'var(--r)', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: '#fff', color: 'var(--tx)', border: '1px solid var(--bdr)', animation: 'fadeSlideIn 0.3s ease-out' }}>
                          {bubble}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Real reply reference (replay mode) */}
                  {m.role === 'assistant' && m.realReply && m.botMessages?.length > 0 && (
                    <div style={{ maxWidth: '80%', padding: '7px 12px', background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: 'var(--rsm)', fontSize: '.75rem', color: '#276749' }}>
                      <span style={{ fontWeight: 600 }}>💡 Coach Shaun said: </span>{m.realReply}
                    </div>
                  )}

                  {/* Meta tags + Edit button */}
                  {m.role === 'assistant' && m.botMessages && m.botMessages.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {m.stage && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: 'var(--accl)', color: 'var(--acc)', fontWeight: 500 }}>{m.stage}</span>}
                      {m.intent && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', fontWeight: 600, background: m.intent === 'HIGH' ? '#fff5f5' : m.intent === 'MEDIUM' ? '#fffbeb' : 'var(--surf2)', color: m.intent === 'HIGH' ? '#e53e3e' : m.intent === 'MEDIUM' ? '#d97706' : '#6b7280' }}>{m.intent}</span>}
                      {m.conf > 0 && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: m.conf >= 75 ? 'var(--accl)' : 'var(--ambbg)', color: m.conf >= 75 ? 'var(--acc)' : 'var(--amb)', fontWeight: 500 }}>{m.conf}%</span>}
                      {m.trained && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: '#f0fff4', color: '#276749', fontWeight: 600 }}>✓ Trained</span>}
                      {m.editable && canEdit && (
                        <span
                          onClick={() => openTrainModal(idx)}
                          style={{ fontSize: '.71rem', color: 'var(--tx3)', cursor: 'pointer', padding: '2px 8px', borderRadius: '100px', border: '1px solid var(--bdr)', background: 'var(--surf2)' }}
                        >✏ Edit & Train</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {(loading || isTyping) && (
                <div style={{ alignSelf: 'flex-start' }}>
                  <div style={{ padding: '12px 16px', background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: 'var(--sh)' }}>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--acc)', animation: 'typingBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                    <span style={{ fontSize: '.75rem', color: 'var(--tx3)', marginLeft: '6px' }}>{loading ? 'Thinking...' : 'Typing...'}</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            {!replayMode ? (
              <div style={{ borderTop: '1px solid var(--bdr)', padding: '12px 14px', display: 'flex', gap: '10px', background: 'var(--surf)' }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Type a message as the lead..."
                  disabled={loading || isTyping}
                  style={{ flex: 1, background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.9rem', padding: '10px 12px', borderRadius: 'var(--rsm)', outline: 'none', opacity: (loading || isTyping) ? .6 : 1 }}
                />
                <button
                  onClick={send}
                  disabled={loading || isTyping || !input.trim()}
                  style={{ background: 'var(--acc)', border: 'none', color: '#fff', fontFamily: 'var(--fn)', fontSize: '.88rem', fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--rsm)', cursor: (loading || isTyping || !input.trim()) ? 'not-allowed' : 'pointer', opacity: (loading || isTyping || !input.trim()) ? .5 : 1 }}>
                  Send
                </button>
              </div>
            ) : (
              /* Replay controls */
              <div style={{ borderTop: '1px solid var(--bdr)', padding: '12px 16px', background: 'var(--surf)', display: 'flex', gap: 10, alignItems: 'center' }}>
                {replayDone ? (
                  <div style={{ flex: 1, textAlign: 'center', fontSize: '.85rem', color: 'var(--acc)', fontWeight: 600 }}>
                    ✅ Conversation complete · {messages.filter(m => m.role === 'assistant' && m.editable).length} bot responses to review
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, fontSize: '.82rem', color: 'var(--tx3)' }}>
                      Next: <span style={{ fontWeight: 600, color: nextTurn?.speaker === 'Lead' ? 'var(--blu)' : 'var(--acc)' }}>
                        {nextTurn?.speaker === 'Lead' ? '👤 Lead says: ' : '🤖 Coach Shaun: '}
                      </span>
                      <span style={{ color: 'var(--tx)' }}>"{nextTurn?.text?.slice(0, 60)}{nextTurn?.text?.length > 60 ? '...' : ''}"</span>
                    </div>
                    <button
                      onClick={replayNextTurn}
                      disabled={loading || isTyping || replayPaused}
                      style={{ background: 'var(--acc)', border: 'none', color: '#fff', fontFamily: 'var(--fn)', fontSize: '.84rem', fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--rsm)', cursor: (loading || isTyping || replayPaused) ? 'not-allowed' : 'pointer', opacity: (loading || isTyping || replayPaused) ? .6 : 1, flexShrink: 0 }}>
                      Next Turn →
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right panel — learnings count */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: 16, boxShadow: 'var(--sh)' }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>How to use</div>
              {replayMode ? (
                <div style={{ fontSize: '.8rem', color: 'var(--tx3)', lineHeight: 1.7 }}>
                  <p style={{ margin: '0 0 8px' }}>1. Click <strong>Next Turn →</strong> to step through the conversation</p>
                  <p style={{ margin: '0 0 8px' }}>2. The bot replies to each lead message</p>
                  <p style={{ margin: '0 0 8px' }}>3. Compare bot reply vs Coach Shaun's real reply (shown in green)</p>
                  <p style={{ margin: 0 }}>4. Click <strong>✏ Edit & Train</strong> on any bot reply to correct it and add an edit reason</p>
                </div>
              ) : (
                <div style={{ fontSize: '.8rem', color: 'var(--tx3)', lineHeight: 1.7 }}>
                  <p style={{ margin: '0 0 8px' }}>1. Click <strong>📚 Conversation Library</strong> to load a real conversation</p>
                  <p style={{ margin: '0 0 8px' }}>2. Or type messages manually as the lead</p>
                  <p style={{ margin: 0 }}>3. Click <strong>✏ Edit & Train</strong> on any bot reply to teach it the right response</p>
                </div>
              )}
            </div>

            {replayMode && replayConversation && (
              <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: 16, boxShadow: 'var(--sh)' }}>
                <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Conversation Info</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Contact', val: replayConversation.contact_name },
                    { label: 'Outcome', val: replayConversation.outcome === 'booked' ? '✅ Booked' : '❌ Not booked' },
                    { label: 'Total messages', val: replayConversation.total_messages },
                    { label: 'Lead messages', val: replayConversation.lead_messages },
                    { label: 'Coach messages', val: replayConversation.coach_messages },
                    { label: 'Had Zoom', val: replayConversation.has_zoom ? 'Yes' : 'No' },
                    { label: 'Had Screening', val: replayConversation.has_screening ? 'Yes' : 'No' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}>
                      <span style={{ color: 'var(--tx3)' }}>{item.label}</span>
                      <span style={{ color: 'var(--tx)', fontWeight: 500, textTransform: 'capitalize' }}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
