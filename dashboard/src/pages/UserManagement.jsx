import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, ALL_PERMISSIONS, DEFAULT_CLIENT_PERMISSIONS, DEFAULT_SETTER_PERMISSIONS, ROLE_OPTIONS_FOR } from '../lib/AuthContext'

export default function UserManagement() {
  const { profile, canInvite, canRemove } = useAuth()
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [toast, setToast] = useState({ msg: '', type: 'success' })

  const isFullAccess = (role) => role === 'admin' || role === 'superadmin'

  const defaultInviteRole = profile?.role === 'client' ? 'setter' : 'client'
  const [inviteForm, setInviteForm] = useState({
    email: '', name: '', role: defaultInviteRole,
    assigned_bot_id: '', permissions: [...DEFAULT_CLIENT_PERMISSIONS]
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    let usersQuery = supabase
      .from('profiles')
      .select('id, name, email, role, assigned_bot_id, permissions, created_at, invited_by')
      .eq('disabled', false)
      .order('created_at', { ascending: false })

    if (profile?.role === 'client') {
      usersQuery = usersQuery
        .eq('role', 'setter')
        .eq('assigned_bot_id', profile.assigned_bot_id)
    }

    const { data: usersData } = await usersQuery

    let invitesQuery = supabase
      .from('invites')
      .select('id, email, name, token, role, status, expires_at, created_at, assigned_bot_id, invited_by')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (profile?.role === 'client') {
      invitesQuery = invitesQuery.eq('invited_by', profile.id)
    }

    const { data: invitesData } = await invitesQuery

    let botsQuery = supabase.from('bots').select('id, name').order('name')
    if (profile?.role === 'client') {
      botsQuery = botsQuery.eq('id', profile.assigned_bot_id)
    }
    const { data: botsData } = await botsQuery

    const botMap = {}
    ;(botsData || []).forEach(b => { botMap[b.id] = b.name })

    const usersWithBot = (usersData || []).map(u => ({ ...u, botName: botMap[u.assigned_bot_id] || null }))
    const invitesWithBot = (invitesData || []).map(i => ({ ...i, botName: botMap[i.assigned_bot_id] || null }))

    setUsers(usersWithBot)
    setInvites(invitesWithBot)
    setBots(botsData || [])
    setLoading(false)
  }

  async function sendInvite() {
    if (!inviteForm.email || !inviteForm.name) { showToast('Please fill in all required fields', 'error'); return }

    const assignedBot = profile?.role === 'client'
      ? profile.assigned_bot_id
      : inviteForm.assigned_bot_id

    if (inviteForm.role === 'client' && !assignedBot) {
      showToast('Please assign a bot', 'error'); return
    }

    try {
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36)
      const { error } = await supabase.from('invites').insert({
        email: inviteForm.email.toLowerCase(),
        name: inviteForm.name,
        token,
        role: inviteForm.role,
        assigned_bot_id: assignedBot || null,
        permissions: isFullAccess(inviteForm.role) ? null : (inviteForm.role === 'setter' ? DEFAULT_SETTER_PERMISSIONS : inviteForm.permissions),
        invited_by: profile.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending'
      })
      if (error) throw error
      const inviteLink = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(inviteLink)
      showToast('Invite created! Link copied to clipboard', 'success')
      setShowInviteModal(false)
      setInviteForm({ email: '', name: '', role: defaultInviteRole, assigned_bot_id: '', permissions: [...DEFAULT_CLIENT_PERMISSIONS] })
      loadData()
    } catch (error) {
      showToast(error.message || 'Failed to create invite', 'error')
    }
  }

  async function saveUserPermissions() {
    const { error } = await supabase
      .from('profiles')
      .update({
        role: editingUser.role,
        permissions: isFullAccess(editingUser.role) ? null : editingUser.permissions,
        assigned_bot_id: editingUser.assigned_bot_id || null
      })
      .eq('id', editingUser.id)
    if (error) { showToast('Failed to save changes', 'error'); return }
    showToast('User updated', 'success')
    setEditingUser(null)
    loadData()
  }

  async function removeUser(u) {
    if (!confirm(`Remove ${u.name || u.email}? They will lose all access immediately.`)) return
    const { error } = await supabase.from('profiles').update({ disabled: true }).eq('id', u.id)
    if (error) { showToast('Failed to remove user', 'error'); return }
    await supabase.from('invites').update({ status: 'expired' }).eq('email', u.email).eq('status', 'pending')
    showToast(`${u.name || u.email} removed`, 'success')
    loadData()
  }

  async function cancelInvite(id) {
    if (!confirm('Cancel this invite?')) return
    const { error } = await supabase.from('invites').update({ status: 'expired' }).eq('id', id)
    if (error) showToast('Failed to cancel', 'error')
    else { showToast('Invite cancelled', 'success'); loadData() }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '' }), 4000)
  }

  const availableRoles = ROLE_OPTIONS_FOR[profile?.role] || []
  const canSendInvites = availableRoles.length > 0

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      {toast.msg && <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>{toast.msg}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Team</div>
          <div className="page-sub">Manage users and control access to your workspace.</div>
        </div>
        {canSendInvites && (
          <button className="btn btn-primary" onClick={() => setShowInviteModal(true)}>+ Invite User</button>
        )}
      </div>

      {/* ── ACTIVE USERS ── */}
      <div className="card">
        <div className="card-title">
          {profile?.role === 'client' ? 'Your Setters' : `Active Users (${users.length})`}
        </div>
        {users.length === 0 ? (
          <div style={{ color: 'var(--tx3)', fontSize: '.84rem', padding: '20px 0' }}>
            {profile?.role === 'client' ? 'No setters yet. Invite one using the button above.' : 'No users yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map(u => (
              <div key={u.id} style={{
                display: 'flex', flexDirection: 'column', gap: '8px',
                padding: '14px', borderRadius: 'var(--rsm)',
                border: '1px solid var(--bdr)', background: 'var(--surf2)'
              }}>
                {/* Row 1 — Avatar + Name + Email */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--acc)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '.88rem', fontWeight: 700, color: '#1A1A1A'
                  }}>
                    {(u.name || u.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.name || '—'}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.email}
                    </div>
                  </div>
                </div>

                {/* Row 2 — Role + Bot + Access */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className={`badge ${u.role === 'superadmin' || u.role === 'admin' ? 'badge-green' : u.role === 'client' ? 'badge-blue' : 'badge-gray'}`}>
                    {u.role}
                  </span>
                  {u.botName && (
                    <span style={{ fontSize: '.76rem', color: 'var(--tx2)', background: 'var(--surf)', border: '1px solid var(--bdr)', padding: '2px 8px', borderRadius: '6px' }}>
                      {u.botName}
                    </span>
                  )}
                  <span style={{ fontSize: '.75rem', color: 'var(--tx3)', marginLeft: 'auto' }}>
                    {isFullAccess(u.role) ? 'Full access' : `${(u.permissions || []).length} of ${ALL_PERMISSIONS.length} permissions`}
                  </span>
                </div>

                {/* Row 3 — Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {isFullAccess(profile?.role) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingUser({ ...u, permissions: u.permissions || [] })}>Edit</button>
                  )}
                  {canRemove(u) && (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeUser(u)}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── PENDING INVITES ── */}
      {invites.length > 0 && (
        <div className="card">
          <div className="card-title">Pending Invites ({invites.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {invites.map(inv => (
              <div key={inv.id} style={{
                display: 'flex', flexDirection: 'column', gap: '8px',
                padding: '14px', borderRadius: 'var(--rsm)',
                border: '1px solid var(--ambbd)', background: 'var(--ambbg)'
              }}>
                {/* Row 1 — Name + Email */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--amb)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '.88rem', fontWeight: 700, color: '#fff'
                  }}>
                    {(inv.name || inv.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.name || '—'}
                    </div>
                    <div style={{ fontSize: '.75rem', color: 'var(--tx3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.email}
                    </div>
                  </div>
                </div>

                {/* Row 2 — Role + Bot + Expiry */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className={`badge ${isFullAccess(inv.role) ? 'badge-green' : inv.role === 'client' ? 'badge-blue' : 'badge-gray'}`}>
                    {inv.role}
                  </span>
                  {inv.botName && (
                    <span style={{ fontSize: '.76rem', color: 'var(--tx2)', background: 'var(--surf)', border: '1px solid var(--bdr)', padding: '2px 8px', borderRadius: '6px' }}>
                      {inv.botName}
                    </span>
                  )}
                  <span style={{ fontSize: '.74rem', color: 'var(--tx3)', marginLeft: 'auto' }}>
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Row 3 — Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => cancelInvite(inv.id)}>Cancel invite</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INVITE MODAL ── */}
      {showInviteModal && (
        <ModalOverlay onClose={() => setShowInviteModal(false)}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '20px' }}>Invite New User</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Name *">
              <input className="form-input" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </FormField>
            <FormField label="Email *">
              <input className="form-input" type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="their@email.com" />
            </FormField>

            {availableRoles.length > 1 && (
              <FormField label="Role *">
                <select className="form-input" value={inviteForm.role}
                  onChange={e => {
                    const r = e.target.value
                    const defaultPerms = r === 'setter' ? DEFAULT_SETTER_PERMISSIONS : DEFAULT_CLIENT_PERMISSIONS
                    setInviteForm(f => ({ ...f, role: r, permissions: defaultPerms }))
                  }}>
                  {availableRoles.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </FormField>
            )}

            {isFullAccess(profile?.role) && (
              <FormField label="Assign Bot *">
                <select className="form-input" value={inviteForm.assigned_bot_id} onChange={e => setInviteForm(f => ({ ...f, assigned_bot_id: e.target.value }))}>
                  <option value="">Select a bot...</option>
                  {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <div style={{ fontSize: '.78rem', color: 'var(--tx3)', marginTop: '4px' }}>User will only see data for this bot</div>
              </FormField>
            )}

            {!isFullAccess(inviteForm.role) && inviteForm.role !== 'setter' && (
              <PermissionCheckboxes
                permissions={inviteForm.permissions}
                onChange={perms => setInviteForm(f => ({ ...f, permissions: perms }))}
              />
            )}

            {isFullAccess(inviteForm.role) && <AdminNote />}

            {inviteForm.role === 'setter' && (
              <div style={{ padding: '10px 12px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', fontSize: '.82rem', color: 'var(--tx2)' }}>
                Setters will have access to the Setter Inbox only. You can edit their access after they join.
              </div>
            )}

            <div style={{ padding: '12px 14px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.55 }}>
              After clicking "Send Invite", a link is copied to your clipboard. Send it to the user — they click it, set a password, and they're in. Expires in 7 days.
            </div>
            <ModalButtons onCancel={() => setShowInviteModal(false)} onConfirm={sendInvite} confirmLabel="Send Invite" />
          </div>
        </ModalOverlay>
      )}

      {/* ── EDIT USER MODAL ── */}
      {editingUser && isFullAccess(profile?.role) && (
        <ModalOverlay onClose={() => setEditingUser(null)}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>Edit Access</div>
            <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>{editingUser.name || editingUser.email}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Role">
              <select className="form-input" value={editingUser.role} onChange={e => setEditingUser(u => ({ ...u, role: e.target.value }))}>
                <option value="setter">Setter</option>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
                {profile?.role === 'superadmin' && <option value="superadmin">Superadmin</option>}
              </select>
            </FormField>
            <FormField label="Assigned Bot">
              <select className="form-input" value={editingUser.assigned_bot_id || ''} onChange={e => setEditingUser(u => ({ ...u, assigned_bot_id: e.target.value }))}>
                <option value="">No bot assigned</option>
                {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FormField>

            {!isFullAccess(editingUser.role) ? (
              <PermissionCheckboxes
                permissions={editingUser.permissions || []}
                onChange={perms => setEditingUser(u => ({ ...u, permissions: perms }))}
              />
            ) : (
              <AdminNote />
            )}

            <ModalButtons onCancel={() => setEditingUser(null)} onConfirm={saveUserPermissions} confirmLabel="Save Changes" />
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// ─── Reusable components ──────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', padding: '28px', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--tx3)' }}>×</button>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}

function PermissionCheckboxes({ permissions, onChange }) {
  function toggle(key) {
    if (permissions.includes(key)) onChange(permissions.filter(p => p !== key))
    else onChange([...permissions, key])
  }
  return (
    <div className="form-group">
      <label className="form-label">Permissions</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
        {ALL_PERMISSIONS.map(p => (
          <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={permissions.includes(p.key)} onChange={() => toggle(p.key)} style={{ marginTop: '3px', accentColor: 'var(--acc)' }} />
            <div>
              <div style={{ fontSize: '.84rem', fontWeight: 500, color: 'var(--tx)' }}>{p.label}</div>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)' }}>{p.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

function AdminNote() {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--rsm)', fontSize: '.82rem', color: 'var(--tx2)' }}>
      Admins and Superadmins automatically have full access to everything.
    </div>
  )
}

function ModalButtons({ onCancel, onConfirm, confirmLabel }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" style={{ flex: 2 }} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  )
}