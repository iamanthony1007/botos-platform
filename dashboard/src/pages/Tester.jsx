import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const WORKER_URL = 'https://sales-bot.nellakuate.workers.dev'

const STAGES = [
  'ENTRY / OPEN LOOP',
  'LOCATION ANCHOR',
  'GOAL LOCK',
  'GOAL DEPTH (MAKE IT SPECIFIC)',
  "WHAT THEY'VE TRIED (PAST + CURRENT)",
  'TRANSLATION / PROGRESS CHECK',
  'BODY LINK ACCEPTANCE + MOBILITY HISTORY',
  'PROGRESS CHECK',
  'PRIORITY GATE',
  'COACHING HAT',
  'CALL BOOK BRIDGE',
  'CALL OFFERED',
  'CALL BOOKING',
  'LONG TERM NURTURE'
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

export default function Tester() {
  const { profile, can } = useAuth()
  const canEdit = can('bot_tester_edit')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [bot, setBot] = useState(null)
  const [learnings, setLearnings] = useState([])
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)
  const [customerId] = useState('tester_' + Math.random().toString(36).substr(2, 9))
  const [isTyping, setIsTyping] = useState(false)
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { loadBot() }, [profile])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isTyping])

  async function loadBot() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    if (data) setBot(data)
    setMessages([{
      role: 'assistant',
      botMessages: ["G'day mate. How long have you been playing golf for?"],
      stage: 'Entry & Context',
      intent: 'LOW',
      conf: 92,
      editable: false,
      editMessages: ["G'day mate. How long have you been playing golf for?"]
    }])
  }

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
      console.log('Bot response:', data)

      let botMsgs = []
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        botMsgs = data.messages.filter(m => m && m.trim())
      } else if (data.bot_reply && data.bot_reply.trim()) {
        botMsgs = [data.bot_reply]
      } else if (data.reply && data.reply.trim()) {
        botMsgs = [data.reply]
      }
      if (botMsgs.length === 0) {
        botMsgs = ['No reply received']
        console.error('No valid messages in response:', data)
      }

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
        stage: 'Error',
        conf: 0,
        editable: false
      }])
    }
  }

  // Click Edit & Train → open modal immediately, no inline editing
  function openTrainModal(idx) {
    const msg = messages[idx]
    if (!bot) return
    setModal({
      idx,
      msg,
      editMessages: [...(msg.botMessages || [])],
      editReason: '',
      correctedStage: msg.stage || STAGES[0],
      correctedIntent: msg.intent || 'LOW'
    })
  }

  function updateModalMessage(bi, val) {
    setModal(prev => {
      const updated = [...prev.editMessages]
      updated[bi] = val
      return { ...prev, editMessages: updated }
    })
  }

  function addModalMessage() {
    setModal(prev => {
      if (prev.editMessages.length >= 3) return prev
      return { ...prev, editMessages: [...prev.editMessages, ''] }
    })
  }

  function removeModalMessage(bi) {
    setModal(prev => {
      if (prev.editMessages.length <= 1) return prev
      return { ...prev, editMessages: prev.editMessages.filter((_, i) => i !== bi) }
    })
  }

  async function confirmSaveLearning() {
    if (!modal || !bot || !modal.editReason.trim()) return
    const { idx, msg, editMessages, editReason, correctedStage, correctedIntent } = modal
    const validMessages = editMessages.filter(m => m.trim())
    if (validMessages.length === 0) return
    setSaving(true)

    const originalJoined = msg.originalMessages?.join(' ') || msg.botMessages.join(' ')
    const correctedJoined = validMessages.join(' ')

    await supabase.from('learnings').insert({
      bot_id: bot.id,
      customer_id: customerId,
      review_id: msg.reviewId || null,
      conversation_stage: correctedStage || msg.stage || 'Unknown',
      original_reply: originalJoined,
      corrected_reply: correctedJoined,
      corrected_messages: validMessages,
      reason: editReason,
      source: 'tester',
      created_at: new Date().toISOString()
    })

    setMessages(prev => prev.map((m, i) => i === idx ? {
      ...m,
      botMessages: validMessages,
      editMessages: validMessages,
      stage: correctedStage || m.stage,
      intent: correctedIntent || m.intent,
      editable: false
    } : m))

    setLearnings(prev => [{
      stage: correctedStage || msg.stage,
      intent: correctedIntent,
      original: originalJoined,
      corrected: correctedJoined,
      reason: editReason
    }, ...prev])

    setSaving(false)
    setModal(null)
    showToast('🧠 Learning saved — bot will apply this pattern')
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  function clearChat() {
    setIsTyping(false)
    setMessages([{
      role: 'assistant',
      botMessages: ["G'day mate. How long have you been playing golf for?"],
      stage: 'Entry & Context',
      intent: 'LOW',
      conf: 92,
      editable: false,
      editMessages: ["G'day mate. How long have you been playing golf for?"]
    }])
    showToast('Chat cleared')
  }

  return (
    <div className="page" style={{ height: '100%', overflow: 'hidden' }}>
      {toast && <div className="toast">{toast}</div>}

      {/* ── TRAIN MODAL ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--surf)', borderRadius: 'var(--rlg)', boxShadow: 'var(--shm)', width: '100%', maxWidth: '580px', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.95rem' }}>✏ Edit & Train</div>
                <div style={{ fontSize: '.75rem', color: 'var(--tx3)', marginTop: '2px' }}>Correct the reply and the bot will learn from it</div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'var(--tx3)', lineHeight: 1 }}>×</button>
            </div>

            {/* Body */}
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '68vh', overflowY: 'auto' }}>

              {/* Editable reply messages */}
              <div>
                <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)', display: 'block', marginBottom: '8px' }}>
                  Bot Reply <span style={{ fontWeight: 400, color: 'var(--tx3)' }}>(edit to correct)</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {modal.editMessages.map((bubble, bi) => (
                    <div key={bi} style={{ position: 'relative' }}>
                      <textarea
                        autoFocus={bi === 0}
                        value={bubble}
                        onChange={e => updateModalMessage(bi, e.target.value)}
                        rows={3}
                        className="form-input"
                        style={{ borderRadius: '10px', paddingRight: modal.editMessages.length > 1 ? '36px' : '12px', resize: 'vertical' }}
                        placeholder={`Message ${bi + 1}...`}
                      />
                      {modal.editMessages.length > 1 && (
                        <button onClick={() => removeModalMessage(bi)} style={{ position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.7rem', color: '#e53e3e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      )}
                    </div>
                  ))}
                  {modal.editMessages.length < 3 && (
                    <button onClick={addModalMessage} style={{ alignSelf: 'flex-start', padding: '4px 12px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: '8px', cursor: 'pointer', fontSize: '.75rem', color: 'var(--tx3)' }}>+ Add message</button>
                  )}
                </div>
              </div>

              {/* Stage + Intent */}
              <div style={{ background: 'var(--surf2)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--tx2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Tag Lead Stage and Intent</div>
                  <div style={{ fontSize: '.74rem', color: 'var(--tx3)', marginTop: '3px' }}>Based on what the lead said, not what the AI assumed</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)' }}>Conversation Stage</label>
                  <select
                    value={modal.correctedStage || ''}
                    onChange={e => setModal(prev => ({ ...prev, correctedStage: e.target.value }))}
                    className="form-input"
                    style={{
                      fontSize: '.8rem', padding: '6px 10px', borderRadius: '8px',
                      border: modal.correctedStage !== modal.msg?.stage ? '1.5px solid var(--acc)' : '1px solid var(--bdr)',
                      background: modal.correctedStage !== modal.msg?.stage ? 'var(--accp)' : 'var(--surf)'
                    }}
                  >
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--tx2)' }}>Lead Intent</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {['LOW', 'MEDIUM', 'HIGH'].map(i => (
                      <button key={i} onClick={() => setModal(prev => ({ ...prev, correctedIntent: i }))}
                        style={{
                          flex: 1, padding: '7px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                          fontSize: '.78rem', fontWeight: 600,
                          background: modal.correctedIntent === i ? (i === 'HIGH' ? '#e53e3e' : i === 'MEDIUM' ? '#d97706' : '#6b7280') : 'var(--surf)',
                          color: modal.correctedIntent === i ? '#fff' : 'var(--tx3)',
                          outline: modal.correctedIntent === i ? 'none' : '1px solid var(--bdr)'
                        }}
                      >{i}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div className="form-group">
                <label className="form-label">
                  Why did you make these changes? <span style={{ color: '#e53e3e' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="e.g. Bot was too pushy here — the lead showed hesitation and it should have validated their concern before moving forward. Always slow down when you see resistance language."
                  value={modal.editReason}
                  onChange={e => setModal(prev => ({ ...prev, editReason: e.target.value }))}
                  style={{ borderRadius: '10px' }}
                />
                <div className="form-hint">The more detail you give, the faster the AI learns.</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bdr)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={confirmSaveLearning}
                disabled={saving || !modal.editReason?.trim()}
                style={{ opacity: saving || !modal.editReason?.trim() ? .6 : 1 }}
              >
                {saving ? 'Saving...' : 'Save & Train'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Conversation Simulator</div>
          <div className="page-sub">Test conversations and refine AI responses before they go live. Edits made here help improve future responses.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={clearChat}>🗑 Clear chat</button>
      </div>

      <div className="grid-sidebar" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Chat panel */}
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh)' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.76rem', color: '#fff', fontWeight: 600, flexShrink: 0 }}>BB</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{bot?.name || 'Bot'}</div>
              <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Testing as lead · {bot?.model || 'gpt-5.4'}</div>
            </div>
            <span className="badge badge-green" style={{ fontSize: '.68rem' }}>Live</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: '#fafcfa' }}>
            {messages.map((m, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>

                {m.role === 'user' && (
                  <div style={{ padding: '10px 13px', borderRadius: 'var(--r)', maxWidth: '80%', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: 'var(--blubg)', color: 'var(--blu)', border: '1px solid var(--blubd)' }}>
                    {m.text}
                  </div>
                )}

                {m.role === 'assistant' && m.botMessages && m.botMessages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '80%' }}>
                    {m.botMessages.map((bubble, bi) => (
                      <div key={bi} style={{ padding: '10px 13px', borderRadius: 'var(--r)', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: '#fff', color: 'var(--tx)', border: '1px solid var(--bdr)', animation: 'fadeSlideIn 0.3s ease-out' }}>
                        {bubble}
                      </div>
                    ))}
                  </div>
                )}

                {m.role === 'assistant' && m.botMessages && m.botMessages.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {m.stage && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: 'var(--accl)', color: 'var(--acc)', fontWeight: 500 }}>{m.stage}</span>}
                    {m.intent && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', fontWeight: 600, background: m.intent === 'HIGH' ? '#fff5f5' : m.intent === 'MEDIUM' ? '#fffbeb' : 'var(--surf2)', color: m.intent === 'HIGH' ? '#e53e3e' : m.intent === 'MEDIUM' ? '#d97706' : '#6b7280' }}>{m.intent}</span>}
                    {m.conf > 0 && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: m.conf >= 75 ? 'var(--accl)' : 'var(--ambbg)', color: m.conf >= 75 ? 'var(--acc)' : 'var(--amb)', fontWeight: 500 }}>{m.conf}%</span>}
                    {m.botMessages.length > 1 && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: 'var(--blubg)', color: 'var(--blu)', fontWeight: 500 }}>{m.botMessages.length} msgs</span>}
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
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--acc)', animation: 'typingBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                  <span style={{ fontSize: '.75rem', color: 'var(--tx3)', marginLeft: '6px' }}>{loading ? 'Thinking...' : 'Typing...'}</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ borderTop: '1px solid var(--bdr)', padding: '12px 14px', display: 'flex', gap: '10px', background: 'var(--surf)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Type a message as the lead..."
              disabled={loading || isTyping}
              style={{ flex: 1, background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.9rem', padding: '10px 12px', borderRadius: 'var(--rsm)', outline: 'none', opacity: (loading || isTyping) ? 0.6 : 1 }}
              onFocus={e => e.target.style.borderColor = 'var(--accm)'}
              onBlur={e => e.target.style.borderColor = 'var(--bdr)'}
            />
            <button
              onClick={send}
              disabled={loading || isTyping || !input.trim()}
              style={{ padding: '10px 16px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 'var(--rsm)', fontFamily: 'var(--fn)', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer', opacity: (loading || isTyping || !input.trim()) ? .4 : 1 }}
            >Send</button>
          </div>
        </div>

        {/* Learnings sidebar */}
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh)' }}>
          <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--bdr)', background: 'var(--accp)' }}>
            <div style={{ fontSize: '.86rem', fontWeight: 600, color: 'var(--acc)' }}>🧠 Learnings captured</div>
            <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: '2px' }}>Edits you make are saved as training data</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px', background: 'var(--surf2)' }}>
            {learnings.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tx3)', fontSize: '.82rem' }}>Edit a bot response to capture your first learning</div>
            ) : learnings.map((l, i) => (
              <div key={i} style={{ padding: '11px', borderRadius: 'var(--rsm)', border: `1px solid ${i === 0 ? 'var(--accm)' : 'var(--bdr)'}`, marginBottom: '8px', background: i === 0 ? 'var(--accp)' : 'var(--surf)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.66rem', fontWeight: 600, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{l.stage}</span>
                  {l.intent && <span style={{ fontSize: '.63rem', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: l.intent === 'HIGH' ? '#fff5f5' : l.intent === 'MEDIUM' ? '#fffbeb' : 'var(--surf2)', color: l.intent === 'HIGH' ? '#e53e3e' : l.intent === 'MEDIUM' ? '#d97706' : '#6b7280' }}>{l.intent}</span>}
                  {i === 0 && <span style={{ fontSize: '.63rem', background: 'var(--accl)', color: 'var(--acc)', padding: '1px 6px', borderRadius: '100px' }}>New</span>}
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--red)', textDecoration: 'line-through', marginBottom: '3px', opacity: .8 }}>{l.original}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--acc)', marginBottom: '5px' }}>→ {l.corrected}</div>
                {l.reason && <div style={{ fontSize: '.73rem', color: 'var(--tx2)', fontStyle: 'italic', lineHeight: 1.5, paddingTop: '5px', borderTop: '1px solid var(--bdr)' }}>{l.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%, 80%, 100% { opacity: .2 } 40% { opacity: 1 } }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0) } 30% { transform: translateY(-4px) } }
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
