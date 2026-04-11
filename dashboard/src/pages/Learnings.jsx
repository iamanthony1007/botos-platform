import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

export default function Learnings() {
  const { profile } = useAuth()
  const [learnings, setLearnings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [profile])

  async function load() {
    if (!profile) { setLoading(false); return }
    const bot = await getAssignedBot(profile, 'id')
    if (!bot) { setLoading(false); return }
    const { data } = await supabase.from('learnings').select('*').eq('bot_id', bot.id).order('created_at', { ascending: false })
    setLearnings(data || [])
    setLoading(false)
  }

  const stages = ['all', ...new Set(learnings.map(l => l.conversation_stage).filter(Boolean))]
  const filtered = filter === 'all' ? learnings : learnings.filter(l => l.conversation_stage === filter)

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Learning Log</div>
          <div className="page-sub">{learnings.length} corrections — applied to every conversation</div>
        </div>
        <select className="form-input" style={{ width: 'auto', padding: '7px 12px', fontSize: '.8rem' }} value={filter} onChange={e => setFilter(e.target.value)}>
          {stages.map(s => <option key={s} value={s}>{s === 'all' ? 'All stages' : s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--tx3)' }}>
          No learnings yet. Edit bot responses in the Bot Tester or Setter Inbox to capture training data.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(l => (
            <div key={l.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', padding: '3px 9px', borderRadius: '100px', background: 'var(--accl)', color: 'var(--acc)' }}>{l.conversation_stage || 'Unknown'}</span>
                <span className={`badge ${l.source === 'tester' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: '.67rem' }}>{l.source === 'tester' ? 'From tester' : 'From inbox'}</span>
                <span style={{ fontSize: '.7rem', color: 'var(--tx3)', marginLeft: 'auto' }}>{new Date(l.created_at).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--tx3)', marginBottom: '4px' }}>❌ Original</div>
                  <div style={{ fontSize: '.82rem', color: 'var(--red)', background: 'var(--redbg)', padding: '8px 10px', borderRadius: 'var(--rsm)', border: '1px solid var(--redbd)', lineHeight: 1.55 }}>{l.original_reply}</div>
                </div>
                <div>
                  <div style={{ fontSize: '.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--tx3)', marginBottom: '4px' }}>✅ Corrected</div>
                  <div style={{ fontSize: '.82rem', color: 'var(--acc)', background: 'var(--accp)', padding: '8px 10px', borderRadius: 'var(--rsm)', border: '1px solid var(--accl)', lineHeight: 1.55 }}>{l.corrected_reply}</div>
                </div>
              </div>
              <div style={{ fontSize: '.79rem', color: 'var(--tx2)', fontStyle: 'italic', lineHeight: 1.6, paddingTop: '8px', borderTop: '1px solid var(--bdr)' }}>{l.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}