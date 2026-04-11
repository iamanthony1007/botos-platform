import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const WORKER_URL = 'https://sales-bot.nellakuate.workers.dev'

// Calculate realistic typing delay based on message length
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
      conf: 92,
      editable: false,
      editing: false,
      editMessages: ["G'day mate. How long have you been playing golf for?"]
    }])
  }

  // Animate messages appearing one by one
  async function animateMessages(botMsgs, metadata) {
    // Add placeholder message
    const msgIndex = messages.length + 1 // +1 for user message we just added
    
    for (let i = 0; i < botMsgs.length; i++) {
      const msg = botMsgs[i]
      const delay = calcTypingDelay(msg)
      
      // Show typing
      setIsTyping(true)
      
      // Wait for typing delay
      await new Promise(resolve => setTimeout(resolve, delay))
      
      // Add this message bubble
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        
        // If last message is our bot response, add to it
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg._tempId === metadata._tempId) {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...lastMsg,
            botMessages: [...lastMsg.botMessages, msg]
          }
          return updated
        }
        
        // Otherwise create new bot message group
        return [...prev, {
          ...metadata,
          botMessages: [msg]
        }]
      })
      
      setIsTyping(false)
    }
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
      
      console.log('Bot response:', data) // Debug log
      
      // Get messages array
      let botMsgs = []
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        botMsgs = data.messages.filter(m => m && m.trim())
      } else if (data.bot_reply && data.bot_reply.trim()) {
        botMsgs = [data.bot_reply]
      } else if (data.reply && data.reply.trim()) {
        botMsgs = [data.reply]
      }
      
      // Fallback if nothing found
      if (botMsgs.length === 0) {
        botMsgs = ['No reply received']
        console.error('No valid messages in response:', data)
      }

      setLoading(false)
      
      const tempId = Date.now()
      const metadata = {
        role: 'assistant',
        botMessages: [],
        stage: data.conversation_stage || 'Unknown',
        conf: Math.round((data.confidence || 0) * 100),
        action: data.next_action,
        reviewId: data.review_id,
        originalMessages: [...botMsgs],
        editable: true,
        editing: false,
        editMessages: [...botMsgs],
        _tempId: tempId
      }
      
      // Add empty placeholder first
      setMessages(prev => [...prev, metadata])
      
      // Animate messages one by one
      for (let i = 0; i < botMsgs.length; i++) {
        const msg = botMsgs[i]
        const delay = calcTypingDelay(msg)
        
        setIsTyping(true)
        await new Promise(resolve => setTimeout(resolve, delay))
        
        setMessages(prev => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (updated[lastIdx] && updated[lastIdx]._tempId === tempId) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              botMessages: [...updated[lastIdx].botMessages, msg]
            }
          }
          return updated
        })
        
        setIsTyping(false)
        
        // Small gap between messages
        if (i < botMsgs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300))
        }
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
        editable: false,
        editing: false
      }])
    }
  }

  function startEdit(idx) {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, editing: true, editMessages: [...m.botMessages] } : m))
  }

  function cancelEdit(idx) {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, editing: false } : m))
  }

  function updateEditMessage(msgIdx, bubbleIdx, val) {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx) return m
      const newEditMessages = [...m.editMessages]
      newEditMessages[bubbleIdx] = val
      return { ...m, editMessages: newEditMessages }
    }))
  }

  function addMessageBubble(msgIdx) {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx) return m
      if (m.editMessages.length >= 3) return m
      return { ...m, editMessages: [...m.editMessages, ''] }
    }))
  }

  function removeMessageBubble(msgIdx, bubbleIdx) {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx) return m
      if (m.editMessages.length <= 1) return m
      const newEditMessages = m.editMessages.filter((_, bi) => bi !== bubbleIdx)
      return { ...m, editMessages: newEditMessages }
    }))
  }

  async function requestSaveLearning(idx) {
    const msg = messages[idx]
    const editedMessages = msg.editMessages.filter(m => m.trim())
    if (editedMessages.length === 0 || !bot) return

    setModal({ idx, msg, step: 'loading', reason: '', editReason: '' })

    try {
      const res = await fetch(`${WORKER_URL}/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_reply: msg.originalMessages?.join(' ') || msg.botMessages.join(' '),
          corrected_reply: editedMessages.join(' '),
          conversation_stage: msg.stage || 'Unknown',
          context: 'Instagram DM sales conversation for golf fitness coaching'
        })
      })
      const data = await res.json()
      setModal(prev => ({ ...prev, step: 'confirm', reason: data.reason || '', editReason: data.reason || '' }))
    } catch (e) {
      setModal(prev => ({ ...prev, step: 'confirm', reason: '', editReason: '' }))
    }
  }

  async function confirmSaveLearning() {
    if (!modal || !bot) return
    const { idx, msg, editReason } = modal
    if (!editReason.trim()) return

    const editedMessages = msg.editMessages.filter(m => m.trim())
    const originalJoined = msg.originalMessages?.join(' ') || msg.botMessages.join(' ')
    const correctedJoined = editedMessages.join(' ')

    await supabase.from('learnings').insert({
      bot_id: bot.id,
      customer_id: customerId,
      review_id: msg.reviewId || null,
      conversation_stage: msg.stage || 'Unknown',
      original_reply: originalJoined,
      corrected_reply: correctedJoined,
      corrected_messages: editedMessages,
      reason: editReason,
      source: 'tester',
      created_at: new Date().toISOString()
    })

    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, botMessages: editedMessages, editing: false, editable: false } : m))
    setLearnings(prev => [{
      stage: msg.stage,
      original: originalJoined,
      corrected: correctedJoined,
      reason: editReason
    }, ...prev])
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
      conf: 92,
      editable: false,
      editing: false,
      editMessages: ["G'day mate. How long have you been playing golf for?"]
    }])
    showToast('Chat cleared')
  }

  return (
    <div className="page" style={{ height: '100%', overflow: 'hidden' }}>
      {toast && <div className="toast">{toast}</div>}

      {/* MODAL */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--surf)', borderRadius: 'var(--rlg)', boxShadow: 'var(--shm)', width: '100%', maxWidth: '560px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.95rem' }}>Save as Learning</div>
                <div style={{ fontSize: '.75rem', color: 'var(--tx3)', marginTop: '2px' }}>The bot will learn from your correction</div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'var(--tx3)', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <div style={{ fontSize: '.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#e53e3e', marginBottom: '6px' }}>❌ Original ({modal.msg?.originalMessages?.length || modal.msg?.botMessages?.length || 1} msg)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(modal.msg?.originalMessages || modal.msg?.botMessages || []).map((m, i) => (
                      <div key={i} style={{ fontSize: '.78rem', color: 'var(--tx2)', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 'var(--rsm)', padding: '8px 10px', lineHeight: 1.55 }}>{m}</div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--acc)', marginBottom: '6px' }}>✅ Corrected ({modal.msg?.editMessages?.filter(m => m.trim()).length || 1} msg)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(modal.msg?.editMessages || []).filter(m => m.trim()).map((m, i) => (
                      <div key={i} style={{ fontSize: '.78rem', color: 'var(--tx2)', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--rsm)', padding: '8px 10px', lineHeight: 1.55 }}>{m}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '.8rem', fontWeight: 600, marginBottom: '6px', color: 'var(--tx2)' }}>
                  🧠 Why this matters — psychological reasoning
                </div>
                {modal.step === 'loading' ? (
                  <div style={{ padding: '12px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', border: '1px solid var(--bdr)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tx3)', animation: 'blink 1.2s ease-in-out infinite', animationDelay: `${i*0.2}s` }} />)}
                    <span style={{ fontSize: '.78rem', color: 'var(--tx3)' }}>Analysing the correction...</span>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={modal.editReason}
                      onChange={e => setModal(prev => ({ ...prev, editReason: e.target.value }))}
                      placeholder="Why was the original reply wrong? What psychological principle does the correction apply?"
                      style={{ width: '100%', minHeight: '80px', background: 'var(--surf2)', border: '1.5px solid var(--bdr)', borderRadius: 'var(--rsm)', padding: '10px 12px', fontFamily: 'var(--fn)', fontSize: '.82rem', lineHeight: 1.6, color: 'var(--tx)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                      onFocus={e => e.target.style.borderColor = 'var(--accm)'}
                      onBlur={e => e.target.style.borderColor = 'var(--bdr)'}
                    />
                    <div style={{ fontSize: '.73rem', color: 'var(--tx3)', marginTop: '4px' }}>AI-generated — edit if needed before saving</div>
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bdr)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={confirmSaveLearning} disabled={modal.step === 'loading' || !modal.editReason?.trim()}>
                Save Learning
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Bot Tester</div>
          <div className="page-sub">Chat with the bot. Edit responses to save as training data.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={clearChat}>🗑 Clear chat</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '14px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh)' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.76rem', color: '#fff', fontWeight: 600, flexShrink: 0 }}>BB</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{bot?.name || 'Bot'}</div>
              <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Testing as lead · {bot?.model || 'gpt-4o'}</div>
            </div>
            <span className="badge badge-green" style={{ fontSize: '.68rem' }}>Live</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: '#fafcfa' }}>
            {messages.map((m, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                
                {/* User message */}
                {m.role === 'user' && (
                  <div style={{ padding: '10px 13px', borderRadius: 'var(--r)', maxWidth: '80%', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: 'var(--blubg)', color: 'var(--blu)', border: '1px solid var(--blubd)' }}>
                    {m.text}
                  </div>
                )}

                {/* Bot message - multiple bubbles */}
                {m.role === 'assistant' && !m.editing && m.botMessages && m.botMessages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '80%' }}>
                    {m.botMessages.map((bubble, bi) => (
                      <div key={bi} style={{ padding: '10px 13px', borderRadius: 'var(--r)', fontSize: '.84rem', lineHeight: 1.65, boxShadow: 'var(--sh)', background: '#fff', color: 'var(--tx)', border: '1px solid var(--bdr)', animation: 'fadeSlideIn 0.3s ease-out' }}>
                        {bubble}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bot message - editing mode */}
                {m.role === 'assistant' && m.editing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '85%', width: '100%' }}>
                    {(m.editMessages || []).map((bubble, bi) => (
                      <div key={bi} style={{ position: 'relative' }}>
                        <textarea
                          value={bubble}
                          onChange={e => updateEditMessage(idx, bi, e.target.value)}
                          style={{ width: '100%', minHeight: '60px', padding: '10px 13px', paddingRight: '36px', borderRadius: 'var(--r)', fontSize: '.84rem', lineHeight: 1.65, background: 'var(--ambbg)', color: 'var(--tx)', border: '1.5px solid var(--ambbd)', fontFamily: 'var(--fn)', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
                          placeholder={`Message ${bi + 1}...`}
                        />
                        {m.editMessages.length > 1 && (
                          <button
                            onClick={() => removeMessageBubble(idx, bi)}
                            style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', borderRadius: '50%', background: '#fed7d7', border: 'none', cursor: 'pointer', fontSize: '.7rem', color: '#e53e3e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >×</button>
                        )}
                        <div style={{ position: 'absolute', bottom: '6px', left: '10px', fontSize: '.65rem', color: 'var(--tx3)' }}>
                          Msg {bi + 1} of {m.editMessages.length}
                        </div>
                      </div>
                    ))}
                    
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {m.editMessages.length < 3 && (
                        <button onClick={() => addMessageBubble(idx)} style={{ padding: '4px 10px', background: 'var(--surf2)', border: '1px dashed var(--bdr)', borderRadius: 'var(--rsm)', cursor: 'pointer', fontSize: '.72rem', color: 'var(--tx3)' }}>+ Add message</button>
                      )}
                      <button className="btn btn-primary btn-sm" style={{ fontSize: '.72rem' }} onClick={() => requestSaveLearning(idx)}>🧠 Save as learning</button>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem' }} onClick={() => cancelEdit(idx)}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Metadata badges */}
                {m.role === 'assistant' && m.botMessages && m.botMessages.length > 0 && !m.editing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {m.stage && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: 'var(--accl)', color: 'var(--acc)', fontWeight: 500 }}>{m.stage}</span>}
                    {m.conf > 0 && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: m.conf >= 75 ? 'var(--accl)' : 'var(--ambbg)', color: m.conf >= 75 ? 'var(--acc)' : 'var(--amb)', fontWeight: 500 }}>{m.conf}%</span>}
                    {m.botMessages.length > 1 && <span style={{ fontSize: '.68rem', padding: '2px 8px', borderRadius: '100px', background: 'var(--blubg)', color: 'var(--blu)', fontWeight: 500 }}>{m.botMessages.length} msgs</span>}
                    {m.editable && !m.editing && canEdit && <span style={{ fontSize: '.71rem', color: 'var(--tx3)', cursor: 'pointer' }} onClick={() => startEdit(idx)}>✏ Edit</span>}
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {(loading || isTyping) && (
              <div style={{ alignSelf: 'flex-start' }}>
                <div style={{ padding: '12px 16px', background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: 'var(--sh)' }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{
                        width: 8, height: 8, borderRadius: '50%', background: 'var(--acc)',
                        animation: 'typingBounce 1.4s ease-in-out infinite',
                        animationDelay: `${i * 0.2}s`
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: '.75rem', color: 'var(--tx3)', marginLeft: '6px' }}>
                    {loading ? 'Thinking...' : 'Typing...'}
                  </span>
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
                <div style={{ fontSize: '.66rem', fontWeight: 600, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '5px' }}>{l.stage} {i === 0 && <span style={{ background: 'var(--accl)', padding: '1px 6px', borderRadius: '100px', marginLeft: '4px' }}>New</span>}</div>
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