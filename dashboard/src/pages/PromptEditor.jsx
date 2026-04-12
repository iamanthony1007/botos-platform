import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

export default function PromptEditor() {
  const { profile } = useAuth()
  const [bot, setBot] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [versions, setVersions] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadBot() }, [profile])

  async function loadBot() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    if (data) {
      setBot(data)
      setPrompt(data.system_prompt || '')
    }
    const { data: vers } = await supabase
      .from('prompt_versions')
      .select('*')
      .eq('bot_id', data?.id)
      .order('version_number', { ascending: false })
      .limit(5)
    setVersions(vers || [])
    setLoading(false)
  }

  async function savePrompt() {
    if (!bot) return
    setSaving(true)
    const nextVersion = versions.length > 0 ? versions[0].version_number + 1 : 1
    await supabase.from('bots').update({
      system_prompt: prompt,
      updated_at: new Date().toISOString()
    }).eq('id', bot.id)
    await supabase.from('prompt_versions').insert({
      bot_id: bot.id,
      version_number: nextVersion,
      prompt,
      label: `v${nextVersion} · ${new Date().toLocaleDateString()}`
    })
    await loadBot()
    setSaving(false)
    showToast('✓ Prompt saved and live')
  }

  async function restoreVersion(v) {
    setPrompt(v.prompt)
    showToast(`Restored ${v.label} — click Save to apply`)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length
  const tokenEstimate = Math.round(wordCount * 1.35)

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      {toast && <div className="toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Prompt Editor</div>
          <div className="page-sub">{bot?.name} · Changes go live on save</div>
        </div>
        <button className="btn btn-primary" onClick={savePrompt} disabled={saving}>
          {saving ? 'Saving...' : 'Save & Deploy'}
        </button>
      </div>

      <div className='grid-sidebar'>

        {/* EDITOR */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '11px 16px',
            borderBottom: '1px solid var(--bdr)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--surf2)'
          }}>
            <span style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--tx2)' }}>System Prompt</span>
            <span className="badge badge-green" style={{ marginLeft: 'auto', fontSize: '.67rem' }}>
              {versions.length > 0 ? `v${versions[0].version_number} — Live` : 'Draft'}
            </span>
          </div>
          <div style={{ padding: '16px' }}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Enter your system prompt here..."
              style={{
                width: '100%',
                minHeight: '420px',
                background: 'var(--surf2)',
                border: '1.5px solid var(--bdr)',
                borderRadius: 'var(--r)',
                fontFamily: 'Monaco, Menlo, monospace',
                fontSize: '.8rem',
                lineHeight: 1.7,
                color: 'var(--tx)',
                padding: '14px',
                outline: 'none',
                resize: 'vertical'
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accm)'}
              onBlur={e => e.target.style.borderColor = 'var(--bdr)'}
            />
          </div>
        </div>

        {/* SIDEBAR */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* STATS */}
          <div className="card">
            <div className="card-title">Prompt Stats</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Word count</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--acc)' }}>{wordCount}</div>
              </div>
              <div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Token estimate</div>
                <div style={{ fontSize: '1rem', fontWeight: 600 }}>~{tokenEstimate}</div>
              </div>
              <div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Model</div>
                <div style={{ fontSize: '.82rem', color: 'var(--tx2)', fontFamily: 'monospace' }}>{bot?.model || 'gpt-5.4'}</div>
              </div>
              <div>
                <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>Last saved</div>
                <div style={{ fontSize: '.82rem', color: 'var(--tx2)' }}>
                  {bot?.updated_at ? new Date(bot.updated_at).toLocaleString() : 'Never'}
                </div>
              </div>
            </div>
          </div>

          {/* VERSION HISTORY */}
          <div className="card">
            <div className="card-title">Version History</div>
            {versions.length === 0 ? (
              <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>No versions saved yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {versions.map((v, i) => (
                  <div key={v.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '9px 0',
                    borderBottom: i < versions.length - 1 ? '1px solid var(--bdr)' : 'none'
                  }}>
                    <div>
                      <div style={{ fontSize: '.82rem', fontWeight: 500 }}>{v.label}</div>
                      <div style={{ fontSize: '.73rem', color: 'var(--tx3)' }}>
                        {Math.round(v.prompt.trim().split(/\s+/).length)} words
                      </div>
                    </div>
                    {i === 0
                      ? <span className="badge badge-green" style={{ fontSize: '.67rem' }}>Current</span>
                      : <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '.7rem', padding: '4px 10px' }}
                          onClick={() => restoreVersion(v)}
                        >Restore</button>
                    }
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* TIP */}
          <div style={{
            background: 'var(--accp)',
            border: '1px solid var(--accl)',
            borderRadius: 'var(--r)',
            padding: '12px 14px'
          }}>
            <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--acc)', marginBottom: '5px' }}>💡 Tip</div>
            <div style={{ fontSize: '.76rem', color: 'var(--tx2)', lineHeight: 1.6 }}>
              Changes saved here go live immediately. Use the Bot Tester to verify the new prompt is working before sending real leads through.
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}