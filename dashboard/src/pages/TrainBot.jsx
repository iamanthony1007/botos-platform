import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

const WORKER_URL = 'https://sales-bot.nellakuate.workers.dev'

export default function TrainBot() {
  const { profile } = useAuth()
  const [bot, setBot] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({ msg: '', type: 'success' })
  const bottomRef = useRef(null)

  useEffect(() => { loadBot() }, [profile])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadBot() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    if (data) {
      setBot(data)
      setMessages([{
        role: 'system',
        text: `Hey! I'm your prompt trainer. Tell me in plain English how you want the bot to behave and I'll update it automatically.\n\nExamples:\n• "Change the greeting to say Hey, thanks for following"\n• "The bot is too formal, make it more casual"\n• "Never ask about distance first, always start with pain"\n• "Add a rule: if someone mentions surgery, slow down and show more empathy"`
      }])
    }
  }

  async function sendInstruction() {
    if (!input.trim() || loading || !bot) return
    const instruction = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: instruction }])
    setLoading(true)

    try {
      const { data: botData } = await supabase.from('bots').select('system_prompt').eq('id', bot.id).single()
      const currentPrompt = botData?.system_prompt || ''

      if (!currentPrompt) {
        setMessages(prev => [...prev, { role: 'system', type: 'error', text: 'No system prompt found. Please add a prompt in the Prompt Editor first.' }])
        setLoading(false)
        return
      }

      const res = await fetch(`${WORKER_URL}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, current_prompt: currentPrompt })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Worker error')
      }

      const { updated_prompt, explanation } = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', type: 'pending', text: explanation, updated_prompt, instruction }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'system', type: 'error', text: `Something went wrong: ${e.message}` }])
    }
    setLoading(false)
  }

  async function applyChange(msgIdx, updatedPrompt) {
    if (!bot) return
    const { data: versions } = await supabase.from('prompt_versions').select('version_number').eq('bot_id', bot.id).order('version_number', { ascending: false }).limit(1)
    const nextVersion = versions && versions.length > 0 ? versions[0].version_number + 1 : 1

    await supabase.from('bots').update({ system_prompt: updatedPrompt, updated_at: new Date().toISOString() }).eq('id', bot.id)
    await supabase.from('prompt_versions').insert({ bot_id: bot.id, version_number: nextVersion, prompt: updatedPrompt, label: `v${nextVersion} · Trained ${new Date().toLocaleDateString()}` })

    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, type: 'applied' } : m))
    showToast('Prompt updated and live — bot will use this on the next message', 'success')
  }

  function discardChange(msgIdx) {
    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, type: 'discarded' } : m))
    showToast('Change discarded', 'warning')
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: 'success' }), 4000)
  }

  const toastStyle = { success: { bg: 'var(--accp)', border: 'var(--accl)', color: 'var(--acc)' }, warning: { bg: 'var(--ambbg)', border: 'var(--ambbd)', color: 'var(--amb)' }, error: { bg: 'var(--redbg)', border: 'var(--redbd)', color: 'var(--red)' } }

  return (
    <div className="page" style={{ height: '100%', overflow: 'hidden' }}>
      {toast.msg && <div style={{ position: 'fixed', top: '70px', right: '20px', zIndex: 999, padding: '12px 18px', borderRadius: 'var(--r)', background: toastStyle[toast.type].bg, border: `1px solid ${toastStyle[toast.type].border}`, color: toastStyle[toast.type].color, fontSize: '.84rem', fontWeight: 500, boxShadow: 'var(--shm)', maxWidth: '380px' }}>{toast.msg}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">AI Behavior</div>
          <div className="page-sub">Define how the AI should respond and behave across all conversations.</div>
        </div>
        <span className="badge badge-green" style={{ fontSize: '.7rem' }}>🤖 {bot?.name || 'Bot'}</span>
      </div>

      <div className="grid-sidebar" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>

        <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--sh)' }}>
          <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>🎓</div>
            <div>
              <div style={{ fontSize: '.88rem', fontWeight: 600 }}>Prompt Trainer</div>
              <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Changes go live when you confirm them</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: '#fafcfa' }}>
            {messages.map((m, idx) => (
              <div key={idx}>
                {m.role === 'user' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ padding: '10px 14px', borderRadius: 'var(--r)', maxWidth: '80%', fontSize: '.84rem', lineHeight: 1.65, background: 'var(--blubg)', color: 'var(--blu)', border: '1px solid var(--blubd)', boxShadow: 'var(--sh)' }}>{m.text}</div>
                  </div>
                )}
                {m.role === 'system' && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ padding: '12px 16px', borderRadius: 'var(--r)', maxWidth: '90%', fontSize: '.82rem', lineHeight: 1.7, background: m.type === 'error' ? 'var(--redbg)' : 'var(--accp)', color: m.type === 'error' ? 'var(--red)' : 'var(--acc)', border: `1px solid ${m.type === 'error' ? 'var(--redbd)' : 'var(--accl)'}`, whiteSpace: 'pre-line' }}>{m.text}</div>
                  </div>
                )}
                {m.role === 'assistant' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ padding: '12px 14px', borderRadius: 'var(--r)', fontSize: '.84rem', lineHeight: 1.65, background: m.type === 'applied' ? 'var(--accp)' : m.type === 'discarded' ? 'var(--surf2)' : '#fff', border: `1px solid ${m.type === 'applied' ? 'var(--accm)' : m.type === 'discarded' ? 'var(--bdr)' : 'var(--ambbd)'}`, color: m.type === 'discarded' ? 'var(--tx3)' : 'var(--tx)', boxShadow: 'var(--sh)' }}>
                        <div style={{ fontSize: '.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px', color: m.type === 'applied' ? 'var(--acc)' : m.type === 'discarded' ? 'var(--tx3)' : 'var(--amb)' }}>
                          {m.type === 'applied' ? '✅ Applied' : m.type === 'discarded' ? '✗ Discarded' : '📝 Proposed change'}
                        </div>
                        {m.text}
                      </div>
                      {m.type === 'pending' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => applyChange(idx, m.updated_prompt)}>✓ Apply this change</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => discardChange(idx)}>Discard</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 14px', background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--tx3)', animation: 'blink 1.2s ease-in-out infinite', animationDelay: `${i*0.2}s` }} />)}
                  <span style={{ fontSize: '.78rem', color: 'var(--tx3)', marginLeft: '6px' }}>Analysing instruction...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ borderTop: '1px solid var(--bdr)', padding: '12px 14px', display: 'flex', gap: '10px', background: 'var(--surf)' }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInstruction() } }} placeholder='e.g. "Change the greeting message to say Thanks for the follow"' style={{ flex: 1, background: 'var(--surf2)', border: '1.5px solid var(--bdr)', color: 'var(--tx)', fontFamily: 'var(--fn)', fontSize: '.88rem', padding: '10px 12px', borderRadius: 'var(--rsm)', outline: 'none' }} onFocus={e => e.target.style.borderColor = 'var(--accm)'} onBlur={e => e.target.style.borderColor = 'var(--bdr)'} />
            <button onClick={sendInstruction} disabled={loading || !input.trim()} style={{ padding: '10px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 'var(--rsm)', fontFamily: 'var(--fn)', fontSize: '.82rem', fontWeight: 500, cursor: 'pointer', opacity: loading || !input.trim() ? .4 : 1 }}>Train</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          <div className="card">
            <div className="card-title">How it works</div>
            <div style={{ fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.7 }}>Type an instruction in plain English. The AI reads the current prompt, makes only the change you asked for, and shows you what changed. You confirm before it goes live.</div>
          </div>
          <div className="card">
            <div className="card-title">Try these</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {['Change the greeting message', 'Sound less formal', 'Ask about pain before distance', 'More empathy when someone mentions surgery', 'Never use the word "optimize"', 'Change the call booking wording'].map((tip, i) => (
                <div key={i} onClick={() => setInput(tip)} style={{ padding: '7px 10px', borderRadius: 'var(--rsm)', background: 'var(--surf2)', border: '1px solid var(--bdr)', fontSize: '.78rem', color: 'var(--tx2)', cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--accp)'; e.currentTarget.style.color = 'var(--acc)' }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--surf2)'; e.currentTarget.style.color = 'var(--tx2)' }}>{tip}</div>
              ))}
            </div>
          </div>
          <div style={{ padding: '12px 14px', background: 'var(--ambbg)', border: '1px solid var(--ambbd)', borderRadius: 'var(--r)' }}>
            <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--amb)', marginBottom: '4px' }}>⚠️ After training</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx2)', lineHeight: 1.6 }}>Always test the bot in Bot Tester after making changes to confirm it behaves correctly.</div>
          </div>
        </div>
      </div>
      <style>{`@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
    </div>
  )
}
