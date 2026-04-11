import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'
import * as mammoth from 'mammoth'

const WORKER_URL = 'https://sales-bot.nellakuate.workers.dev'

const ACCEPTED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx'
}

export default function Documents() {
  const { profile } = useAuth()
  const [docs, setDocs] = useState([])
  const [bot, setBot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [toast, setToast] = useState({ msg: '', type: 'success' })
  const [dragOver, setDragOver] = useState(false)
  const [expandedDoc, setExpandedDoc] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => { load() }, [profile])

  async function load() {
    if (!profile) { setLoading(false); return }
    const b = await getAssignedBot(profile)
    if (b) setBot(b)
    const { data } = await supabase.from('bot_documents').select('*').eq('bot_id', b?.id).order('created_at', { ascending: false })
    setDocs(data || [])
    setLoading(false)
  }

  async function handleFiles(files) {
    if (!bot || uploading) return
    const fileList = Array.from(files)
    const valid = fileList.filter(f => ACCEPTED_TYPES[f.type])
    const invalid = fileList.filter(f => !ACCEPTED_TYPES[f.type])
    if (invalid.length > 0) showToast('Unsupported file type: ' + invalid.map(f => f.name).join(', '), 'error')
    if (valid.length === 0) return
    setUploading(true)
    for (const file of valid) await uploadFile(file)
    setUploading(false)
    setUploadProgress('')
    await load()
  }

  async function uploadFile(file) {
    setUploadProgress('Extracting text from ' + file.name + '...')
    try {
      let content = ''
      const fileType = ACCEPTED_TYPES[file.type]

      if (fileType === 'txt') {
        content = await readAsText(file)
      } else if (fileType === 'docx') {
        const arrayBuffer = await readAsArrayBuffer(file)
        const result = await mammoth.extractRawText({ arrayBuffer })
        content = result.value || ''
      } else {
        const base64 = await readAsBase64(file)
        const res = await fetch(WORKER_URL + '/extract-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_name: file.name, file_type: fileType, file_data: base64 })
        })
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Extraction failed') }
        const data = await res.json()
        content = data.content || ''
      }

      if (!content || content.trim().length < 20) {
        showToast('Could not extract text from ' + file.name + '. Try saving as TXT.', 'error')
        return
      }

      setUploadProgress('Saving ' + file.name + ' to knowledge base...')
      const { data: existing } = await supabase.from('bot_documents').select('id').eq('bot_id', bot.id).eq('name', file.name).single()

      if (existing) {
        await supabase.from('bot_documents').update({ content: content.trim(), file_size: file.size, status: 'active', updated_at: new Date().toISOString() }).eq('id', existing.id)
        showToast('Updated: ' + file.name)
      } else {
        await supabase.from('bot_documents').insert({ bot_id: bot.id, name: file.name, file_path: 'text-only/' + file.name, file_size: file.size, content: content.trim(), status: 'active', usage_count: 0, created_at: new Date().toISOString() })
        showToast('Added to knowledge base: ' + file.name)
      }
    } catch (e) {
      console.error(e)
      showToast('Failed to upload ' + file.name + ': ' + e.message, 'error')
    }
  }

  function readAsText(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result); r.onerror = () => reject(new Error('Failed')); r.readAsText(file) }) }
  function readAsArrayBuffer(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result); r.onerror = () => reject(new Error('Failed')); r.readAsArrayBuffer(file) }) }
  function readAsBase64(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result.split(',')[1]); r.onerror = () => reject(new Error('Failed')); r.readAsDataURL(file) }) }

  async function toggleStatus(doc) {
    const s = doc.status === 'active' ? 'inactive' : 'active'
    await supabase.from('bot_documents').update({ status: s }).eq('id', doc.id)
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: s } : d))
    showToast(s === 'active' ? doc.name + ' enabled' : doc.name + ' disabled')
  }

  async function removeDoc(doc) {
    await supabase.from('bot_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
    showToast(doc.name + ' removed')
  }

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast({ msg: '', type: 'success' }), 4000) }

  const docIcon = name => { if (!name) return '?'; if (name.endsWith('.pdf')) return 'PDF'; if (name.endsWith('.docx')) return 'DOC'; if (name.endsWith('.xlsx')) return 'XLS'; return 'TXT' }
  const toastStyle = { success: { bg: 'var(--accp)', border: 'var(--accl)', color: 'var(--acc)' }, error: { bg: 'var(--redbg)', border: 'var(--redbd)', color: 'var(--red)' } }
  const activeDocs = docs.filter(d => d.status === 'active')
  const inactiveDocs = docs.filter(d => d.status === 'inactive')

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      {toast.msg && <div style={{ position: 'fixed', top: '70px', right: '20px', zIndex: 999, padding: '12px 18px', borderRadius: 'var(--r)', background: toastStyle[toast.type].bg, border: '1px solid ' + toastStyle[toast.type].border, color: toastStyle[toast.type].color, fontSize: '.84rem', fontWeight: 500, boxShadow: 'var(--shm)', maxWidth: '380px' }}>{toast.msg}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Knowledge Base</div>
          <div className="page-sub">Add and manage information the AI uses to respond accurately in conversations.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>+ Upload File</button>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.xlsx" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      </div>

      <div className="card" style={{ padding: 0, border: dragOver ? '2px solid var(--accm)' : '2px dashed var(--bdr2)', background: dragOver ? 'var(--accp)' : 'var(--surf)', transition: 'all .2s', cursor: uploading ? 'not-allowed' : 'pointer' }}
        onDragOver={e => { e.preventDefault(); if (!uploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => !uploading && fileInputRef.current?.click()}>
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          {uploading ? (
            <><div style={{ fontWeight: 500, color: 'var(--acc)', marginBottom: '4px' }}>{uploadProgress || 'Uploading...'}</div><div style={{ fontSize: '.79rem', color: 'var(--tx3)' }}>Please wait</div></>
          ) : (
            <><div style={{ fontWeight: 500, marginBottom: '3px', color: dragOver ? 'var(--acc)' : 'var(--tx)' }}>{dragOver ? 'Drop files here' : 'Drop files here or click to browse'}</div><div style={{ fontSize: '.79rem', color: 'var(--tx3)' }}>PDF, DOCX, TXT, XLSX - Max 10MB per file</div></>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 16px', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--r)', fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--acc)' }}>How documents work:</strong> Text is extracted and stored in the bot knowledge base. Active documents are included in every bot response. Disable documents without deleting them.
      </div>

      <div className="card">
        <div className="card-title">Active Knowledge Base ({activeDocs.length} files)</div>
        {activeDocs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px', color: 'var(--tx3)', fontSize: '.84rem' }}>No active documents yet. Upload a file above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeDocs.map(d => <DocRow key={d.id} doc={d} docIcon={docIcon} expanded={expandedDoc === d.id} onToggleExpand={() => setExpandedDoc(expandedDoc === d.id ? null : d.id)} onToggleStatus={() => toggleStatus(d)} onRemove={() => removeDoc(d)} />)}
          </div>
        )}
      </div>

      {inactiveDocs.length > 0 && (
        <div className="card">
          <div className="card-title">Disabled ({inactiveDocs.length} files)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {inactiveDocs.map(d => <DocRow key={d.id} doc={d} docIcon={docIcon} expanded={expandedDoc === d.id} onToggleExpand={() => setExpandedDoc(expandedDoc === d.id ? null : d.id)} onToggleStatus={() => toggleStatus(d)} onRemove={() => removeDoc(d)} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function DocRow({ doc, docIcon, expanded, onToggleExpand, onToggleStatus, onRemove }) {
  const wordCount = doc.content ? doc.content.trim().split(/\s+/).filter(Boolean).length : 0
  const preview = doc.content ? doc.content.slice(0, 400).trim() + (doc.content.length > 400 ? '...' : '') : ''
  return (
    <div style={{ borderRadius: 'var(--rsm)', border: '1px solid var(--bdr)', background: doc.status === 'active' ? 'var(--surf)' : 'var(--surf2)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px' }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--tx3)', flexShrink: 0, minWidth: '28px', textAlign: 'center' }}>{docIcon(doc.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: doc.status === 'active' ? 'var(--tx)' : 'var(--tx3)' }}>{doc.name}</div>
          <div style={{ fontSize: '.74rem', color: 'var(--tx3)', marginTop: '2px' }}>
            {doc.file_size ? Math.round(doc.file_size / 1024) + ' KB - ' : ''}
            {wordCount > 0 ? wordCount.toLocaleString() + ' words - ' : 'No text extracted - '}
            Added {new Date(doc.created_at).toLocaleDateString()}
            {doc.usage_count > 0 ? ' - Used in ' + doc.usage_count + ' responses' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span className={'badge ' + (doc.status === 'active' ? 'badge-green' : 'badge-gray')}>{doc.status}</span>
          {wordCount > 0 && <button className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem', padding: '4px 8px' }} onClick={onToggleExpand}>{expanded ? 'Hide' : 'Preview'}</button>}
          {wordCount === 0 && <span className="badge badge-red" style={{ fontSize: '.67rem' }}>No text</span>}
          <button className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem', padding: '4px 8px' }} onClick={onToggleStatus}>{doc.status === 'active' ? 'Disable' : 'Enable'}</button>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem', padding: '4px 8px', color: 'var(--red)', borderColor: 'var(--redbd)' }} onClick={onRemove}>Remove</button>
        </div>
      </div>
      {expanded && doc.content && (
        <div style={{ borderTop: '1px solid var(--bdr)', padding: '12px 14px', background: 'var(--surf2)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--tx3)', marginBottom: '6px' }}>Extracted content - {wordCount.toLocaleString()} words total</div>
          <pre style={{ fontSize: '.76rem', fontFamily: 'Monaco, Menlo, monospace', color: 'var(--tx2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: '220px', overflow: 'auto' }}>{preview}</pre>
        </div>
      )}
    </div>
  )
}